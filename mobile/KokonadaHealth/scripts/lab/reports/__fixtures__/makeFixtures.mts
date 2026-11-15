// The planted capture runs the report tests read (B8-8a, B8-8b): small synthetic PNGs and their manifests, generated at
// test time into a folder the test owns, never device captures and never anything personal.
//
//   node scripts/lab/reports/__fixtures__/makeFixtures.mts <out folder>
//
// Each set is a folder holding manifest.json and its PNGs, laid out as capture.mjs writes a run (rows.ts builds each row
// with the harness's own functions and its validateRow): the screen is 103 × 241 px at density 40 (0.25 px per dp, so
// 412 × 964 dp), its status bar the top 6 rows and its navigation bar the bottom 6, so every PNG is the app region between
// them, 103 × 229 px from y 6; READY's stage is the app window, the whole screen (UI-216), so its top and bottom 6 rows are
// under the bars and not in the PNG (the reports must not compare them). A capture is the law twin of its scene over the
// stage, drawn by evidence.mts and cropped to the app region by plain array copies, with planted changes:
//
//   parity-pass   four shots (field dark one.joy still, field light three low, fallback dark one.C.right, fallback light
//                 rest), each with 7 pixels at R + 1 and 5 others at B − 1 (all within ±1), so every |Δ| is 0 or 1;
//   parity-fail   the same with planted pixels over 1, listed with the region the law puts them in, in planted.json:
//                 on the field shot one each in the ring, a bead's halo, a quiet rect, the plate face and the ground at
//                 |Δ| 2, and one more in the ground at |Δ| 5; on the fallback shot one in the plate face and one in the ring;
//   neverred-*    flat grey captures of a field scene with a planted 6 × 4 red patch, one (2, 0, 0) pixel, or one
//                 (1, 0, 0) pixel (just below the check band's chroma floor, the control); planted.json lists them.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { encodePng } from '../../lib/png.mjs';
import { readFallbackShot, readFieldShot, renderFallbackTwin, renderFieldTwin, type Rect, type Rgba } from '../lib/evidence.mts';
import { manifest, row } from './rows.ts';

// No process.exit(): this script loads CanvasKit (reportsCanvasKitExit.test.ts).
const given = process.argv[2];
if (!given) {
  console.error('usage: node makeFixtures.mts <out folder>');
  process.exitCode = 2;
  throw new Error('no out folder');
}
const out: string = given;

const SCREEN = { width: 103, height: 241 };
const BARS: Rect[] = [{ x: 0, y: 0, width: 103, height: 6 }, { x: 0, y: 235, width: 103, height: 6 }];
const REGION: Rect = { x: 0, y: 6, width: 103, height: 229 };
const DENSITY = 40;
const K = 0.25;
/** The stage's top left on the PNG: the window starts 6 rows above the app region. */
const OFFSET = { x: 0 - REGION.x, y: 0 - REGION.y };

type Planted = { shot: string; x: number; y: number; delta: number; region: string };

const SHOTS = [
  { shot: 'dark-one-joy-still', scene: 'field.abyss.dark.one.joy.still', expect: { direction: 'abyss', face: 'dark', hero: 'one.joy', tier: 'still' }, shaderStatus: 'ready' },
  { shot: 'light-three-low', scene: 'field.abyss.light.three.low', expect: { direction: 'abyss', face: 'light', hero: 'three', tier: 'low' }, shaderStatus: 'ready' },
  { shot: 'fb-dark-one-c-right', scene: 'fallback.abyss.dark.one.C.right', expect: { direction: 'abyss', face: 'dark', hero: null, tier: null }, shaderStatus: 'fallback-scene' },
  { shot: 'fb-light-rest', scene: 'fallback.abyss.light.rest', expect: { direction: 'abyss', face: 'light', hero: null, tier: null }, shaderStatus: 'fallback-scene' },
] as const;

const sha256 = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

/** The app region: the twin's rows that lie in it, copied in at the stage's offset (the rows under the bars are not). */
function compose(twin: Rgba): Uint8Array {
  const rgba = new Uint8Array(REGION.width * REGION.height * 4).fill(255);
  for (let y = 0; y < twin.height; y++) {
    const to = y + OFFSET.y;
    if (to < 0 || to >= REGION.height) continue;
    rgba.set(twin.rgba.subarray(y * twin.width * 4, (y + 1) * twin.width * 4), (to * REGION.width + OFFSET.x) * 4);
  }
  return rgba;
}

/** Moves one channel of the PNG pixel at stage (x, y) by delta, away from the end of the byte range it would cross. */
function nudge(rgba: Uint8Array, x: number, y: number, channel: number, delta: number): number {
  if (y + OFFSET.y < 0 || y + OFFSET.y >= REGION.height) throw new Error(`the planted pixel at stage y ${y} is under a system bar, not in the PNG`);
  const i = ((y + OFFSET.y) * REGION.width + (x + OFFSET.x)) * 4 + channel;
  const v = rgba[i] + delta;
  rgba[i] = v > 255 || v < 0 ? rgba[i] - delta : v;
  return y + OFFSET.y;
}

async function writeSet(name: string, shots: Array<{ row: Record<string, unknown>; rgba: Uint8Array }>, planted: unknown[] | null) {
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  for (const s of shots) {
    const png = await encodePng({ width: REGION.width, height: REGION.height, rgba: s.rgba });
    fs.writeFileSync(path.join(dir, s.row.file as string), png);
    rows.push({ ...s.row, sha256: sha256(png) });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest(rows), null, 2)}\n`);
  if (planted) fs.writeFileSync(path.join(dir, 'planted.json'), `${JSON.stringify(planted, null, 2)}\n`);
}

const baseRow = (s: (typeof SHOTS)[number]) =>
  row({ shot: s.shot, scene: s.scene, expect: s.expect, file: `${s.shot}.1.png`, sha256: '0'.repeat(64), screen: SCREEN, bars: BARS, density: DENSITY, shaderStatus: s.shaderStatus });
if (JSON.stringify(baseRow(SHOTS[0]).region) !== JSON.stringify(REGION)) throw new Error('the harness app region is not the REGION of the fixtures');

// ---- the twins

const twins = [];
for (const s of SHOTS) {
  const r = baseRow(s);
  if (s.scene.startsWith('field.')) {
    const shot = readFieldShot(r, 'makeFixtures');
    twins.push({ s, r, twin: await renderFieldTwin(shot), field: true });
  } else {
    const shot = readFallbackShot(r, 'makeFixtures');
    twins.push({ s, r, twin: await renderFallbackTwin(shot), field: false });
  }
}

// ---- parity-pass: 7 pixels at R + 1 and 5 at B − 1, each a different pixel, on a diagonal through the app region

function withinOne(rgba: Uint8Array) {
  for (let i = 0; i < 7; i++) nudge(rgba, 4 + 13 * i, 16 + 29 * i, 0, 1);
  for (let i = 0; i < 5; i++) nudge(rgba, 96 - 17 * i, 26 + 37 * i, 2, -1);
}

await writeSet('parity-pass', twins.map(({ r, twin }) => {
  const rgba = compose(twin);
  withinOne(rgba);
  return { row: r, rgba };
}), null);

// ---- parity-fail: planted pixels over 1, at places whose region the plate's geometry fixes

const planted: Planted[] = [];
const failShots = twins.map(({ s, r, twin, field }) => {
  const rgba = compose(twin);
  withinOne(rgba);
  const put = (x: number, y: number, delta: number, region: string) => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    nudge(rgba, px, py, 1, delta);
    planted.push({ shot: `${s.shot}.1`, x: px + OFFSET.x, y: py + OFFSET.y, delta, region });
  };
  const layout = (twin as { inputs: { layout: { centre: readonly [number, number]; radius: number; quietRects?: ReadonlyArray<Rect> } } }).inputs.layout;
  const cx = layout.centre[0] * K;
  const cy = layout.centre[1] * K;
  const R = layout.radius * K;
  if (s.shot === 'dark-one-joy-still') {
    const ringInner = (twin as { frame: { ringInner: number } }).frame.ringInner;
    const avatar = layout.quietRects![0];
    put(cx + ((ringInner + 1) / 2) * R, cy, 2, 'ring');
    put(cx + 0.566 * R, cy - 0.566 * R, 2, 'halo');
    put((avatar.x + avatar.width / 2) * K, (avatar.y + avatar.height / 2) * K, 2, 'quiet rect');
    put(cx, cy + 0.3 * R, 2, 'plate face');
    put(2, 600 * K, 2, 'ground');
    put(5, 610 * K, 5, 'ground');
  }
  if (s.shot === 'fb-dark-one-c-right') {
    const plan = (twin as { plan: { ring: { inner: number; outer: number } } }).plan;
    put(cx - 0.3 * R, cy, 2, 'plate face');
    put(cx - (plan.ring.inner + plan.ring.outer) / 2, cy, 2, 'ring');
  }
  return { row: r, rgba };
});
await writeSet('parity-fail', failShots, planted);

// ---- never-red: flat grey captures of one field shot, with planted pixels

const grey = () => new Uint8Array(REGION.width * REGION.height * 4).fill(96).map((v, i) => (i % 4 === 3 ? 255 : v));
const neverRow = baseRow(SHOTS[0]);
const at = (rgba: Uint8Array, x: number, y: number, c: readonly number[]) => rgba.set([...c, 255], (y * REGION.width + x) * 4);
const patch = grey();
const patchList = [];
for (let y = 50; y < 54; y++) for (let x = 40; x < 46; x++) {
  at(patch, x, y, [200, 30, 40]);
  patchList.push({ x, y });
}
await writeSet('neverred-patch', [{ row: neverRow, rgba: patch }], patchList);
const two = grey();
at(two, 71, 140, [2, 0, 0]);
await writeSet('neverred-200', [{ row: neverRow, rgba: two }], [{ x: 71, y: 140 }]);
const one = grey();
at(one, 71, 140, [1, 0, 0]);
await writeSet('neverred-100', [{ row: neverRow, rgba: one }], []);
console.log(`fixtures written to ${out}`);
