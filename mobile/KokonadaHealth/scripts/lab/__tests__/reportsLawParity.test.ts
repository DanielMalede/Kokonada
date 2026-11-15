/// <reference types="node" />
// B8-8a (the architect's B8 plan at 199b138): scripts/lab/reports/lawParity.mts, on planted capture runs.
//   · UI-183: each field.* capture against its law twin in CanvasKit, ±1 per channel; the full |Δ| histogram; every pixel
//     over 1 listed with its region (plate face, ring, halo, quiet rect, ground). The tolerance is not the report's to
//     widen: it lists, and the designer rules.
//   · UI-159: ×8 crops of both ring edges, the capture beside its twin, for every field.* capture (every tier).
//   · UI-211: each fallback.* capture against the CanvasKit FieldFallback render, ±1.
// It exits 1 on any failure, 2 on an input it cannot use (naming the field), writes a text report and never overwrites one.
// The planted runs come from scripts/lab/reports/__fixtures__/makeFixtures.mts, in the harness's row schema: the twin of
// each scene over READY's stage (the app window, the whole screen) cropped to the app region the system bars leave, so
// the stage's rows under the bars are not in the PNG and are not compared, with planted pixels whose regions the plate's
// geometry fixes.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodePng } from '../lib/png.mjs';
import { withValue, without } from '../reports/__fixtures__/rows';

jest.setTimeout(180000);

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/lab/reports/lawParity.mts');
const MAKE = path.join(APP, 'scripts/lab/reports/__fixtures__/makeFixtures.mts');
const N = 103 * 229; // the stage's pixels in the app region: the compared ones
const UNDER_BARS = 103 * 12; // the stage's pixels under the status and navigation bars: not in the PNG
const SHOTS = ['dark-one-joy-still.1', 'light-three-low.1', 'fb-dark-one-c-right.1', 'fb-light-rest.1'];

let root: string;
let fixtures: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-parity-'));
  fixtures = path.join(root, 'fx');
  const r = spawnSync(process.execPath, ['--no-warnings', MAKE, fixtures], { cwd: APP, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the fixtures were not made: ${r.stderr}`);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A copy of a fixture set, so a test can change it. */
function copySet(name: string): string {
  const dir = fs.mkdtempSync(path.join(root, `${name}-`));
  for (const f of fs.readdirSync(path.join(fixtures, name))) fs.copyFileSync(path.join(fixtures, name, f), path.join(dir, f));
  return dir;
}
const editManifest = (dir: string, edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[], top: Record<string, unknown> = {}) => {
  const file = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...m, ...top, rows: edit(m.rows) }));
};

function run(dir: string, out = path.join(dir, 'parity.txt')) {
  const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--manifest', path.join(dir, 'manifest.json'), '--out', out], { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out, report: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null };
}
/** The report's lines for one row: from its header to the next row's. */
function section(report: string, shot: string): string[] {
  const lines = report.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`row ${shot} `));
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && !l.startsWith('  '));
  return lines.slice(start, end === -1 ? undefined : end);
}

describe('lawParity on a planted run within ±1', () => {
  let r: ReturnType<typeof run>;
  let dir: string;
  beforeAll(() => {
    dir = copySet('parity-pass');
    r = run(dir);
  });

  it('exits 0 and writes its report, the same text it prints', () => {
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report).not.toBeNull();
    expect(r.stdout).toBe(r.report);
    expect(r.report).toMatch(/^tolerance: ±1 per channel/m);
    expect(r.report).toContain('the designer rules');
    expect(r.report!.trimEnd().split(/\r?\n/).pop()).toBe('PASS: 4 rows within ±1 of their twins (2 field, 2 fallback)');
  });

  it.each(SHOTS)('%s: compared with its own twin over the stage alone, the full |Δ| histogram, nothing over 1', (shot) => {
    const s = section(r.report!, shot);
    const twin = shot.startsWith('fb-') ? 'FieldFallback twin' : 'field twin';
    expect(s[0]).toBe(`row ${shot} ${shot.startsWith('fb-') ? 'fallback' : 'field'}.abyss.${shot.includes('dark') ? 'dark' : 'light'}.${{ 'dark-one-joy-still.1': 'one.joy.still', 'light-three-low.1': 'three.low', 'fb-dark-one-c-right.1': 'one.C.right', 'fb-light-rest.1': 'rest' }[shot]}: ${twin}, ${N} px compared, max |Δ| 1, over 1: 0`);
    expect(s).toContain(`  |Δ| histogram (largest channel per pixel): 0: ${N - 12}, 1: 12`);
    expect(s).toContain(`  |Δ| histogram R: 0: ${N - 7}, 1: 7`);
    expect(s).toContain(`  |Δ| histogram G: 0: ${N}, 1: 0`); // every bin up to the row’s largest |Δ|
    expect(s).toContain(`  |Δ| histogram B: 0: ${N - 5}, 1: 5`);
    expect(s).toContain('  over 1 by region: plate face 0, ring 0, halo 0, quiet rect 0, ground 0');
    expect(s).toContain(`  not compared: ${UNDER_BARS} px of the stage outside the app region (under the system bars), 0 px of the app region outside the stage`);
    expect(s[s.length - 1]).toBe('  PASS');
  });

  it('UI-159: ×8 crops of both ring edges for each field capture, the capture beside its twin, and none for a fallback', async () => {
    const crops = `${r.out.replace(/\.txt$/, '')}.crops`;
    const files = fs.readdirSync(crops).sort();
    expect(files).toEqual(['dark-one-joy-still.1.ring-inner.x8.png', 'dark-one-joy-still.1.ring-outer.x8.png', 'light-three-low.1.ring-inner.x8.png', 'light-three-low.1.ring-outer.x8.png']);
    const s = section(r.report!, 'dark-one-joy-still.1');
    const line = s.find((l) => l.startsWith('  crop ring-inner ×8: '));
    expect(line).toMatch(/^ {2}crop ring-inner ×8: dark-one-joy-still\.1\.ring-inner\.x8\.png, 16 × 16 px at \(\d+, \d+\), panels: capture \| twin \| \|Δ\| × 32$/);
    const [, x0, y0] = /at \((\d+), (\d+)\)/.exec(line!)!.map(Number);
    const crop = await decodePng(fs.readFileSync(path.join(crops, 'dark-one-joy-still.1.ring-inner.x8.png')));
    expect([crop.width, crop.height]).toEqual([3 * 128 + 2 * 8, 128]);
    const capture = await decodePng(fs.readFileSync(path.join(dir, 'dark-one-joy-still.1.png')));
    // The capture panel is the capture, ×8 nearest: each crop pixel is an 8 × 8 block.
    for (const [cx, cy] of [[0, 0], [5, 9], [15, 15]]) {
      const want = Array.from(capture.rgba.subarray(((y0 + cy) * capture.width + (x0 + cx)) * 4, ((y0 + cy) * capture.width + (x0 + cx)) * 4 + 4));
      for (const [dx, dy] of [[0, 0], [7, 7]]) {
        const at = ((cy * 8 + dy) * crop.width + (cx * 8 + dx)) * 4;
        expect(Array.from(crop.rgba.subarray(at, at + 4))).toEqual(want);
      }
    }
    // The ring's inner edge is inside the crop: it is not one flat colour.
    const colours = new Set<string>();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) colours.add(Array.from(capture.rgba.subarray(((y0 + y) * capture.width + x0 + x) * 4, ((y0 + y) * capture.width + x0 + x) * 4 + 3)).join());
    expect(colours.size).toBeGreaterThan(4);
  });
});

describe('lawParity on a planted run with pixels over 1', () => {
  let r: ReturnType<typeof run>;
  let planted: Array<{ shot: string; x: number; y: number; delta: number; region: string }>;
  beforeAll(() => {
    const dir = copySet('parity-fail');
    planted = JSON.parse(fs.readFileSync(path.join(dir, 'planted.json'), 'utf8'));
    r = run(dir);
  });

  it('the guard: pixels were planted in every region, on a field and a fallback capture', () => {
    expect(new Set(planted.map((p) => p.region))).toEqual(new Set(['plate face', 'ring', 'halo', 'quiet rect', 'ground']));
    expect(new Set(planted.map((p) => p.shot))).toEqual(new Set(['dark-one-joy-still.1', 'fb-dark-one-c-right.1']));
  });

  it('exits 1, and its last line says which rows failed', () => {
    expect(r.status).toBe(1);
    expect(r.report!.trimEnd().split(/\r?\n/).pop()).toBe('FAIL: 2 of 4 rows have pixels over ±1 (dark-one-joy-still.1, fb-dark-one-c-right.1); the designer rules');
  });

  it('lists every planted pixel over 1, by region, with the capture, the twin and |Δ|', () => {
    for (const p of planted) {
      const s = section(r.report!, p.shot);
      const line = s.find((l) => l.startsWith(`  over 1 · ${p.region} · (${p.x}, ${p.y}) `));
      expect({ p, line }).toEqual({ p, line: expect.stringMatching(new RegExp(`capture \\(\\d+, \\d+, \\d+\\) twin \\(\\d+, \\d+, \\d+\\) \\|Δ\\| \\(0, ${p.delta}, 0\\)$`)) });
    }
    const listed = r.report!.split(/\r?\n/).filter((l) => l.startsWith('  over 1 · '));
    expect(listed).toHaveLength(planted.length);
  });

  it('the field capture: the full histogram (every bin up to the largest), the counts by region, FAIL', () => {
    const s = section(r.report!, 'dark-one-joy-still.1');
    expect(s[0]).toBe(`row dark-one-joy-still.1 field.abyss.dark.one.joy.still: field twin, ${N} px compared, max |Δ| 5, over 1: 6`);
    expect(s).toContain(`  |Δ| histogram (largest channel per pixel): 0: ${N - 18}, 1: 12, 2: 5, 3: 0, 4: 0, 5: 1`);
    expect(s).toContain(`  |Δ| histogram G: 0: ${N - 6}, 1: 0, 2: 5, 3: 0, 4: 0, 5: 1`);
    expect(s).toContain('  over 1 by region: plate face 1, ring 1, halo 1, quiet rect 1, ground 2');
    expect(s[s.length - 1]).toBe('  FAIL: 6 px over ±1');
  });

  it('the fallback capture is held to the FieldFallback twin: its two planted pixels, FAIL', () => {
    const s = section(r.report!, 'fb-dark-one-c-right.1');
    expect(s[0]).toBe(`row fb-dark-one-c-right.1 fallback.abyss.dark.one.C.right: FieldFallback twin, ${N} px compared, max |Δ| 2, over 1: 2`);
    expect(s).toContain('  over 1 by region: plate face 1, ring 1, halo 0, quiet rect 0, ground 0');
    expect(s[s.length - 1]).toBe('  FAIL: 2 px over ±1');
  });

  it('the rows with nothing planted over 1 still pass', () => {
    expect(section(r.report!, 'light-three-low.1').pop()).toBe('  PASS');
    expect(section(r.report!, 'fb-light-rest.1').pop()).toBe('  PASS');
  });
});

describe('lawParity refuses what it cannot use, and never overwrites', () => {
  it('an existing report: exit 2, the report as it was, no crops written', () => {
    const dir = copySet('parity-pass');
    const out = path.join(dir, 'parity.txt');
    fs.writeFileSync(out, 'an earlier report\n');
    const r = run(dir, out);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(out);
    expect(fs.readFileSync(out, 'utf8')).toBe('an earlier report\n');
    expect(fs.existsSync(path.join(dir, 'parity.crops'))).toBe(false);
  });

  it('an existing crops folder: exit 2, no report written', () => {
    const dir = copySet('parity-pass');
    fs.mkdirSync(path.join(dir, 'parity.crops'));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.report).toBeNull();
  });

  it.each(['expect.tier', 'stage', 'device.density', 'clock.t', 'renderScale', 'sampling'])('a field row without "%s": exit 2, naming the field, no report', (field) => {
    const dir = copySet('parity-pass');
    editManifest(dir, (rows) => rows.map((x, i) => (i === 1 ? without(x, field) : x)));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`"${field}"`);
    expect(r.stderr).toContain('light-three-low.1');
    expect(r.report).toBeNull();
  });

  it('a fallback row without "stage": exit 2, naming the field', () => {
    const dir = copySet('parity-pass');
    editManifest(dir, (rows) => rows.map((x, i) => (i === 3 ? without(x, 'stage') : x)));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"stage"');
  });

  it('a capture whose PNG is not the row’s: exit 2, naming "sha256"', () => {
    const dir = copySet('parity-pass');
    editManifest(dir, (rows) => rows.map((x, i) => (i === 0 ? withValue(x, 'sha256', 'e'.repeat(64)) : x)));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"sha256"');
  });

  it('a run whose capture failed: exit 1, saying so, even with every row within ±1', () => {
    const dir = copySet('parity-pass');
    editManifest(dir, (rows) => rows, { outcome: 'failed', failure: 'planted failure' });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.report).toContain('the capture run failed: planted failure');
  });

  it('a row the harness would not write (a field it has no schema for): exit 2, naming the field, no report', () => {
    const dir = copySet('parity-pass');
    editManifest(dir, (rows) => rows.map((x, i) => (i === 2 ? withValue(x, 'pxPerDp', 0.25) : x)));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/fb-dark-one-c-right\.1: .*validateRow.*"pxPerDp" is not a manifest field/);
    expect(r.report).toBeNull();
  });

  it('a field row on the real-time clock has no fixed frame time, so no twin: named, not compared, and the rest still judged', () => {
    const dir = copySet('parity-pass');
    editManifest(dir, (rows) => rows.map((x, i) => (i === 1 ? withValue(x, 'clock', { mode: 'realtime', t: null, seq: 0 }) : x)));
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.report).toContain('not compared: light-three-low.1 field.abyss.light.three.low (clock realtime: no fixed frame time, so no twin)');
    expect(r.report!.trimEnd().split(/\r?\n/).pop()).toBe('PASS: 3 rows within ±1 of their twins (1 field, 2 fallback); 1 row not compared, named above');
  });

  it('a run with no field or fallback row proves nothing: exit 1, and the other rows are named, not compared', () => {
    const dir = copySet('parity-pass');
    editManifest(dir, (rows) => rows.slice(0, 1).map((x) => withValue(x, 'scene', 'smoke')));
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.report).toContain('not compared: dark-one-joy-still.1 smoke (not a field.* or fallback.* scene)');
    expect(r.report!.trimEnd().split(/\r?\n/).pop()).toBe('FAIL: no field.* or fallback.* row to compare');
  });

  it('no --out: exit 2 with the usage', () => {
    const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--manifest', path.join(fixtures, 'parity-pass', 'manifest.json')], { cwd: APP, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
  });
});
