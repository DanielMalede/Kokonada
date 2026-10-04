import { CHECK_BAND, DESIGN_BAND, EDGE_SWEEP_GRIDS, coverageRange, edgeFamiliesFor, edgeSweepInputs } from '../neverRedSweeps.ts';
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
// The default run uses the coarse grid; the sweeps project runs the full one (UI-073).
describe('QA-065 anti-aliased pairs: the resolutions the sweep runs at', () => {
  it('two grids: by default k 0.1 on 8-bit pixels, shimmer at its ends and the nearest pixels; in full k 0.01, shimmer at 1° and every pixel the dither reaches', () => {
    expect(EDGE_SWEEP_GRIDS).toEqual({
      coarse: { floatKStep: 0.01, byteKStep: 0.1, presenceShares: [0.25, 0.5, 1], shimmerStepDeg: null, byteBackground: 'nearest', ctaMixSteps: 20 },
      full: { floatKStep: 0.01, byteKStep: 0.01, presenceShares: [0.25, 0.5, 1], shimmerStepDeg: 1, byteBackground: 'dithered', ctaMixSteps: 20 },
    });
  });

  const expectedFor = (id: DirectionId) => {
    const d = DIRECTIONS[id];
    const deg = d.field.shimmer.deg;
    const amplitude = BASE.field.dither.amplitude + Math.max(d.field.grain.ground, d.field.grain.inside);
    return { d, deg, amplitude, presences: [0.25, 0.5, 1].map((p) => p * d.bead.chromaScale) };
  };

  it.each(IDS)('%s, by default: presences, the shimmer ends and the grain shifts', (id) => {
    const { deg, amplitude, presences } = expectedFor(id);
    expect(edgeSweepInputs(id)).toEqual({
      floatKStep: 0.01,
      byteKStep: 0.1,
      presences,
      shimmers: deg > 0 ? [-deg, 0, deg] : [0],
      lShifts: [-amplitude, 0, amplitude],
      byteLShifts: [-amplitude, 0, amplitude],
      byteDitherAmplitude: 0,
      ctaMixSteps: 20,
    });
  });

  it.each(IDS)('%s, at full resolution: shimmer every 1°, byte k 0.01, and each 8-bit background dithered over ±A', (id) => {
    const { deg, amplitude, presences } = expectedFor(id);
    expect(edgeSweepInputs(id, 'full')).toEqual({
      floatKStep: 0.01,
      byteKStep: 0.01,
      presences,
      shimmers: deg > 0 ? Array.from({ length: 2 * deg + 1 }, (_, i) => i - deg) : [0],
      lShifts: [-amplitude, 0, amplitude],
      byteLShifts: [0],
      byteDitherAmplitude: amplitude,
      ctaMixSteps: 20,
    });
  });

  it('every coverage an ink can take: [0, α] in float, 1 to ⌈α·255⌉ (at most 254) on 8-bit pixels', () => {
    expect(coverageRange(1)).toEqual({ float: [0, 1], bytes: [1, 254] });
    expect(coverageRange(0.5)).toEqual({ float: [0, 0.5], bytes: [1, 128] });
    expect(coverageRange(0.001)).toEqual({ float: [0, 0.001], bytes: [1, 1] });
  });

  // The float sweep takes a coverage in (0, 1] only; the range refuses the rest rather than invent
  // a pixel range for an ink that is never drawn.
  it.each([0, -0.1, 1.01, NaN])('refuses the coverage %p', (coverage) => {
    expect(() => coverageRange(coverage)).toThrow(RangeError);
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
