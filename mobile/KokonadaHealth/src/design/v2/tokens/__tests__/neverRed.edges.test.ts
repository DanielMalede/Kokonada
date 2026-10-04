import { CHECK_BAND, DESIGN_BAND, EDGE_SWEEP_GRID, coverageRange, edgeFamiliesFor, edgeSweepInputs } from '../neverRedSweeps.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';

// QA-065's anti-aliased term (addendum §2.4, resilience HIGH-1, designer rulings §1, second voice
// §2): every pair of colours that meet at an edge, a stroke, a shadow tail or a gradient, blended in
// sRGB as Skia draws them. Exact in float against the design band; every GPU rounding on 8-bit
// pixels against the check band; both keep DEC-081's margin. Its own file, so jest runs it beside
// the field sweep.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const CASES = IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const));
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;

// The sweep's resolutions, pinned: a coarser k step, fewer presences, a dropped shimmer end, a
// missing grain shift or a narrower coverage range would leave the block below green while it
// checked less (resilience round 2, FIX-3). A deliberate change edits these numbers in review.
describe('QA-065 anti-aliased pairs: the resolutions the sweep runs at', () => {
  it('k at 0.01 in float and 0.1 on 8-bit pixels, presences at ¼, ½ and full bead chroma, nearest pixels only, CTA mixes 1/20 apart', () => {
    expect(EDGE_SWEEP_GRID).toEqual({
      floatKStep: 0.01,
      byteKStep: 0.1,
      presenceShares: [0.25, 0.5, 1],
      byteDitherAmplitude: 0,
      ctaMixSteps: 20,
    });
  });

  it.each(IDS)('%s: presences, the shimmer set and the grain shifts', (id) => {
    const d = DIRECTIONS[id];
    const inputs = edgeSweepInputs(id);
    const deg = d.field.shimmer.deg;
    const amplitude = BASE.field.dither.amplitude + Math.max(d.field.grain.ground, d.field.grain.inside);
    expect(inputs).toEqual({
      floatKStep: 0.01,
      byteKStep: 0.1,
      presences: [0.25, 0.5, 1].map((p) => p * d.bead.chromaScale),
      shimmers: deg > 0 ? [-deg, 0, deg] : [0],
      lShifts: [-amplitude, 0, amplitude],
      byteDitherAmplitude: 0,
      ctaMixSteps: 20,
    });
  });

  it('every coverage an ink can take: [0, α] in float, 1 to ⌈α·255⌉ (at most 254) on 8-bit pixels', () => {
    expect(coverageRange(1)).toEqual({ float: [0, 1], bytes: [1, 254] });
    expect(coverageRange(0.5)).toEqual({ float: [0, 0.5], bytes: [1, 128] });
    expect(coverageRange(0.001)).toEqual({ float: [0, 0.001], bytes: [1, 1] });
  });
});

describe.each(CASES)('QA-065 anti-aliased pairs: %s, %s face', (id, face) => {
  it('no edge family reaches within the margin of either band', () => {
    const over = edgeFamiliesFor(id, face)
      .filter((f) => f.design.chroma > DESIGN_LIMIT || f.check.chroma > CHECK_LIMIT)
      .map((f) => ({
        family: f.family,
        design: `C ${f.design.chroma.toFixed(5)} at ${f.design.hue.toFixed(1)}°`,
        check: `C ${f.check.chroma.toFixed(5)} at ${f.check.hue.toFixed(1)}°`,
      }));
    expect(over).toEqual([]);
  });

  // The families the designer and resilience asked for, all present, so none can drop out quietly.
  it('sweeps every edge family this direction draws', () => {
    const families = edgeFamiliesFor(id, face).map((f) => f.family);
    expect(families).toEqual(
      expect.arrayContaining([
        'ring halo · text.primary',
        'ring halo · plate.rim.base',
        'ring halo · plate.rim.lit',
        'ring halo · plate.ringHighlight',
        'ring halo · bead.setting',
        'ring halo · bead.shadow at α',
        'face lit · bead.setting',
        'face lit · bead.shadow at α',
        'bead fill · bead.setting',
        'bead fill · highlight',
        'CTA fill · text.onTint',
        'CTA fill · text.onInk',
        ...(DIRECTIONS[id].cta.keyline > 0 ? ['CTA fill · keyline', 'CTA keyline · ground'] : ['CTA fill · ground']),
      ]),
    );
  });
});
