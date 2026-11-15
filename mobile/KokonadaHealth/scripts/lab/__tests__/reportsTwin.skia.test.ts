/// <reference types="node" />
// B8-8c: the law twin the reports compare a capture with is what the app's own drawing code draws in CanvasKit, byte for
// byte. The library (scripts/lab/reports/lib/evidence.mts) runs under plain node, where it cannot load the app's .tsx
// (fieldImage.tsx, FieldFallback.tsx), so it repeats their few Skia calls: renderFieldImage's offscreen pass, FieldImage's
// bilinear upscale (FIELD_SAMPLING) under the canvas's density scale, and FieldFallback's picture played at the density.
// Here, in Skia's own jest environment, the app's real functions draw the same scenes, and the twin must equal them.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { AlphaType, ClipOp, ColorType, Skia, TileMode, type SkImage } from '@shopify/react-native-skia';
import { FIELD_SCENES, FIELD_STATICS, fieldSceneLayout } from '../../../src/design/lab/fieldScenes';
import { fieldEffect } from '../../../src/design/v2/field/effect';
import { recordFieldFallback } from '../../../src/design/v2/field/fallbackDraw';
import { fallbackPlan } from '../../../src/design/v2/field/fallbackModel';
import { fieldStep, renderGeometry, renderScaleFor, renderSize } from '../../../src/design/v2/field/fieldDriver';
import { fixedFieldBreath } from '../../../src/design/v2/field/fieldFrame';
import { FieldImage, imageRect, renderFieldImage } from '../../../src/design/v2/field/fieldImage';
import { emptyLedger } from '../../../src/design/v2/field/placementLedger';
import { ledgerConfigFor } from '../../../src/design/v2/field/statics';
import { decodePng } from '../lib/png.mjs';
import { row } from '../reports/__fixtures__/rows';

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

/** The fallback scene as the app draws it: FieldFallback's picture, played under the density's scale. */
function appFallback(id: string): Uint8Array {
  const spec = FIELD_SCENES[id];
  const layout = fieldSceneLayout(spec, W, H, 1);
  const picture = recordFieldFallback({ Skia, ClipOp, TileMode }, fallbackPlan({ direction: spec.direction, face: spec.face, statics: FIELD_STATICS, taps: spec.taps, layout, pxPerDp: K }), layout.width, layout.height);
  const surface = Skia.Surface.Make(PX.width, PX.height)!;
  surface.getCanvas().scale(K, K);
  surface.getCanvas().drawPicture(picture);
  surface.flush();
  return read(surface.makeImageSnapshot(), PX.width, PX.height);
}

const stageRow = (id: string) => {
  const s = FIELD_SCENES[id];
  const field = s.kind === 'field';
  return row({
    shot: 's', scene: id, expect: { direction: s.direction, face: s.face, hero: s.hero, tier: s.tier }, file: 'x.png', sha256: 'b'.repeat(64),
    region: { x: 0, y: 0, ...PX }, stage: { x: 0, y: 0, ...PX }, pxPerDp: K, t: T,
    renderScale: field ? renderScaleFor(s.tier!) : undefined, shaderStatus: field ? 'ready' : 'fallback-scene',
  });
};

const differing = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

describe('B8-8c: the twin is the app’s own drawing in CanvasKit, byte for byte', () => {
  const FIELD = ['field.abyss.dark.one.joy.still', 'field.abyss.light.three.low', 'field.abyss.dark.rest.full'];
  const FALLBACK = ['fallback.abyss.dark.one.C.right', 'fallback.abyss.light.rest', 'fallback.abyss.dark.three'];

  it('the guard: every case is a lab scene of its kind', () => {
    for (const id of FIELD) expect(FIELD_SCENES[id]?.kind).toBe('field');
    for (const id of FALLBACK) expect(FIELD_SCENES[id]?.kind).toBe('fallback');
  });

  it('field scenes: renderFieldImage and FieldImage’s bilinear upscale at the density', async () => {
    const got = await twins(FIELD.map(stageRow));
    FIELD.forEach((id, i) => {
      expect([got[i].width, got[i].height]).toEqual([PX.width, PX.height]);
      const want = appField(id);
      expect({ id, differing: differing(got[i].rgba, want) }).toEqual({ id, differing: 0 });
    });
  });

  it('fallback scenes: FieldFallback’s picture at the density', async () => {
    const got = await twins(FALLBACK.map(stageRow));
    FALLBACK.forEach((id, i) => {
      expect([got[i].width, got[i].height]).toEqual([PX.width, PX.height]);
      const want = appFallback(id);
      expect({ id, differing: differing(got[i].rgba, want) }).toEqual({ id, differing: 0 });
    });
  });

  it('the planted control: a field twin and a fallback twin of one scene differ (so neither stands for the other)', async () => {
    const [field, fallback] = await twins([stageRow('field.abyss.dark.three.still'), stageRow('fallback.abyss.dark.three')]);
    expect(differing(field.rgba, fallback.rgba)).toBeGreaterThan(1000);
  });
});
