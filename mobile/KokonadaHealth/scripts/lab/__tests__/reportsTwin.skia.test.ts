/// <reference types="node" />
// B8-8c: the law twin the reports compare a capture with is what the app's own drawing code draws in CanvasKit, byte for
// byte, but for one modelled layer (UI-272, below). The library (scripts/lab/reports/lib/evidence.mts) runs under plain
// node, where it cannot load the app's .tsx (fieldImage.tsx, FieldFallback.tsx), so it repeats their few Skia calls:
// renderFieldImage's offscreen pass, FieldImage's bilinear upscale (FIELD_SAMPLING) under the canvas's density scale, and
// FieldFallback's picture played at the density. Here, in Skia's own jest environment, the app's real functions draw the
// same scenes, and the twin must equal them.
//
// The one modelled layer is FieldFallback's ring, at its two anti-aliased edges only (UI-272). The app draws the ring with
// drawDRRect, anti-aliased; CanvasKit scan-converts it on the CPU and puts each edge up to 0.25 px off the circle the
// phone's GPU draws, so a twin that is CanvasKit's ring cannot hold ±1 there (at 91d6940 every pixel over ±1 of all 22
// fallback scenes lay on those two edges). So within 1.5 px of either edge the twin is plate.ring over the app's own
// layers 1–3 (ground, face, field: fallbackDraw.ts's own functions) at the coverage the device draws, an 8-bit src-over
// blend; everywhere else it is still the app's picture, byte for byte. Here the model is restated and the twin held to it
// over the app's own layers; reportsRingModel.test.ts holds the model to the phone's own pixels.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { AlphaType, ClipOp, ColorType, Skia, TileMode, type SkImage, type SkPicture } from '@shopify/react-native-skia';
import { FIELD_SCENES, FIELD_STATICS, fieldSceneLayout } from '../../../src/design/lab/fieldScenes';
import { fieldEffect } from '../../../src/design/v2/field/effect';
import { drawFallbackFace, drawFallbackField, drawFallbackGround, recordFieldFallback } from '../../../src/design/v2/field/fallbackDraw';
import { fallbackPlan, type FallbackPlan } from '../../../src/design/v2/field/fallbackModel';
import { fieldStep, renderGeometry, renderScaleFor, renderSize } from '../../../src/design/v2/field/fieldDriver';
import { fixedFieldBreath } from '../../../src/design/v2/field/fieldFrame';
import { FieldImage, imageRect, renderFieldImage } from '../../../src/design/v2/field/fieldImage';
import { emptyLedger } from '../../../src/design/v2/field/placementLedger';
import { ledgerConfigFor } from '../../../src/design/v2/field/statics';
import { DIRECTIONS } from '../../../src/design/v2/tokens/tokens.generated';
import { decodePng } from '../lib/png.mjs';
import { row, type Rect } from '../reports/__fixtures__/rows';

jest.setTimeout(180000);

// As in FallbackScene.skia.test.tsx: CanvasKit's gradient factory reads the colours with instanceof checks that arrays made
// in the test's realm fail; at CanvasKit's own door only, the colours are re-homed into CanvasKit's realm unchanged.
beforeAll(() => {
  const ck = (globalThis as unknown as { CanvasKit: { HEAPF32: Float32Array; Shader: { MakeRadialGradient: (...args: unknown[]) => unknown } } }).CanvasKit;
  const Home = ck.HEAPF32.constructor as Float32ArrayConstructor;
  const make = ck.Shader.MakeRadialGradient.bind(ck.Shader);
  ck.Shader.MakeRadialGradient = (centre: unknown, radius: unknown, colours: unknown, ...rest: unknown[]) =>
    make(centre, radius, Array.isArray(colours) ? Home.from((colours as Float32Array[]).flatMap((c) => Array.from(c))) : colours, ...rest);
});

const APP = path.resolve(__dirname, '../../..');
const LIB = path.join(APP, 'scripts/lab/reports/lib/evidence.mts');
const T = 11000;
// The stage of a small phone: 412 × 916 dp at 0.25 px per dp, 103 × 229 px.
const W = 412;
const H = 916;
const K = 0.25;
const PX = { width: W * K, height: H * K };

/** The twin of each row, rendered by the library in a child node, read back as RGBA. */
async function twins(rows: Record<string, unknown>[]): Promise<Array<{ width: number; height: number; rgba: Uint8Array }>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-'));
  try {
    const code = `const E = await import(${JSON.stringify(pathToFileURL(LIB).href)});
const { encodePng } = await import(${JSON.stringify(pathToFileURL(path.join(APP, 'scripts/lab/lib/png.mjs')).href)});
const fs = await import('node:fs');
const rows = JSON.parse(process.env.TWIN_ROWS);
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const twin = r.scene.startsWith('field.') ? await E.renderFieldTwin(E.readFieldShot(r, 'test')) : await E.renderFallbackTwin(E.readFallbackShot(r, 'test'));
  fs.writeFileSync(process.env.TWIN_DIR + '/' + i + '.png', await encodePng(twin));
}`;
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], {
      cwd: APP, encoding: 'utf8', env: { ...process.env, TWIN_ROWS: JSON.stringify(rows), TWIN_DIR: dir }, maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error(`the library did not render (exit ${r.status}): ${r.stderr}`);
    return await Promise.all(rows.map((_, i) => decodePng(fs.readFileSync(path.join(dir, `${i}.png`)))));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const read = (image: SkImage, w: number, h: number) =>
  image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;

// FieldImage's element is drawn by the library's own command for <Image>, the one the reconciler calls (as in
// fieldImage.skia.test.tsx), on a canvas scaled by the density, as RN Skia's Canvas is on the device.
const { drawImage } = jest.requireActual('@shopify/react-native-skia/lib/commonjs/sksg/Recorder/commands/Drawing');

/** The field scene as the app draws it: fieldStep on FieldScene's inputs, renderFieldImage, FieldImage at the density. */
function appField(id: string): Uint8Array {
  const spec = FIELD_SCENES[id];
  const tier = spec.tier!;
  const layout = fieldSceneLayout(spec, W, H, 1);
  const rs = renderScaleFor(tier);
  const g = renderGeometry(layout, K, rs);
  const size = renderSize(layout, K, rs);
  const ledger = emptyLedger(ledgerConfigFor(spec.direction, spec.face, FIELD_STATICS, g));
  const step = fieldStep(ledger, { seq: 0, taps: spec.taps }, 0, { direction: spec.direction, face: spec.face, stress: 0, confidence: 1, genesis: false, tier }, g, FIELD_STATICS, T, fixedFieldBreath(spec.direction, 0, T).phase);
  if (step.uniforms === null) throw new Error(step.error ?? 'no uniforms');
  const effect = fieldEffect();
  if (effect.status !== 'ready') throw new Error(effect.reason);
  const image = renderFieldImage(Skia, effect.effect, effect.blueNoiseShader, step.uniforms, size.width, size.height)!;
  const surface = Skia.Surface.Make(PX.width, PX.height)!;
  const canvas = surface.getCanvas();
  canvas.scale(K, K);
  const element = FieldImage({ image, rect: imageRect(size, K, rs) }) as React.ReactElement<Record<string, unknown>>;
  drawImage({ Skia, canvas, paint: Skia.Paint() }, element.props);
  surface.flush();
  return read(surface.makeImageSnapshot(), PX.width, PX.height);
}

/** A stage the twin covers, as READY measures it: its rect in px and its px per dp; the twin is its whole px. */
interface Stage {
  readonly name: string;
  readonly rect: Rect;
  readonly k: number;
  readonly px: { readonly width: number; readonly height: number };
  readonly screen: { readonly width: number; readonly height: number };
  readonly bars: readonly Rect[];
  readonly density: number;
}
const SMALL: Stage = { name: 'a small phone', rect: { x: 0, y: 0, ...PX }, k: K, px: PX, screen: PX, bars: [], density: K * 160 };
// The S22+ of the 91d6940 v1-field run, as its manifest records it: 1080 × 2340 px at 420 dpi (2.625 px per dp), the
// status bar the top 74 rows and the navigation bar the bottom 39, READY's stage the window as the phone measured it.
const S22: Stage = {
  name: 'the S22+', rect: { x: 0, y: 0, width: 1079.9999656677246, height: 2340.000045776367 }, k: 2.625, px: { width: 1080, height: 2340 },
  screen: { width: 1080, height: 2340 }, bars: [{ x: 0, y: 0, width: 1080, height: 74 }, { x: 0, y: 2301, width: 1080, height: 39 }], density: 420,
};

interface AppFallback {
  readonly plan: FallbackPlan;
  /** FieldFallback's picture (recordFieldFallback), played under the density's scale. */
  readonly picture: Uint8Array;
  /** Its layers 1–3 alone, fallbackDraw.ts's own functions recorded as recordFieldFallback records them, played the same way. */
  readonly under: Uint8Array;
}

/** The fallback scene as the app draws it, on a stage: its whole picture, and its layers 1–3 without the ring. */
function appFallback(id: string, stage: Stage): AppFallback {
  const spec = FIELD_SCENES[id];
  const layout = fieldSceneLayout(spec, stage.rect.width / stage.k, stage.rect.height / stage.k, 1);
  const plan = fallbackPlan({ direction: spec.direction, face: spec.face, statics: FIELD_STATICS, taps: spec.taps, layout, pxPerDp: stage.k });
  const s = { Skia, ClipOp, TileMode };
  const play = (picture: SkPicture) => {
    const surface = Skia.Surface.Make(stage.px.width, stage.px.height)!;
    surface.getCanvas().scale(stage.k, stage.k);
    surface.getCanvas().drawPicture(picture);
    surface.flush();
    return read(surface.makeImageSnapshot(), stage.px.width, stage.px.height);
  };
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, layout.width, layout.height));
  canvas.scale(1 / plan.pxPerDp, 1 / plan.pxPerDp);
  drawFallbackGround(s, canvas, plan);
  drawFallbackFace(s, canvas, plan);
  drawFallbackField(s, canvas, plan);
  return { plan, picture: play(recordFieldFallback(s, plan, layout.width, layout.height)), under: play(recorder.finishRecordingAsPicture()) };
}

// UI-272's model, restated from its specification (the S22+'s coverage, measured on the 91d6940 captures), with d the
// distance of the pixel's centre from the ring's centre: the inner edge an exact distance ramp, clamp(d − R_in + ½, 0, 1);
// the outer edge the circle's implicit function over its gradient's L1 norm, clamp(½ + (R_out² − d²)/(2(|dx| + |dy|)), 0, 1),
// a ramp |cos θ| + |sin θ| px wide; then round(ring·a + under·(1 − a)) in each channel, opaque. It owns the pixels within
// 1.5 px of either edge.
const BAND = 1.5;
const unit = (v: number) => Math.min(1, Math.max(0, v));
const hexBytes = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The twin against the app on one stage: the picture outside the band, the model over the app's layers 1–3 inside it. */
function againstApp(got: Uint8Array, app: AppFallback, stage: Stage) {
  const { ring } = app.plan;
  const rgb = hexBytes(ring.colour);
  const t = { outside: 0, outsideDiffering: 0, band: 0, bandDiffering: 0, fractional: { inner: 0, outer: 0 }, modelNotCanvasKit: 0 };
  const same = (i: number, want: ArrayLike<number>) => [0, 1, 2, 3].every((ch) => got[i + ch] === want[ch]);
  for (let y = 0; y < stage.px.height; y++) {
    for (let x = 0; x < stage.px.width; x++) {
      const i = (y * stage.px.width + x) * 4;
      const dx = x + 0.5 - ring.centre[0];
      const dy = y + 0.5 - ring.centre[1];
      const d = Math.hypot(dx, dy);
      const nearInner = Math.abs(d - ring.inner) <= BAND;
      if (!nearInner && !(Math.abs(d - ring.outer) <= BAND)) {
        t.outside++;
        if (!same(i, app.picture.subarray(i, i + 4))) t.outsideDiffering++;
        continue;
      }
      t.band++;
      const a = unit(d - ring.inner + 0.5) * unit(0.5 + (ring.outer * ring.outer - d * d) / (2 * (Math.abs(dx) + Math.abs(dy))));
      if (a > 0 && a < 1) t.fractional[nearInner ? 'inner' : 'outer']++;
      const want = [...[0, 1, 2].map((ch) => Math.round(rgb[ch] * a + app.under[i + ch] * (1 - a))), 255];
      if (!same(i, want)) t.bandDiffering++;
      if (![0, 1, 2, 3].every((ch) => want[ch] === app.picture[i + ch])) t.modelNotCanvasKit++;
    }
  }
  return t;
}

const rowOn = (id: string, stage: Stage) => {
  const s = FIELD_SCENES[id];
  const field = s.kind === 'field';
  return row({
    shot: 's', scene: id, expect: { direction: s.direction, face: s.face, hero: s.hero, tier: s.tier }, file: 'x.png', sha256: 'b'.repeat(64),
    screen: stage.screen, bars: stage.bars, stage: stage.rect, density: stage.density, clock: { mode: 'fixed', t: T },
    shaderStatus: field ? 'ready' : 'fallback-scene',
  });
};
const stageRow = (id: string) => rowOn(id, SMALL);

const differing = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

describe('B8-8c: the twin is the app’s own drawing in CanvasKit, byte for byte, but for the ring’s two edges (UI-272)', () => {
  const FIELD = ['field.abyss.dark.one.joy.still', 'field.abyss.light.three.low', 'field.abyss.dark.rest.full', 'field.abyss.dark.near.joy.full', 'field.abyss.light.near.intense.full'];
  const FALLBACK = ['fallback.abyss.dark.one.C.right', 'fallback.abyss.light.rest', 'fallback.abyss.dark.three'];
  const ON_S22 = ['fallback.abyss.dark.one.J', 'fallback.abyss.light.three'];

  it('the guard: every case is a lab scene of its kind', () => {
    for (const id of FIELD) expect(FIELD_SCENES[id]?.kind).toBe('field');
    for (const id of [...FALLBACK, ...ON_S22]) expect(FIELD_SCENES[id]?.kind).toBe('fallback');
  });

  it('field scenes: renderFieldImage and FieldImage’s bilinear upscale at the density', async () => {
    const got = await twins(FIELD.map(stageRow));
    FIELD.forEach((id, i) => {
      expect([got[i].width, got[i].height]).toEqual([PX.width, PX.height]);
      const want = appField(id);
      expect({ id, differing: differing(got[i].rgba, want) }).toEqual({ id, differing: 0 });
    });
  });

  const fallbackCases = [...FALLBACK.map((id) => [id, SMALL] as const), ...ON_S22.map((id) => [id, S22] as const)];
  it.each(fallbackCases.map(([id, stage]) => [id, stage.name, stage] as const))(
    'fallback %s on %s: FieldFallback’s picture at the density, byte for byte, but within 1.5 px of either ring edge plate.ring over the app’s own layers 1–3 at the device’s coverage',
    async (id, _name, stage) => {
      const [got] = await twins([rowOn(id, stage)]);
      expect([got.width, got.height]).toEqual([stage.px.width, stage.px.height]);
      const app = appFallback(id, stage);
      // Every input of the model is the plan's or the twin's (C1): plate.ring is its token, the geometry fallbackPlan's.
      expect(app.plan.ring.colour).toBe(DIRECTIONS[FIELD_SCENES[id].direction].color[FIELD_SCENES[id].face].plate.ring.hex);
      const t = againstApp(got.rgba, app, stage);
      expect({ id, outsideDiffering: t.outsideDiffering, bandDiffering: t.bandDiffering }).toEqual({ id, outsideDiffering: 0, bandDiffering: 0 });
      // It has cases: both edges at fractional coverage, the model not CanvasKit's ring there, and most of the stage the picture's.
      expect(t.fractional.inner).toBeGreaterThan(0);
      expect(t.fractional.outer).toBeGreaterThan(0);
      expect(t.modelNotCanvasKit).toBeGreaterThan(0);
      expect(t.outside).toBeGreaterThan(10 * t.band);
    },
  );

  it('the planted control: a field twin and a fallback twin of one scene differ (so neither stands for the other)', async () => {
    const [field, fallback] = await twins([stageRow('field.abyss.dark.three.still'), stageRow('fallback.abyss.dark.three')]);
    expect(differing(field.rgba, fallback.rgba)).toBeGreaterThan(1000);
  });
});
