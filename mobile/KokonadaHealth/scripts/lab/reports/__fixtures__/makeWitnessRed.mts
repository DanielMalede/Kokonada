// Planted witness captures for the never-red report's witness rule (the designer's rule (b)): synthetic PNGs and their
// manifest, generated at test time, never device captures and never anything personal.
//
//   node scripts/lab/reports/__fixtures__/makeWitnessRed.mts <out folder> '<options JSON>'
//
// options: { face?, fontScale?, plants? }. One witness.abyss.<face> row, built with the harness's own pieces (rows.ts:
// appRegion, classifyProbes, renderFacts, validateRow): a 412 × 964 px screen at density 160 (1 px per dp), its status bar
// the top 6 rows and its navigation bar the bottom 6, READY's stage the whole window. The stage is flat grey; every patch
// of witnessLayout (imported, never restated), laid out from the row's own facts, is painted flat in its bytes over the
// pixels whose centres lie in its rect; every planted patch (misreadAsP3, doubleEncode, skipEncode) also gets a red
// anti-aliased fringe on the pixel row just above its rect (inside the report's 1 px growth). A plant adds red elsewhere:
//   { at: 'outside' }           a red pixel 2 px above the first planted patch's top (outside its 1 px growth)
//   { at: 'non-planted' }       a red pixel at the centre of the first W2 patch (a true patch: never excluded)
//   { at: 'misplaced' }         the first planted patch's sample painted grey (its median is not its paint), red fringe kept
//   { at: 'seam' }              a red pixel on the gap between the first two non-planted patches (the dry-run seam)
// planted.json lists every red pixel it painted, by why.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { encodePng } from '../../lib/png.mjs';
import { registerTsResolve } from '../lib/tsResolve.mjs';
import { manifest, row } from './rows.ts';

registerTsResolve();
const { witnessLayout } = await import('../../../../src/design/lab/witness/witnessLayout.ts');
const { hexBytes } = await import('../../../../src/design/v2/color/displayP3.ts');

type Plant = { at: 'outside' | 'non-planted' | 'misplaced' | 'seam' };
type Options = { face?: 'dark' | 'light'; fontScale?: number; plants?: Plant[] };

// No process.exit(): this script loads CanvasKit through the witness modules (reportsCanvasKitExit.test.ts).
const [out, json] = process.argv.slice(2);
if (!out || !json) {
  process.exitCode = 2;
  throw new Error('usage: node makeWitnessRed.mts <out folder> <options JSON>');
}
const options = JSON.parse(json) as Options;
const face = options.face ?? 'dark';
const fontScale = options.fontScale ?? 1;
const SCREEN = { width: 412, height: 964 };
const BAR = 6;
const BARS = [{ x: 0, y: 0, width: SCREEN.width, height: BAR }, { x: 0, y: SCREEN.height - BAR, width: SCREEN.width, height: BAR }];
const RED = [200, 30, 40];
const PLANTED = new Set(['misreadAsP3', 'doubleEncode', 'skipEncode']);

const base = row({
  shot: `witness-${face}`, scene: `witness.abyss.${face}`, expect: { direction: 'abyss', face, hero: 'one.joy', tier: 'full' },
  file: `witness-${face}.1.png`, sha256: '0'.repeat(64), screen: SCREEN, bars: BARS, density: 160, fontScale, shaderStatus: 'ready',
});
const region = base.region as { x: number; y: number; width: number; height: number };
const layout = witnessLayout(face, SCREEN.width, SCREEN.height, 1, fontScale);
const rgba = new Uint8Array(region.width * region.height * 4);
for (let i = 0; i < rgba.length; i += 4) rgba.set([96, 96, 96, 255], i);
type R = { x: number; y: number; width: number; height: number };
/** Paints the PNG pixels whose centres lie in a dp rect of the stage (1 px per dp, the stage at the window's 0, 0). */
const paint = (r: R, c: readonly number[]) => {
  for (let y = 0; y < region.height; y++) {
    const cy = y + region.y + 0.5;
    if (cy < r.y || cy >= r.y + r.height) continue;
    for (let x = 0; x < region.width; x++) {
      const cx = x + region.x + 0.5;
      if (cx >= r.x && cx < r.x + r.width) rgba.set([c[0], c[1], c[2], 255], (y * region.width + x) * 4);
    }
  }
};
const red: Array<{ x: number; y: number; why: string }> = [];
const dot = (sx: number, sy: number, why: string) => {
  const x = Math.floor(sx) - region.x;
  const y = Math.floor(sy) - region.y;
  rgba.set([...RED, 255], (y * region.width + x) * 4);
  red.push({ x, y, why });
};

for (const p of layout.patches) paint(p.rect, p.paint === null ? p.token : hexBytes(p.paint));
const planted = layout.patches.filter((p) => PLANTED.has(p.kind));
const truths = layout.patches.filter((p) => !PLANTED.has(p.kind));
for (const p of planted) for (let x = Math.ceil(p.rect.x); x < p.rect.x + p.rect.width; x += 3) dot(x, Math.ceil(p.rect.y) - 1, 'fringe');
for (const plant of options.plants ?? []) {
  const first = planted[0];
  if (plant.at === 'outside') dot(first.rect.x + 4, Math.ceil(first.rect.y) - 2, 'outside');
  if (plant.at === 'non-planted') {
    const w2 = truths.find((p) => p.kind === 'W2')!;
    dot(w2.rect.x + w2.rect.width / 2, w2.rect.y + w2.rect.height / 2, 'non-planted');
  }
  if (plant.at === 'misplaced') paint(first.sample, [96, 96, 96]);
  if (plant.at === 'seam') {
    const [a, b] = truths;
    const sameRow = Math.abs(a.rect.y - b.rect.y) < 1e-9;
    dot(sameRow ? (a.rect.x + a.rect.width + b.rect.x) / 2 : a.rect.x + 2, sameRow ? a.rect.y + 2 : (a.rect.y + a.rect.height + b.rect.y) / 2, 'seam');
  }
}

fs.mkdirSync(out, { recursive: true });
const png = await encodePng({ width: region.width, height: region.height, rgba });
fs.writeFileSync(path.join(out, base.file as string), png);
const r = { ...base, sha256: crypto.createHash('sha256').update(png).digest('hex') };
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest([r]), null, 2)}\n`);
fs.writeFileSync(path.join(out, 'planted.json'), `${JSON.stringify({ planted: planted.length, red }, null, 2)}\n`);
console.log(`witness fixture written to ${out}`);
