import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame, type FieldState } from '../fieldFrame.ts';
import { SHADOW_SLOTS, inertShadow, regionOf, shadowFactor } from '../fieldLaw.ts';
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

  it('Abyss draws no shadow on either face', () => {
    const modes = (id: DirectionId, face: Face) => frameOf(id, face).shadows.map((s) => [s.mode, Math.sign(s.strength)]);
    expect(modes('abyss', 'dark')).toEqual([[0, 0], [0, 0]]);
    expect(modes('abyss', 'light')).toEqual([[0, 0], [0, 0]]);
  });
});

// The close-out (Abyss only): every shadow path the law and the builder keep (outer, inner, the lift,
// L only, the outer shadow where the field does not land, static, packed in two slots) is held on the
// fixture directions, fixture-outer and fixture-inner (fixturePaths.test.ts and fixturePaths.skia.test.ts).
describe('the law: Abyss draws no shadow', () => {
  it('Abyss draws no shadow: its ground is untouched everywhere', () => {
    const f = frameOf('abyss', 'dark');
    for (let qy = -1.5; qy <= 1.5; qy += 0.05) expect(shadowFactor(f, regionOf(Math.abs(qy), f), 0, qy)).toBe(1);
  });
});
