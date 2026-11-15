// Planted witness captures for the colour-path report (B8-8d): synthetic PNGs and their manifest, generated at test time,
// never device captures and never anything personal.
//
//   node scripts/lab/reports/__fixtures__/makeWitness.mts <out folder> '<options JSON>'
//
// options: { rows: [{ face, colorMode, density?, plants? }], outcome?, smoke? }. Each row is a witness.abyss.<face> capture
// drawn as the witness scene draws it (WitnessScene.tsx): the stage, 412 × 916 dp at 0.5 px per dp (density 80), is the
// law's noise-free W1b field, pixel by pixel at each pixel's centre, and every patch of witnessLayout (imported, never
// restated) is painted flat in its bytes: the token's for W1a, W2 and W3, the planted model's for the others. A white
// strip of 6 px above the stage is in the app region and is not the stage. A plant changes one patch before it is drawn:
//   { kind, colour, paint?: 'token' | <model>, delta?: [r, g, b] }   (kind 'W1b' moves W1b's sample by delta)
// Each row is built from the harness's own pieces: renderFacts (capture.mjs) for its render facts, and it is checked by
// validateRow (lib/manifest.mjs) before it is written.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderFacts } from '../../capture.mjs';
import { validateRow } from '../../lib/manifest.mjs';
import { encodePng } from '../../lib/png.mjs';
import { registerTsResolve } from '../lib/tsResolve.mjs';

registerTsResolve();
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { witnessLayout } = await import('../../../../src/design/lab/witness/witnessLayout.ts');
const { w1bFrame, noiseFree, witnessSceneId, WITNESS_HERO, WITNESS_TIER, WITNESS_DIRECTION } = await import('../../../../src/design/lab/witness/witnessFrames.ts');
const { WITNESS_MODELS, hexBytes } = await import('../../../../src/design/v2/color/displayP3.ts');
const { fieldPixel } = await import('../../../../src/design/v2/field/fieldLaw.ts');

type Bytes = readonly [number, number, number];
type Plant = { kind: string; colour?: string; paint?: string; delta?: Bytes };
type RowOptions = { face: 'dark' | 'light'; colorMode: string | null; density?: number; plants?: Plant[] };
type Options = { rows: RowOptions[]; outcome?: 'passed' | 'failed'; smoke?: boolean };

// No process.exit(): this script loads CanvasKit (reportsCanvasKitExit.test.ts).
const [out, json] = process.argv.slice(2);
if (!out || !json) {
  process.exitCode = 2;
  throw new Error('usage: node makeWitness.mts <out folder> <options JSON>');
}
const options = JSON.parse(json) as Options;

const DP = { width: 412, height: 916 };
const STRIP = 6;
const tiers = JSON.parse(fs.readFileSync(path.join(APP, '../../design-tokens/base.tokens.json'), 'utf8')).field.tiers;
const sha256 = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const H = (c: string) => c.repeat(64);

fs.mkdirSync(out, { recursive: true });
const rows: Record<string, unknown>[] = [];
for (const [n, r] of options.rows.entries()) {
  const density = r.density ?? 80;
  const k = density / 160;
  const stagePx = { width: DP.width * k, height: DP.height * k };
  const region = { x: 0, y: 24, width: Math.ceil(stagePx.width), height: Math.ceil(stagePx.height) + STRIP };
  const stage = { x: 0, y: region.y + STRIP, width: stagePx.width, height: stagePx.height };
  const layout = witnessLayout(r.face, DP.width, DP.height, k, 1);
  const rgba = new Uint8Array(region.width * region.height * 4).fill(255);
  const put = (x: number, y: number, c: Bytes) => rgba.set([c[0], c[1], c[2], 255], ((y + STRIP) * region.width + x) * 4);
  const add = (c: Bytes, d: Bytes | undefined): Bytes => (d ? [c[0] + d[0], c[1] + d[1], c[2] + d[2]].map((v) => Math.min(255, Math.max(0, v))) as unknown as Bytes : c);
  /** The stage px whose centres lie in a dp rect. */
  const pixelsIn = (rect: { x: number; y: number; width: number; height: number }) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = 0; x < Math.floor(stagePx.width); x++) if ((x + 0.5) / k >= rect.x && (x + 0.5) / k < rect.x + rect.width) xs.push(x);
    for (let y = 0; y < Math.floor(stagePx.height); y++) if ((y + 0.5) / k >= rect.y && (y + 0.5) / k < rect.y + rect.height) ys.push(y);
    return { xs, ys };
  };

  // W1b, the production field, noise-free, over the whole stage.
  const w1b = w1bFrame(r.face, layout.field, k, layout.renderScale);
  const frame = noiseFree(w1b.frame);
  for (let y = 0; y < Math.floor(stagePx.height); y++) {
    for (let x = 0; x < Math.floor(stagePx.width); x++) put(x, y, fieldPixel(frame, (x + 0.5) * layout.renderScale, (y + 0.5) * layout.renderScale));
  }
  const w1bPlant = r.plants?.find((p) => p.kind === 'W1b');
  if (w1bPlant) {
    const { xs, ys } = pixelsIn(layout.w1b.sample);
    for (const y of ys) for (const x of xs) {
      const i = ((y + STRIP) * region.width + x) * 4;
      put(x, y, add([rgba[i], rgba[i + 1], rgba[i + 2]], w1bPlant.delta));
    }
  }
  // Every patch, flat in its bytes, with its plant.
  for (const p of layout.patches) {
    const plant = r.plants?.find((q) => q.kind === p.kind && q.colour === p.colour);
    let bytes: Bytes = p.paint === null ? p.token : hexBytes(p.paint);
    if (plant?.paint === 'token') bytes = p.token;
    else if (plant?.paint) bytes = (WITNESS_MODELS as Record<string, (b: Bytes) => Bytes>)[plant.paint](p.token);
    bytes = add(bytes, plant?.delta);
    const { xs, ys } = pixelsIn(p.rect);
    for (const y of ys) for (const x of xs) put(x, y, bytes);
  }

  const shot = `witness-${r.face}-${n}`;
  const file = `${shot}.1.png`;
  const png = await encodePng({ width: region.width, height: region.height, rgba });
  fs.writeFileSync(path.join(out, file), png);
  const row = {
    shot, repeat: 1, file, sha256: sha256(png), appRegionHash: H('2'),
    commit: { sha: 'a'.repeat(40), porcelainEmpty: true },
    stamp: { bundleSha256: H('3'), tokens: {} },
    device: { model: 'fixture', fingerprint: 'fixture/planted', width: region.width, height: region.y + region.height, density, refreshRate: 120 },
    app: { package: 'com.kokonadahealth.lab', apkSha256: H('4'), buildType: 'lab', hermes: true, dev: false },
    scene: witnessSceneId(r.face), direction: WITNESS_DIRECTION, face: r.face,
    fontScale: { requested: 1, observed: 1, app: 1 },
    motion: { reduceMotionObserved: false, powerSaveObserved: false, tier: WITNESS_TIER },
    locale: 'he-IL', isRTL: true,
    clock: { mode: 'fixed', t: 11000, seq: 0 },
    shaderStatus: 'ready',
    uimode: r.face === 'dark' ? 'night' : 'day', animatorScales: { window: 1, transition: 1, animator: 1 }, forceDark: false, colorSpace: 'sRGB',
    region,
    probes: { inside: { stage: { x: 0, y: stage.y, width: Math.ceil(stage.width), height: Math.ceil(stage.height) } }, excluded: [] },
    timestamps: { launched: '2026-11-15T00:00:00.000Z', ready: '2026-11-15T00:00:01.000Z', captured: '2026-11-15T00:00:02.000Z' },
    expect: { direction: WITNESS_DIRECTION, face: r.face, hero: WITNESS_HERO, tier: WITNESS_TIER },
    ...renderFacts(WITNESS_TIER, tiers),
    gl: { renderer: 'fixture', gles: 'OpenGL ES 3.2', reason: null },
    display: { colorMode: r.colorMode, wideColor: true, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: r.colorMode === null ? 'planted: no colour mode' : null },
    skiaVersion: '2.6.9',
    shaderReason: null,
    stage,
  };
  const errors = validateRow(row);
  if (errors.length) throw new Error(`the planted row is not a valid manifest row: ${errors.join('; ')}`);
  rows.push(row);
}
if (options.smoke) {
  const base = rows[0];
  rows.push({ ...base, shot: 'smoke', scene: 'smoke', expect: { direction: null, face: null, hero: null, tier: null }, renderScale: null, sampling: null });
}
const manifest = {
  plan: 'v1-witness', outcome: options.outcome ?? 'passed', failure: options.outcome === 'failed' ? 'planted failure' : null, restoreFailures: [],
  commit: 'a'.repeat(40), stamp: {}, apkSha256: H('4'), device: { model: 'fixture' },
  startedAt: '2026-11-15T00:00:00Z', finishedAt: '2026-11-15T00:01:00Z', rows, determinism: [], proofs: [],
};
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
