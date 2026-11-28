import { AlphaType, ColorType, PaintStyle, Skia, TileMode, type SkCanvas } from '@shopify/react-native-skia';
import { sweepSrgbToOklab } from '../../../color/sweepConvert.ts';
import { hueInBand } from '../../../color/redBand.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry } from '../geometry.ts';
import { recordPlateRim, rimPlan, type RimPlan, type RimSkia } from '../rim.ts';

// The rim keyline in real Skia (CanvasKit): the plate's recorded picture, played as RN Skia's Canvas plays it, on a
// surface of the canvas's device px under the density's scale. The plan's numbers are held in rim.test.ts; here, the
// pixels: where the keyline lands, how wide it is, which colours it carries, and that it paints nothing else.

// Skia's jest environment loads CanvasKit in its own realm, and its gradient factory reads the colours with instanceof
// Float32Array / Array, which arrays made in the test's realm fail; on the device JSI takes them as they are. So, at
// CanvasKit's own door and nowhere else, the colours are re-homed into one flat Float32Array of CanvasKit's realm (the
// fallback's skia test does the same for its radial gradient). Every value passes unchanged.
beforeAll(() => {
  const ck = (globalThis as unknown as { CanvasKit: { HEAPF32: Float32Array; Shader: { MakeLinearGradient: (...args: unknown[]) => unknown } } }).CanvasKit;
  const Home = ck.HEAPF32.constructor as Float32ArrayConstructor;
  const make = ck.Shader.MakeLinearGradient.bind(ck.Shader);
  ck.Shader.MakeLinearGradient = (start: unknown, end: unknown, colours: unknown, ...rest: unknown[]) =>
    make(start, end, Array.isArray(colours) ? Home.from((colours as Float32Array[]).flatMap((c) => Array.from(c))) : colours, ...rest);
});

const SK: RimSkia = { Skia, PaintStyle, TileMode };
const K = 2.625; // the S22+'s 420 dpi
const FACES: readonly Face[] = ['dark', 'light'];
const CHECK = { hueFrom: BASE.neverRed.check.hueStart, hueTo: BASE.neverRed.check.hueEnd, chromaFloor: BASE.neverRed.check.chromaFloor };
const CHECK_LIMIT = CHECK.chromaFloor - BASE.neverRed.margin;
const bytesOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

interface Played {
  readonly plan: RimPlan;
  readonly w: number;
  readonly px: Uint8Array;
  /** The keyline's centre and radius, in device px. */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly half: number;
}

function planFor(face: Face, fontScale = 1) {
  const t = { base: BASE, direction: DIRECTIONS.abyss, color: DIRECTIONS.abyss.color[face] };
  return rimPlan(t, plateGeometry(t, 296, fontScale));
}

/** The rim's picture on a transparent surface, or over `under`, drawn first in the same canvas, in dp. */
function play(plan: RimPlan, under?: (canvas: SkCanvas) => void): Played {
  const w = Math.round(plan.size * K);
  const surface = Skia.Surface.Make(w, w)!;
  const canvas = surface.getCanvas();
  canvas.scale(K, K);
  under?.(canvas);
  const picture = recordPlateRim(SK, plan);
  canvas.drawPicture(picture);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const px = image.readPixels(0, 0, { width: w, height: w, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
  image.dispose();
  picture.dispose();
  surface.dispose();
  return { plan, w, px, cx: plan.centre[0] * K, cy: plan.centre[1] * K, r: plan.radius * K, half: (plan.width / 2) * K };
}

const rgba = (p: Played, x: number, y: number) => [0, 1, 2, 3].map((c) => p.px[4 * (y * p.w + x) + c]);
const distance = (p: Played, x: number, y: number) => Math.hypot(x + 0.5 - p.cx, y + 0.5 - p.cy);

/** The most opaque pixel of a column (or row) inside [from, to), and its colour. */
function peak(p: Played, along: 'column' | 'row', at: number, from: number, to: number) {
  let best = { i: -1, a: -1, rgb: [0, 0, 0] };
  for (let i = from; i < to; i++) {
    const [r, g, b, a] = along === 'column' ? rgba(p, at, i) : rgba(p, i, at);
    if (a > best.a) best = { i, a, rgb: [r, g, b] };
  }
  return best;
}

const near = (actual: number[], expected: number[], tolerance: number) => actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

describe.each(FACES)('%s face: the rim keyline’s pixels', (face) => {
  // Played once per face, after the top-level beforeAll has re-homed the gradient's colours (never at collection).
  let p!: Played;
  let top!: number[];
  let bottom!: number[];
  let column!: number;
  let row!: number;
  beforeAll(() => {
    p = play(planFor(face));
    top = [...p.plan.gradient.top];
    bottom = [...p.plan.gradient.bottom];
    column = Math.floor(p.cx);
    row = Math.floor(p.cy);
  });

  it('is plate.rim.lit at the top and plate.rim.base at the bottom, opaque at its core', () => {
    const c = DIRECTIONS.abyss.color[face].plate.rim;
    expect(top).toEqual(bytesOf(c.lit.hex));
    expect(bottom).toEqual(bytesOf(c.base.hex));
    const atTop = peak(p, 'column', column, 0, Math.floor(p.w / 4));
    const atBottom = peak(p, 'column', column, Math.floor((3 * p.w) / 4), p.w);
    expect(atTop.a).toBe(255);
    expect(atBottom.a).toBe(255);
    expect(near(atTop.rgb, top, 2)).toBe(true);
    expect(near(atBottom.rgb, bottom, 2)).toBe(true);
  });

  it('at mid-height, on both sides, is halfway down the gradient', () => {
    const mid = top.map((v, i) => v + (bottom[i] - v) / 2);
    for (const side of [peak(p, 'row', row, 0, Math.floor(p.w / 4)), peak(p, 'row', row, Math.floor((3 * p.w) / 4), p.w)]) {
      expect(side.a).toBe(255);
      expect(near(side.rgb, mid, 2)).toBe(true);
    }
  });

  it('is centred on R and 1.5 dp wide: its coverage along a radius sums to its width and balances on the rim', () => {
    let sum = 0;
    let moment = 0;
    for (let x = Math.ceil(p.cx); x < p.w; x++) {
      const a = rgba(p, x, row)[3] / 255;
      sum += a;
      moment += a * (x + 0.5 - p.cx);
    }
    expect(sum).toBeCloseTo(2 * p.half, 0);
    expect(Math.abs(sum - 2 * p.half)).toBeLessThan(0.35);
    expect(Math.abs(moment / sum - p.r)).toBeLessThan(0.25);
  });

  it('paints nothing but the keyline: not the ring, not the face, not the moat (T13 Q3)', () => {
    let drawn = 0;
    const strays: number[][] = [];
    for (let y = 0; y < p.w; y++) {
      for (let x = 0; x < p.w; x++) {
        if (rgba(p, x, y)[3] === 0) continue;
        drawn += 1;
        const d = distance(p, x, y);
        if (d < p.r - p.half - 1.5 || d > p.r + p.half + 1.5) strays.push([x, y]);
      }
    }
    expect(drawn).toBeGreaterThan(2 * Math.PI * p.r);
    expect(strays).toEqual([]);
  });

  it('is never cut by its canvas: every edge row and column of the canvas is empty', () => {
    const edge: number[][] = [];
    for (let i = 0; i < p.w; i++) {
      for (const [x, y] of [[i, 0], [i, p.w - 1], [0, i], [p.w - 1, i]]) if (rgba(p, x, y)[3] !== 0) edge.push([x, y]);
    }
    expect(edge).toEqual([]);
  });

  it('over the ring and the moat (a stand-in for the field’s grounds), no pixel is red, inside the check band’s margin', () => {
    const c = DIRECTIONS.abyss.color[face];
    const over = play(p.plan, (canvas) => {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color(c.ground.hex));
      canvas.drawPaint(paint);
      paint.setColor(Skia.Color(c.plate.ring.hex));
      paint.setAntiAlias(true);
      canvas.drawCircle(p.plan.centre[0], p.plan.centre[1], p.plan.radius, paint);
      paint.dispose();
    });
    let seen = 0;
    let worst = 0;
    for (let y = 0; y < over.w; y++) {
      for (let x = 0; x < over.w; x++) {
        const d = distance(over, x, y);
        if (Math.abs(d - over.r) > over.half + 2) continue;
        const [r, g, b] = rgba(over, x, y);
        const lab = sweepSrgbToOklab([r / 255, g / 255, b / 255]);
        const hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
        if (hueInBand((hue + 360) % 360, CHECK)) worst = Math.max(worst, Math.hypot(lab.a, lab.b));
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(2 * Math.PI * over.r);
    expect(worst).toBeLessThan(CHECK_LIMIT);
  });
});

it('at font scale 2.0 the keyline does not move: the band grows inward, the rim stays on R', () => {
  const one = planFor('dark', 1);
  const two = planFor('dark', 2);
  expect(two.radius).toBe(one.radius);
  expect(two.centre).toEqual(one.centre);
  const a = play(one);
  const b = play(two);
  expect(Buffer.from(b.px).equals(Buffer.from(a.px))).toBe(true);
});
