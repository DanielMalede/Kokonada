import { AlphaType, ClipOp, ColorType, Skia, TileMode } from '@shopify/react-native-skia';
import { oklabToOklch, oklchToOklab, srgbToOklab } from '../../color/oklab.ts';
import { hueInBand } from '../../color/redBand.ts';
import { CHECK_BAND } from '../../tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { recordFieldFallback } from '../fallbackDraw.ts';
import { fallbackPlan, fallbackStops, type FallbackPlan } from '../fallbackModel.ts';
import { PHONE, heroLayout, rampPlacements } from '../fallbackScenes.ts';
import { nodeAt, placementRamp } from '../fieldFrame.ts';
import type { FieldLayout } from '../fieldDriver.ts';
import type { Tap } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';

// QA-065 on the fallback (the designer's Q3 of 2026-11-11: never red measured, not assumed): the fallback's real
// CanvasKit pixels, Abyss dark and light, J, C, R and I at p ∈ {0, 0.25, 0.5, 0.75, 1}, a neutral and rest, the hero's
// layout at the board's phone size. Every gradient pixel and every pixel of the ring's inner fringe (the lens and 1.5 px
// past the ring's inner circle) is held to QA-065's pass rule: a hue outside the check band, or a chroma below its floor.
// A planted red stop is caught, so the check bites. The shipped tokens only: no fixture direction stands in here.

const ABYSS = Object.keys(DIRECTIONS)[0] as DirectionId;
const FACES: readonly Face[] = ['dark', 'light'];
const SK = { Skia, ClipOp, TileMode };
const statics = staticsFor(ABYSS, EXTENSIONS as never);
const layout: FieldLayout = heroLayout(ABYSS, PHONE.width, PHONE.height, 1);
const k = PHONE.pxPerDp;
const W = Math.round(layout.width * k);
const H = Math.round(layout.height * k);
const [CX, CY, R] = [layout.centre[0] * k, layout.centre[1] * k, layout.radius * k];
const R_IN = (1 - BASE.plate.labelBand.min / layout.radius) * R;
const LONG = 600_000;

function render(plan: FallbackPlan): Uint8Array {
  const surface = Skia.Surface.Make(W, H)!;
  const canvas = surface.getCanvas();
  canvas.scale(k, k);
  canvas.drawPicture(recordFieldFallback(SK, plan, layout.width, layout.height));
  surface.flush();
  return surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
}

/** Per 8-bit colour, its OKLCh chroma if its hue is in the check band, else −1. */
const IN_BAND = new Map<number, number>();
interface Worst { readonly chroma: number; readonly rgb: readonly number[]; readonly at: readonly [number, number]; readonly pixels: number }

/** The largest in-band chroma over the lens and the ring's inner fringe (d < R_in + 1.5 px). */
function worstInLens(px: Uint8Array): Worst {
  let worst: Worst = { chroma: -1, rgb: [], at: [-1, -1], pixels: 0 };
  let pixels = 0;
  const reach = R_IN + 1.5;
  for (let y = Math.max(0, Math.floor(CY - reach)); y < Math.min(H, Math.ceil(CY + reach)); y++) {
    for (let x = Math.max(0, Math.floor(CX - reach)); x < Math.min(W, Math.ceil(CX + reach)); x++) {
      if (Math.hypot(x + 0.5 - CX, y + 0.5 - CY) >= reach) continue;
      pixels++;
      const i = 4 * (y * W + x);
      const key = px[i] * 65536 + px[i + 1] * 256 + px[i + 2];
      let chroma = IN_BAND.get(key);
      if (chroma === undefined) {
        const lch = oklabToOklch(srgbToOklab([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]));
        chroma = hueInBand(lch.h, CHECK_BAND) ? lch.C : -1;
        IN_BAND.set(key, chroma);
      }
      if (chroma > worst.chroma) worst = { chroma, rgb: [px[i], px[i + 1], px[i + 2]], at: [x, y], pixels: 0 };
    }
  }
  return { ...worst, pixels };
}

const planFor = (face: Face, taps: readonly Tap[]) => fallbackPlan({ direction: ABYSS, face, statics, taps, layout, pxPerDp: k });

const SCENES: ReadonlyArray<readonly [string, readonly Tap[]]> = [
  ...rampPlacements().map(({ node, p, tap }) => [`${node} at p ${p}`, [tap]] as const),
  ['neutral', [{ x: 0.05, y: 0.05 }]],
  ['rest', []],
];

const REPORT: string[] = [];
afterAll(() => {
  if (process.env.FALLBACK_NEVER_RED_REPORT) console.log(`QA-065 floor C < ${CHECK_BAND.chromaFloor} (DEC-081 margin to ${CHECK_BAND.chromaFloor - BASE.neverRed.margin})\n${REPORT.join('\n')}`);
});

describe('the sweep’s placements are what they say', () => {
  it('each ramp placement is its node at its p; the neutral is neutral', () => {
    const ramp = rampPlacements();
    expect(ramp).toHaveLength(20);
    for (const { node, p, tap } of ramp) {
      expect(nodeAt(tap.x, tap.y)).toBe(node);
      expect(Math.abs(placementRamp(tap.x, tap.y) - p)).toBeLessThan(1e-6);
    }
    expect(nodeAt(0.05, 0.05)).toBe('neutral');
  });
});

describe('QA-065 on the fallback’s pixels: no colour in the check band at or above its floor', () => {
  it.each(FACES)(
    'Abyss %s: every scene, the lens and the ring’s inner fringe',
    (face) => {
      const over: string[] = [];
      for (const [label, taps] of SCENES) {
        const plan = planFor(face, taps);
        expect(plan.field).not.toBeNull();
        const worst = worstInLens(render(plan));
        expect(worst.pixels).toBeGreaterThan(300000);
        REPORT.push(`${face} ${label}: ${worst.chroma < 0 ? 'no pixel in the band' : `max in-band C ${worst.chroma.toFixed(5)} at (${worst.rgb.join(', ')}), pixel (${worst.at.join(', ')}), margin ${(CHECK_BAND.chromaFloor - worst.chroma).toFixed(5)}`}`);
        if (worst.chroma >= CHECK_BAND.chromaFloor) over.push(`${label}: C ${worst.chroma.toFixed(5)} at (${worst.rgb.join(', ')})`);
      }
      expect(over).toEqual([]);
    },
    LONG,
  );

  it('the check bites: a planted red stop (OKLCh 0.6, 0.15, 20°) drawn through the same fallback is caught', () => {
    const plan = planFor('dark', [{ x: 0.566, y: 0.566 }]);
    const red = oklchToOklab({ L: 0.6, C: 0.15, h: 20 });
    const planted = { ...plan, field: { ...plan.field!, colours: fallbackStops(ABYSS, 'dark', 'face', statics, red).colours } };
    expect(worstInLens(render(planted)).chroma).toBeGreaterThanOrEqual(CHECK_BAND.chromaFloor);
  }, LONG);
});
