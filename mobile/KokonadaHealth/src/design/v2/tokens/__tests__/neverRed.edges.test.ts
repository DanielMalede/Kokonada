import { CHECK_BAND, DESIGN_BAND, edgeFamiliesFor } from '../neverRedSweeps.ts';
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
