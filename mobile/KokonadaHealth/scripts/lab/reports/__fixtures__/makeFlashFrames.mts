// The planted frame sequences flashTrace.mts is tested on (B8-7): small synthetic PNG frames with their timestamps,
// generated at test time into a folder the test owns, never device captures and never anything personal.
//
//   node scripts/lab/reports/__fixtures__/makeFlashFrames.mts <out folder>
//
// Each set is a folder holding frames.json ({ "frames": [{ "file", "tMs" }] }, the input flashTrace reads) and its PNGs:
// 96 × 192 px at 0.5 px per dp (192 × 384 dp), so a 24 dp cell is 12 px and the grid is 8 × 16 cells. The ground is
// Abyss dark's; the storm marker (storm/stormMarker.ts) sits at its dp rect, 0,36 8×8 px, in cell 0,3, and shows the
// colour of its count of changes. Unless a set says otherwise, the frames are at 60 fps for 4 s (240 frames).
//
//   pass-2hz       cell 4,8 flickers between grey Y 0.05 and Y 0.30 every 15 frames (2 Hz) for 3.5 s: 2 flashes in
//                  every 1 s window, the most S7 allows; widen the window and it becomes 3. The marker flips once.
//   fail-3hz       cell 2,5 flickers the same way every 10 frames (3 Hz): 3 flashes; cell 6,12 flickers at 2 Hz and stays
//                  inside the limit, so exactly one cell is over 2.
//   fail-3hz-low   cell 2,5 flickers at 3 Hz between Y 0.05 and Y 0.17: a step of 0.12, just over WCAG's 0.1.
//   pass-3hz-sub   cell 2,5 flickers at 3 Hz between Y 0.05 and Y 0.13: a step of 0.08, under 0.1, so no flash at all.
//   fail-vfr       fail-3hz as screenrecord writes it, a frame only when the screen changes: the display frames where
//                  either cell flips (every 10th and every 15th), 32 frames at mixed intervals of 83.3 and 166.7 ms.
//   latency        a still field; the marker flips at frame 100 and cell 5,10 brightens at frame 102 (2 frames, 33.3 ms
//                  later); the marker flips again at frame 200 and cell 5,10 dims back on that same frame (0 frames). The
//                  cell under the marker changes with it and must never count as the field.
//   static         the ground only, the marker never changes: no flash, and no marker change to measure from.
//
// planted.json, beside the sets, says what each set holds, for the test to read; odd-size.png is a 48 × 48 frame.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { encodePng } from '../../lib/png.mjs';
import { manifest, row } from './rows.ts';
import { STORM_MARKER_COLOURS, STORM_MARKER_DP } from '../../../../src/design/lab/storm/stormMarker.ts';
import { relY } from '../../../../src/design/v2/field/flashCount.ts';
import { DIRECTIONS } from '../../../../src/design/v2/tokens/tokens.generated.ts';

// No process.exit(): this script loads CanvasKit (reportsCanvasKitExit.test.ts).
const given = process.argv[2];
if (!given) {
  console.error('usage: node makeFlashFrames.mts <out folder>');
  process.exitCode = 2;
  throw new Error('no out folder');
}
const out: string = given;

const W = 96;
const H = 192;
const K = 0.5;
const CELL = 24 * K;
const FRAME_MS = 1000 / 60;
const FRAMES = 240;

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const GROUND = hex(DIRECTIONS.abyss.color.dark.ground.hex);
const MARKER = STORM_MARKER_COLOURS.map(hex);

/** The darkest grey whose relative luminance is at least y. */
function greyAt(y: number): [number, number, number] {
  for (let g = 0; g < 256; g++) if (relY([g, g, g]) >= y) return [g, g, g];
  throw new Error(`no grey reaches Y ${y}`);
}

type Px = [number, number, number];
type Frame = { cells: Map<string, Px>; marker: number };

function draw(f: Frame): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  const mx = STORM_MARKER_DP.left * K;
  const my = STORM_MARKER_DP.top * K;
  const ms = STORM_MARKER_DP.size * K;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = f.cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? GROUND;
      if (x >= mx && x < mx + ms && y >= my && y < my + ms) c = MARKER[f.marker % 2];
      const i = (y * W + x) * 4;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/** A cell flickering between two greys, flipping every `every` frames from `from` to `to`. */
const flicker = (cell: string, a: Px, b: Px, every: number, from: number, to: number) => (i: number, cells: Map<string, Px>) => {
  if (i >= from && i < to) cells.set(cell, Math.floor((i - from) / every) % 2 === 0 ? b : a);
  else cells.set(cell, a);
};

type Painter = (i: number, cells: Map<string, Px>) => void;
async function writeSet(name: string, painters: Painter[], markerAt: (i: number) => number, frames: number[] = Array.from({ length: FRAMES }, (_, i) => i)) {
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  const list: Array<{ file: string; tMs: number }> = [];
  for (const i of frames) {
    const cells = new Map<string, Px>();
    for (const p of painters) p(i, cells);
    const file = `${String(i).padStart(5, '0')}.png`;
    fs.writeFileSync(path.join(dir, file), await encodePng({ width: W, height: H, rgba: draw({ cells, marker: markerAt(i) }) }));
    list.push({ file, tMs: i * FRAME_MS });
  }
  fs.writeFileSync(path.join(dir, 'frames.json'), `${JSON.stringify({ source: { mp4Sha256: PLANTED_MP4_SHA256, size: { width: W, height: H } }, frames: list }, null, 1)}\n`);
}

// Every set says it was decoded from one planted recording: the mp4 the manifest's record for the shot `planted` names.
const PLANTED_MP4_SHA256 = crypto.createHash('sha256').update('the planted storm recording').digest('hex');

const LO = greyAt(0.05);
const HI = greyAt(0.3);
const MID = greyAt(0.17);
const SUB = greyAt(0.13);
const BRIGHT = greyAt(0.1);
const once = (at: number) => (i: number) => (i >= at ? 1 : 0);

fs.mkdirSync(out, { recursive: true });
await writeSet('pass-2hz', [flicker('4,8', LO, HI, 15, 15, 225)], once(120));
await writeSet('fail-3hz', [flicker('2,5', LO, HI, 10, 10, 220), flicker('6,12', LO, HI, 15, 15, 225)], once(120));
await writeSet('fail-3hz-low', [flicker('2,5', LO, MID, 10, 10, 220)], once(120));
await writeSet('pass-3hz-sub', [flicker('2,5', LO, SUB, 10, 10, 220)], once(120));
await writeSet('fail-vfr', [flicker('2,5', LO, HI, 10, 10, 220), flicker('6,12', LO, HI, 15, 15, 225)], once(120),
  Array.from({ length: FRAMES }, (_, i) => i).filter((i) => i % 10 === 0 || i % 15 === 0));
await writeSet('latency', [(i, cells) => { if (i >= 102 && i < 200) cells.set('5,10', BRIGHT); }], (i) => (i >= 200 ? 2 : i >= 100 ? 1 : 0));
await writeSet('static', [], () => 0);
// A frame of another size, for the size refusal.
fs.writeFileSync(path.join(out, 'odd-size.png'), await encodePng({ width: 48, height: 48, rgba: new Uint8Array(48 * 48 * 4).fill(255) }));

// The planted runs, built with the harness's own pieces (rows.ts: row() checks every row with validateRow; manifest() writes
// capture.mjs's top-level fields), on a screen twice the frames' size (192 × 384 px at 160 dpi, Android's density 1), the
// stage the whole window as UI-216 requires: the recording is half size, so its px per dp is 1 × 96 ÷ 192 = 0.5, and
// READY's marker probe scales by 0.5. manifest.json passed; manifest-failed.json is the same run, failed. Its shots:
//   planted              the bound recording: its record names the planted mp4 at 96 × 192, the marker where the scene puts it
//   planted-right        the marker where an RTL swap would put it (the right edge)
//   planted-under-bars   the marker under a system bar, so the harness left it out (classifyProbes' excluded)
//   planted-squashed     a 192 × 300 screen: the stage scales to the frames unequally
//   planted-other        a record of another mp4
//   planted-size         a record of the planted mp4 at another size
//   planted-norecord     a row and no record
const SCREEN = { width: W * 2, height: H * 2 };
const MK = { x: STORM_MARKER_DP.left, y: STORM_MARKER_DP.top, size: STORM_MARKER_DP.size };
const plantedRow = (shot: string, opts: { x?: number; screen?: { width: number; height: number }; bars?: Array<{ x: number; y: number; width: number; height: number }> } = {}) => row({
  shot, scene: 'storm.abyss.dark.idle-still', expect: { direction: 'abyss', face: 'dark', hero: null, tier: null },
  file: `${shot}.1.png`, sha256: crypto.createHash('sha256').update(shot).digest('hex'),
  screen: opts.screen ?? SCREEN, bars: opts.bars, density: 160, clock: { mode: 'realtime', t: null }, shaderStatus: 'ready',
  probes: { marker: { x: opts.x ?? MK.x, y: MK.y, width: MK.size, height: MK.size } },
});
const record = (shot: string, sha256: string, size: { width: number; height: number }) => ({
  shot, file: `${shot}.mp4`, format: 'mp4', bytes: 1000, sha256, seconds: 8, size,
});
const SIZE = { width: W, height: H };
const rows = [
  plantedRow('planted'),
  plantedRow('planted-right', { x: SCREEN.width - MK.size }),
  plantedRow('planted-under-bars', { bars: [{ x: 0, y: 0, width: SCREEN.width, height: 80 }] }),
  plantedRow('planted-squashed', { screen: { width: SCREEN.width, height: 300 } }),
  plantedRow('planted-other'),
  plantedRow('planted-size'),
  plantedRow('planted-norecord'),
];
const records = [
  record('planted', PLANTED_MP4_SHA256, SIZE),
  record('planted-right', PLANTED_MP4_SHA256, SIZE),
  record('planted-under-bars', PLANTED_MP4_SHA256, SIZE),
  record('planted-squashed', PLANTED_MP4_SHA256, SIZE),
  record('planted-other', crypto.createHash('sha256').update('another recording').digest('hex'), SIZE),
  record('planted-size', PLANTED_MP4_SHA256, { width: 540, height: 1170 }),
];
for (const [file, outcome] of [['manifest.json', 'passed'], ['manifest-failed.json', 'failed']] as const) {
  fs.writeFileSync(path.join(out, file), `${JSON.stringify({ ...manifest(rows, outcome, 'v1-storm'), records }, null, 1)}\n`);
}

const planted = {
  mp4Sha256: PLANTED_MP4_SHA256,
  size: { width: W, height: H }, pxPerDp: K, cellPx: CELL, frameMs: FRAME_MS,
  marker: { x: STORM_MARKER_DP.left * K, y: STORM_MARKER_DP.top * K, size: STORM_MARKER_DP.size * K, cell: '0,3' },
  greys: { lo: relY(LO), hi: relY(HI), mid: relY(MID), sub: relY(SUB), bright: relY(BRIGHT), ground: relY(GROUND) },
};
fs.writeFileSync(path.join(out, 'planted.json'), `${JSON.stringify(planted, null, 1)}\n`);
console.log(`planted flash frames in ${out}`);
