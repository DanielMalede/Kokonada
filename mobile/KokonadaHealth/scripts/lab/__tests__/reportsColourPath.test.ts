/// <reference types="node" />
// B8-8d (the architect's B8 plan at 199b138; B4 fork 2E, D1–D5; the designer's 3c amendments): scripts/lab/reports/
// colourPath.mts, on planted witness captures. For each witness.abyss.<face> row it rebuilds witnessLayout from the row's
// own facts (the stage in dp, px per dp from the density, the font scale) and samples each patch's central 16 × 16 dp:
//   · W1a, W2 and W3 = the token hex within ±1 per channel (their medians), and they agree with each other within ±1;
//   · W1b: the median of (capture − the law's noise-free colour) within ±1 per channel;
//   · a planted patch the layout marks `separates` must be more than MODEL_SEPARATION_LSB from the hex, or the
//     instrument is blind; an identity-only planted patch is listed, not judged;
//   · a true patch that shows a planted model's bytes is named as the diagnosis.
// Byte evidence only in the sRGB/Natural display mode: any other or unknown mode is "eyes-on only, not evidence".
// Exit 1 on a failed judgement, a blind instrument, no witness row (or none as evidence) or a failed run; 2 on an input
// it cannot use (a field missing, named); a report is never overwritten.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRow } from '../lib/manifest.mjs';
import { without, withValue } from '../reports/__fixtures__/rows';
import { MODEL_SEPARATION_LSB, lsbDelta, WITNESS_MODELS } from '../../../src/design/v2/color/displayP3';
import { witnessColours } from '../../../src/design/lab/witness/witnessFrames';
import { witnessLayout } from '../../../src/design/lab/witness/witnessLayout';

jest.setTimeout(180000);

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/lab/reports/colourPath.mts');
const MAKE = path.join(APP, 'scripts/lab/reports/__fixtures__/makeWitness.mts');
const SRGB = 'ColorMode::SRGB (7)';
const NATIVE = 'ColorMode::NATIVE (0)';

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'colour-path-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

type Plant = { kind: string; colour?: string; paint?: string; delta?: number[] };
type RowOpt = { face: 'dark' | 'light'; colorMode: string | null; density?: number; plants?: Plant[] };

function make(rows: RowOpt[], extra: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(root, 'run-'));
  const r = spawnSync(process.execPath, ['--no-warnings', MAKE, dir, JSON.stringify({ rows, ...extra })], { cwd: APP, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the witness fixtures were not made: ${r.stderr}`);
  return dir;
}
function run(dir: string, out = path.join(dir, 'colour-path.txt')) {
  const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--manifest', path.join(dir, 'manifest.json'), '--out', out], { cwd: APP, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, report: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null };
}
const editRows = (dir: string, edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[]) => {
  const file = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...m, rows: edit(m.rows) }));
};
const L = (report: string | null) => (report ?? '').split(/\r?\n/);
const last = (report: string | null) => (report ?? '').trimEnd().split(/\r?\n/).pop();
/** The report's lines for one row. */
function section(report: string, shot: string): string[] {
  const lines = L(report);
  const start = lines.findIndex((l) => l.startsWith(`row ${shot} `));
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && !l.startsWith('  '));
  return lines.slice(start, end === -1 ? undefined : end);
}
const hex = (face: 'dark' | 'light', colour: string) => witnessColours(face).find((c) => c.name === colour)!.hex;
const planted = (face: 'dark' | 'light', density = 80) => witnessLayout(face, 412, 916, density / 160, 1).patches.filter((p) => !['W1a', 'W2', 'W3'].includes(p.kind));

describe('the planted witness rows are harness rows', () => {
  it('every row passes the harness’s own schema (validateRow), and both faces have separating and identity-only plants', () => {
    const dir = make([{ face: 'dark', colorMode: SRGB }, { face: 'light', colorMode: SRGB, density: 120 }]);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    for (const row of m.rows) expect(validateRow(row)).toEqual([]);
    expect(planted('dark').filter((p) => p.separates).length).toBeGreaterThanOrEqual(10);
    expect(planted('dark').filter((p) => !p.separates).length).toBeGreaterThanOrEqual(1);
    // The diagnosis cases below need each model to separate on the dark face's joy.
    for (const model of Object.keys(WITNESS_MODELS) as Array<keyof typeof WITNESS_MODELS>) {
      const joy = witnessColours('dark').find((c) => c.name === 'joy')!;
      expect(lsbDelta(WITNESS_MODELS[model](joy.bytes), joy.bytes)).toBeGreaterThan(MODEL_SEPARATION_LSB);
    }
  });
});

describe('colourPath on a sound witness, in the sRGB mode', () => {
  let r: ReturnType<typeof run>;
  beforeAll(() => {
    r = run(make([{ face: 'dark', colorMode: SRGB }, { face: 'light', colorMode: SRGB, density: 120 }]));
  });

  it('exits 0, prints what it writes', () => {
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toBe(r.report);
    expect(last(r.report)).toBe('PASS: 2 witness rows of byte evidence; every true path shows its token and every separating wrong path is seen');
  });

  it.each([['dark', 0, 80], ['light', 1, 120]] as const)('%s: every judgement, from the layout the row’s own facts rebuild', (face, n, density) => {
    const s = section(r.report!, `witness-${face}-${n}.1`);
    expect(s[0]).toBe(`row witness-${face}-${n}.1 witness.abyss.${face}: display ${SRGB}: byte evidence`);
    for (const c of witnessColours(face)) {
      for (const kind of ['W1a', 'W2', 'W3']) {
        expect(s).toContain(`  ${kind} ${c.name}: median (${c.bytes.join(', ')}), token ${c.hex}, |Δ| 0 (PASS)`);
      }
      expect(s).toContain(`  agree ${c.name}: W1a, W2 and W3 within ±1 of each other (largest pairwise |Δ| 0) (PASS)`);
    }
    expect(s.find((l) => l.startsWith('  W1b: '))).toMatch(/^ {2}W1b: median of \(capture − the law's noise-free colour\) \(0, 0, 0\) over \d+ px, within ±1 \(PASS\)$/);
    for (const p of planted(face, density)) {
      const line = s.find((l) => l.startsWith(`  ${p.kind} ${p.colour}: `));
      if (p.separates) expect(line).toMatch(new RegExp(`\\|Δ\\| from the token \\d+ > ${MODEL_SEPARATION_LSB}: the wrong path is seen \\(PASS\\)$`));
      else expect(line).toMatch(new RegExp(`^ {2}${p.kind} ${p.colour}: identity-only \\(its model moves the token by \\d+ ≤ ${MODEL_SEPARATION_LSB}\\): not judged$`));
    }
    expect(s[s.length - 1]).toBe('  PASS');
  });
});

describe('colourPath fails a wrong path', () => {
  it('W1a off by 2: exit 1', () => {
    const r = run(make([{ face: 'dark', colorMode: SRGB, plants: [{ kind: 'W1a', colour: 'calm', delta: [0, 2, 0] }] }]));
    expect(r.status).toBe(1);
    const b = witnessColours('dark').find((c) => c.name === 'calm')!.bytes;
    expect(r.report).toContain(`  W1a calm: median (${b[0]}, ${b[1] + 2}, ${b[2]}), token ${hex('dark', 'calm')}, |Δ| 2 (FAIL)`);
    expect(last(r.report)).toBe('FAIL: 1 of 1 evidence rows fail (witness-dark-0.1)');
  });

  it('W3 off by 1 passes (the tolerance is ±1)', () => {
    const r = run(make([{ face: 'dark', colorMode: SRGB, plants: [{ kind: 'W3', colour: 'intense', delta: [1, 1, 1] }] }]));
    expect(r.status).toBe(0);
  });

  it('W1a, W2 and W3 each within ±1 of the hex but 2 apart from each other: the agreement fails, exit 1', () => {
    const r = run(make([{ face: 'dark', colorMode: SRGB, plants: [{ kind: 'W1a', colour: 'calm', delta: [-1, -1, -1] }, { kind: 'W3', colour: 'calm', delta: [1, 1, 1] }] }]));
    expect(r.status).toBe(1);
    expect(r.report).toContain('  agree calm: W1a, W2 and W3 within ±1 of each other (largest pairwise |Δ| 2) (FAIL)');
  });

  it('W1b two off the law in its sample: exit 1', () => {
    const r = run(make([{ face: 'light', colorMode: SRGB, plants: [{ kind: 'W1b', delta: [0, 2, 0] }] }]));
    expect(r.status).toBe(1);
    expect(r.report).toMatch(/^ {2}W1b: median of \(capture − the law's noise-free colour\) \(0, 2, 0\) over \d+ px, within ±1 \(FAIL\)$/m);
  });

  it.each([
    ['W2', 'misreadAsP3', 'the display path reads the sRGB bytes as Display-P3'],
    ['W1a', 'doubleEncode', 'the path encodes the bytes twice'],
    ['W3', 'skipEncode', 'the path skips the encode: linear light written as bytes'],
  ])('a true %s patch showing %s’s bytes: FAIL, and the model named as the diagnosis', (kind, model, why) => {
    const r = run(make([{ face: 'dark', colorMode: SRGB, plants: [{ kind, colour: 'joy', paint: model }] }]));
    expect(r.status).toBe(1);
    expect(r.report).toContain(`  diagnosis: ${kind} joy shows ${model}'s bytes: ${why}`);
  });

  it('a separating planted patch that shows the true hex: BLIND, exit 1', () => {
    const r = run(make([{ face: 'dark', colorMode: SRGB, plants: [{ kind: 'doubleEncode', colour: 'joy', paint: 'token' }] }]));
    expect(r.status).toBe(1);
    expect(r.report).toMatch(new RegExp(`^ {2}doubleEncode joy: median \\(.*\\), token ${hex('dark', 'joy')}, \\|Δ\\| from the token 0 ≤ ${MODEL_SEPARATION_LSB}: BLIND, the instrument cannot see this wrong path \\(FAIL\\)$`, 'm'));
    expect(last(r.report)).toBe('FAIL: 1 of 1 evidence rows fail (witness-dark-0.1); the instrument is blind to: witness-dark-0.1 doubleEncode joy');
  });

  it('an identity-only planted patch that shows the true hex is not judged: exit 0', () => {
    const identity = planted('dark').find((p) => !p.separates)!;
    const r = run(make([{ face: 'dark', colorMode: SRGB, plants: [{ kind: identity.kind, colour: identity.colour, paint: 'token' }] }]));
    expect(r.status).toBe(0);
  });
});

describe('byte evidence only in the sRGB/Natural mode', () => {
  it('Vivid (NATIVE) and an unknown mode: eyes-on only, never evidence; with no evidence row, exit 1', () => {
    const r = run(make([{ face: 'dark', colorMode: NATIVE }, { face: 'light', colorMode: null }]));
    expect(r.status).toBe(1);
    expect(r.report).toContain(`row witness-dark-0.1 witness.abyss.dark: display ${NATIVE}: eyes-on only, not evidence (byte evidence needs the sRGB/Natural mode)`);
    expect(r.report).toContain('row witness-light-1.1 witness.abyss.light: display unknown: eyes-on only, not evidence (byte evidence needs the sRGB/Natural mode)');
    expect(L(r.report).filter((l) => l.endsWith('(PASS)'))).toEqual([]);
    expect(last(r.report)).toBe('FAIL: no witness row is byte evidence (none in the sRGB/Natural display mode)');
  });

  it('a Vivid row beside an sRGB one is listed, never judged: its wrong bytes do not fail the run, and it adds nothing', () => {
    const r = run(make([{ face: 'dark', colorMode: SRGB }, { face: 'light', colorMode: NATIVE, plants: [{ kind: 'W2', colour: 'joy', delta: [9, 9, 9] }] }]));
    expect(r.status).toBe(0);
    expect(section(r.report!, 'witness-light-1.1')).toHaveLength(1);
    expect(last(r.report)).toBe('PASS: 1 witness rows of byte evidence; every true path shows its token and every separating wrong path is seen');
  });
});

describe('colourPath refuses what it cannot use', () => {
  let base: string;
  beforeAll(() => {
    base = make([{ face: 'dark', colorMode: SRGB }], { smoke: true });
  });
  const copy = () => {
    const dir = fs.mkdtempSync(path.join(root, 'copy-'));
    for (const f of fs.readdirSync(base)) fs.copyFileSync(path.join(base, f), path.join(dir, f));
    return dir;
  };

  it('a smoke row is named, not judged', () => {
    const r = run(copy());
    expect(r.status).toBe(0);
    expect(r.report).toContain('not a witness row: smoke.1 smoke');
  });

  it('no witness row: exit 1', () => {
    const dir = copy();
    editRows(dir, (rows) => rows.filter((x) => x.scene === 'smoke'));
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(last(r.report)).toBe('FAIL: no witness row');
  });

  it('a failed capture run: exit 1', () => {
    const dir = copy();
    const file = path.join(dir, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), outcome: 'failed', failure: 'planted failure' }));
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.report).toContain('the capture run failed: planted failure');
  });

  it.each(['display.colorMode', 'display', 'device.density', 'stage', 'stage.height', 'fontScale', 'renderScale', 'expect.face'])('a witness row without "%s": exit 2, naming the field, no report', (field) => {
    const dir = copy();
    editRows(dir, (rows) => rows.map((x) => (x.scene === 'smoke' ? x : without(x, field))));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`"${field}"`);
    expect(r.report).toBeNull();
  });

  it.each([
    ['a renderScale that is not the witness tier’s', 'renderScale', 0.33],
    ['a face that is not the scene’s', 'expect.face', 'light'],
    ['a density that is not a whole positive number', 'device.density', 0],
  ])('%s: exit 2, naming the field', (_, field, value) => {
    const dir = copy();
    editRows(dir, (rows) => rows.map((x) => (x.scene === 'smoke' ? x : withValue(x, field, value))));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`"${field}"`);
  });

  it('an existing report: exit 2, left as it was', () => {
    const dir = copy();
    const out = path.join(dir, 'colour-path.txt');
    fs.writeFileSync(out, 'an earlier report\n');
    const r = run(dir, out);
    expect(r.status).toBe(2);
    expect(fs.readFileSync(out, 'utf8')).toBe('an earlier report\n');
  });
});
