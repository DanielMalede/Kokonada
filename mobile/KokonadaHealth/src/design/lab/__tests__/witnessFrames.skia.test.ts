import { AlphaType, ColorType, Skia, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { hexBytes, lsbDelta } from '../../v2/color/displayP3';
import { createFieldEffect } from '../../v2/field/effect';
import { PHONE } from '../../v2/field/fallbackScenes';
import { renderSize } from '../../v2/field/fieldDriver';
import { renderFieldImage } from '../../v2/field/fieldImage';
import { fieldPixel } from '../../v2/field/fieldLaw';
import type { Face } from '../../v2/tokens/tokens.generated';
import { noiseFree, w1aFrame, w1bFrame, witnessColours } from '../witness/witnessFrames';
import { PATCH_DP, witnessLayout } from '../witness/witnessLayout';
import { packFrame } from '../../v2/field/uniforms';

// B8-2 in real Skia (CanvasKit): the witness frames drawn by the field's own runtime effect, made as the app makes it
// (effect.ts), through FieldSurface's render (renderFieldImage) for W1a. W1a must be the token hex ±1 (the designer's 3c
// amendment 1: W1a, W2 and W3 share one expected value). W1b, the production one.joy frame with its grain and dither, is
// held by the median of (render − the law's noise-free colour) over its sample, per channel, within ±1: the median is
// preserved under the monotone encode, so the zero-mean noise does not bias it. W2's and the planted patches' paints read
// back as the bytes they name.

const FACES: readonly Face[] = ['dark', 'light'];
let effect: SkRuntimeEffect;
let blueNoise: SkShader;

beforeAll(() => {
  const made = createFieldEffect(Skia)();
  if (made.status !== 'ready') throw new Error(`the field effect is not ready: ${made.reason}`);
  effect = made.effect;
  blueNoise = made.blueNoiseShader;
});

const read = (image: { readPixels: (x: number, y: number, info: object) => unknown }, w: number, h: number) =>
  image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
const rgb = (px: Uint8Array, i: number): [number, number, number] => [px[4 * i], px[4 * i + 1], px[4 * i + 2]];

describe('W1a in CanvasKit: the runtime effect over a ground set to the colour is the token hex ±1', () => {
  it.each(FACES)('%s face: the four anchors and the ground, every pixel of the patch\'s render', (face) => {
    const size = renderSize({ width: PATCH_DP, height: PATCH_DP, centre: [0, 0], radius: 1, fontScale: 1 }, PHONE.pxPerDp, 0.5);
    for (const colour of witnessColours(face)) {
      const image = renderFieldImage(Skia, effect, blueNoise, packFrame(w1aFrame(face, colour, size)), size.width, size.height);
      expect(image).not.toBeNull();
      const px = read(image!, size.width, size.height);
      let worst = 0;
      for (let i = 0; i < size.width * size.height; i++) worst = Math.max(worst, lsbDelta(rgb(px, i), colour.bytes));
      expect({ colour: colour.name, worst: Math.min(worst, 2) }).toEqual({ colour: colour.name, worst: Math.min(worst, 1) });
    }
  });
});

/** The W1b frame drawn over its sample only: the effect evaluated at the sample's own render px (a translated canvas). */
function renderSample(uniforms: readonly number[], x0: number, y0: number, w: number, h: number): Uint8Array {
  const surface = Skia.Surface.MakeOffscreen(w, h)!;
  const paint = Skia.Paint();
  paint.setDither(false);
  paint.setShader(effect.makeShaderWithChildren([...uniforms], [blueNoise]));
  const canvas = surface.getCanvas();
  canvas.translate(-x0, -y0);
  canvas.drawPaint(paint);
  surface.flush();
  return read(surface.makeImageSnapshot(), w, h);
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

describe('W1b in CanvasKit: the production patch, its median Δ from the noise-free law within ±1', () => {
  it.each(FACES)('%s face, on the board phone', (face) => {
    const layout = witnessLayout(face, PHONE.width, PHONE.height, PHONE.pxPerDp, 1);
    const { frame, uniforms, renderScale } = w1bFrame(face, layout.field, PHONE.pxPerDp);
    const k = PHONE.pxPerDp * renderScale;
    const s = layout.w1b.sample;
    const x0 = Math.ceil(s.x * k - 0.5);
    const y0 = Math.ceil(s.y * k - 0.5);
    const w = Math.floor((s.x + s.width) * k - 0.5) - x0 + 1;
    const h = Math.floor((s.y + s.height) * k - 0.5) - y0 + 1;
    const px = renderSample(uniforms, x0, y0, w, h);
    const clean = noiseFree(frame);
    const deltas: number[][] = [[], [], []];
    let grained = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const drawn = rgb(px, j * w + i);
      const law = fieldPixel(clean, x0 + i + 0.5, y0 + j + 0.5);
      for (let c = 0; c < 3; c++) deltas[c].push(drawn[c] - law[c]);
      if (lsbDelta(drawn, law) > 0) grained += 1;
    }
    expect(w * h).toBeGreaterThanOrEqual(400);
    for (let c = 0; c < 3; c++) expect(Math.abs(median(deltas[c]))).toBeLessThanOrEqual(1);
    // Not vacuous: the grain and the dither are drawn (the render is not the noise-free law), and the patch is the
    // field's colour, not the face ground's.
    expect(grained).toBeGreaterThan((w * h) / 4);
    const centre = fieldPixel(clean, x0 + w / 2, y0 + h / 2);
    expect(lsbDelta(centre, fieldPixel({ ...clean, kField: 0, nodes: clean.nodes.map((n) => ({ ...n, fade: 0 })) }, x0 + w / 2, y0 + h / 2))).toBeGreaterThan(8);
  });
});

describe('W2 and the planted patches: a Skia paint of the bytes reads back as those bytes', () => {
  it.each(FACES)('%s face', (face) => {
    const layout = witnessLayout(face, PHONE.width, PHONE.height, PHONE.pxPerDp, 1);
    const painted = layout.patches.filter((p) => p.paint !== null && p.kind !== 'W3');
    expect(painted).toHaveLength(20);
    for (const p of painted) {
      const surface = Skia.Surface.MakeOffscreen(4, 4)!;
      const paint = Skia.Paint();
      paint.setColor(Skia.Color(p.paint!));
      surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 4, 4), paint);
      surface.flush();
      expect(rgb(read(surface.makeImageSnapshot(), 4, 4), 5)).toEqual(hexBytes(p.paint!));
    }
  });
});
