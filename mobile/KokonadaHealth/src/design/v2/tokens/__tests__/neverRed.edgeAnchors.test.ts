import { maxInBandOnSrgbBlend } from '../../color/edgeSweep.ts';
import { segmentTouchesRed } from '../../color/redBand.ts';
import { sweepOklabToSrgb } from '../../color/sweepConvert.ts';
import type { Oklab, Srgb } from '../../color/oklab.ts';
import { CHECK_BAND, DESIGN_BAND, edgeFamiliesFor, edgeSweepInputs, lab, plateShadowGrounds, tierFor } from '../neverRedSweeps.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';

// UI-243 (the designer, the B8 dry run): the joy and intense anchors flank the red band, so an edge between them,
// blended in sRGB as Skia draws it, or in linear sRGB, or in OKLab, crosses the band at in-band chroma well above
// either floor on both faces. No surface may put the two edge to edge. edgeFamiliesFor enumerates every pair of
// colours that meet at an edge; each pair reaches its float pass as maxInBandOnSrgbBlend(bg, ink), so the pin
// watches those calls (the real function still answers) and holds that no checked pair has a joy anchor colour on
// one side and an intense one on the other, at any presence the sweep fills a bead with or at the CTA's full tint.

type Watch = (bg: Srgb, ink: Srgb) => void;
const mockWatch: { current: Watch | null } = { current: null };
jest.mock('../../color/edgeSweep.ts', () => {
  const actual = jest.requireActual('../../color/edgeSweep.ts');
  return {
    ...actual,
    maxInBandOnSrgbBlend: (bg: Srgb, ink: Srgb, ...rest: unknown[]) => {
      mockWatch.current?.(bg, ink);
      return actual.maxInBandOnSrgbBlend(bg, ink, ...rest);
    },
  };
});

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const CASES = IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const));
const key = (rgb: Srgb) => rgb.join(',');

/** The sRGB of each anchor colour the sweep can draw, keyed exactly: the bead presences, and the full tint. */
function anchorColours(id: DirectionId, face: Face, quadrant: 'joy' | 'intense'): Map<string, string> {
  const anchor = lab(BASE.emotion[quadrant][tierFor(face)]);
  const out = new Map<string, string>();
  for (const p of [...edgeSweepInputs(id).presences, 1]) {
    out.set(key(sweepOklabToSrgb({ L: anchor.L, a: anchor.a * p, b: anchor.b * p })), `${quadrant} at presence ${p}`);
  }
  return out;
}

interface Meetings {
  readonly pairs: number;
  readonly seen: ReadonlySet<string>;
  readonly jointPairs: readonly string[];
}

/** Runs edgeFamiliesFor with the watch on, and reports the anchor colours it saw and every joy–intense pair. */
function meetingsOf(id: DirectionId, face: Face, run: () => unknown): Meetings {
  const joy = anchorColours(id, face, 'joy');
  const intense = anchorColours(id, face, 'intense');
  const seen = new Set<string>();
  const joint = new Set<string>();
  let pairs = 0;
  mockWatch.current = (bg, ink) => {
    pairs++;
    const [b, i] = [key(bg), key(ink)];
    for (const k of [b, i]) {
      const name = joy.get(k) ?? intense.get(k);
      if (name !== undefined) seen.add(name);
    }
    if ((joy.has(b) && intense.has(i)) || (intense.has(b) && joy.has(i))) {
      joint.add(`${joy.get(b) ?? intense.get(b)} · ${joy.get(i) ?? intense.get(i)}`);
    }
  };
  try {
    run();
  } finally {
    mockWatch.current = null;
  }
  return { pairs, seen, jointPairs: [...joint].sort() };
}

const DEFAULTS = new Map<string, Meetings>();
const defaultMeetings = (id: DirectionId, face: Face): Meetings => {
  const k = `${id} ${face}`;
  let m = DEFAULTS.get(k);
  if (!m) {
    m = meetingsOf(id, face, () => edgeFamiliesFor(id, face));
    DEFAULTS.set(k, m);
  }
  return m;
};

describe.each(CASES)('UI-243: no edge pairs the joy anchor with the intense anchor: %s, %s face', (id, face) => {
  it('the hazard is real: the joy–intense edge enters both bands, in sRGB as Skia blends it and on the OKLab line', () => {
    const tier = tierFor(face);
    const [J, I] = [lab(BASE.emotion.joy[tier]), lab(BASE.emotion.intense[tier])];
    const limits = { design: DESIGN_BAND.chromaFloor - BASE.neverRed.margin, check: CHECK_BAND.chromaFloor - BASE.neverRed.margin };
    expect(maxInBandOnSrgbBlend(sweepOklabToSrgb(J), sweepOklabToSrgb(I), DESIGN_BAND).chroma).toBeGreaterThan(limits.design);
    expect(maxInBandOnSrgbBlend(sweepOklabToSrgb(J), sweepOklabToSrgb(I), CHECK_BAND).chroma).toBeGreaterThan(limits.check);
    expect([segmentTouchesRed(J, I, DESIGN_BAND), segmentTouchesRed(J, I, CHECK_BAND)]).toEqual([true, true]);
  });

  it('has its cases: the watch sees the checked pairs, and every joy and intense colour among them', () => {
    const m = defaultMeetings(id, face);
    expect(m.pairs).toBeGreaterThan(1000);
    const expected = [...anchorColours(id, face, 'joy').values(), ...anchorColours(id, face, 'intense').values()];
    expect(expected.length).toBeGreaterThanOrEqual(4);
    expect([...m.seen].sort()).toEqual([...new Set(expected)].sort());
  });

  it('no checked pair puts a joy colour against an intense one', () => {
    expect(defaultMeetings(id, face).jointPairs).toEqual([]);
  });

  it('bites: an intense ground planted under the CTA pairs it with the joy fill, and the pin names the pair', () => {
    const grounds = plateShadowGrounds(id, face);
    const intense = lab(BASE.emotion.intense[tierFor(face)]);
    const planted: Oklab = { L: intense.L, a: intense.a, b: intense.b };
    const m = meetingsOf(id, face, () => edgeFamiliesFor(id, face, 'coarse', { face: grounds.face, ground: { 'planted intense': planted } }, {}, {}));
    expect(m.jointPairs).toEqual(['joy at presence 1 · intense at presence 1']);
  });
});
