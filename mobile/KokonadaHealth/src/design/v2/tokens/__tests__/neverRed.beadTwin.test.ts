import { maxInBandOnPixelBlend } from '../../color/edgeSweep.ts';
import { mixOklab } from '../../color/oklab.ts';
import { encodeSrgb8 } from '../../field/fieldLaw.ts';
import { BEAD_TWIN_GRIDS, CHECK_BAND, DESIGN_BAND, beadTwinFamiliesFor, beadTwinInks, greyOverPixelsMax, lab, tierFor } from '../neverRedSweeps.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';

// F1 (P0, the designer's rulings of 2026-11-25): a bead is never translucent in colour over the field. Below opacity 1 it
// shows only its grey disc, its achromatic twin (the fill at its own OKLab L with chroma 0, and the highlight drawn from
// it); the colour disc over it fades only while the bead is opaque. So the colours a bead can show over the field are:
//   (a) the grey disc, every grey from its darkest fill to its lightest highlight, at every opacity α, over every
//       surface the bead can sit on: the face lit by the halos and the field, and the ring and its bands lit by the halos;
//   (b) the colour disc at every fraction over its grey twin (the opaque grey disc), at every step of the highlight.
// Both faces, float against the design band and 8-bit against the check band, with DEC-081's margin. The 8-bit grey pass
// is exact over every grey byte and coverage (a superset of every rounding). The planted pre-F1 bead, its coloured fill
// at α over the face lit by another family, must fail: the sweep bites. The full grid runs in the sweeps project
// (neverRed.full.abyss.sweeps.test.ts); this file is the default run's coarse grid.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const CASES = IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const));
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
const GREY = ['face lit · bead grey disc at α', 'ring halo · bead grey disc at α'];
const TWIN = 'bead colour disc · grey twin';
const PLANTED = 'face lit · bead colour fill at α (planted: the pre-F1 bead)';
const over = (f: { design: { chroma: number }; check: { chroma: number } }) => f.design.chroma > DESIGN_LIMIT || f.check.chroma > CHECK_LIMIT;
// One planted run per case: the plant only appends its family (the sweeps project checks the unplanted run is the same).
const cached = new Map<string, ReturnType<typeof beadTwinFamiliesFor>>();
const planted = (id: DirectionId, face: Face) => {
  const key = `${id} ${face}`;
  if (!cached.has(key)) cached.set(key, beadTwinFamiliesFor(id, face, 'coarse', { plant: true }));
  return cached.get(key)!;
};
const families = (id: DirectionId, face: Face) => planted(id, face).filter((f) => f.family !== PLANTED);

describe('F1’s sweep grids', () => {
  it('pinned: coarse by default, full in the sweeps project', () => {
    expect(BEAD_TWIN_GRIDS).toEqual({
      coarse: { floatKStep: 0.05, byteKStep: 0.1, presenceShares: [1], shimmerStepDeg: null, bandSteps: 4, floatGreys: 4, ramps: [0, 0.5, 1], gradientSteps: 4 },
      full: { floatKStep: 0.01, byteKStep: 0.1, presenceShares: [0.25, 0.5, 1], shimmerStepDeg: null, bandSteps: 10, floatGreys: 8, ramps: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], gradientSteps: 10 },
    });
  });
});

describe.each(CASES)('F1’s inks: %s, %s face', (id, face) => {
  it('the fills are DSN-017’s over the grid’s ramps, each quadrant’s anchor at the face’s tier, with the highlight mixed toward white', () => {
    const d = DIRECTIONS[id];
    const neutral = lab(d.color[face].bead.neutral);
    const { fills } = beadTwinInks(id, face, 'full');
    expect(fills).toHaveLength(4 * BEAD_TWIN_GRIDS.full.ramps.length);
    for (const { quadrant, p, fill, highlight } of fills) {
      const anchor = lab(BASE.emotion[quadrant][tierFor(face)]);
      expect(fill.L).toBeCloseTo(neutral.L + (anchor.L - neutral.L) * p, 12);
      expect(fill.a).toBeCloseTo(anchor.a * p * d.bead.chromaScale, 12);
      expect(fill.b).toBeCloseTo(anchor.b * p * d.bead.chromaScale, 12);
      expect(highlight).toEqual(mixOklab(fill, { L: 1, a: 0, b: 0 }, d.bead.highlight.mix));
    }
  });

  it('the greys run from the darkest fill’s twin to the lightest highlight’s, and every 8-bit grey between', () => {
    const d = DIRECTIONS[id];
    const Ls = [d.color[face].bead.neutral.oklab[0], ...(['joy', 'calm', 'reflective', 'intense'] as const).map((q) => BASE.emotion[q][tierFor(face)].oklab[0])];
    const top = Math.max(...Ls);
    const { greyL, greyBytes } = beadTwinInks(id, face);
    expect(greyL[0]).toBe(Math.min(...Ls));
    expect(greyL[1]).toBeCloseTo(top + d.bead.highlight.mix * (1 - top), 12);
    expect(greyBytes).toEqual([encodeSrgb8({ L: greyL[0], a: 0, b: 0 })[1], encodeSrgb8({ L: greyL[1], a: 0, b: 0 })[1]]);
  });
});

describe('the 8-bit grey pass is exact over every grey byte and coverage', () => {
  const greys = (bg: readonly [number, number, number], v0: number, v1: number) => {
    let best = 0;
    for (let v = v0; v <= v1; v++) best = Math.max(best, maxInBandOnPixelBlend(bg, [v, v, v], CHECK_BAND, 254).chroma);
    return best;
  };

  // The last two peak away from the darkest grey (inside the range, and at its lightest): a pass that read only one end
  // of the greys would fall short of brute force there.
  it.each([
    ['a joy-lit face', [182, 150, 96], 140, 200],
    ['an intense-lit face', [120, 84, 128], 140, 200],
    ['the dark ground', [3, 12, 21], 140, 200],
    ['a calm-lit ring', [60, 140, 120], 140, 200],
    ['a joy-lit face, every grey (peaks inside the range)', [182, 150, 96], 40, 240],
    ['a dark mauve, every grey (peaks at the lightest)', [60, 30, 40], 40, 240],
  ] as const)('never below brute force (every grey, every coverage, every rounding) over %s', (_label, bg, v0, v1) => {
    const exact = greyOverPixelsMax(bg, v0, v1);
    expect(exact.chroma).toBeGreaterThanOrEqual(greys(bg, v0, v1) - 1e-12);
  });

  it('bites: over a planted red ground a grey at low coverage is red, and the pass says so', () => {
    const red: readonly [number, number, number] = [200, 70, 60];
    expect(greys(red, 150, 160)).toBeGreaterThan(CHECK_LIMIT);
    expect(greyOverPixelsMax(red, 150, 160).chroma).toBeGreaterThan(CHECK_LIMIT);
  });

  it('a grey over a grey is never red', () => {
    expect(greyOverPixelsMax([128, 128, 128], 100, 200).chroma).toBeLessThan(0.006);
  });
});

describe.each(CASES)('F1: %s, %s face', (id, face) => {
  it('sweeps the grey disc over the face-lit and ring-halo surfaces, and the colour disc over its twin', () => {
    const found = families(id, face);
    expect(found.map((f) => f.family)).toEqual([...GREY, TWIN]);
    for (const f of found) expect([f.family, f.pixelBlends > 0]).toEqual([f.family, true]);
  });

  it('the grey disc at every α over every lit surface stays out of both bands, with the margin', () => {
    const fails = families(id, face).filter((f) => GREY.includes(f.family) && over(f));
    expect(fails.map((f) => `${f.family}: design C ${f.design.chroma.toFixed(5)}, check C ${f.check.chroma.toFixed(5)}`)).toEqual([]);
  });

  it('the colour disc at every fraction over its grey twin stays out of both bands, with the margin', () => {
    const fails = families(id, face).filter((f) => f.family === TWIN && over(f));
    expect(fails.map((f) => `${f.family}: design C ${f.design.chroma.toFixed(5)}, check C ${f.check.chroma.toFixed(5)}`)).toEqual([]);
  });

  it('bites: the pre-F1 bead, its coloured fill at α over the face lit by another family, breaks both bands', () => {
    const found = planted(id, face);
    expect(found.map((f) => f.family)).toEqual([...GREY, TWIN, PLANTED]);
    const plant = found.find((f) => f.family === PLANTED)!;
    expect(plant.design.chroma).toBeGreaterThan(DESIGN_LIMIT);
    expect(plant.check.chroma).toBeGreaterThan(CHECK_LIMIT);
    expect(plant.design.coverage).toBeGreaterThan(0);
    expect(plant.design.coverage).toBeLessThan(1);
  });
});
