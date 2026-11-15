/// <reference types="node" />
// B8-8e (the architect's B8 plan at 199b138; forks F2, F3): scripts/lab/reports/fieldCost.mts, on planted runs. It reads
// each planned cost.* shot's RESULT line as the manifest carries it, prints a table per scene and tier with the heavy and
// empty calibration rows beside the field's and the ratio heavy/field, every number labelled "informational, DEC-082
// OPEN", and asserts NO threshold on any cost. It exits 1 only when the instrument cannot be trusted: a RESULT missing for
// a planned cost shot, a number that is not finite, a missing field (named), the wrong clock, or a broken calibration
// (heavy not above the field, or empty not below it); 2 on an input it cannot use; it never overwrites a report.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { surfaceRule, validatePlan } from '../capture.mjs';
import { costRun, type Json } from '../reports/__fixtures__/proofs';

jest.setTimeout(120000);

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/lab/reports/fieldCost.mts');
const LABEL = 'informational, DEC-082 OPEN';

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-cost-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function run(run: { plan: Json; manifest: Json }, opts: { out?: string; argv?: string[] } = {}) {
  const dir = fs.mkdtempSync(path.join(root, 'run-'));
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(run.plan));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(run.manifest));
  const out = opts.out ?? path.join(dir, 'cost.txt');
  if (opts.out) fs.writeFileSync(out, 'an earlier report\n');
  const argv = opts.argv ?? ['--plan', path.join(dir, 'plan.json'), '--manifest', path.join(dir, 'manifest.json'), '--out', out];
  const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...argv], { cwd: APP, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out, report: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null };
}
const lines = (report: string | null) => (report ?? '').split(/\r?\n/);
const last = (report: string | null) => (report ?? '').trimEnd().split(/\r?\n/).pop();
const set = (r: Json, dotted: string, value: unknown): Json => {
  const copy = JSON.parse(JSON.stringify(r)) as Json;
  const keys = dotted.split('.');
  let at = copy as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
  if (value === undefined) delete at[keys[keys.length - 1]];
  else at[keys[keys.length - 1]] = value;
  return copy;
};

describe('fieldCost on a sound run', () => {
  let r: ReturnType<typeof run>;
  beforeAll(() => {
    r = run(costRun());
  });

  it('exits 0, prints what it writes, and says no threshold is asserted', () => {
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toBe(r.report);
    expect(lines(r.report)[0]).toBe(`fieldCost (B8-8e: the field's cost bench, forks F2 and F3): every number is ${LABEL}; no threshold is asserted`);
    expect(last(r.report)).toBe(`PASS: 6 RESULT lines, calibration sound; no threshold asserted on any cost (${LABEL})`);
  });

  it('a table per scene and tier: the field, the storm, and the heavy and empty calibration rows beside it', () => {
    const L = lines(r.report);
    const full = L.indexOf('abyss dark three full');
    expect(full).toBeGreaterThan(0);
    const row = (variant: string, gpu: number) =>
      `  ${variant}: frames 600, displayHz 120, stepUs 210/340/900, renderUs 1500/2100/4000, gpuProxyUs ${gpu}/${gpu + 200}/${gpu + 900} (p50/p95/max µs; ${LABEL})`;
    expect(L.slice(full + 1, full + 6)).toEqual([
      row('field', 800), row('storm', 950), row('heavy', 3000), row('empty', 100),
      `  calibration: heavy/field gpuProxyUs p50 3.75, empty/field 0.125 (${LABEL}); heavy above the field: yes; empty below it: yes`,
    ]);
    const low = L.indexOf('abyss dark three low');
    expect(L.slice(low + 1, low + 4)).toEqual([row('field', 500), row('storm', 600), '  calibration: none planned for this scene and tier']);
  });

  it('every line that carries a cost number carries the label', () => {
    const numbered = lines(r.report).filter((l) => l.startsWith('  ') && /\d/.test(l));
    expect(numbered.length).toBe(7);
    for (const l of numbered) expect(l).toContain(LABEL);
  });
});

describe('fieldCost asserts no threshold', () => {
  it('costs a hundred times larger, the calibration still sound: exit 0', () => {
    const big = costRun((_, res) => ({
      ...res,
      stepUs: { p50: 21000, p95: 34000, max: 900000 }, renderUs: { p50: 150000, p95: 210000, max: 400000 },
      gpuProxyUs: { p50: (res.gpuProxyUs as { p50: number }).p50 * 100, p95: 1e7, max: 1e8 }, frames: 3,
    }));
    const r = run(big);
    expect(r.status).toBe(0);
    expect(r.report).toContain('gpuProxyUs 80000/10000000/100000000');
  });
});

describe('fieldCost fails when the instrument cannot be trusted', () => {
  it('a planned cost shot with no RESULT: exit 1, naming the shot', () => {
    const r = run(costRun((id, res) => (id === 'cost-low-storm' ? null : res)));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  FAIL: cost-low-storm: no RESULT line for the planned cost shot cost.abyss.dark.three.low.storm');
    expect(last(r.report)).toBe('FAIL: the cost instrument cannot be trusted (1 problem); no threshold was asserted');
  });

  it.each([
    ['a number that is not finite', 'gpuProxyUs.p95', 'NaN', '"gpuProxyUs.p95"'],
    ['a null number', 'stepUs.max', null, '"stepUs.max"'],
    ['a missing field', 'renderUs', undefined, '"renderUs"'],
    ['a missing displayHz', 'displayHz', undefined, '"displayHz"'],
    ['the wrong clock', 'clock', 'Date.now', '"clock"'],
    ['another kind', 'kind', 'flash', '"kind"'],
    ['another scene than the shot', 'scene', 'cost.abyss.dark.rest.full', '"scene"'],
  ])('%s in a RESULT: exit 1, naming the field', (_, field, value, named) => {
    const r = run(costRun((id, res) => (id === 'cost-full-storm' ? set(res, field, value) : res)));
    expect(r.status).toBe(1);
    const fail = lines(r.report).find((l) => l.startsWith('  FAIL: cost-full-storm: '));
    expect(fail).toContain(named);
  });

  it('heavy not above the field: exit 1, the calibration broken', () => {
    const r = run(costRun((id, res) => (id === 'cost-full-heavy' ? set(res, 'gpuProxyUs.p50', 800) : res)));
    expect(r.status).toBe(1);
    expect(r.report).toContain('heavy above the field: NO');
    expect(r.report).toContain('  FAIL: abyss dark three full: the calibration is broken: heavy gpuProxyUs p50 800 is not above the field’s 800');
  });

  it('empty not below the field: exit 1, the calibration broken', () => {
    const r = run(costRun((id, res) => (id === 'cost-full-empty' ? set(res, 'gpuProxyUs.p50', 900) : res)));
    expect(r.status).toBe(1);
    expect(r.report).toContain('empty below it: NO');
  });

  it('a calibration row with no field row beside it: exit 1', () => {
    const r = run(costRun((id, res) => (id === 'cost-full' ? null : res)));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  FAIL: abyss dark three full: the calibration has no field row to compare with');
  });

  it('a failed capture run: exit 1', () => {
    const c = costRun();
    const r = run({ plan: c.plan, manifest: { ...c.manifest, outcome: 'failed', failure: 'planted failure' } });
    expect(r.status).toBe(1);
    expect(r.report).toContain('the capture run failed: planted failure');
  });
});

describe('fieldCost refuses what it cannot use', () => {
  it('a manifest of another plan: exit 2', () => {
    const c = costRun();
    const r = run({ plan: c.plan, manifest: { ...c.manifest, plan: 'v1-field' } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"plan"');
    expect(r.report).toBeNull();
  });

  it('a manifest with no proofs list: exit 2, naming "proofs"', () => {
    const c = costRun();
    const r = run({ plan: c.plan, manifest: set(c.manifest, 'proofs', undefined) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"proofs"');
  });

  it('a planned cost scene that is not cost.<direction>.<face>.<scene>.<tier>[.storm|.heavy|.empty]: exit 2, naming the shot', () => {
    const c = costRun();
    const shots = (c.plan.shots as Json[]).map((s) => (s.id === 'cost-low' ? { ...s, scene: 'cost.abyss.dim.three.low' } : s));
    const r = run({ plan: { ...c.plan, shots }, manifest: c.manifest });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cost-low');
  });

  it('an existing report: exit 2, left as it was', () => {
    const out = path.join(fs.mkdtempSync(path.join(root, 'out-')), 'cost.txt');
    const r = run(costRun(), { out });
    expect(r.status).toBe(2);
    expect(fs.readFileSync(out, 'utf8')).toBe('an earlier report\n');
  });

  it('no --plan: exit 2 with the usage', () => {
    const r = run(costRun(), { argv: ['--manifest', 'x.json', '--out', path.join(root, 'y.txt')] });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
  });
});

// The shipped cost plan, as the harness reads it: every cost shot asks for the bench's RESULT line (the harness's `result`
// proof, B8-5b), or the manifest would carry none and fieldCost could only say it is missing; and every cost scene is held
// by the harness's surface rule for `cost.` to READY's `ready` (UI-223).
describe('the shipped v1-cost plan', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(APP, 'scripts/lab/capture-plans/v1-cost.json'), 'utf8')) as { id: string; shots: Array<{ id: string; scene: string; proof?: Json }> };

  it('is a valid plan for the harness, with cost shots', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.shots.length).toBeGreaterThanOrEqual(12);
    expect(plan.shots.every((s) => s.scene.startsWith('cost.'))).toBe(true);
  });

  it('every cost shot carries the result proof, with a window inside the harness’s bound', () => {
    for (const s of plan.shots) {
      expect([s.id, s.proof?.kind]).toEqual([s.id, 'result']);
      expect([s.id, Object.keys(s.proof!).sort()]).toEqual([s.id, ['kind', 'seconds']]);
      expect(s.proof!.seconds as number).toBeGreaterThanOrEqual(30);
      expect(s.proof!.seconds as number).toBeLessThanOrEqual(120);
    }
  });

  it('every cost scene is held by the harness’s cost. rule to READY saying ready', () => {
    for (const s of plan.shots) expect([s.scene, surfaceRule(s.scene)]).toEqual([s.scene, expect.objectContaining({ prefix: 'cost.', status: 'ready' })]);
  });
});
