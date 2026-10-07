import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame, checkQuietRects, type FieldGeometry, type FieldState } from '../fieldFrame.ts';
import { QUIET_SLOTS, fieldOklab, groundAt, quietFactor, regionOf, shadowFactor, type QuietRect } from '../fieldLaw.ts';
import { blueNoiseValue } from '../blueNoise.ts';
import { staticsFor } from '../statics.ts';

// Quiet zones (DSN-023; designer ruling 2.9 and r3 §1): a term of the one field law, never a layer.
//   q = abs(p − c_j) − h_j
//   sd_j = length(max(q, 0)) + min(max(q.x, q.y), 0) − g
//   factor_j = F > 0 ? smoothstep(0, F, sd_j) : (sd_j > 0 ? 1 : 0)
//   extent = regionExtent · Π over j < count of factor_j
// c_j and h_j: the measured, ungrown bound's centre and half-size; g = quiet.grow and
// F = field.mask.quietFeather, all in render pixels. Extent is exactly 0 on the grown boundary and
// inside it. Unused slots are inert through count only: a zero-size rect is not empty, it carves a
// disc of radius g. Up to QUIET_SLOTS rects: more, or a malformed rect, is a RangeError in every
// build (checkQuietRects, called by the builder and by packFrame's count check).

const R_DP = BASE.plate.maxDiameter / 2;
const statics = (id: DirectionId) => staticsFor(id, EXTENSIONS as never);
const geometry = (quietRects: readonly QuietRect[] = [], pxPerDp = 1): FieldGeometry => ({ centrePx: [300, 300], radiusPx: R_DP * pxPerDp, pxPerDp, fontScale: 1, quietRects });
const state = (id: DirectionId, face: Face, more: Partial<FieldState> = {}): FieldState => ({
  direction: id,
  face,
  placements: [{ x: 0.566, y: -0.566, fade: 1 }],
  restFade: 0,
  stress: 0,
  confidence: 1,
  genesis: false,
  tMs: 7000,
  breathPhase: 0.3,
  tier: 'full',
  ...more,
});
const frameOf = (id: DirectionId, face: Face, rects: readonly QuietRect[], more: Partial<FieldState> = {}) => buildFieldFrame(state(id, face, more), geometry(rects), statics(id));

describe('the builder: quiet rects in render pixels, grow and feather from the tokens', () => {
  it.each(['abyss', 'linen', 'basin'] as DirectionId[])('%s: grow is quiet.grow, feather is field.mask.quietFeather, both in render px', (id) => {
    for (const pxPerDp of [0.5, 1, 1.4]) {
      const f = buildFieldFrame(state(id, 'dark'), geometry([{ cx: 10, cy: 20, hx: 30, hy: 4 }], pxPerDp), statics(id));
      expect(f.quiet.grow).toBeCloseTo(BASE.quiet.grow * pxPerDp, 12);
      expect(f.quiet.feather).toBeCloseTo(DIRECTIONS[id].field.mask.quietFeather * pxPerDp, 12);
      expect(f.quiet.rects).toEqual([{ cx: 10, cy: 20, hx: 30, hy: 4 }]);
    }
  });

  it('Basin takes the step path (quietFeather 0); Abyss and Linen feather', () => {
    expect(['abyss', 'linen', 'basin'].map((id) => DIRECTIONS[id as DirectionId].field.mask.quietFeather > 0)).toEqual([true, true, false]);
  });

  // Architect round 1 §5: every build throws above QUIET_SLOTS (no lab/shipped switch in the builder,
  // or tests would never run the shipped path); the shipped clamp lives at FieldView's boundary (T12).
  it('more than QUIET_SLOTS rects, or one that is not finite or has a negative size, is a RangeError in every build', () => {
    expect(QUIET_SLOTS).toBe(6);
    const seven = Array.from({ length: 7 }, (_, i) => ({ cx: 10 * i, cy: 5, hx: 2, hy: 2 }));
    expect(() => frameOf('abyss', 'dark', seven)).toThrow(RangeError);
    expect(frameOf('abyss', 'dark', seven.slice(0, 6)).quiet.rects).toEqual(seven.slice(0, 6));
    expect(() => checkQuietRects(seven)).toThrow(RangeError);
    expect(() => checkQuietRects(seven.slice(0, 6))).not.toThrow();
    for (const bad of [{ cx: NaN, cy: 0, hx: 1, hy: 1 }, { cx: 0, cy: Infinity, hx: 1, hy: 1 }, { cx: 0, cy: 0, hx: -1, hy: 1 }]) {
      expect(() => checkQuietRects([bad])).toThrow(RangeError);
      expect(() => frameOf('basin', 'light', [bad])).toThrow(RangeError);
    }
  });

  // Designer r3 §1: "8 dp is far wider than the upsampling half-width at renderScale 0.33". Bilinear
  // upsampling reads the render pixels within one render pixel of a point, so the grown margin, in
  // render pixels, must be at least one for every density down to mdpi.
  it('invariant: quiet.grow × pxPerDp is at least the upsampling half-width (one render pixel) at every tier', () => {
    for (const density of [1, 1.5, 2, 2.625, 2.8125, 3, 3.5, 4]) {
      for (const scale of [BASE.field.tiers.low.renderScale, BASE.field.tiers.full.renderScale]) {
        expect(BASE.quiet.grow * density * scale).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('the law: the rounded grown rect, exactly (designer r3 §1)', () => {
  const RECT: QuietRect = { cx: 100, cy: 100, hx: 40, hy: 10 };
  const corner = [RECT.cx + RECT.hx, RECT.cy + RECT.hy];

  it.each([['abyss', 'feather'], ['basin', 'step']] as const)('%s (%s path): the bound’s corner + 0.70·g on each axis (0.99·g away) is quiet; + 0.75·g (1.06·g away) is not', (id, path) => {
    const f = frameOf(id, 'dark', [RECT]);
    const g = f.quiet.grow;
    expect(quietFactor(f, corner[0] + 0.7 * g, corner[1] + 0.7 * g)).toBe(0);
    const out = quietFactor(f, corner[0] + 0.75 * g, corner[1] + 0.75 * g);
    if (path === 'step') expect(out).toBe(1);
    else expect(out).toBeGreaterThan(0);
  });

  it('on the grown boundary and inside it the factor is exactly 0; at the feather’s width it is 1', () => {
    const f = frameOf('abyss', 'dark', [RECT]);
    const g = f.quiet.grow;
    const F = f.quiet.feather;
    expect(quietFactor(f, RECT.cx, RECT.cy)).toBe(0);
    expect(quietFactor(f, RECT.cx + RECT.hx + g, RECT.cy)).toBe(0);
    expect(quietFactor(f, RECT.cx + RECT.hx + g + F, RECT.cy)).toBe(1);
    expect(quietFactor(f, RECT.cx + RECT.hx + g + F / 2, RECT.cy)).toBeCloseTo(0.5, 12);
  });

  it('a zero-size rect is not empty: it carves a disc of radius g', () => {
    const f = frameOf('basin', 'dark', [{ cx: 50, cy: 60, hx: 0, hy: 0 }]);
    const g = f.quiet.grow;
    expect(quietFactor(f, 50 + 0.99 * g, 60)).toBe(0);
    expect(quietFactor(f, 50 + (0.99 * g) / Math.SQRT2, 60 + (0.99 * g) / Math.SQRT2)).toBe(0);
    expect(quietFactor(f, 50 + 1.01 * g, 60)).toBe(1);
  });

  it('rects multiply: where two feathers overlap, the factors multiply, with no crease', () => {
    const a: QuietRect = { cx: 100, cy: 100, hx: 10, hy: 10 };
    const b: QuietRect = { cx: 180, cy: 100, hx: 10, hy: 10 };
    const f = frameOf('abyss', 'dark', [a, b]);
    const x = 140;
    const one = quietFactor(frameOf('abyss', 'dark', [a]), x, 100);
    const two = quietFactor(frameOf('abyss', 'dark', [b]), x, 100);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
    expect(quietFactor(f, x, 100)).toBeCloseTo(one * two, 15);
  });

  it('no rects: the factor is 1 everywhere', () => {
    const f = frameOf('abyss', 'dark', []);
    for (const [x, y] of [[0, 0], [300, 300], [599, 10]]) expect(quietFactor(f, x, y)).toBe(1);
  });
});

// The designer's planted-rect test (ruling 2.9): every pixel inside a grown rect is byte-identical
// across s, c, t and placements, and equals the law's ground + grain + dither.
describe('a planted quiet rect: nothing the field does reaches inside it', () => {
  const cases: Array<[DirectionId, Face, QuietRect]> = [
    ['abyss', 'dark', { cx: 300, cy: 40, hx: 120, hy: 12 }], // above the plate, in the field
    ['abyss', 'light', { cx: 300, cy: 40, hx: 120, hy: 12 }],
    ['linen', 'light', { cx: 300, cy: 520, hx: 150, hy: 14 }], // below the plate: the backlight and the outer shadow
    ['basin', 'dark', { cx: 300, cy: 250, hx: 30, hy: 8 }], // on the floor
  ];
  const moments: Array<Partial<FieldState>> = [
    { stress: 0, confidence: 1, genesis: true, tMs: 1000, breathPhase: 0.1 },
    { stress: 1, confidence: null, genesis: false, tMs: 37000, breathPhase: 0.7, placements: [{ x: -0.566, y: 0.566, fade: 1 }, { x: 0.3, y: 0.8, fade: 0.4 }] },
    { stress: 0.5, confidence: 0.2, genesis: false, tMs: 59999, breathPhase: 0.95, placements: [] , restFade: 1 },
  ];

  it.each(cases)('%s, %s face: identical across s, c, t and placements, and equal to the ground + grain + dither', (id, face, rect) => {
    const frames = moments.map((m) => frameOf(id, face, [rect], m));
    let inside = 0;
    for (let y = Math.floor(rect.cy - rect.hy - 8); y <= rect.cy + rect.hy + 8; y++) {
      for (let x = Math.floor(rect.cx - rect.hx - 8); x <= rect.cx + rect.hx + 8; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (quietFactor(frames[0], px, py) !== 0) continue;
        inside++;
        const first = fieldOklab(frames[0], px, py);
        for (const f of frames.slice(1)) expect(fieldOklab(f, px, py)).toEqual(first);
        // The ground, shadowed where the plate's shadow reaches, with the static grain and dither.
        const f = frames[0];
        const qx = (px - f.centrePx[0]) / f.radiusPx;
        const qy = -(py - f.centrePx[1]) / f.radiusPx;
        const d = Math.sqrt(qx * qx + qy * qy);
        const region = regionOf(d, f);
        const g = groundAt(region, d, f);
        const grain = region === 'face' ? f.grain.inside : f.grain.ground;
        const shaded = g.L * shadowFactor(f, region, qx, qy);
        expect(first).toEqual({ L: shaded + grain * blueNoiseValue('grain', x, y) + f.dither * blueNoiseValue('dither', x, y), a: g.a, b: g.b });
      }
    }
    expect(inside).toBeGreaterThan(100);
  });
});
