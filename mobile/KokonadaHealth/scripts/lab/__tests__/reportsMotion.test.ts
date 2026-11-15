/// <reference types="node" />
// B8-8e (the architect's B8 plan at 199b138): scripts/lab/reports/motion.mts summarises a capture run from its manifest,
// with the manifest's own numbers, against the plan that ran:
//   · QA-078: every shot launched more than once has equal hashes; every shot whose launches differ is listed;
//   · QA-034/035: each zero-frames proof drew 0 frames (the still tier, reduced motion), and each draws-frames proof, its
//     positive control, drew some;
//   · UI-171: each rate proof's frames per second lies inside the band its plan gives;
//   · framestats is informational: printed, never judged.
// It exits 1 on a failed determinism pair, a non-zero zero-frames proof, a control that drew nothing, a rate outside its
// band, a proof (or determinism record) the plan names that the manifest lacks, or a failed run; 2 on an input it cannot
// use (a field missing, named); it never overwrites a report.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { motionRun, type Json } from '../reports/__fixtures__/proofs';

jest.setTimeout(120000);

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/lab/reports/motion.mts');

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function run(r: { plan: Json; manifest: Json }, out?: string) {
  const dir = fs.mkdtempSync(path.join(root, 'run-'));
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(r.plan));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(r.manifest));
  const file = out ?? path.join(dir, 'motion.txt');
  if (out) fs.writeFileSync(out, 'an earlier report\n');
  const p = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--plan', path.join(dir, 'plan.json'), '--manifest', path.join(dir, 'manifest.json'), '--out', file], { cwd: APP, encoding: 'utf8' });
  return { status: p.status, stdout: p.stdout, stderr: p.stderr, report: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}
const last = (report: string | null) => (report ?? '').trimEnd().split(/\r?\n/).pop();
/** The motion run with one manifest proof changed (or removed, on null). */
function withProof(shot: string, edit: (p: Json) => Json | null) {
  const m = motionRun();
  const proofs = (m.manifest.proofs as Json[]).flatMap((p) => {
    if (p.shot !== shot) return [p];
    const e = edit(p);
    return e === null ? [] : [e];
  });
  return { plan: m.plan, manifest: { ...m.manifest, proofs } };
}
function withDeterminism(edit: (d: Json[]) => Json[]) {
  const m = motionRun();
  return { plan: m.plan, manifest: { ...m.manifest, determinism: edit(m.manifest.determinism as Json[]) } };
}

describe('motion on a sound run', () => {
  let r: ReturnType<typeof run>;
  beforeAll(() => {
    r = run(motionRun());
  });

  it('exits 0, prints what it writes', () => {
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toBe(r.report);
    expect(last(r.report)).toBe('PASS: 2 determinism pairs equal, 2 zero-frames, 1 draws-frames, 2 rate proofs; framestats informational');
  });

  it('every section, with the manifest’s own numbers', () => {
    const L = r.report!.split(/\r?\n/);
    const after = (head: string, n: number) => L.slice(L.indexOf(head) + 1, L.indexOf(head) + 1 + n);
    expect(after('QA-078 determinism: every launch of a shot draws the same pixels', 2)).toEqual([
      '  dark-rest-still: 2 launches, equal (PASS)',
      '  dark-rest-full: 2 launches, equal (PASS)',
    ]);
    expect(after('QA-034/035 zero-frames: still tier and reduced motion draw nothing', 2)).toEqual([
      '  dark-rest-still: 0 frames in 10 s (PASS)',
      '  dark-rest-reduced: 0 frames in 10 s (PASS)',
    ]);
    expect(after('draws-frames: the positive control draws', 1)).toEqual(['  dark-rest-full: 1187 frames in 10 s (PASS)']);
    expect(after('UI-171 rate: frames per second inside the plan’s band', 2)).toEqual([
      '  rate-low: 598 frames in 10 s = 59.8 fps, band 55 to 62 (PASS)',
      '  rate-full: 1190 frames in 10 s = 119 fps, band 110 to 125 (PASS)',
    ]);
    expect(after('framestats (informational, never judged)', 1)).toEqual(['  stats-full: seconds 10, frames 1190, jankPercent 1.5, p90Ms 9, p99Ms 14 (informational)']);
  });
});

describe('motion fails on a broken proof', () => {
  it('QA-078: launches that differ are listed, exit 1', () => {
    const r = run(withDeterminism((d) => d.map((x) => (x.shot === 'dark-rest-full' ? { ...x, equal: false, hashes: ['2'.repeat(64), '3'.repeat(64)] } : x))));
    expect(r.status).toBe(1);
    expect(r.report).toContain(`  dark-rest-full: 2 launches, DIFFER: ${'2'.repeat(12)}, ${'3'.repeat(12)} (FAIL)`);
    expect(last(r.report)).toBe('FAIL: 1 problem: dark-rest-full determinism');
  });

  it('QA-078: the hashes decide, not the manifest’s equal flag', () => {
    const r = run(withDeterminism((d) => d.map((x) => (x.shot === 'dark-rest-still' ? { ...x, equal: true, hashes: ['1'.repeat(64), '4'.repeat(64)] } : x))));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  dark-rest-still: 2 launches, DIFFER');
  });

  it('QA-078: a shot planned twice with no determinism record: exit 1', () => {
    const r = run(withDeterminism((d) => d.filter((x) => x.shot !== 'dark-rest-full')));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  dark-rest-full: planned 2 launches, no determinism record (FAIL)');
  });

  it('a zero-frames proof that drew frames: exit 1', () => {
    const r = run(withProof('dark-rest-reduced', (p) => ({ ...p, frames: 3, passed: false })));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  dark-rest-reduced: 3 frames in 10 s (FAIL)');
  });

  it('a positive control that drew nothing: exit 1', () => {
    const r = run(withProof('dark-rest-full', (p) => ({ ...p, frames: 0 })));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  dark-rest-full: 0 frames in 10 s (FAIL)');
  });

  it.each([
    ['rate-low', 640, '  rate-low: 640 frames in 10 s = 64 fps, band 55 to 62 (FAIL)'],
    ['rate-low', 540, '  rate-low: 540 frames in 10 s = 54 fps, band 55 to 62 (FAIL)'],
    ['rate-full', 900, '  rate-full: 900 frames in 10 s = 90 fps, band 110 to 125 (FAIL)'],
  ])('a rate outside its band (%s at %i frames): exit 1', (shot, frames, line) => {
    const r = run(withProof(shot, (p) => ({ ...p, frames })));
    expect(r.status).toBe(1);
    expect(r.report).toContain(line);
  });

  it('a rate on the band’s edge passes (the band is inclusive)', () => {
    const r = run(withProof('rate-low', (p) => ({ ...p, frames: 620 })));
    expect(r.status).toBe(0);
  });

  it.each(['dark-rest-still', 'dark-rest-full', 'rate-full', 'stats-full'])('a proof the plan names and the manifest lacks (%s): exit 1', (shot) => {
    const r = run(withProof(shot, () => null));
    expect(r.status).toBe(1);
    expect(r.report).toMatch(new RegExp(`^ {2}${shot}: no \\S+ proof in the manifest \\(FAIL\\)$`, 'm'));
  });

  it('framestats is informational: any numbers pass', () => {
    const r = run(withProof('stats-full', (p) => ({ ...p, jankPercent: 80, p99Ms: 900, passed: false })));
    expect(r.status).toBe(0);
    expect(r.report).toContain('jankPercent 80');
  });

  it('a failed capture run: exit 1', () => {
    const m = motionRun();
    const r = run({ plan: m.plan, manifest: { ...m.manifest, outcome: 'failed', failure: 'planted failure' } });
    expect(r.status).toBe(1);
    expect(r.report).toContain('the capture run failed: planted failure');
  });
});

describe('motion refuses what it cannot use', () => {
  it.each([['zero-frames', 'dark-rest-still', 'frames'], ['rate', 'rate-low', 'seconds'], ['draws-frames', 'dark-rest-full', 'shot']])('a %s proof without "%s"’s %s: exit 2, naming the field', (_, shot, field) => {
    const r = run(withProof(shot, (p) => {
      const c = { ...p };
      delete c[field];
      return c;
    }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`"${field}"`);
    expect(r.report).toBeNull();
  });

  it('a planned rate proof without its band: exit 2, naming "proof.band"', () => {
    const m = motionRun();
    const shots = (m.plan.shots as Json[]).map((s) => (s.id === 'rate-full' ? { ...s, proof: { kind: 'rate', seconds: 10 } } : s));
    const r = run({ plan: { ...m.plan, shots }, manifest: m.manifest });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"proof.band"');
  });

  it('a determinism record without hashes: exit 2, naming "hashes"', () => {
    const r = run(withDeterminism((d) => d.map((x) => ({ shot: x.shot, equal: x.equal }))));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"hashes"');
  });

  it('a manifest of another plan: exit 2', () => {
    const m = motionRun();
    const r = run({ plan: m.plan, manifest: { ...m.manifest, plan: 'v1-cost' } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"plan"');
  });

  it('an existing report: exit 2, left as it was', () => {
    const out = path.join(fs.mkdtempSync(path.join(root, 'out-')), 'motion.txt');
    const r = run(motionRun(), out);
    expect(r.status).toBe(2);
    expect(fs.readFileSync(out, 'utf8')).toBe('an earlier report\n');
  });
});
