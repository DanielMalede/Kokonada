import { mixSafe } from '../../../color/mixSafe.ts';
import { encodeSrgb8 } from '../../../field/fieldLaw.ts';
import { BASE, DIRECTIONS, type DirectionId, type DirectionTokens, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry } from '../geometry.ts';
import { rimPlan } from '../rim.ts';

// The rim keyline (V1 directions §1.5 and A2; the designer's D6-1 and T13 Q3): the plate's one frame, 1.5 dp, drawn by
// the plate at device resolution above the field and centred on d = 1, lit by a vertical gradient from plate.rim.lit at
// the top to plate.rim.base at the bottom. The field paints the ring, the face and the moat; the plate never does.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: readonly Face[] = ['dark', 'light'];
const tokensOf = (id: DirectionId, face: Face, direction: DirectionTokens = DIRECTIONS[id]) => ({ base: BASE, direction, color: direction.color[face] });
const bytesOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lab = (c: { readonly oklab: readonly number[] }) => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const designBand = { hueFrom: BASE.neverRed.design.hueStart, hueTo: BASE.neverRed.design.hueEnd, chromaFloor: BASE.neverRed.design.chromaFloor };

describe.each(IDS)('%s: the rim plan', (id) => {
  it.each(FACES)('%s: a 1.5 dp keyline centred on R, the rim’s centre line (D6-1)', (face) => {
    for (const fontScale of [1, 2]) {
      const g = plateGeometry(tokensOf(id, face), 296, fontScale);
      const plan = rimPlan(tokensOf(id, face), g);
      expect(plan.width).toBe(BASE.plate.rim.width);
      expect(plan.radius).toBe(g.radius);
      expect(plan.centre).toEqual([g.radius + plan.pad, g.radius + plan.pad]);
    }
  });

  it('draws in a canvas the plate’s box outset on every side, so the keyline’s outer half and its fringe are never cut', () => {
    const g = plateGeometry(tokensOf(id, 'dark'), 296, 1);
    const plan = rimPlan(tokensOf(id, 'dark'), g);
    expect(plan.size).toBe(296 + 2 * plan.pad);
    // Beyond the keyline's outer edge, at least a whole dp: one device pixel or more at every density.
    expect(plan.pad - plan.width / 2).toBeGreaterThanOrEqual(1);
  });

  it.each(FACES)('%s: lit at the top and base at the bottom, a vertical gradient across the plate’s height (V1 A2)', (face) => {
    const t = tokensOf(id, face);
    const g = plateGeometry(t, 296, 1);
    const plan = rimPlan(t, g);
    const x = g.radius + plan.pad;
    expect(plan.gradient.from).toEqual([x, plan.pad]);
    expect(plan.gradient.to).toEqual([x, plan.pad + 296]);
    expect(DIRECTIONS[id].plate.rim.light).toBe(1);
    expect(plan.gradient.top).toEqual(bytesOf(t.color.plate.rim.lit.hex));
    expect(plan.gradient.bottom).toEqual(bytesOf(t.color.plate.rim.base.hex));
  });
});

describe('plate.rim.light: how far the top is lit, from the base (0) to plate.rim.lit (1)', () => {
  const at = (light: number) => {
    const d = DIRECTIONS.abyss;
    const direction = { ...d, plate: { ...d.plate, rim: { ...d.plate.rim, light } } } as DirectionTokens;
    const t = tokensOf('abyss', 'dark', direction);
    return rimPlan(t, plateGeometry(t, 296, 1));
  };
  const c = DIRECTIONS.abyss.color.dark.plate.rim;

  it('0 is a flat base keyline, 1 is the lit token, each byte for byte', () => {
    expect(at(0).gradient.top).toEqual(bytesOf(c.base.hex));
    expect(at(0).gradient.bottom).toEqual(bytesOf(c.base.hex));
    expect(at(1).gradient.top).toEqual(bytesOf(c.lit.hex));
  });

  it('between them, the top is the never-red mix of the two (mixSafe, DSN-015), on 8-bit pixels', () => {
    const top = at(0.5).gradient.top;
    expect(top).toEqual(encodeSrgb8(mixSafe(lab(c.base), lab(c.lit), 0.5, designBand)));
    expect(top).not.toEqual(bytesOf(c.base.hex));
    expect(top).not.toEqual(bytesOf(c.lit.hex));
    expect(at(0.5).gradient.bottom).toEqual(bytesOf(c.base.hex));
  });

  it.each([-0.1, 1.1, NaN, Infinity])('refuses %p: a rim lit outside 0..1 is a broken token, never a guess', (light) => {
    expect(() => at(light)).toThrow(RangeError);
  });
});

// The plate draws no ring highlight: Abyss has none, and where a non-zero plate.ringHighlightArc would sit (which edge,
// which width, which ends) is an open question for the designer. A direction that sets one fails here, by name, until
// the Plate draws it to a ruling.
it('tripwire: every direction’s plate.ringHighlightArc is 0, because the Plate draws no ring highlight', () => {
  const lit = IDS.filter((id) => DIRECTIONS[id].plate.ringHighlightArc !== 0);
  expect(lit).toEqual([]);
});
