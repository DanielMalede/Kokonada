import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, TileMode, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { oklabToOklch, srgbToOklab } from '../../color/oklab.ts';
import { hueInBand } from '../../color/redBand.ts';
import { CHECK_BAND } from '../../tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, type DirectionId } from '../../tokens/tokens.generated.ts';
import { BLUE_NOISE_SIZE, blueNoiseRgba } from '../blueNoise.ts';
import type { FieldState } from '../fieldFrame.ts';
import { fieldPixel, type FieldFrame } from '../fieldLaw.ts';
import { IDS, frameIn, noWaypoint, sceneCatalogue, sizeOf, viewsOf, type Drawn } from '../fieldScenes.ts';
import { FIELD_SKSL } from '../fieldShader.ts';
import { stormDeps } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';
import { packFrame } from '../uniforms.ts';

// QA-065 on the never-red scenes, in the CanvasKit sweeps project (law round 2, item 8): each scene,
// built by the uniform builder from the tokens with the plate's shadows, drawn by the field shader in
// real Skia, and every pixel held outside the check band with DEC-081's margin; each scene's heaviest
// frame held to the law (±1 LSB); and the planted shader whose J–I edge runs straight caught on every
// dark face's seam, here where the check runs. The scene builders are shared (field/fieldScenes.ts).
// CanvasKit draws this shader slowly, so each frame is drawn in two views: the whole field at a coarse
// scale, and the scene's beads at a fine scale, where the halos, the ring and the moat are thin.

const LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
const LONG = 600_000;
const deps = (id: DirectionId) => stormDeps(id, staticsFor(id, EXTENSIONS as never));
const { drawn } = sceneCatalogue(EXTENSIONS, deps);
const CASES = drawn.map((d) => [d.id, d.scene, d.face, d] as const);

let effect: SkRuntimeEffect;
let planted: SkRuntimeEffect;
let blueNoise: SkShader;

beforeAll(() => {
  const made = Skia.RuntimeEffect.Make(FIELD_SKSL);
  const plantedMade = Skia.RuntimeEffect.Make(noWaypoint(FIELD_SKSL));
  if (!made || !plantedMade) throw new Error('a field shader did not compile');
  effect = made;
  planted = plantedMade;
  const image = Skia.Image.MakeImage(
    { width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(blueNoiseRgba()),
    BLUE_NOISE_SIZE * 4,
  );
  if (!image) throw new Error('the blue-noise image was not made');
  blueNoise = image.makeShaderOptions(TileMode.Repeat, TileMode.Repeat, FilterMode.Nearest, MipmapMode.None);
});

function render(frame: FieldFrame, w: number, h: number, source: SkRuntimeEffect): Uint8Array {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('no surface');
  const paint = Skia.Paint();
  paint.setDither(false);
  paint.setShader(source.makeShaderWithChildren(packFrame(frame), [blueNoise]));
  surface.getCanvas().drawPaint(paint);
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!pixels) throw new Error('no pixels');
  return pixels as Uint8Array;
}

/** Per 8-bit colour, its OKLCh chroma if its hue is in the check band, else −1. */
const IN_BAND = new Map<number, number>();
interface Worst { readonly chroma: number; readonly rgb: readonly number[]; readonly at: readonly [number, number]; readonly view: string }

function worstInBand(pixels: Uint8Array, w: number, h: number, view: string): Worst {
  let worst: Worst = { chroma: 0, rgb: [], at: [-1, -1], view };
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = [pixels[4 * i], pixels[4 * i + 1], pixels[4 * i + 2]];
    const key = r * 65536 + g * 256 + b;
    let chroma = IN_BAND.get(key);
    if (chroma === undefined) {
      const lch = oklabToOklch(srgbToOklab([r / 255, g / 255, b / 255]));
      chroma = hueInBand(lch.h, CHECK_BAND) ? lch.C : -1;
      IN_BAND.set(key, chroma);
    }
    if (chroma > worst.chroma) worst = { chroma, rgb: [r, g, b], at: [i % w, Math.floor(i / w)], view };
  }
  return worst;
}

function worstOfFrame(d: Drawn, state: FieldState, source: SkRuntimeEffect): Worst {
  let worst: Worst = { chroma: 0, rgb: [], at: [-1, -1], view: '' };
  for (const view of viewsOf(d)) {
    const [w, h] = sizeOf(view);
    const found = worstInBand(render(frameIn(view, state, deps(d.id).statics), w, h, source), w, h, view.name);
    if (found.chroma > worst.chroma) worst = found;
  }
  return worst;
}
const describeWorst = (w: Worst) => `C ${w.chroma.toFixed(5)} at (${w.rgb.join(', ')}), ${w.view} view pixel (${w.at.join(', ')})`;

/** Each scene's largest in-band chroma, for the evidence run (FIELD_SCENES_REPORT=1). */
const MARGINS: string[] = [];
afterAll(() => {
  if (process.env.FIELD_SCENES_REPORT) console.log(`limit C <= ${LIMIT}\n${MARGINS.join('\n')}`);
});

describe('QA-065 on the scenes, in real Skia: no pixel comes within the margin of the check band', () => {
  it.each(CASES)(
    '%s, %s, %s face',
    (id, scene, face, d) => {
      const over: string[] = [];
      let max: Worst = { chroma: 0, rgb: [], at: [-1, -1], view: '' };
      let label = '';
      const frames = d.frames();
      for (const frame of frames) {
        const worst = worstOfFrame(d, frame.state, effect);
        if (worst.chroma > LIMIT) over.push(`${frame.label}: ${describeWorst(worst)}`);
        if (worst.chroma > max.chroma) { max = worst; label = frame.label; }
      }
      MARGINS.push(`${id} ${scene} ${face}: ${frames.length} frames, max ${max.chroma > 0 ? `${describeWorst(max)} (${label})` : 'none in band'}, margin ${(LIMIT - max.chroma).toFixed(5)}`);
      expect(over).toEqual([]);
    },
    LONG,
  );
});

describe('the scenes agree with the TypeScript law, pixel for pixel (±1 LSB)', () => {
  it.each(CASES)(
    '%s, %s, %s face, the heaviest frame',
    (_id, _scene, _face, d) => {
      const { state } = d.heaviest();
      for (const view of viewsOf(d)) {
        const [w, h] = sizeOf(view);
        const frame = frameIn(view, state, deps(d.id).statics);
        const pixels = render(frame, w, h, effect);
        let worst = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const law = fieldPixel(frame, x + 0.5, y + 0.5);
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(pixels[4 * (y * w + x) + c] - law[c]));
          }
        }
        expect({ view: view.name, worst }).toEqual({ view: view.name, worst: Math.min(worst, 1) });
      }
    },
    LONG,
  );
});

describe('the planted shader (J–I straight) is caught on every dark face', () => {
  const seams = drawn.filter((d) => d.scene === 'seam' && d.face === 'dark');

  it('the seam is a scene of every direction', () => {
    expect(seams.map((d) => d.id).sort()).toEqual([...IDS].sort());
  });

  it.each(seams.map((d) => [d.id, d] as const))(
    '%s: the seam drawn straight puts pixels in the check band',
    (_id, d) => {
      const worst = worstOfFrame(d, d.heaviest().state, planted);
      expect(worst.chroma).toBeGreaterThanOrEqual(CHECK_BAND.chromaFloor);
    },
    LONG,
  );
});
