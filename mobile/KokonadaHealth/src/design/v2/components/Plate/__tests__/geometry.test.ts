import { buildFieldFrame, type FieldGeometry, type FieldState } from '../../../field/fieldFrame.ts';
import type { Tap } from '../../../field/placementLedger.ts';
import { staticsFor } from '../../../field/statics.ts';
import { EXTENSIONS } from '../../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal, wheelLayout, type PlatePoint } from '../geometry.ts';

// The plate's one coordinate space (DSN-025, DSN-026; architect sequencing §4). The rim, the rim words, the beads and the
// touch layer are drawn over the field, which paints the ring, the face and each bead's halo itself. So the plate's
// geometry is held to the field's builder, number for number: a ring or a bead that the plate puts anywhere else than
// the field does shows as a seam on the device.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const tokensOf = (id: DirectionId) => ({ base: BASE, direction: DIRECTIONS[id] });
const statics = (id: DirectionId) => staticsFor(id, EXTENSIONS as never);

/** The field's frame for a plate of diameter `d` dp at `fontScale`, drawn at `k` render px per dp, with one placement. */
function fieldFrame(id: DirectionId, d: number, fontScale: number, k: number, placement: Tap = { x: 0.5, y: -0.3 }) {
  const r = d / 2;
  const geometry: FieldGeometry = { centrePx: [r * k, r * k], radiusPx: r * k, pxPerDp: k, fontScale };
  const state: FieldState = {
    direction: id, face: 'dark', placements: [{ x: placement.x, y: placement.y, fade: 1 }], restFade: 0,
    stress: 0, confidence: null, genesis: false, tMs: 0, breathPhase: 0, tier: 'still',
  };
  return buildFieldFrame(state, geometry, statics(id));
}

describe('a PlatePoint', () => {
  it('is the field’s Tap: the unit disc, x right, y up, so a bead, a touch and the field mean the same point', () => {
    const point: PlatePoint = { x: 0.25, y: -0.5 };
    const tap: Tap = point;
    const back: PlatePoint = tap;
    expect(back).toBe(point);
  });
});

describe('plateGeometry', () => {
  it.each(IDS)('%s: a 296 dp plate at font scale 1.0 and 2.0, from the tokens', (id) => {
    const d = DIRECTIONS[id];
    const one = plateGeometry(tokensOf(id), 296, 1);
    expect(one).toEqual({
      diameter: 296,
      radius: 148,
      centre: [148, 148],
      band: BASE.plate.labelBand.min,
      ringInner: 148 - BASE.plate.labelBand.min,
      ringMid: 148 - BASE.plate.labelBand.min / 2,
      beadRadius: d.bead.diameter / 2,
      layoutRadius: 148 - d.bead.diameter / 2,
      rimWidth: BASE.plate.rim.width,
    });
    // DSN-027 and the hero spec: the band follows the OS scale with no cap, 28 dp at 1.0 and 56 dp at 2.0.
    const two = plateGeometry(tokensOf(id), 296, 2);
    expect(two.band).toBe(2 * BASE.plate.labelBand.min);
    expect(two.ringInner).toBe(148 - 2 * BASE.plate.labelBand.min);
    expect(two.ringMid).toBe(148 - BASE.plate.labelBand.min);
    expect(two.radius).toBe(148);
  });

  it('the band never shrinks below its minimum: a font scale under 1 keeps 28 dp', () => {
    expect(plateGeometry(tokensOf('abyss'), 296, 0.85).band).toBe(BASE.plate.labelBand.min);
  });

  // The field reads a font scale that is not a number as 1 (fieldFrame.ts, finite(fontScale, 1)); the plate must read it
  // the same way, or its ring and the field's part.
  it.each([NaN, Infinity, -Infinity, 0, -1])('reads the font scale %p as the field does', (fontScale) => {
    const g = plateGeometry(tokensOf('abyss'), 296, fontScale);
    expect(g.ringInner).toBeCloseTo(fieldFrame('abyss', 296, fontScale, 1).ringInner * g.radius, 9);
    expect(g.band).toBe(BASE.plate.labelBand.min);
  });

  describe.each(IDS)('%s: the ring the plate lays its words in is the ring the field paints', (id) => {
    const cases = [264, 296, 340].flatMap((d) => [0.85, 1, 1.3, 1.5, 2, 3].flatMap((fs) => [1, 2.625 * 0.5, 3.5 * 0.33].map((k) => [d, fs, k] as const)));
    it.each(cases)('diameter %p dp, font scale %p, %p render px per dp', (d, fs, k) => {
      const g = plateGeometry(tokensOf(id), d, fs);
      const f = fieldFrame(id, d, fs, k);
      expect(g.ringInner).toBeCloseTo(f.ringInner * g.radius, 9);
      expect(g.beadRadius).toBeCloseTo(f.beadRadius * g.radius, 9);
      expect(g.radius - g.layoutRadius).toBeCloseTo(f.beadRadius * g.radius, 9);
    });
  });

  it.each([0, -296, NaN, Infinity])('refuses a diameter of %p: a plate must have a size to be drawn at', (diameter) => {
    expect(() => plateGeometry(tokensOf('abyss'), diameter, 1)).toThrow(RangeError);
  });

  it('refuses a plate whose label band leaves no face inside it, naming both sizes', () => {
    // 100 dp at font scale 2: R is 50 dp and the band 56 dp.
    expect(() => plateGeometry(tokensOf('abyss'), 100, 2)).toThrow(/56.*50|50.*56/);
  });
});

describe('pointToLocal: where a point sits on the plate, in its own dp (x right, y down)', () => {
  const g = plateGeometry(tokensOf('abyss'), 296, 1);
  const L = g.layoutRadius;

  it('the axes: y up on the plate is up on the screen, and every point is scaled to the layout radius (DSN-025)', () => {
    expect(pointToLocal({ x: 0, y: 0 }, g)).toEqual({ x: 148, y: 148 });
    expect(pointToLocal({ x: 1, y: 0 }, g)).toEqual({ x: 148 + L, y: 148 });
    expect(pointToLocal({ x: -1, y: 0 }, g)).toEqual({ x: 148 - L, y: 148 });
    expect(pointToLocal({ x: 0, y: 1 }, g)).toEqual({ x: 148, y: 148 - L });
    expect(pointToLocal({ x: 0, y: -1 }, g)).toEqual({ x: 148, y: 148 + L });
  });

  it('a bead at the rim touches the rim from inside: its far edge is the rim’s centre line', () => {
    const p = pointToLocal({ x: 1, y: 0 }, g);
    expect(p.x + g.beadRadius).toBe(g.diameter);
  });

  // The field moves a point outside the unit disc onto its rim, and reads a coordinate that is not a number as 0, one
  // coordinate at a time (fieldFrame.ts, placed()). The bead must land on the halo the field draws for that point.
  const POINTS: Tap[] = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
    { x: 0.566, y: 0.566 }, { x: 0.6, y: -0.8 }, { x: 0.95, y: -0.05 }, { x: -0.141, y: 0.141 },
    { x: 3, y: 4 }, { x: -2, y: 0 }, { x: NaN, y: 0.5 }, { x: 0.5, y: Infinity }, { x: -Infinity, y: NaN },
  ];
  it.each(IDS)('%s: every point lands where the field draws its bead, at both font scales', (id) => {
    for (const fs of [1, 2]) {
      const geo = plateGeometry(tokensOf(id), 296, fs);
      for (const point of POINTS) {
        const bead = fieldFrame(id, 296, fs, 1.3125, point).nodes.find((n) => n.bead !== null)!.bead!;
        const local = pointToLocal(point, geo);
        expect(local.x).toBeCloseTo(geo.centre[0] + bead[0] * geo.radius, 9);
        expect(local.y).toBeCloseTo(geo.centre[1] - bead[1] * geo.radius, 9);
      }
    }
  });
});

describe('wheelLayout: the layout the touch layer hands to screenToCircumplex (wheelGeometry.ts, DSN-025)', () => {
  it('is the plate’s own centre with the layout radius, R less the bead, so every bead sits inside the rim', () => {
    const g = plateGeometry(tokensOf('abyss'), 296, 2);
    expect(wheelLayout(g)).toEqual({ cx: 148, cy: 148, radius: 148 - DIRECTIONS.abyss.bead.diameter / 2 });
  });
});
