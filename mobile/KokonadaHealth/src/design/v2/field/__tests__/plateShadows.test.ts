import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame, type FieldState } from '../fieldFrame.ts';
import { SHADOW_SLOTS, fieldOklab, inertShadow, regionOf, shadowFactor, smoothstep, type FieldFrame } from '../fieldLaw.ts';
import { packFrame } from '../uniforms.ts';
import { staticsFor } from '../statics.ts';

// Plate shadows (designer ruling 2.9, r2 text; the critic's wording, accepted): terms of the one field
// law, never a separate layer, scrim, mask or opacity overlay in the shader path. They act on the local
// ground's L before the composite:
//   G.L ← G.L·(1 − Σ_j strength_j·g_j), g_j = smoothstep(−blur_j, blur_j, u_j),
//   outer (plate.depth > 0, outside the plate):  u = R − |x − (c + o)|,
//   inner (plate.depth < 0, on the face):        u = |x − (c + o)| − R_face,
//   o = (0, offsetY) dp, downward on screen; a negative strength is a lift; static.
// Summed over the face's plate.shadow and plate.shadow2. Distances are in dp; the frame carries them in
// plate units, where smoothstep(−b, b, u) is unchanged. R_face is the face's edge, ringInner (a reading).

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: Face[] = ['dark', 'light'];
const R_DP = BASE.plate.maxDiameter / 2;
const geometry = { centrePx: [300, 300] as [number, number], radiusPx: R_DP, pxPerDp: 1, fontScale: 1 };
const statics = (id: DirectionId) => staticsFor(id, EXTENSIONS as never);
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
const frameOf = (id: DirectionId, face: Face, more: Partial<FieldState> = {}) => buildFieldFrame(state(id, face, more), geometry, statics(id));
const tokensOf = (id: DirectionId, face: Face) => [DIRECTIONS[id].plate.shadow[face], DIRECTIONS[id].plate.shadow2[face]];

describe('the shadows come from the tokens', () => {
  it('premise: every shadow with a strength has a blur (blur 0 would divide by zero in smoothstep)', () => {
    for (const id of IDS) for (const face of FACES) for (const s of tokensOf(id, face)) if (s.strength !== 0) expect(s.blur).toBeGreaterThan(0);
  });

  it.each(IDS.flatMap((id) => FACES.map((face) => [id, face] as const)))('%s, %s face: two slots; mode by the sign of plate.depth, offset and blur in plate units', (id, face) => {
    const f = frameOf(id, face);
    expect(SHADOW_SLOTS).toBe(2);
    expect(f.shadows).toHaveLength(SHADOW_SLOTS);
    const depth = DIRECTIONS[id].plate.depth;
    tokensOf(id, face).forEach((t, i) => {
      if (t.strength === 0 || depth === 0) {
        expect(f.shadows[i]).toEqual(inertShadow());
      } else {
        expect(f.shadows[i].mode).toBe(Math.sign(depth));
        expect(f.shadows[i].offset).toBeCloseTo(-t.offsetY / R_DP, 15); // y up: downward on screen is negative
        expect(f.shadows[i].blur).toBeCloseTo(t.blur / R_DP, 15);
        expect(f.shadows[i].strength).toBe(t.strength);
      }
    });
  });

  it('which directions shade: Abyss none; Linen outer, light face only; Basin inner, both faces, with a lift on light', () => {
    const modes = (id: DirectionId, face: Face) => frameOf(id, face).shadows.map((s) => [s.mode, Math.sign(s.strength)]);
    expect(modes('abyss', 'dark')).toEqual([[0, 0], [0, 0]]);
    expect(modes('abyss', 'light')).toEqual([[0, 0], [0, 0]]);
    expect(modes('linen', 'dark')).toEqual([[0, 0], [0, 0]]);
    expect(modes('linen', 'light')).toEqual([[1, 1], [1, 1]]);
    expect(modes('basin', 'dark')).toEqual([[-1, 1], [0, 0]]);
    expect(modes('basin', 'light')).toEqual([[-1, 1], [-1, -1]]);
  });

  it('static: no clock, breath, tension, confidence or placement moves a shadow', () => {
    const a = frameOf('basin', 'light');
    const b = frameOf('basin', 'light', { tMs: 41234, breathPhase: 0.9, stress: 1, confidence: null, genesis: true, placements: [] , restFade: 1 });
    expect(b.shadows).toEqual(a.shadows);
  });
});

describe('the law: the shadow factor, exactly as ruled', () => {
  /** r2's form, by hand, in plate units. */
  const expected = (f: FieldFrame, qx: number, qy: number) => {
    const d = Math.sqrt(qx * qx + qy * qy);
    const region = regionOf(d, f);
    let sum = 0;
    for (const s of f.shadows) {
      if (s.mode === 0) continue;
      const dist = Math.sqrt(qx * qx + (qy - s.offset) * (qy - s.offset));
      if (s.mode > 0 && (region === 'moat' || region === 'outside')) sum += s.strength * smoothstep(-s.blur, s.blur, 1 - dist);
      if (s.mode < 0 && region === 'face') sum += s.strength * smoothstep(-s.blur, s.blur, dist - f.ringInner);
    }
    return 1 - sum;
  };

  it.each([['linen', 'light'], ['basin', 'dark'], ['basin', 'light']] as const)('%s, %s face: at points across the plate and beyond', (id, face) => {
    const f = frameOf(id, face);
    let shaded = 0;
    for (let qy = -1.4; qy <= 1.4; qy += 0.01) {
      for (const qx of [0, 0.3, -0.7]) {
        const region = regionOf(Math.hypot(qx, qy), f);
        const got = shadowFactor(f, region, qx, qy);
        expect(got).toBe(expected(f, qx, qy));
        if (got !== 1) shaded++;
      }
    }
    expect(shaded).toBeGreaterThan(20);
  });

  it('outer shadows fall only outside the rim, darkest below the plate (the light is from above)', () => {
    const f = frameOf('linen', 'light');
    const at = (qx: number, qy: number) => shadowFactor(f, regionOf(Math.hypot(qx, qy), f), qx, qy);
    for (const [qx, qy] of [[0, 0], [0, 0.9], [0, -0.99], [0.7, -0.7]]) expect(at(qx, qy)).toBe(1); // inside the rim
    expect(at(0, -1.03)).toBeLessThan(at(0, 1.03));
    expect(at(0, -1.03)).toBeLessThan(1);
  });

  it('inner shadows fall only on the face, darkest at the top inner lip; a negative strength lifts', () => {
    const f = frameOf('basin', 'dark');
    const at = (qx: number, qy: number) => shadowFactor(f, regionOf(Math.hypot(qx, qy), f), qx, qy);
    const lip = f.ringInner - 0.005;
    expect(at(0, lip)).toBeLessThan(at(0, -lip));
    expect(at(0, 0.95)).toBe(1); // the ring
    expect(at(0, 1.05)).toBe(1); // beyond the rim
    const lift = { ...frameOf('basin', 'light'), shadows: [inertShadow(), frameOf('basin', 'light').shadows[1]] };
    const atLift = (qx: number, qy: number) => shadowFactor(lift, regionOf(Math.hypot(qx, qy), lift), qx, qy);
    expect(atLift(0, -lip)).toBeGreaterThan(1);
  });

  it('L only: on a neutral ground the shadows change L and leave a and b exactly 0', () => {
    const grey = { L: 0.6, a: 0, b: 0 };
    for (const [id, face] of [['linen', 'light'], ['basin', 'dark'], ['basin', 'light']] as const) {
      const f = { ...frameOf(id, face, { placements: [] }), grounds: { outside: grey, face: grey, ring: grey }, grain: { inside: 0, ground: 0 }, dither: 0, vignette: 0, centreLift: 0, kField: 0 };
      let changed = 0;
      for (let y = 100; y < 520; y += 3) {
        const c = fieldOklab(f, 300.5, y + 0.5);
        expect([c.a, c.b]).toEqual([0, 0]);
        if (c.L !== 0.6) changed++;
      }
      expect(changed).toBeGreaterThan(0);
    }
  });

  it('Abyss draws no shadow: its ground is untouched everywhere', () => {
    const f = frameOf('abyss', 'dark');
    for (let qy = -1.5; qy <= 1.5; qy += 0.05) expect(shadowFactor(f, regionOf(Math.abs(qy), f), 0, qy)).toBe(1);
  });

  it('the packed shadows are the frame’s, in its two slots', () => {
    const f = frameOf('basin', 'light');
    const packed = packFrame(f);
    const flat = f.shadows.flatMap((s) => [s.offset, s.blur, s.strength, s.mode]);
    const at = packed.findIndex((_, i) => flat.every((v, k) => packed[i + k] === v));
    expect(at).toBeGreaterThan(0);
  });
});

// Resilience, rulings after T5d, §3: does the plate's outer shadow shade the ground where the field
// does not land (mask.outside = 0)? It does: the shadow multiplies the local ground's L before the
// composite, whatever the extent. So the never-red sweep's condition is "a shadow is drawn".
describe('the outer shadow shades the ground where the field does not land', () => {
  it('Linen light with mask.outside 0: below the plate, the ground is darker than the plain ground, by the shadow factor', () => {
    const frame = frameOf('linen', 'light');
    const noField = { ...frame, mask: { ...frame.mask, outside: 0 }, grain: { inside: 0, ground: 0 }, dither: 0 };
    const qx = 0;
    const qy = -1.02; // just outside the rim, under the shadow's offset
    const x = noField.centrePx[0] + qx * noField.radiusPx;
    const y = noField.centrePx[1] - qy * noField.radiusPx;
    const region = regionOf(Math.hypot(qx, qy), noField);
    const factor = shadowFactor(noField, region, qx, qy);
    expect(factor).toBeLessThan(0.99);
    expect(fieldOklab(noField, x, y).L).toBeCloseTo(noField.grounds.outside.L * factor, 12);
  });
});
