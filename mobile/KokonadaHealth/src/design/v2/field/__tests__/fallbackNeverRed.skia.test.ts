import { AlphaType, ClipOp, ColorType, Skia, TileMode, type SkPicture } from '@shopify/react-native-skia';
import { oklabToOklch, oklchToOklab, srgbToOklab } from '../../color/oklab.ts';
import { hueInBand } from '../../color/redBand.ts';
import { CHECK_BAND } from '../../tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { drawFallbackFace, drawFallbackField, drawFallbackGround, drawFallbackRing, recordFieldFallback } from '../fallbackDraw.ts';
import { fallbackPlan, fallbackStops, type FallbackPlan, type Rgb } from '../fallbackModel.ts';
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
//
// The fringe is held at every coverage, not only at CanvasKit's (UI-275): the device's ring edge sits up to 0.25 px from
// CanvasKit's, so the coverage the device draws at a fringe pixel is not the one CanvasKit draws there. Every 8-bit colour
// the ring is drawn over within 1.5 px of R_in, on either side (the picture without its ring), is mixed with plate.ring
// at every coverage n/255, n = 0 to 255, by an 8-bit src-over blend rounded half up per channel (the device's), and each
// mix is held to the same rule by the same judge. A planted stop that CanvasKit's own picture never shows red is caught.

// Skia's jest environment loads CanvasKit in its own realm, and its gradient factory reads the colours with instanceof,
// which arrays from the test's realm fail (the device's JSI takes them as they are): re-home them at CanvasKit's door,
// into one flat Float32Array of its realm, every value unchanged (as FieldFallback.skia.test.tsx does).
beforeAll(() => {
  const ck = (globalThis as unknown as { CanvasKit: { HEAPF32: Float32Array; Shader: { MakeRadialGradient: (...args: unknown[]) => unknown } } }).CanvasKit;
  const Home = ck.HEAPF32.constructor as Float32ArrayConstructor;
  const make = ck.Shader.MakeRadialGradient.bind(ck.Shader);
  ck.Shader.MakeRadialGradient = (centre: unknown, radius: unknown, colours: unknown, ...rest: unknown[]) =>
    make(centre, radius, Array.isArray(colours) ? Home.from((colours as Float32Array[]).flatMap((c) => Array.from(c))) : colours, ...rest);
});

// Bound once: a global lookup is many times slower in jest's sandbox, and the scan runs millions of times.
const { abs, ceil, floor, hypot, max, min, round } = Math;

const ABYSS = Object.keys(DIRECTIONS)[0] as DirectionId;
const FACES: readonly Face[] = ['dark', 'light'];
const SK = { Skia, ClipOp, TileMode };
const statics = staticsFor(ABYSS, EXTENSIONS as never);
const layout: FieldLayout = heroLayout(ABYSS, PHONE.width, PHONE.height, 1);
const k = PHONE.pxPerDp;
const W = round(layout.width * k);
const H = round(layout.height * k);
const [CX, CY, R] = [layout.centre[0] * k, layout.centre[1] * k, layout.radius * k];
const R_IN = (1 - BASE.plate.labelBand.min / layout.radius) * R;
const LONG = 600_000;

/** A picture played as RN Skia's Canvas plays it (scaled by the density), its pixels read, and every CanvasKit object freed. */
function play(picture: SkPicture): Uint8Array {
  const surface = Skia.Surface.Make(W, H)!;
  const canvas = surface.getCanvas();
  canvas.scale(k, k);
  canvas.drawPicture(picture);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const px = image.readPixels(0, 0, { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
  image.dispose();
  picture.dispose();
  surface.dispose();
  return px;
}

/** The fallback's picture played as RN Skia's Canvas plays it. */
const render = (plan: FallbackPlan): Uint8Array => play(recordFieldFallback(SK, plan, layout.width, layout.height));

type Layer = typeof drawFallbackGround;
/** Q3's layers recorded as recordFieldFallback records them (in dp, each at device px under scale(1/pxPerDp)), then played. */
function renderLayers(plan: FallbackPlan, layers: readonly Layer[]): Uint8Array {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, layout.width, layout.height));
  canvas.scale(1 / plan.pxPerDp, 1 / plan.pxPerDp);
  for (const layer of layers) layer(SK, canvas, plan);
  const picture = recorder.finishRecordingAsPicture();
  recorder.dispose();
  return play(picture);
}

/** What the ring is drawn over: the picture without its ring (Q3's layers 1 to 3). */
const UNDER: readonly Layer[] = [drawFallbackGround, drawFallbackFace, drawFallbackField];
const renderUnder = (plan: FallbackPlan): Uint8Array => renderLayers(plan, UNDER);

/** CanvasKit's own coverage of the ring at every pixel, 0 to 255: the opaque ring layer alone on a clear canvas, read as each pixel's alpha (byte 3). */
const ringCoverage = (plan: FallbackPlan): Uint8Array => renderLayers(plan, [drawFallbackRing]);

type Bytes = readonly [number, number, number];
/** An 8-bit colour's key, r·65536 + g·256 + b. */
const keyOf = ([r, g, b]: Bytes): number => r * 65536 + g * 256 + b;
const bytesOfKey = (key: number): Bytes => [floor(key / 65536), floor(key / 256) % 256, key % 256];
const bytesOfHex = (hex: string): Bytes => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const rgbOf = ([r, g, b]: Bytes): Rgb => [r / 255, g / 255, b / 255];

/** Per 8-bit colour key, its OKLCh chroma if its hue is in the check band, else −1: QA-065's judge, red at or above the floor. */
const IN_BAND = new Map<number, number>();
function inBandChroma(key: number): number {
  let chroma = IN_BAND.get(key);
  if (chroma === undefined) {
    const lch = oklabToOklch(srgbToOklab([floor(key / 65536) / 255, (floor(key / 256) % 256) / 255, (key % 256) / 255]));
    chroma = hueInBand(lch.h, CHECK_BAND) ? lch.C : -1;
    IN_BAND.set(key, chroma);
  }
  return chroma;
}
interface Worst { readonly chroma: number; readonly rgb: readonly number[]; readonly at: readonly [number, number]; readonly pixels: number }

/** The largest in-band chroma over the lens and the ring's inner fringe (d < R_in + 1.5 px). */
function worstInLens(px: Uint8Array): Worst {
  let worst: Worst = { chroma: -1, rgb: [], at: [-1, -1], pixels: 0 };
  let pixels = 0;
  const reach = R_IN + 1.5;
  for (let y = max(0, floor(CY - reach)); y < min(H, ceil(CY + reach)); y++) {
    for (let x = max(0, floor(CX - reach)); x < min(W, ceil(CX + reach)); x++) {
      if (hypot(x + 0.5 - CX, y + 0.5 - CY) >= reach) continue;
      pixels++;
      const i = 4 * (y * W + x);
      const chroma = inBandChroma(px[i] * 65536 + px[i + 1] * 256 + px[i + 2]);
      if (chroma > worst.chroma) worst = { chroma, rgb: [px[i], px[i + 1], px[i + 2]], at: [x, y], pixels: 0 };
    }
  }
  return { ...worst, pixels };
}

/** The ring's inner fringe (UI-275): every pixel whose centre lies within 1.5 px of R_in, on either side, as its index into a render. */
const FRINGE_PX = 1.5;
const FRINGE: Int32Array = (() => {
  const out: number[] = [];
  const reach = R_IN + FRINGE_PX;
  for (let y = max(0, floor(CY - reach)); y < min(H, ceil(CY + reach)); y++) {
    for (let x = max(0, floor(CX - reach)); x < min(W, ceil(CX + reach)); x++) {
      if (abs(hypot(x + 0.5 - CX, y + 0.5 - CY) - R_IN) < FRINGE_PX) out.push(4 * (y * W + x));
    }
  }
  return Int32Array.from(out);
})();
const distanceAt = (i: number): number => hypot(((i / 4) % W) + 0.5 - CX, floor(i / 4 / W) + 0.5 - CY);

/** Every 8-bit colour a render shows in the fringe, by key. */
function fringeColours(px: Uint8Array): Set<number> {
  const colours = new Set<number>();
  for (const i of FRINGE) colours.add(px[i] * 65536 + px[i + 1] * 256 + px[i + 2]);
  return colours;
}

/**
 * A channel of plate.ring drawn at coverage n/255 over a channel c, src-over in 8 bits, rounded half up as the device's
 * blend writes it: ⌊(n·ring + (255 − n)·c)/255 + ½⌋, in integers. No tie is ever met: the numerator over 255 is never x.5.
 */
const ringOver = (ring: number, c: number, n: number): number => floor((2 * (n * ring + (255 - n) * c) + 255) / 510);

/** A mix the sweep judged: the colour under the ring, the ring's coverage n/255 over it, and the 8-bit result. */
interface Mix { readonly under: number; readonly coverage: number; readonly mix: number; readonly chroma: number }

/** Every colour under the fringe with plate.ring over it at every coverage n/255, n = 0 to 255, each mix judged by QA-065. */
function sweepFringe(colours: Iterable<number>, [rr, rg, rb]: Bytes): { readonly red: Mix[]; readonly worst: Mix | null; readonly mixes: number } {
  const red: Mix[] = [];
  let worst: Mix | null = null;
  let mixes = 0;
  for (const under of colours) {
    const [r, g, b] = bytesOfKey(under);
    for (let n = 0; n <= 255; n++) {
      const mix = ringOver(rr, r, n) * 65536 + ringOver(rg, g, n) * 256 + ringOver(rb, b, n);
      const chroma = inBandChroma(mix);
      mixes++;
      if (chroma < 0) continue;
      const judged: Mix = { under, coverage: n, mix, chroma };
      if (worst === null || chroma > worst.chroma) worst = judged;
      if (chroma >= CHECK_BAND.chromaFloor) red.push(judged);
    }
  }
  return { red, worst, mixes };
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

describe('QA-065 on every mix the ring’s inner fringe can draw (UI-275): each colour under it, with plate.ring over it at every coverage n/255', () => {
  it('the fringe is the band 1.5 px either side of R_in, all round', () => {
    // 2π · R_in · 3 px is about 6,814 px; a band on one side only is half of it.
    expect(FRINGE.length).toBeGreaterThan(6000);
    let inside = 0;
    let farthest = 0;
    for (const i of FRINGE) {
      const d = distanceAt(i);
      farthest = max(farthest, abs(d - R_IN));
      if (d < R_IN) inside++;
    }
    expect(farthest).toBeLessThan(FRINGE_PX);
    expect(inside).toBeGreaterThan(3000);
    expect(FRINGE.length - inside).toBeGreaterThan(3000);
  });

  it('the blend is plate.ring src-over in 8 bits, each channel rounded half up: n 0 is the colour, n 255 the ring, no tie ever met', () => {
    for (const ring of new Set(FACES.flatMap((face) => bytesOfHex(planFor(face, []).ring.colour)))) {
      for (let c = 0; c <= 255; c++) {
        expect([ringOver(ring, c, 0), ringOver(ring, c, 255)]).toEqual([c, ring]);
        for (let n = 1; n < 255; n++) {
          const exact = (n * ring + (255 - n) * c) / 255;
          const wrong = ringOver(ring, c, n) !== floor(exact + 0.5) || abs(exact - floor(exact) - 0.5) < 1e-9;
          if (wrong) expect({ ring, c, n, got: ringOver(ring, c, n), exact }).toBeNull();
        }
      }
    }
  });

  it.each(FACES)('the picture under the ring is the fallback’s own (Abyss %s): with drawFallbackRing over it, it is the whole picture, byte for byte', (face) => {
    for (const [label, taps] of SCENES.filter(([scene]) => scene === 'rest' || scene === 'J at p 1')) {
      const plan = planFor(face, taps);
      const whole = render(plan);
      const layered = renderLayers(plan, [...UNDER, drawFallbackRing]);
      let differ = 0;
      for (let i = 0; i < whole.length; i++) if (whole[i] !== layered[i]) differ++;
      expect([label, differ]).toEqual([label, 0]);
    }
  }, LONG);

  it.each(FACES)(
    'Abyss %s: every scene, every colour within 1.5 px of R_in, under plate.ring at every coverage n/255',
    (face) => {
      const ring = bytesOfHex(planFor(face, []).ring.colour);
      const over: string[] = [];
      for (const [label, taps] of SCENES) {
        const colours = fringeColours(renderUnder(planFor(face, taps)));
        const { red, worst, mixes } = sweepFringe(colours, ring);
        // Has cases: a gradient's worth of colours under the fringe, not a flat fill, each at all 256 coverages.
        expect(colours.size).toBeGreaterThanOrEqual(5);
        expect(mixes).toBe(256 * colours.size);
        REPORT.push(`${face} ${label} fringe: ${colours.size} colours × 256 coverages, ${worst === null ? 'no mix in the band' : `max in-band C ${worst.chroma.toFixed(5)}: (${bytesOfKey(worst.under).join(', ')}) at ${worst.coverage}/255 → (${bytesOfKey(worst.mix).join(', ')}), margin ${(CHECK_BAND.chromaFloor - worst.chroma).toFixed(5)}`}`);
        for (const m of red.slice(0, 3)) over.push(`${label}: (${bytesOfKey(m.under).join(', ')}) at ${m.coverage}/255 → (${bytesOfKey(m.mix).join(', ')}), C ${m.chroma.toFixed(5)}`);
      }
      expect(over).toEqual([]);
    },
    LONG,
  );

  // The plant: a hard stop 0.1 px inside R_in, concentric with the ring, from plate.face to (30, 9, 0), a dark brown 2.4°
  // past the band's end (OKLCh 0.171, 0.044, 52.4°), which alone passes. plate.ring's blue turns its mix into the band
  // from coverage 5/255 to 74/255; where the stop lies, CanvasKit's ring covers it by 96/255 or more, so CanvasKit's own
  // picture never shows those mixes and the pixel check above passes it. The sweep must catch it.
  const PLANT: Bytes = [30, 9, 0];
  it('the sweep bites where CanvasKit is blind: a planted stop is caught at coverages CanvasKit’s fringe never draws it at', () => {
    const plan = planFor('dark', [{ x: 0.566, y: 0.566 }]);
    const plateFace = bytesOfHex(plan.face.colour);
    const at = (R_IN - 0.1) / plan.ring.outer;
    const planted: FallbackPlan = {
      ...plan,
      field: { ...plan.field!, centre: plan.ring.centre, radius: plan.ring.outer, positions: [0, at, at, 1], colours: [plateFace, plateFace, PLANT, PLANT].map(rgbOf) },
    };
    const plant = keyOf(PLANT);
    // The stop alone passes, and so does CanvasKit's whole picture of it: the pixel check is blind to it.
    expect(inBandChroma(plant)).toBeLessThan(CHECK_BAND.chromaFloor);
    expect(worstInLens(render(planted)).chroma).toBeLessThan(CHECK_BAND.chromaFloor);
    // The coverage map is CanvasKit's ring: nothing a pixel short of R_in, all of it a pixel past.
    const coverage = ringCoverage(planted);
    const edge = { short: -1, past: 256 };
    for (const i of FRINGE) {
      const d = distanceAt(i);
      if (d < R_IN - 1) edge.short = max(edge.short, coverage[i + 3]);
      if (d > R_IN + 1) edge.past = min(edge.past, coverage[i + 3]);
    }
    expect(edge).toEqual({ short: 0, past: 255 });
    // The plant lies under the fringe on both sides of R_in, and CanvasKit draws it there at these coverages only.
    const under = renderUnder(planted);
    const drawn = new Set<number>();
    let inside = 0;
    for (const i of FRINGE) {
      if (under[i] * 65536 + under[i + 1] * 256 + under[i + 2] !== plant) continue;
      drawn.add(coverage[i + 3]);
      if (distanceAt(i) < R_IN) inside++;
    }
    expect(inside).toBeGreaterThan(0);
    expect(drawn.size).toBeGreaterThan(0);
    // The sweep catches it, the plant only, and every coverage it is caught at is one CanvasKit never draws it at.
    const { red } = sweepFringe(fringeColours(under), bytesOfHex(plan.ring.colour));
    expect(red.length).toBeGreaterThan(0);
    expect([...new Set(red.map((m) => m.under))]).toEqual([plant]);
    expect(red.filter((m) => drawn.has(m.coverage)).map((m) => m.coverage)).toEqual([]);
    const caught = red.map((m) => m.coverage);
    REPORT.push(`planted (${PLANT.join(', ')}): red at ${caught.length} coverages, ${min(...caught)}/255 to ${max(...caught)}/255; CanvasKit's ring covers it by ${min(...drawn)}/255 to ${max(...drawn)}/255 only`);
  }, LONG);
});
