/// <reference types="node" />
// B8-8a (the architect's B8 plan at 199b138): scripts/lab/reports/lawParity.mts, on planted capture runs.
//   · UI-183: each field.* capture against its law twin in CanvasKit, ±1 per channel; the full |Δ| histogram; every pixel
//     over 1 listed with its region (plate face, ring, halo, quiet rect, ground). The tolerance is not the report's to
//     widen: it lists, and the designer rules.
//   · UI-159: ×8 crops of both ring edges, the capture beside its twin, for every field.* capture (every tier).
//   · UI-211: each fallback.* capture against the CanvasKit FieldFallback render, ±1.
//   · UI-277: the same ×8 crops for every fallback.* capture, on the ring its FieldFallback plan draws.
//   · UI-274: what ±1 cannot judge, measured beside it and never judged: the signed Δ (capture − twin) of each channel, its
//     histogram and mean, overall and by the band of the twin's value (0–63, 64–127, 128–255), so a one-sided residue
//     shows; the largest 8-connected group of pixels over 1; and in the header, the commit the report was made at and the
//     twin's CanvasKit, beside the run's commit.
// It exits 1 on any failure, 2 on an input it cannot use (naming the field), writes a text report and never overwrites one.
// The planted runs come from scripts/lab/reports/__fixtures__/makeFixtures.mts, in the harness's row schema: the twin of
// each scene over READY's stage (the app window, the whole screen) cropped to the app region the system bars leave, so
// the stage's rows under the bars are not in the PNG and are not compared, with planted pixels whose regions the plate's
// geometry fixes. The fixtures nudge only R and B, so a capture's G is its twin's: UI-274's plants go in G.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePng, encodePng } from '../lib/png.mjs';
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

/** The bands of a twin's channel value that UI-274 keeps the signed Δ by. */
const BANDS = [[0, 63], [64, 127], [128, 255]] as const;
const bandOf = (v: number) => BANDS.findIndex(([lo, hi]) => v >= lo && v <= hi);

/** A row's PNG, decoded; written back with the manifest's sha256 for it. */
async function readRow(dir: string, i: number) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return decodePng(fs.readFileSync(path.join(dir, m.rows[i].file)));
}
async function writeRow(dir: string, i: number, img: { width: number; height: number; rgba: Uint8Array }) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const png = await encodePng(img);
  fs.writeFileSync(path.join(dir, m.rows[i].file), png);
  editManifest(dir, (rows) => rows.map((x, j) => (j === i ? withValue(x, 'sha256', crypto.createHash('sha256').update(png).digest('hex')) : x)));
}

/** A crop line's top left on the PNG. */
function cropAt(report: string, shot: string, edge: string): [number, number] {
  const line = section(report, shot).find((l) => l.startsWith(`  crop ${edge} ×8: `));
  expect({ shot, edge, line }).toEqual({ shot, edge, line: expect.stringMatching(new RegExp(`^ {2}crop ${edge} ×8: ${shot.replace(/\./g, '\\.')}\\.${edge}\\.x8\\.png, 16 × 16 px at \\(\\d+, \\d+\\), panels: capture \\| twin \\| \\|Δ\\| × 32$`)) });
  const [, x, y] = /at \((\d+), (\d+)\)/.exec(line!)!.map(Number);
  return [x, y];
}

type Signed = { mean: string; sum: number; n: number; bins: Array<[number, number]> } | null;
const SIGNED = /^ {2}signed Δ [RGB] (?:\(capture − twin\)|where the twin's [RGB] is \d+–\d+): (?:no px|mean (-?\d+\.\d{6}), Σ (-?\d+) over (\d+) px; histogram (-?\d+: \d+(?:, -?\d+: \d+)*))$/;
/** A channel's signed Δ lines in a row's section: the whole channel, then each band of the twin's value (null: no px). */
function signedOf(s: string[], ch: string): { all: Signed; bands: Signed[] } {
  const parse = (head: string): Signed => {
    const line = s.find((l) => l.startsWith(head));
    expect({ head, line }).toEqual({ head, line: expect.stringMatching(SIGNED) });
    const m = SIGNED.exec(line!)!;
    if (m[1] === undefined) return null;
    return { mean: m[1], sum: Number(m[2]), n: Number(m[3]), bins: m[4].split(', ').map((b) => b.split(': ').map(Number) as [number, number]) };
  };
  return { all: parse(`  signed Δ ${ch} (capture − twin): `), bands: BANDS.map(([lo, hi]) => parse(`  signed Δ ${ch} where the twin's ${ch} is ${lo}–${hi}: `)) };
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

  it('UI-274: the header names the commit the report was made at and the twin\'s CanvasKit, beside the run\'s commit', () => {
    const lines = r.report!.split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith('run: '));
    expect(lines[at]).toBe(`run: plan "fixture", outcome "passed", commit "${'a'.repeat(40)}"`);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: APP, encoding: 'utf8' }).stdout.trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    const version = (name: string) => JSON.parse(fs.readFileSync(path.join(APP, 'node_modules', name, 'package.json'), 'utf8')).version as string;
    const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The tree's state is the checkout's at the run (lib/provenance.mjs, held by reportsProvenance.test.ts on planted checkouts).
    expect(lines[at + 1]).toMatch(new RegExp(`^report: commit ${head}, (a clean tree|with uncommitted changes in \\d+ paths?); the twin: canvaskit-wasm ${esc(version('canvaskit-wasm'))}, @shopify/react-native-skia ${esc(version('@shopify/react-native-skia'))}$`));
    // Then the fallback ring model's two lines (UI-272, the test below).
    expect(lines[at + 4]).toMatch(/^tolerance: ±1 per channel/);
    expect(lines[at + 5]).toBe('measured, not judged (UI-274): the signed Δ (capture − twin) of each channel, overall and by the twin\'s value of the channel (0–63, 64–127, 128–255), and the largest 8-connected group of pixels over 1');
  });

  it('UI-272: the header names the fallback ring model and the one backend it was validated on, from evidence.mts’s own exports', () => {
    const lines = r.report!.split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith('report: '));
    const lib = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `const E = await import(${JSON.stringify(pathToFileURL(path.join(APP, 'scripts/lab/reports/lib/evidence.mts')).href)}); process.stdout.write(JSON.stringify([E.RING_MODEL, E.RING_MODEL_SCOPE]));`], { cwd: APP, encoding: 'utf8' });
    expect(lib.stderr).toBe('');
    const [model, scope] = JSON.parse(lib.stdout) as [string, string];
    expect(model).toBe('the fallback ring: inner exact clamp(d − R_in + ½), outer L1 clamp(½ + (R_out² − d²)/(2(|dx|+|dy|))), validated on Skia GL / Adreno 730 at 91d6940');
    expect(scope).toBe('the fallback ring model applies only to rows recorded with skiaVersion 2.6.9 and a GL renderer matching /\\bAdreno \\(TM\\) 730\\b/; any other fallback row is refused, with the reason');
    expect(lines.slice(at + 1, at + 3)).toEqual([model, scope]);
    // The report prints the library's text and never spells its facts again itself: the formula, the GPU, the Skia, the commit.
    const source = fs.readFileSync(SCRIPT, 'utf8');
    for (const spelled of ['clamp(d − R_in', 'R_out²', 'Adreno', '2.6.9', '91d6940']) expect({ spelled, inLawParity: source.includes(spelled) }).toEqual({ spelled, inLawParity: false });
  });

  it.each(SHOTS)('UI-274: %s: the signed Δ per channel as planted, overall and by the band of the twin\'s value, the bands adding up to the channel; no group over 1', async (shot) => {
    const s = section(r.report!, shot);
    expect(s).toContain(`  signed Δ R (capture − twin): mean 0.000297, Σ 7 over ${N} px; histogram 0: ${N - 7}, 1: 7`);
    expect(s).toContain(`  signed Δ G (capture − twin): mean 0.000000, Σ 0 over ${N} px; histogram 0: ${N}`);
    expect(s).toContain(`  signed Δ B (capture − twin): mean -0.000212, Σ -5 over ${N} px; histogram -1: 5, 0: ${N - 5}`);
    // G is never nudged, so the twin's G is the capture's: each band's pixels counted from the PNG.
    const png = await decodePng(fs.readFileSync(path.join(dir, `${shot}.png`)));
    const inBand = [0, 0, 0];
    for (let i = 0; i < N; i++) inBand[bandOf(png.rgba[i * 4 + 1])]++;
    BANDS.forEach(([lo, hi], b) => expect(s).toContain(inBand[b] === 0
      ? `  signed Δ G where the twin's G is ${lo}–${hi}: no px`
      : `  signed Δ G where the twin's G is ${lo}–${hi}: mean 0.000000, Σ 0 over ${inBand[b]} px; histogram 0: ${inBand[b]}`));
    for (const ch of ['R', 'G', 'B']) {
      const { all, bands } = signedOf(s, ch);
      const present = bands.filter((b): b is NonNullable<Signed> => b !== null);
      // Each histogram is every bin from its lowest to its highest, 0 among them, holding its pixels and their sum.
      for (const h of [all!, ...present]) {
        const lo = Math.min(0, h.bins[0][0]);
        expect(h.bins.map(([v]) => v)).toEqual(Array.from({ length: Math.max(0, h.bins[h.bins.length - 1][0]) - lo + 1 }, (_, i) => lo + i));
        expect([h.bins.reduce((n, [, c]) => n + c, 0), h.bins.reduce((n, [v, c]) => n + v * c, 0), h.mean]).toEqual([h.n, h.sum, (h.sum / h.n).toFixed(6)]);
      }
      // The bands share the channel's pixels out: their counts, sums and bins add up to its.
      const added = new Map<number, number>();
      for (const b of present) for (const [v, c] of b.bins) added.set(v, (added.get(v) ?? 0) + c);
      expect([present.reduce((n, b) => n + b.n, 0), present.reduce((n, b) => n + b.sum, 0)]).toEqual([N, all!.sum]);
      expect(all!.bins.map(([v]) => [v, added.get(v) ?? 0])).toEqual(all!.bins);
    }
    expect(s).toContain('  largest 8-connected group over 1: 0 px (no pixel over 1)');
  });

  it('UI-159, UI-277: ×8 crops of both ring edges for every field and fallback capture, the capture beside its twin', async () => {
    const crops = `${r.out.replace(/\.txt$/, '')}.crops`;
    const files = fs.readdirSync(crops).sort();
    expect(files).toEqual(SHOTS.flatMap((s) => [`${s}.ring-inner.x8.png`, `${s}.ring-outer.x8.png`]).sort());
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

  it.each(['fb-dark-one-c-right.1', 'fb-light-rest.1'])('UI-277: %s: both crops on its plan\'s ring, where the field rows\' are on the same plate, the capture beside its twin', async (shot) => {
    const crops = `${r.out.replace(/\.txt$/, '')}.crops`;
    const capture = await decodePng(fs.readFileSync(path.join(dir, `${shot}.png`)));
    const at = Object.fromEntries(['ring-inner', 'ring-outer'].map((edge) => [edge, cropAt(r.report!, shot, edge)]));
    // The fixtures' field and fallback rows share the stage, the density, the layout and the font scale: one plate.
    expect(at).toEqual(Object.fromEntries(['ring-inner', 'ring-outer'].map((edge) => [edge, cropAt(r.report!, 'dark-one-joy-still.1', edge)])));
    expect(at['ring-inner'][0]).toBeLessThan(at['ring-outer'][0]);
    for (const edge of ['ring-inner', 'ring-outer']) {
      const [x0, y0] = at[edge];
      const crop = await decodePng(fs.readFileSync(path.join(crops, `${shot}.${edge}.x8.png`)));
      expect([crop.width, crop.height]).toEqual([3 * 128 + 2 * 8, 128]);
      const colours = new Set<string>();
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const want = Array.from(capture.rgba.subarray(((y0 + y) * capture.width + x0 + x) * 4, ((y0 + y) * capture.width + x0 + x) * 4 + 4));
          colours.add(want.join());
          const panel = (n: number) => Array.from(crop.rgba.subarray(((y * 8 + 4) * crop.width + n * (128 + 8) + x * 8 + 4) * 4, ((y * 8 + 4) * crop.width + n * (128 + 8) + x * 8 + 4) * 4 + 4));
          // The capture panel is the capture there; the twin panel is the twin there, which the capture is within 1 of.
          expect({ edge, x, y, capture: panel(0) }).toEqual({ edge, x, y, capture: want });
          expect({ edge, x, y, off: panel(1).map((v, c) => Math.abs(v - want[c])).some((d) => d > 1) }).toEqual({ edge, x, y, off: false });
        }
      }
      // The edge is inside: the ring's colour, the material on its other side, and the anti-aliased pixels between.
      expect(colours.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('UI-277: a fallback row\'s crops follow its own plan: at font scale 1.3 the wider label band grows the plate, so the rim\'s crop moves out and the lens edge\'s stays', () => {
    const big = copySet('parity-pass');
    editManifest(big, (rows) => rows.map((x, i) => (i === 3 ? [['fontScale.requested', 1.3], ['fontScale.observed', 1.3], ['fontScale.app', 1.3]].reduce((y, [k, v]) => withValue(y, k as string, v), x) : x)));
    const b = run(big);
    expect(b.stderr).toBe('');
    const [inner, outer] = ['ring-inner', 'ring-outer'].map((edge) => cropAt(b.report!, 'fb-light-rest.1', edge));
    expect(inner[0]).toBe(cropAt(r.report!, 'fb-light-rest.1', 'ring-inner')[0]);
    expect(outer[0]).toBeGreaterThan(cropAt(r.report!, 'fb-light-rest.1', 'ring-outer')[0]);
    expect(inner[1]).toBe(outer[1]);
  });
});

describe('lawParity on a planted run with pixels over 1', () => {
  let r: ReturnType<typeof run>;
  let dir: string;
  let planted: Array<{ shot: string; x: number; y: number; delta: number; region: string }>;
  beforeAll(() => {
    dir = copySet('parity-fail');
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

  it('UI-274: the planted pixels over 1 stand apart, so each is a group of its own: the largest 1 px, the first in reading order', () => {
    for (const shot of ['dark-one-joy-still.1', 'fb-dark-one-c-right.1']) {
      const mine = planted.filter((p) => p.shot === shot).sort((a, b) => a.y - b.y || a.x - b.x);
      // The guard: no two of them touch, even at a corner.
      for (const p of mine) for (const q of mine) if (p !== q) expect(Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y))).toBeGreaterThan(1);
      const [{ x, y }] = mine;
      expect(section(r.report!, shot)).toContain(`  largest 8-connected group over 1: 1 px in (${x}, ${y})–(${x}, ${y}), of ${mine.length} groups`);
    }
    expect(section(r.report!, 'light-three-low.1')).toContain('  largest 8-connected group over 1: 0 px (no pixel over 1)');
  });

  it('UI-274: the signed Δ keeps each planted pixel\'s sign: the field\'s G up by 2 five times and by 5 once, the fallback\'s up by 2 twice', async () => {
    // The guard: these captures' G stays far below 255, so makeFixtures' nudge turned none of them down.
    expect(planted.every((p) => p.delta > 0)).toBe(true);
    for (const shot of ['dark-one-joy-still.1', 'fb-dark-one-c-right.1']) {
      const png = await decodePng(fs.readFileSync(path.join(dir, `${shot}.png`)));
      expect(Math.max(...Array.from({ length: N }, (_, i) => png.rgba[i * 4 + 1]))).toBeLessThan(250);
    }
    expect(section(r.report!, 'dark-one-joy-still.1')).toContain(`  signed Δ G (capture − twin): mean 0.000636, Σ 15 over ${N} px; histogram 0: ${N - 6}, 1: 0, 2: 5, 3: 0, 4: 0, 5: 1`);
    expect(section(r.report!, 'fb-dark-one-c-right.1')).toContain(`  signed Δ G (capture − twin): mean 0.000170, Σ 4 over ${N} px; histogram 0: ${N - 2}, 1: 0, 2: 2`);
  });

  it('the rows with nothing planted over 1 still pass', () => {
    expect(section(r.report!, 'light-three-low.1').pop()).toBe('  PASS');
    expect(section(r.report!, 'fb-light-rest.1').pop()).toBe('  PASS');
  });
});

// UI-274: what ±1 cannot judge. On the dark field, G one level down at every pixel whose x + y is even: half the pixels
// move by 1 and the rest by 0, a mean of −0.5 that the |Δ| histogram shows only as a passing row. On the dark fallback,
// G one level down at every pixel whose twin's G is 64–127 and nowhere else: a residue confined to one band. On the light
// field, pixels over 1 planted in shapes whose 8-connected groups are known.
describe('UI-274: lawParity measures what ±1 cannot judge: a one-sided shift, and pixels over 1 in groups', () => {
  /** The light field's planted pixels over 1 (G − 2), PNG px: a V of 5 that only both diagonals join, an L of 3, two at the
   * ends of adjacent rows (not neighbours, though one follows the other in memory), and two one pixel apart. */
  const V = [[20, 30], [21, 31], [22, 32], [23, 31], [24, 30]];
  const L = [[60, 80], [61, 80], [60, 81]];
  const ENDS = [[102, 150], [0, 151]];
  const APART = [[40, 200], [42, 200]];
  const shift = { planted: 0, onEdge: 0, bands: BANDS.map(() => ({ n: 0, planted: 0 })) };
  /** The dark fallback's pixels by the band of the twin's G: those of 64–127 are each one level down. */
  const confined = BANDS.map(() => 0);
  let r: ReturnType<typeof run>;
  beforeAll(async () => {
    const dir = copySet('parity-pass');
    const fb = await readRow(dir, 2);
    expect(SHOTS[2]).toBe('fb-dark-one-c-right.1');
    for (let i = 0; i < fb.width * fb.height; i++) {
      const g = fb.rgba[i * 4 + 1]; // the twin's G: the fixtures never nudge G
      confined[bandOf(g)]++;
      if (bandOf(g) === 1) fb.rgba[i * 4 + 1] = g - 1;
    }
    await writeRow(dir, 2, fb);
    const dark = await readRow(dir, 0);
    expect(SHOTS[0]).toBe('dark-one-joy-still.1');
    for (let y = 0; y < dark.height; y++) {
      for (let x = 0; x < dark.width; x++) {
        const i = (y * dark.width + x) * 4 + 1;
        const g = dark.rgba[i]; // the twin's G: the fixtures never nudge G
        shift.bands[bandOf(g)].n++;
        if ((x + y) % 2 === 0 && g > 0) {
          dark.rgba[i] = g - 1;
          shift.bands[bandOf(g)].planted++;
          shift.planted++;
          if (g === 64 || g === 128) shift.onEdge++;
        }
      }
    }
    await writeRow(dir, 0, dark);
    const light = await readRow(dir, 1);
    for (const [x, y] of [...V, ...L, ...ENDS, ...APART]) {
      const i = (y * light.width + x) * 4 + 1;
      if (light.rgba[i] < 2) throw new Error(`the light field's G at (${x}, ${y}) cannot go down by 2`);
      light.rgba[i] -= 2;
    }
    await writeRow(dir, 1, light);
    r = run(dir);
  });

  it('the guard: every even pixel moved, some sit on a band\'s lower edge (a band read from the capture would move them), and each band with pixels has some moved', () => {
    expect(shift.planted).toBe(11794);
    expect(shift.onEdge).toBeGreaterThan(0);
    expect(shift.bands.filter((b) => b.n > 0).map((b) => b.planted > 0)).toEqual(shift.bands.filter((b) => b.n > 0).map(() => true));
  });

  it('±1 passes the shifted row, as it must: every |Δ| is 0 or 1, no group over 1', () => {
    const s = section(r.report!, 'dark-one-joy-still.1');
    expect(s[0]).toBe(`row dark-one-joy-still.1 field.abyss.dark.one.joy.still: field twin, ${N} px compared, max |Δ| 1, over 1: 0`);
    expect(s).toContain('  largest 8-connected group over 1: 0 px (no pixel over 1)');
    expect(s[s.length - 1]).toBe('  PASS');
  });

  it('the signed mean names the shift: G half a level low, overall and in each band of the twin\'s G; R and B as planted', () => {
    const s = section(r.report!, 'dark-one-joy-still.1');
    expect(s).toContain(`  signed Δ G (capture − twin): mean -0.500021, Σ -11794 over ${N} px; histogram -1: 11794, 0: ${N - 11794}`);
    BANDS.forEach(([lo, hi], b) => {
      const { n, planted } = shift.bands[b];
      expect(s).toContain(n === 0
        ? `  signed Δ G where the twin's G is ${lo}–${hi}: no px`
        : `  signed Δ G where the twin's G is ${lo}–${hi}: mean ${(-planted / n).toFixed(6)}, Σ -${planted} over ${n} px; histogram -1: ${planted}, 0: ${n - planted}`);
    });
    expect(s).toContain(`  signed Δ R (capture − twin): mean 0.000297, Σ 7 over ${N} px; histogram 0: ${N - 7}, 1: 7`);
    expect(s).toContain(`  signed Δ B (capture − twin): mean -0.000212, Σ -5 over ${N} px; histogram -1: 5, 0: ${N - 5}`);
  });

  it('a residue confined to one band shows there whole: the fallback\'s 64–127 band reads −1, its 0 bin kept though empty, while the row\'s mean dilutes it', () => {
    const [n0, n1, n2] = confined;
    // The guard: both of the lower bands have pixels.
    expect([n0 > 0, n1 > 0]).toEqual([true, true]);
    const s = section(r.report!, 'fb-dark-one-c-right.1');
    expect(s[0]).toBe(`row fb-dark-one-c-right.1 fallback.abyss.dark.one.C.right: FieldFallback twin, ${N} px compared, max |Δ| 1, over 1: 0`);
    expect(s).toContain(`  signed Δ G (capture − twin): mean ${(-n1 / N).toFixed(6)}, Σ -${n1} over ${N} px; histogram -1: ${n1}, 0: ${N - n1}`);
    expect(s).toContain(`  signed Δ G where the twin's G is 0–63: mean 0.000000, Σ 0 over ${n0} px; histogram 0: ${n0}`);
    expect(s).toContain(`  signed Δ G where the twin's G is 64–127: mean -1.000000, Σ -${n1} over ${n1} px; histogram -1: ${n1}, 0: 0`);
    expect(s).toContain(n2 === 0 ? '  signed Δ G where the twin\'s G is 128–255: no px' : `  signed Δ G where the twin's G is 128–255: mean 0.000000, Σ 0 over ${n2} px; histogram 0: ${n2}`);
    expect(s[s.length - 1]).toBe('  PASS');
  });

  it('the largest 8-connected group over 1 is the V of 5, joined only through both diagonals; 6 groups in all', () => {
    const s = section(r.report!, 'light-three-low.1');
    expect(s[0]).toBe(`row light-three-low.1 field.abyss.light.three.low: field twin, ${N} px compared, max |Δ| 2, over 1: 12`);
    expect(s).toContain('  largest 8-connected group over 1: 5 px in (20, 30)–(24, 32), of 6 groups');
    expect(s).toContain(`  signed Δ G (capture − twin): mean -0.001018, Σ -24 over ${N} px; histogram -2: 12, -1: 0, 0: ${N - 12}`);
  });

  it('the verdict is still ±1\'s alone: only the row with pixels over 1 fails', () => {
    expect(r.status).toBe(1);
    expect(r.report!.trimEnd().split(/\r?\n/).pop()).toBe('FAIL: 1 of 4 rows have pixels over ±1 (light-three-low.1); the designer rules');
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

  // UI-272, the report side of UI-276: the fallback ring model holds only on the backend it was validated on.
  it.each([
    ['gl.renderer', 'ARM, Mali-G710'],
    ['skiaVersion', '2.7.0'],
  ])('UI-272: a fallback row whose "%s" is %s, a backend the ring model was not validated on: exit 2, naming the field and the value, no report', (field, value) => {
    const dir = copySet('parity-pass');
    editManifest(dir, (rows) => rows.map((x, i) => (i === 3 ? withValue(x, field, value) : x)));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`"${field}"`);
    expect(r.stderr).toContain(JSON.stringify(value));
    expect(r.stderr).toContain('fb-light-rest.1');
    expect(r.report).toBeNull();
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
