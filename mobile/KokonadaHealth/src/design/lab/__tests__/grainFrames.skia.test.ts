import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { fieldEffect } from '../../v2/field/effect';
import { renderGeometry, renderSize } from '../../v2/field/fieldDriver';
import { heroLayout, PHONE } from '../../v2/field/fallbackScenes';
import { renderFieldImage } from '../../v2/field/fieldImage';
import { emptyLedger } from '../../v2/field/placementLedger';
import { ledgerConfigFor, staticsFor } from '../../v2/field/statics';
import { EXTENSIONS } from '../../v2/tokens/tokens.extensions.generated';
import { DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { GRAIN_FACTORS, GRAIN_INDICES, grainBase, grainParams, grainSpec, grainStrips, scaleGrain, stripWidth } from '../grain/grainFrames';

// B8-4 on real Skia (CanvasKit): the grain strips drawn by the shipped effect through renderFieldImage, the function
// FieldSurface draws with. A strip's render is exactly the left third of the whole view's render (the same window of the
// field), and the three strengths differ in pixels only by grain: against the same frame with no grain, ×1 moves pixels
// more than ×0.71, which moves them more than ×0.5, and each stays within its own amplitude.

const statics = staticsFor('abyss', EXTENSIONS as never);
const read = (image: SkImage) =>
  image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;

function ready() {
  const effect = fieldEffect();
  if (effect.status !== 'ready') throw new Error(effect.reason);
  return effect;
}

function scene(id: string) {
  const spec = grainSpec(id);
  const layout = heroLayout('abyss', PHONE.width, PHONE.height, 1);
  const geometry = renderGeometry(layout, PHONE.pxPerDp, spec.renderScale);
  const ledger = emptyLedger(ledgerConfigFor('abyss', spec.face, statics, geometry));
  const step = grainBase(ledger, grainParams(spec), geometry, statics, DIRECTIONS.abyss.field.stillTime);
  if (step.uniforms === null) throw new Error(step.error ?? 'no frame');
  const strip = renderSize({ ...layout, width: stripWidth(layout.width, PHONE.pxPerDp) }, PHONE.pxPerDp, spec.renderScale);
  const whole = renderSize(layout, PHONE.pxPerDp, spec.renderScale);
  return { base: step.uniforms, strip, whole };
}

const draw = (uniforms: readonly number[], size: { width: number; height: number }) => {
  const effect = ready();
  return read(renderFieldImage(Skia, effect.effect, effect.blueNoiseShader, uniforms, size.width, size.height)!);
};

/** Per pixel, the largest channel difference; its mean and maximum over the image. */
function delta(a: Uint8Array, b: Uint8Array) {
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / (a.length / 4), max };
}

describe.each(['grain.abyss.dark.full', 'grain.abyss.light.full', 'grain.abyss.dark.low', 'grain.abyss.light.low'])('%s on CanvasKit', (id) => {
  const { base, strip, whole } = scene(id);

  it("a strip is the left third of the whole view's render, byte for byte (the same window, the same noise)", () => {
    const s = draw(base, strip);
    const w = draw(base, whole);
    let same = true;
    for (let y = 0; y < strip.height && same; y++) {
      for (let x = 0; x < strip.width * 4; x++) {
        if (s[y * strip.width * 4 + x] !== w[y * whole.width * 4 + x]) { same = false; break; }
      }
    }
    expect(strip.width).toBeLessThan(whole.width);
    expect(same).toBe(true);
  });

  it('the strengths move pixels in their order, only as far as their amplitude, against the same frame with no grain', () => {
    const none = draw(scaleGrain(base, 0), strip);
    const strips = grainStrips(base).map((u) => draw(u!, strip));
    const d = strips.map((px) => delta(px, none));
    expect(d[0].mean).toBeGreaterThan(d[1].mean);
    expect(d[1].mean).toBeGreaterThan(d[2].mean);
    expect(d[2].mean).toBeGreaterThan(0);
    // The grain moves L by at most ±0.012 at ×1: a few 8-bit levels of a channel on these grounds. Measured at 08103b9's
    // tokens: ×1 at most 4 (dark) and 5 (light) levels, ×0.5 at most 2 and 3; a bound of 6 leaves one level of margin.
    const amplitude = Math.max(base[GRAIN_INDICES[0]], base[GRAIN_INDICES[1]]);
    expect(amplitude).toBe(0.012);
    expect(d[0].max).toBeLessThanOrEqual(6);
    expect(d[2].max).toBeLessThan(d[0].max);
    // The means follow the factors, though not exactly (the encode and the rounding to 8 bits sit between L and a level):
    // measured 0.565 of ×1's for ×0.5 and 0.75 for ×0.71, on both faces and tiers.
    expect(d[2].mean / d[0].mean).toBeGreaterThan(0.45);
    expect(d[2].mean / d[0].mean).toBeLessThan(0.65);
    expect(d[1].mean / d[0].mean).toBeGreaterThan(0.65);
    expect(d[1].mean / d[0].mean).toBeLessThan(0.85);
  });

  it('two strips at one strength draw the same bytes (the scene is deterministic)', () => {
    const k = GRAIN_FACTORS[1];
    expect(Buffer.from(draw(scaleGrain(base, k), strip)).equals(Buffer.from(draw(scaleGrain(base, k), strip)))).toBe(true);
  });
});
