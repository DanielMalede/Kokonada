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
// Each row is built by the harness's own buildRow (lib/manifest.mjs, UI-240) over planted sources, with renderFacts
// (capture.mjs) for its render facts, and checked by validateRow before it is written; the manifest is rows.ts's, the
// harness's buildManifest.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderFacts } from '../../capture.mjs';
import { buildRow, validateRow } from '../../lib/manifest.mjs';
import { classifyProbes } from '../../lib/protocol.mjs';
import { encodePng } from '../../lib/png.mjs';
import { registerTsResolve } from '../lib/tsResolve.mjs';
import { manifest } from './rows.ts';

registerTsResolve();
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { witnessLayout } = await import('../../../../src/design/lab/witness/witnessLayout.ts');
const { w1bFrame, noiseFree, witnessSceneId, WITNESS_HERO, WITNESS_TIER, WITNESS_DIRECTION } = await import('../../../../src/design/lab/witness/witnessFrames.ts');
const { WITNESS_MODELS, hexBytes } = await import('../../../../src/design/v2/color/displayP3.ts');
const { fieldPixel } = await import('../../../../src/design/v2/field/fieldLaw.ts');

type Bytes = readonly [number, number, number];
type Plant = { kind: string; colour?: string; paint?: string; delta?: Bytes };
type Insets = { top: number; right: number; bottom: number; left: number };
/**
 * geometry 'dryRun': the S22+ of the dry run, edge to edge: a 1080 × 2340 px screen at density 420 (2.625 px per dp), the
 * stage the whole screen, the app region the screen less the status bar (0–74 px) and the navigation bar (2301–2340 px),
 * and the scene's insets the measured top (74 px) and the 48 dp bound at the bottom. Otherwise a 412 × 916 dp stage inside
 * the app region under a 6 px strip, with no insets. `layoutInsets` (dp) replaces the insets the scene laid out with.
 */
type RowOptions = { face: 'dark' | 'light'; colorMode: string | null; density?: number; plants?: Plant[]; geometry?: 'dryRun'; layoutInsets?: Insets };
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
  const dry = r.geometry === 'dryRun';
  const density = dry ? 420 : (r.density ?? 80);
  const k = density / 160;
  // Screen px: the screen, the app region the capture keeps (the PNG), and READY's stage.
  const screen = dry ? { width: 1080, height: 2340 } : { width: Math.ceil(DP.width * k), height: 24 + STRIP + Math.ceil(DP.height * k) };
  const region = dry ? { x: 0, y: 74, width: 1080, height: 2301 - 74 } : { x: 0, y: 24, width: Math.ceil(DP.width * k), height: Math.ceil(DP.height * k) + STRIP };
  const stage = dry ? { x: 0, y: 0, width: 1080, height: 2340 } : { x: 0, y: region.y + STRIP, width: DP.width * k, height: DP.height * k };
  const insets: Insets = r.layoutInsets ?? (dry ? { top: 74 / k, right: 0, bottom: 48, left: 0 } : { top: 0, right: 0, bottom: 0, left: 0 });
  const layout = witnessLayout(r.face, stage.width / k, stage.height / k, k, 1, insets);
  const rgba = new Uint8Array(region.width * region.height * 4).fill(255);
  /** A stage px (its column and row from the stage's origin) on the PNG, or nothing when the capture leaves it out. */
  const put = (x: number, y: number, c: Bytes) => {
    const px = Math.floor(stage.x) + x - region.x;
    const py = Math.floor(stage.y) + y - region.y;
    if (px < 0 || py < 0 || px >= region.width || py >= region.height) return;
    rgba.set([c[0], c[1], c[2], 255], (py * region.width + px) * 4);
  };
  const get = (x: number, y: number): Bytes => {
    const i = ((Math.floor(stage.y) + y - region.y) * region.width + (Math.floor(stage.x) + x - region.x)) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2]];
  };
  const stagePx = { width: Math.floor(stage.width), height: Math.floor(stage.height) };
  const add = (c: Bytes, d: Bytes | undefined): Bytes => (d ? [c[0] + d[0], c[1] + d[1], c[2] + d[2]].map((v) => Math.min(255, Math.max(0, v))) as unknown as Bytes : c);
  /** The stage px whose centres lie in a dp rect. */
  const pixelsIn = (rect: { x: number; y: number; width: number; height: number }) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = 0; x < stagePx.width; x++) if ((x + 0.5) / k >= rect.x && (x + 0.5) / k < rect.x + rect.width) xs.push(x);
    for (let y = 0; y < stagePx.height; y++) if ((y + 0.5) / k >= rect.y && (y + 0.5) / k < rect.y + rect.height) ys.push(y);
    return { xs, ys };
  };

  // W1b, the production field, noise-free, over the whole stage.
  const w1b = w1bFrame(r.face, layout.field, k, layout.renderScale);
  const frame = noiseFree(w1b.frame);
  for (let y = 0; y < stagePx.height; y++) {
    for (let x = 0; x < stagePx.width; x++) put(x, y, fieldPixel(frame, (x + 0.5) * layout.renderScale, (y + 0.5) * layout.renderScale));
  }
  const w1bPlant = r.plants?.find((p) => p.kind === 'W1b');
  if (w1bPlant) {
    const { xs, ys } = pixelsIn(layout.w1b.sample);
    for (const y of ys) for (const x of xs) put(x, y, add(get(x, y), w1bPlant.delta));
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
  const row = buildRow({
    shot: { id: shot, scene: witnessSceneId(r.face), device: { fontScale: 1 }, expect: { direction: WITNESS_DIRECTION, face: r.face, hero: WITNESS_HERO, tier: WITNESS_TIER } },
    repeat: 1, file, sha256: sha256(png), appRegionHash: H('2'),
    build: { head: 'a'.repeat(40), stamp: { bundleSha256: H('3'), tokens: {}, dev: false }, apkSha256: H('4'), hermes: true, skiaVersion: '2.6.9' },
    app: { package: 'com.kokonadahealth.lab' },
    facts: { model: 'fixture', fingerprint: 'fixture/planted', density, refreshRate: 120, forceDark: false, locale: 'he-IL' },
    frame: { ...screen, colorSpace: 'sRGB' },
    observed: { fontScale: 1, night: r.face === 'dark' ? 'yes' : 'no', animatorScales: { window: 1, transition: 1, animator: 1 } },
    ready: {
      clock: 'fixed', t: 11000, seq: 0, powerSave: false, tier: WITNESS_TIER, isRTL: true, fontScale: 1, shaderStatus: 'ready', shaderReason: null,
      pixelRatio: k, probes: { stage: { px: stage } },
    },
    region,
    // READY's stage and region probes (the stage minus the insets the scene laid out with), classified by the harness.
    probes: classifyProbes({
      stage: { px: stage },
      region: { px: { x: stage.x + insets.left * k, y: stage.y + insets.top * k, width: stage.width - (insets.left + insets.right) * k, height: stage.height - (insets.top + insets.bottom) * k } },
    }, screen, region),
    timestamps: { launched: new Date('2026-11-15T00:00:00.000Z'), ready: new Date('2026-11-15T00:00:01.000Z'), captured: new Date('2026-11-15T00:00:02.000Z') },
    renderFacts: renderFacts(WITNESS_TIER, tiers),
    render: {
      gl: { renderer: 'fixture', gles: 'OpenGL ES 3.2', reason: null },
      display: { colorMode: r.colorMode, wideColor: true, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: r.colorMode === null ? 'planted: no colour mode' : null },
    },
  }) as Record<string, unknown>;
  const errors = validateRow(row);
  if (errors.length) throw new Error(`the planted row is not a valid manifest row: ${errors.join('; ')}`);
  rows.push(row);
}
if (options.smoke) {
  const base = rows[0];
  rows.push({ ...base, shot: 'smoke', scene: 'smoke', expect: { direction: null, face: null, hero: null, tier: null }, renderScale: null, sampling: null });
}
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest(rows, options.outcome ?? 'passed', 'v1-witness'), null, 2)}\n`);
