/// <reference types="node" />
// UI-272 (the architect's F1-A; the designer's C1–C3 of 2026-11-18): the fallback twin's ring, its one modelled layer, held
// to the S22+'s own pixels. FieldFallback draws its ring with drawDRRect, anti-aliased; CanvasKit's scan conversion puts
// that edge up to 0.25 px off the circle the phone's GPU draws, so every one of the 22 fallback scenes failed lawParity on
// the ring's two edges alone. The twin therefore composites plate.ring over the app's own layers 1–3 at the device's
// coverage, within 1.5 px of either edge (scripts/lab/reports/lib/evidence.mts ringCoverage, compositeRing).
//
// The device bytes below are fixtured, not read: the captures live outside the repository. Each is a pixel of a PNG of the
// 91d6940 v1-field run (Kokonada-private/evidence/v1/91d694034be7/session/v1-field/, manifest.json sha256
// 8e0b3632cedf493bb5aca4e80dec15b7bcd36ff2ad269a299483df49eefbdeb8; SM-S906E, Adreno 730, OpenGL ES 3.2, RN Skia 2.6.9),
// named by its file and sha256, at PNG coordinates (the app region: the stage's y is 74 more), as captured:
//   · the architect's nine (lawParity root cause, 2026-11-18) and the designer's four (one of them, dark rest (530, 760),
//     is also the architect's): 12 distinct pixels, on the inner edge and the top of the outer edge, both faces;
//   · eight pins on the outer edge, two faces by four quadrants: in each, the fractional-coverage outer-edge pixel nearest
//     the diagonal at which an exact distance ramp (the brief's outer clamp(R_out + ½ − d)) is off by 2 or more. On the
//     axes the two ramps agree; on the diagonals the phone's outer ramp is √2 px wide, so these pin which one it draws.
// The geometry is never the capture's (C1): the twin derives the centre and both radii from fallbackPlan at the row's
// pixel ratio and stage, as lawParity does, and the rows here are the device's own (its screen, bars, stage and density).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { row, type Rect } from '../reports/__fixtures__/rows';

jest.setTimeout(180000);

const APP = path.resolve(__dirname, '../../..');
const LIB = path.join(APP, 'scripts/lab/reports/lib/evidence.mts');

/** Runs `body` (an async function body that sees E, the library, and input) in a child node and returns its JSON result. */
function lib<T>(body: string, input: unknown): T {
  const code = `const E = await import(${JSON.stringify(pathToFileURL(LIB).href)});
const input = JSON.parse(process.env.RING_INPUT);
const out = await (async () => { ${body} })();
process.stdout.write(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], {
    cwd: APP, encoding: 'utf8', env: { ...process.env, RING_INPUT: JSON.stringify(input) }, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`the library did not run (exit ${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout) as T;
}

// The phone of the 91d6940 run as its manifest records it: 1080 × 2340 px at 420 dpi (pixel ratio 2.625), the status bar
// the top 74 rows and the navigation bar the bottom 39, so the PNG is the app region y 74–2301; READY's stage is the
// window as the phone measured it.
const SCREEN = { width: 1080, height: 2340 };
const BARS: Rect[] = [{ x: 0, y: 0, width: 1080, height: 74 }, { x: 0, y: 2301, width: 1080, height: 39 }];
const STAGE: Rect = { x: 0, y: 0, width: 1079.9999656677246, height: 2340.000045776367 };
const REGION: Rect = { x: 0, y: 74, width: 1080, height: 2227 };

type Rgb = readonly [number, number, number];
interface DevicePixel {
  readonly x: number;
  readonly y: number;
  readonly rgb: Rgb;
  readonly edge: 'inner' | 'outer';
  /** Who named it. */
  readonly by: ReadonlyArray<'architect' | 'designer' | 'outer pin'>;
}
interface DeviceShot {
  readonly scene: string;
  readonly face: 'dark' | 'light';
  readonly file: string;
  readonly sha256: string;
  readonly pixels: readonly DevicePixel[];
}

const DEVICE: readonly DeviceShot[] = [
  {
    scene: 'fallback.abyss.dark.rest', face: 'dark', file: 'fallback-dark-rest.1.png', sha256: '312355f70ea470e2a9dbe6cf7e001390cf017b9d793421e75a431d9cb8e96e96',
    pixels: [
      { x: 538, y: 834, rgb: [43, 61, 75], edge: 'inner', by: ['architect'] },
      { x: 526, y: 834, rgb: [31, 48, 61], edge: 'inner', by: ['architect'] },
      { x: 517, y: 834, rgb: [10, 24, 34], edge: 'inner', by: ['architect'] },
      { x: 500, y: 836, rgb: [35, 53, 66], edge: 'inner', by: ['architect'] },
      { x: 530, y: 760, rgb: [4, 13, 23], edge: 'outer', by: ['architect', 'designer'] },
      { x: 454, y: 769, rgb: [6, 18, 28], edge: 'outer', by: ['architect'] },
      { x: 256, y: 971, rgb: [32, 50, 63], edge: 'inner', by: ['designer'] },
      { x: 839, y: 1510, rgb: [6, 20, 29], edge: 'outer', by: ['outer pin'] },
      { x: 240, y: 1510, rgb: [6, 20, 29], edge: 'outer', by: ['outer pin'] },
      { x: 843, y: 883, rgb: [3, 14, 23], edge: 'outer', by: ['outer pin'] },
      { x: 236, y: 883, rgb: [3, 14, 23], edge: 'outer', by: ['outer pin'] },
    ],
  },
  {
    scene: 'fallback.abyss.dark.one.J', face: 'dark', file: 'fallback-dark-one-j.1.png', sha256: 'f84c78368e9b6c3fe68d174a693eae5769985c5b51b75a95e443a8c4f1adfe58',
    pixels: [
      { x: 806, y: 952, rgb: [112, 97, 67], edge: 'inner', by: ['architect'] },
      { x: 809, y: 955, rgb: [108, 94, 65], edge: 'inner', by: ['architect'] },
      { x: 835, y: 987, rgb: [59, 59, 49], edge: 'inner', by: ['architect'] },
      { x: 813, y: 959, rgb: [69, 66, 53], edge: 'inner', by: ['designer'] },
    ],
  },
  {
    scene: 'fallback.abyss.light.three', face: 'light', file: 'fallback-light-three.1.png', sha256: '26389f712b9624e3eacf7750ffebd1849c0a341b7382f856e3e8ae5a0978fcf3',
    pixels: [{ x: 288, y: 1455, rgb: [230, 239, 244], edge: 'inner', by: ['designer'] }],
  },
  {
    scene: 'fallback.abyss.light.rest', face: 'light', file: 'fallback-light-rest.1.png', sha256: '8336e870b16bc408fd81add82c4e568c35e146efe5488421b8fd3798e6f6aa80',
    pixels: [
      { x: 847, y: 1503, rgb: [246, 251, 251], edge: 'outer', by: ['outer pin'] },
      { x: 232, y: 1503, rgb: [246, 251, 251], edge: 'outer', by: ['outer pin'] },
      { x: 847, y: 887, rgb: [243, 249, 250], edge: 'outer', by: ['outer pin'] },
      { x: 232, y: 887, rgb: [243, 249, 250], edge: 'outer', by: ['outer pin'] },
    ],
  },
];

/** The device's row for a shot, built by the harness's own builder (rows.ts) from what the manifest records. */
const deviceRow = (s: DeviceShot) =>
  row({
    shot: s.file.replace(/\.1\.png$/, ''), scene: s.scene, expect: { direction: 'abyss', face: s.face, hero: null, tier: null },
    file: s.file, sha256: s.sha256, screen: SCREEN, bars: BARS, stage: STAGE, density: 420,
    shaderStatus: 'fallback-scene', shaderReason: 'the lab fallback scene: FieldFallback mounted directly',
  });
const jobs = () => DEVICE.map((s) => ({ scene: s.scene, row: deviceRow(s), pixels: s.pixels.map((p) => [p.x, p.y]) }));

/** Each pixel's largest channel |Δ| from the device, by shot and pixel, with what the twin drew. */
function deltas(got: ReadonlyArray<ReadonlyArray<Rgb>>) {
  return DEVICE.flatMap((s, i) => s.pixels.map((p, j) => {
    const twin = got[i][j];
    return { at: `${s.file} (${p.x}, ${p.y})`, device: p.rgb.join(','), twin: twin.join(','), max: Math.max(...twin.map((v, ch) => Math.abs(v - p.rgb[ch]))) };
  }));
}

type TwinAt = { ring: { centre: [number, number]; inner: number; outer: number; colour: string }; stageY: number; pixels: Array<{ rgb: Rgb; inner: number; outer: number }> };

/** The library's twin of each device row, read at the fixture's pixels, with each pixel's signed distance into the ring from either edge. */
const twinAt = (): TwinAt[] =>
  lib<TwinAt[]>(`const out = [];
for (const job of input) {
  const shot = E.readFallbackShot(job.row, 'UI-272');
  const twin = await E.renderFallbackTwin(shot);
  const ring = twin.plan.ring;
  out.push({ ring, stageY: shot.stage.y, pixels: job.pixels.map(([x, y]) => {
    const sy = y - shot.stage.y;
    const i = (sy * twin.width + x) * 4;
    const d = Math.hypot(x + 0.5 - ring.centre[0], sy + 0.5 - ring.centre[1]);
    return { rgb: [twin.rgba[i], twin.rgba[i + 1], twin.rgba[i + 2]], inner: d - ring.inner, outer: ring.outer - d };
  }) });
}
return out;`, jobs());

// The plants: each changes one input of the model (or the model itself) and must turn the device pixels red under ±1
// (C3), so a pass is the model's and not a blind fixture. The control is the same seam with nothing planted.
type Plant = { name: string; kind: 'none' | 'canvaskit' | 'inner' | 'colour' | 'binary' | 'l2'; by?: number; channel?: number };
const CONTROL: Plant = { name: 'nothing planted (the control)', kind: 'none' };
const PLANTS: Plant[] = [
  { name: 'CanvasKit’s own ring (the twin before UI-272)', kind: 'canvaskit' },
  { name: 'R_in + 0.25 px', kind: 'inner', by: 0.25 },
  { name: 'R_in + 0.5 px', kind: 'inner', by: 0.5 },
  { name: 'plate.ring 3 LSB off in R', kind: 'colour', channel: 0 },
  { name: 'plate.ring 3 LSB off in G', kind: 'colour', channel: 1 },
  { name: 'plate.ring 3 LSB off in B', kind: 'colour', channel: 2 },
  { name: 'the ring drawn without anti-aliasing', kind: 'binary' },
  { name: 'the outer edge as an exact distance ramp, clamp(R_out + ½ − d)', kind: 'l2' },
];

/** The library's layers of each device row, composited by its compositeRing with each plant, read at the fixture's pixels. */
const plantedAt = (): Record<string, Rgb[][]> =>
  lib<Record<string, Rgb[][]>>(`const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (v) => '#' + v.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const unit = (v) => Math.min(1, Math.max(0, v));
const out = {};
for (const p of input.plants) out[p.name] = [];
for (const job of input.jobs) {
  const shot = E.readFallbackShot(job.row, 'UI-272');
  const L = await E.renderFallbackLayers(shot);
  const ring = L.plan.ring;
  const at = (rgba) => job.pixels.map(([x, y]) => { const i = ((y - shot.stage.y) * L.width + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]]; });
  for (const p of input.plants) {
    if (p.kind === 'canvaskit') { out[p.name].push(at(L.picture.rgba)); continue; }
    let planted = ring;
    let coverage;
    if (p.kind === 'inner') planted = { ...ring, inner: ring.inner + p.by };
    if (p.kind === 'colour') { const c = hex(ring.colour); c[p.channel] += c[p.channel] + 3 > 255 ? -3 : 3; planted = { ...ring, colour: toHex(c) }; }
    if (p.kind === 'binary') coverage = (q, x, y) => { const d = Math.hypot(x + 0.5 - q.centre[0], y + 0.5 - q.centre[1]); return d >= q.inner && d <= q.outer ? 1 : 0; };
    if (p.kind === 'l2') coverage = (q, x, y) => { const d = Math.hypot(x + 0.5 - q.centre[0], y + 0.5 - q.centre[1]); return unit(d - q.inner + 0.5) * unit(q.outer + 0.5 - d); };
    out[p.name].push(at(E.compositeRing(L.picture, L.under, planted, coverage)));
  }
}
return out;`, { jobs: jobs(), plants: [CONTROL, ...PLANTS] });

describe('UI-272: the fallback twin’s ring against the S22+’s own pixels (91d6940 v1-field)', () => {
  it('the guard: the fixture holds the 13 pixels the architect and the designer named, and the outer pins, on both faces and both edges', () => {
    const all = DEVICE.flatMap((s) => s.pixels.map((p) => ({ ...p, face: s.face, at: `${s.file} (${p.x}, ${p.y})` })));
    expect(all.filter((p) => p.by.includes('architect'))).toHaveLength(9);
    expect(all.filter((p) => p.by.includes('designer'))).toHaveLength(4);
    expect(all.filter((p) => p.by.includes('outer pin'))).toHaveLength(8);
    expect(new Set(all.map((p) => p.at)).size).toBe(all.length);
    for (const face of ['dark', 'light'] as const) for (const edge of ['inner', 'outer'] as const) expect(all.some((p) => p.face === face && p.edge === edge)).toBe(true);
    // The rows are the device's: the harness's own builder makes the app region the manifest records.
    for (const s of DEVICE) expect(deviceRow(s).region).toEqual(REGION);
  });

  let twin: TwinAt[];
  beforeAll(() => {
    twin = twinAt();
  });

  it('every fixture pixel lies within 1.5 px of the edge it names, by the twin’s own geometry (fallbackPlan at the row’s pixel ratio and stage)', () => {
    expect(twin.map((t) => t.stageY)).toEqual(DEVICE.map(() => STAGE.y - REGION.y));
    DEVICE.forEach((s, i) => s.pixels.forEach((p, j) => {
      const into = twin[i].pixels[j][p.edge];
      expect({ at: `${s.file} (${p.x}, ${p.y})`, edge: p.edge, within: Math.abs(into) <= 1.5 }).toEqual({ at: `${s.file} (${p.x}, ${p.y})`, edge: p.edge, within: true });
    }));
    // Every pin really sits where the two outer ramps part: between the axes (|dx| and |dy| within 10% of each other), and
    // inside the √2-wide diagonal ramp, at a fractional coverage (its centre within 0.7 px of R_out, the ramp's half-width √2/2).
    DEVICE.forEach((s, i) => s.pixels.forEach((p, j) => {
      if (!p.by.includes('outer pin')) return;
      const { centre } = twin[i].ring;
      const dx = Math.abs(p.x + 0.5 - centre[0]);
      const dy = Math.abs(p.y - twin[i].stageY + 0.5 - centre[1]);
      expect({ at: `${s.file} (${p.x}, ${p.y})`, diagonal: Math.min(dx, dy) / Math.max(dx, dy) > 0.9, fractional: Math.abs(twin[i].pixels[j].outer) < 0.7 })
        .toEqual({ at: `${s.file} (${p.x}, ${p.y})`, diagonal: true, fractional: true });
    }));
  });

  it('the twin holds every device pixel within ±1 per channel', () => {
    const got = deltas(twin.map((t) => t.pixels.map((p) => p.rgb)));
    expect(got.filter((g) => g.max > 1)).toEqual([]);
  });

  describe('the plants (C3)', () => {
    let planted: Record<string, Rgb[][]>;
    beforeAll(() => {
      planted = plantedAt();
    });

    it('the control: the same seam with nothing planted holds every device pixel within ±1, and is the twin', () => {
      expect(deltas(planted[CONTROL.name]).filter((g) => g.max > 1)).toEqual([]);
      expect(planted[CONTROL.name]).toEqual(twin.map((t) => t.pixels.map((p) => p.rgb)));
    });

    it.each(PLANTS.map((p) => [p.name]))('%s turns the device pixels red under ±1', (name) => {
      const red = deltas(planted[name]).filter((g) => g.max > 1);
      expect(red.length).toBeGreaterThan(0);
    });
  });
});
