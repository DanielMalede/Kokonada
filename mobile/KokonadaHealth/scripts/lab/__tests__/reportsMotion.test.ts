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
import { DISPLAY_120, DISPLAY_60, motionRun, planShot, plan as fixturePlan, type Json } from '../reports/__fixtures__/proofs';

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
      '  dark-rest-fixed: 2 launches, equal (PASS)',
    ]);
    expect(after('QA-034/035 zero-frames: still tier and reduced motion draw nothing', 2)).toEqual([
      '  dark-rest-still: 0 frames in 10 s (PASS)',
      '  dark-rest-reduced: 0 frames in 10 s (PASS)',
    ]);
    expect(after('draws-frames: the positive control draws', 1)).toEqual(['  dark-rest-full: 1187 frames in 10 s (PASS)']);
    expect(after('UI-171 rate: frames per second inside the plan’s band', 2)).toEqual([
      '  rate-low: 598 frames in 10 s = 59.8 fps, band 55 to 62, display 120 Hz (PASS)',
      '  rate-full: 1190 frames in 10 s = 119 fps, band 110 to 125, display 120 Hz (PASS)',
    ]);
    expect(after('framestats (informational, never judged)', 1)).toEqual(['  stats-full: seconds 10, frames 1190, janky 18, jankPercent 1.5 (informational)']);
  });
});

describe('motion fails on a broken proof', () => {
  it('QA-078: launches that differ are listed, exit 1', () => {
    const r = run(withDeterminism((d) => d.map((x) => (x.shot === 'dark-rest-fixed' ? { ...x, equal: false, hashes: ['2'.repeat(64), '3'.repeat(64)] } : x))));
    expect(r.status).toBe(1);
    expect(r.report).toContain(`  dark-rest-fixed: 2 launches, DIFFER: ${'2'.repeat(12)}, ${'3'.repeat(12)} (FAIL)`);
    expect(last(r.report)).toBe('FAIL: 1 problem: dark-rest-fixed determinism');
  });

  it('QA-078: the hashes decide, not the manifest’s equal flag', () => {
    const r = run(withDeterminism((d) => d.map((x) => (x.shot === 'dark-rest-still' ? { ...x, equal: true, hashes: ['1'.repeat(64), '4'.repeat(64)] } : x))));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  dark-rest-still: 2 launches, DIFFER');
  });

  it('QA-078: a shot planned twice with no determinism record: exit 1', () => {
    const r = run(withDeterminism((d) => d.filter((x) => x.shot !== 'dark-rest-fixed')));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  dark-rest-fixed: planned 2 launches, no determinism record (FAIL)');
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
    ['rate-low', 640, '  rate-low: 640 frames in 10 s = 64 fps, band 55 to 62, display 120 Hz (FAIL)'],
    ['rate-low', 540, '  rate-low: 540 frames in 10 s = 54 fps, band 55 to 62, display 120 Hz (FAIL)'],
    ['rate-full', 900, '  rate-full: 900 frames in 10 s = 90 fps, band 110 to 125, display 120 Hz (FAIL)'],
  ])('a rate outside its band (%s at %i frames): exit 1', (shot, frames, line) => {
    const r = run(withProof(shot, (p) => ({ ...p, frames, fps: frames / 10, passed: false })));
    expect(r.status).toBe(1);
    expect(r.report).toContain(line);
  });

  it('a rate on the band’s edge passes (the band is inclusive)', () => {
    const r = run(withProof('rate-low', (p) => ({ ...p, frames: 620, fps: 62 })));
    expect(r.status).toBe(0);
  });

  it.each(['dark-rest-still', 'dark-rest-full', 'rate-full', 'stats-full'])('a proof the plan names and the manifest lacks (%s): exit 1', (shot) => {
    const r = run(withProof(shot, () => null));
    expect(r.status).toBe(1);
    expect(r.report).toMatch(new RegExp(`^ {2}${shot}: no \\S+ proof in the manifest \\(FAIL\\)$`, 'm'));
  });

  it('framestats is informational: any numbers pass', () => {
    const r = run(withProof('stats-full', (p) => ({ ...p, janky: 952, jankPercent: 80 })));
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

// RA-52 (S2): a low-tier rate proof taken while the display itself runs at or below the band's ceiling (battery saver, or
// the phone set to Standard, 60 Hz) cannot see the tier's cap: frames at 60 per second are what the display allows, capped
// or not. Such a proof is neither PASS nor FAIL but "cap not observable", and the run is INCONCLUSIVE for UI-171 (exit 3)
// unless another low-tier rate proof, taken where the display ran above the band, passed.
describe('RA-52: the low tier’s cap is observable only above the display’s rate', () => {
  const at60 = () => withProof('rate-low', (p) => ({ ...p, display: DISPLAY_60 }));
  /** The motion run with a second low-tier rate shot, its proof as given. */
  function withSecondLow(proof: Json) {
    const m = at60();
    const shots = [...(m.plan.shots as Json[]), planShot('rate-low-2', 'field.abyss.light.three.low', { proof: { kind: 'rate', seconds: 10, band: { min: 55, max: 62 } } })];
    return { plan: fixturePlan('v1-motion', shots), manifest: { ...m.manifest, proofs: [...(m.manifest.proofs as Json[]), { shot: 'rate-low-2', kind: 'rate', seconds: 10, band: { min: 55, max: 62 }, passed: true, ...proof }] } };
  }

  it('a low-tier rate proof at a 60 Hz display, in its band, is not PASS: cap not observable, the run INCONCLUSIVE, exit 3', () => {
    const r = run(at60());
    expect(r.status).toBe(3);
    expect(r.report).toContain('  rate-low: 598 frames in 10 s = 59.8 fps, band 55 to 62, display 60 Hz: cap not observable (display at 60 Hz)');
    expect(r.report).not.toMatch(/^ {2}rate-low: .*\(PASS\)$/m);
    expect(last(r.report)).toBe('INCONCLUSIVE: UI-171’s low-tier cap was not observable (rate-low: display at 60 Hz); no low-tier rate proof was taken above its band; nothing else failed');
  });

  it('a display exactly at the band’s ceiling cannot see the cap either', () => {
    const r = run(withProof('rate-low', (p) => ({ ...p, display: { ...DISPLAY_60, refreshHz: 62 } })));
    expect(r.status).toBe(3);
    expect(r.report).toContain('display 62 Hz: cap not observable (display at 62 Hz)');
  });

  it('a low-tier rate proof at a 120 Hz display, in its band, is PASS', () => {
    const r = run(motionRun());
    expect(r.status).toBe(0);
    expect(r.report).toContain('  rate-low: 598 frames in 10 s = 59.8 fps, band 55 to 62, display 120 Hz (PASS)');
  });

  it('another low-tier rate proof taken at 120 Hz that passed decides it: PASS, the 60 Hz proof still not counted', () => {
    const r = run(withSecondLow({ frames: 600, fps: 60, display: DISPLAY_120 }));
    expect(r.status).toBe(0);
    expect(r.report).toContain('display 60 Hz: cap not observable (display at 60 Hz)');
    expect(r.report).toContain('  rate-low-2: 600 frames in 10 s = 60 fps, band 55 to 62, display 120 Hz (PASS)');
    expect(last(r.report)).toBe('PASS: 2 determinism pairs equal, 2 zero-frames, 1 draws-frames, 2 rate proofs; framestats informational; 1 low-tier rate proof not observable (rate-low: display at 60 Hz)');
  });

  it('a second low-tier proof also at 60 Hz does not decide it: INCONCLUSIVE', () => {
    const r = run(withSecondLow({ frames: 600, fps: 60, display: DISPLAY_60 }));
    expect(r.status).toBe(3);
    expect(last(r.report)).toMatch(/^INCONCLUSIVE: /);
  });

  it('a failure elsewhere wins over INCONCLUSIVE: exit 1', () => {
    const m = at60();
    const proofs = (m.manifest.proofs as Json[]).map((p) => (p.shot === 'rate-full' ? { ...p, frames: 900, fps: 90, passed: false } : p));
    const r = run({ plan: m.plan, manifest: { ...m.manifest, proofs } });
    expect(r.status).toBe(1);
    expect(last(r.report)).toBe('FAIL: 1 problem: rate-full rate');
  });

  it('a full-tier proof is not held to the cap rule: at a 60 Hz display, out of its band, it fails', () => {
    const r = run(withProof('rate-full', (p) => ({ ...p, frames: 600, fps: 60, display: DISPLAY_60, passed: false })));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  rate-full: 600 frames in 10 s = 60 fps, band 110 to 125, display 60 Hz (FAIL)');
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

  it('a planned rate proof without its band, which the harness’s validatePlan refuses: exit 2, with its sentence', () => {
    const m = motionRun();
    const shots = (m.plan.shots as Json[]).map((s) => (s.id === 'rate-full' ? { ...s, proof: { kind: 'rate', seconds: 10 } } : s));
    const r = run({ plan: { ...m.plan, shots }, manifest: m.manifest });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/validatePlan.*shots\[5\]\.proof\.band must be \{ min, max \}/);
    expect(r.report).toBeNull();
  });

  it('a plan the harness would refuse (a shot without expect): exit 2, with the harness’s sentence', () => {
    const m = motionRun();
    const shots = (m.plan.shots as Json[]).map((s) => (s.id === 'stats-full' ? (({ expect: _e, ...rest }) => rest)(s) : s));
    const r = run({ plan: { ...m.plan, shots }, manifest: m.manifest });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/validatePlan.*shots\[6\]\.expect must be/);
  });

  it.each([
    ['a rate proof whose fps is not its frames over its seconds', 'rate-low', (p: Json) => ({ ...p, fps: 61 }), '"fps"'],
    ['a rate proof whose band is not the plan’s', 'rate-low', (p: Json) => ({ ...p, band: { min: 0, max: 1000 } }), '"band"'],
    ['a rate proof whose band floor alone is not the plan’s', 'rate-low', (p: Json) => ({ ...p, band: { min: 54, max: 62 } }), '"band"'],
    ['a rate proof whose band ceiling alone is not the plan’s', 'rate-low', (p: Json) => ({ ...p, band: { min: 55, max: 63 } }), '"band"'],
    ['a proof whose seconds are not the plan’s', 'dark-rest-full', (p: Json) => ({ ...p, seconds: 5 }), '"seconds"'],
    ['a proof field the harness does not write', 'dark-rest-still', (p: Json) => ({ ...p, p99Ms: 14 }), '"p99Ms"'],
    ['a framestats proof without its janky count', 'stats-full', (p: Json) => (({ janky: _j, ...rest }) => rest)(p), '"janky"'],
    ['a rate proof without the display it was taken at (RA-52)', 'rate-low', (p: Json) => (({ display: _d, ...rest }) => rest)(p), '"display"'],
    ['a rate proof whose display has no refresh rate', 'rate-low', (p: Json) => ({ ...p, display: { mode: 'standard', key: 'refresh_rate_mode' } }), '"display.refreshHz"'],
    ['a rate proof whose display refresh rate is not a positive number', 'rate-low', (p: Json) => ({ ...p, display: { ...DISPLAY_60, refreshHz: 0 } }), '"display.refreshHz"'],
    ['a rate proof whose display has no mode', 'rate-low', (p: Json) => ({ ...p, display: { refreshHz: 60, key: 'refresh_rate_mode' } }), '"display.mode"'],
    ['a rate proof whose display has no key', 'rate-low', (p: Json) => ({ ...p, display: { refreshHz: 60, mode: 'standard' } }), '"display.key"'],
  ])('%s: exit 2, naming the field', (_, shot, edit, field) => {
    const r = run(withProof(shot, edit));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(field);
    expect(r.report).toBeNull();
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
