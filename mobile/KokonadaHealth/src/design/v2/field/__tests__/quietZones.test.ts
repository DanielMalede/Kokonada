import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame, checkQuietRects, type FieldGeometry, type FieldState } from '../fieldFrame.ts';
import { QUIET_SLOTS, QUIET_ZONE, checkQuietPresence, fieldOklab, groundAt, quietFactor, regionOf, shadowFactor, type QuietRect } from '../fieldLaw.ts';
import { blueNoiseValue } from '../blueNoise.ts';
import { staticsFor } from '../statics.ts';

// Quiet zones (DSN-023; designer ruling 2.9 and r3 §1): a term of the one field law, never a layer.
//   q = abs(p − c_j) − h_j
//   sd_j = length(max(q, 0)) + min(max(q.x, q.y), 0) − g
//   factor_j = F > 0 ? smoothstep(0, F, sd_j) : (sd_j > 0 ? 1 : 0)
//   extent = regionExtent · Π over j < count of (1 − p_j) + p_j·factor_j (presence, below)
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
  it.each(['abyss'] as DirectionId[])('%s: grow is quiet.grow, feather is field.mask.quietFeather, both in render px', (id) => {
    for (const pxPerDp of [0.5, 1, 1.4]) {
      const f = buildFieldFrame(state(id, 'dark'), geometry([{ cx: 10, cy: 20, hx: 30, hy: 4 }], pxPerDp), statics(id));
      expect(f.quiet.grow).toBeCloseTo(BASE.quiet.grow * pxPerDp, 12);
      expect(f.quiet.feather).toBeCloseTo(DIRECTIONS[id].field.mask.quietFeather * pxPerDp, 12);
      expect(f.quiet.rects).toEqual([{ cx: 10, cy: 20, hx: 30, hy: 4 }]);
    }
  });

  // The step path (quietFeather 0) is held on the fixture direction fixture-inner (fixturePaths.test.ts).
  it('Abyss takes the feather path (quietFeather above 0)', () => {
    expect(DIRECTIONS.abyss.field.mask.quietFeather).toBeGreaterThan(0);
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
      expect(() => frameOf('abyss', 'light', [bad])).toThrow(RangeError);
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

  it.each([['abyss', 'feather']] as const)('%s (%s path): the bound’s corner + 0.70·g on each axis (0.99·g away) is quiet; + 0.75·g (1.06·g away) is not', (id, path) => {
    const f = frameOf(id, 'dark', [RECT]);
    const g = f.quiet.grow;
    expect(quietFactor(f, corner[0] + 0.7 * g, corner[1] + 0.7 * g)).toBe(0);
    const out = quietFactor(f, corner[0] + 0.75 * g, corner[1] + 0.75 * g);
    // The feather path; the step path's exact 1 is held on fixture-inner (fixturePaths.test.ts).
    expect([path, out > 0, out < 1]).toEqual(['feather', true, true]);
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

  it('a zero-size rect is not empty: it carves a disc of radius g, feathered out to g + F', () => {
    const f = frameOf('abyss', 'dark', [{ cx: 50, cy: 60, hx: 0, hy: 0 }]);
    const g = f.quiet.grow;
    const F = f.quiet.feather;
    expect(quietFactor(f, 50 + 0.99 * g, 60)).toBe(0);
    expect(quietFactor(f, 50 + (0.99 * g) / Math.SQRT2, 60 + (0.99 * g) / Math.SQRT2)).toBe(0);
    expect(quietFactor(f, 50 + 1.01 * g, 60)).toBeGreaterThan(0);
    expect(quietFactor(f, 50 + g + F + 0.01, 60)).toBe(1);
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
    // Under a plate shadow, and on the step path: the fixture directions (fixturePaths.test.ts).
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

// Presence (law round 2 item 7, DSN-023 as amended 2026-10-07; architect option D; resilience's pins):
//   factor_z = (1 − p_z) + p_z·q_z(x), p_z ∈ [0, 1]
// p_z = 0 is no zone, and p_z = 1 is the zone bit for bit. The slots are fixed by a registry, so a zone keeps
// its slot whether or not it shows, and a slot below the count whose presence is 0 (a hole) is exactly inert.
// Presence is per frame (FieldState.quietPresence, aligned to the slots of FieldGeometry.quietRects): omitted, it
// is 1 for each rect. Malformed presence (not finite, outside [0, 1], or a value for a slot with no rect) is a
// RangeError in the law, the builder and the packing, in every build; the future FieldView sanitises at its
// boundary (non-finite → 1).
// The rects' own factor q_z, written out here as today's law draws it, so the pins below do not lean on the
// code they pin.
const todayOne = (f: { quiet: { grow: number; feather: number } }, r: QuietRect, x: number, y: number) => {
  const qx = Math.abs(x - r.cx) - r.hx;
  const qy = Math.abs(y - r.cy) - r.hy;
  const sd = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) + Math.min(Math.max(qx, qy), 0) - f.quiet.grow;
  const F = f.quiet.feather;
  if (F > 0) {
    const t = Math.min(1, Math.max(0, sd / F));
    return t * t * (3 - 2 * t);
  }
  return sd > 0 ? 1 : 0;
};
const todayProduct = (f: { quiet: { grow: number; feather: number } }, rects: readonly QuietRect[], x: number, y: number) => {
  let product = 1;
  for (const r of rects) product *= todayOne(f, r, x, y);
  return product;
};

// Two zones whose feathers overlap, a zero-size one, and three more: all six slots, with points across every
// feather, every grown boundary and the space between.
const SIX: QuietRect[] = [
  { cx: 100, cy: 100, hx: 40, hy: 10 },
  { cx: 160, cy: 104, hx: 12, hy: 6 },
  { cx: 60, cy: 170, hx: 0, hy: 0 },
  { cx: 220, cy: 40, hx: 30, hy: 3 },
  { cx: 30, cy: 30, hx: 8, hy: 8 },
  { cx: 140, cy: 200, hx: 50, hy: 8 },
];
const POINTS: Array<[number, number]> = [];
for (let y = 0.5; y < 260; y += 3.7) for (let x = 0.5; x < 300; x += 3.3) POINTS.push([x, y]);

describe('presence: the slot registry', () => {
  // Architect option D: fixed named slots, B4's constant under field/, imported by B6; one spare.
  it('names the zones on fixed slots below QUIET_SLOTS, each once, with one spare', () => {
    expect(QUIET_ZONE).toEqual({ avatar: 0, aiLine: 1, nav: 2, voiceBox: 3, cta: 4 });
    const slots = Object.values(QUIET_ZONE);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots.every((k) => Number.isInteger(k) && k >= 0 && k < QUIET_SLOTS)).toBe(true);
    expect(QUIET_SLOTS - slots.length).toBe(1);
  });
});

describe('presence: the law', () => {
  const base = frameOf('abyss', 'dark', SIX);
  const withPresence = (rects: readonly QuietRect[], presence: readonly number[]) => ({ ...base, quiet: { ...base.quiet, rects, presence } });

  it('the builder carries presence: omitted, 1 for each rect; given, as given', () => {
    expect(base.quiet.presence).toEqual([1, 1, 1, 1, 1, 1]);
    expect(frameOf('abyss', 'dark', []).quiet.presence).toEqual([]);
    const given = [1, 0.5, 0, 0.25, 1, 0.75];
    expect(frameOf('abyss', 'dark', SIX, { quietPresence: given }).quiet.presence).toEqual(given);
  });

  it('p = 1 on every slot is today’s product, bit for bit (and the frame equals the one built without presence)', () => {
    const ones = frameOf('abyss', 'dark', SIX, { quietPresence: [1, 1, 1, 1, 1, 1] });
    let partial = 0;
    for (const [x, y] of POINTS) {
      const today = todayProduct(base, SIX, x, y);
      if (today > 0 && today < 1) partial++;
      expect(quietFactor(ones, x, y)).toBe(today);
      expect(quietFactor(base, x, y)).toBe(today);
      expect(fieldOklab(ones, x, y)).toEqual(fieldOklab(base, x, y));
    }
    expect(partial).toBeGreaterThan(200); // not vacuous: many points sit in a feather
  });

  it('p = 0 on a slot is that zone absent, bit for bit, wherever the slot sits: a hole below the count is inert', () => {
    for (let k = 0; k < QUIET_SLOTS; k++) {
      const presence = SIX.map((_, j) => (j === k ? 0 : 1));
      const holed = withPresence(SIX, presence);
      const absent = withPresence(SIX.filter((_, j) => j !== k), presence.filter((_, j) => j !== k));
      let carved = 0;
      for (const [x, y] of POINTS) {
        if (todayOne(base, SIX[k], x, y) < 1) carved++;
        expect(quietFactor(holed, x, y)).toBe(quietFactor(absent, x, y));
        expect(fieldOklab(holed, x, y)).toEqual(fieldOklab(absent, x, y));
      }
      expect(carved).toBeGreaterThan(0); // not vacuous: the zone in slot k carves the field at p = 1
    }
    // Every slot at 0 is no zone at all: the factor is exactly 1 everywhere.
    const none = withPresence(SIX, [0, 0, 0, 0, 0, 0]);
    for (const [x, y] of POINTS) expect(quietFactor(none, x, y)).toBe(1);
  });

  it('in between, each slot’s factor is (1 − p) + p·q, the zones multiply, and the factor falls as p rises', () => {
    const ps = [0, 0.25, 0.5, 0.75, 1];
    for (let k = 0; k < QUIET_SLOTS; k++) {
      for (const [x, y] of POINTS) {
        const q = todayOne(base, SIX[k], x, y);
        const rest = todayProduct(base, SIX.filter((_, j) => j !== k), x, y);
        let previous = Infinity;
        for (const p of ps) {
          const presence = SIX.map((_, j) => (j === k ? p : 1));
          const f = quietFactor(withPresence(SIX, presence), x, y);
          expect(f).toBeCloseTo(((1 - p) + p * q) * rest, 14);
          expect(f).toBeLessThanOrEqual(previous);
          previous = f;
        }
      }
    }
  });

  // The planted wrong factors, read on one point in slot 0's feather: each must miss the law's value.
  it('not vacuous: 1 − p·q, p·q and q alone each give a different factor in a feather at p = 0.5', () => {
    const r = SIX[0];
    const x = r.cx + r.hx + base.quiet.grow + base.quiet.feather / 3;
    const y = r.cy;
    const q = todayOne(base, r, x, y);
    expect(q).toBeGreaterThan(0.1);
    expect(q).toBeLessThan(0.9);
    const f = quietFactor(withPresence([r], [0.5]), x, y);
    expect(f).toBeCloseTo(0.5 + 0.5 * q, 14);
    for (const wrong of [1 - 0.5 * q, 0.5 * q, q]) expect(Math.abs(f - wrong)).toBeGreaterThan(0.01);
  });

  it('malformed presence is a RangeError in the law: not finite, outside [0, 1], or a value for a slot with no rect', () => {
    const one = [SIX[0]];
    for (const bad of [NaN, Infinity, -Infinity, -0.001, 1.001, -1, 2]) {
      expect(() => quietFactor(withPresence(one, [bad]), 0, 0)).toThrow(RangeError);
      expect(() => fieldOklab(withPresence(one, [bad]), 0, 0)).toThrow(RangeError);
    }
    expect(() => quietFactor(withPresence(one, [1, 1]), 0, 0)).toThrow(RangeError); // slot 1 has no rect
    expect(() => quietFactor(withPresence(one, []), 0, 0)).toThrow(RangeError); // slot 0's presence is missing
    expect(() => quietFactor(withPresence([], [0]), 0, 0)).toThrow(RangeError);
    for (const ok of [0, 0.5, 1]) expect(() => quietFactor(withPresence(one, [ok]), 0, 0)).not.toThrow();
  });

  it('malformed presence is a RangeError in the builder, in every build', () => {
    for (const bad of [[NaN], [1.5], [-0.5], [Infinity]]) {
      expect(() => frameOf('abyss', 'dark', [SIX[0]], { quietPresence: bad })).toThrow(RangeError);
    }
    expect(() => frameOf('abyss', 'dark', [SIX[0]], { quietPresence: [1, 1] })).toThrow(RangeError);
    expect(() => frameOf('abyss', 'dark', SIX, { quietPresence: [1, 1, 1] })).toThrow(RangeError);
    expect(() => frameOf('abyss', 'dark', [], { quietPresence: [0] })).toThrow(RangeError);
    expect(() => checkQuietPresence(2, [0, 1])).not.toThrow();
    expect(() => checkQuietPresence(2, [0, NaN])).toThrow(RangeError);
  });
});
