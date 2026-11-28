import { sweepNeverRed } from '../../color/blendSpace.ts';
import { CHECK_BAND, DESIGN_BAND, beadTwinFamiliesFor, fullEdgeReport, fullFieldReport, ringEdgeGrounds, ringEdgeSweepFor, ringOuterGrounds, ringOuterSweepFor, type GraphEdges } from '../neverRedSweeps.ts';
import { EXTENSIONS } from '../tokens.extensions.generated.ts';
import { BASE, type DirectionId, type Face } from '../tokens.generated.ts';

// UI-073: QA-065 at full resolution for one direction, in the sweeps project (jest.sweeps.config.js),
// which CI runs in its own gated job, one file per direction, two workers. The default run keeps the
// coarse grids (neverRed.field.test.ts and neverRed.edges.test.ts pin both grids). Inside the design
// band, the exact float pass plus about 0.004 of rounding bounds the check band; the blind spot is a
// colour just outside 345–55° with C ≳ 0.016 that rounding turns into 350–50°, and only a fine 8-bit
// grid sees it. Both bands keep DEC-081's margin.

const ID: DirectionId = 'abyss';
const GRAPH = EXTENSIONS.base['field.graph'] as unknown as { edges: GraphEdges };
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
// One face of the field at full resolution takes up to about two minutes.
const LONG = 15 * 60_000;

describe.each(['dark', 'light'] as Face[])(`QA-065 at full resolution: ${ID}, %s face`, (face) => {
  it(
    'the field: no blend-graph colour composited over a local ground is red, in float or on any 8-bit pixel, with the margin',
    () => {
      const { grid, report } = fullFieldReport(ID, face, GRAPH.edges);
      expect(grid.pixelShimmerStepDeg).toBe(1);
      expect(report.failures).toEqual([]);
      expect(report.pixelSamples).toBeGreaterThan(0);
      expect(report.maxDesign.chroma).toBeLessThanOrEqual(DESIGN_LIMIT);
      expect(report.maxCheck.chroma).toBeLessThanOrEqual(CHECK_LIMIT);
    },
    LONG,
  );

  // UI-114 (designer §4 (a)): the ring edge's mixed grounds every 0.02 of α. The float pass is the full
  // grid's; the 8-bit pass keeps the default grid (t and k 0.2, the shimmer's ends): on the full 8-bit grid
  // each of the 49 grounds costs about a minute (dark) or half a minute (light).
  it(
    'the ring edge: no blend-graph colour over the band’s grounds, every 0.02 of α, is red, in float or on 8-bit pixels, with the margin',
    () => {
      const config = ringEdgeSweepFor(ID, face, GRAPH.edges, undefined, 'full');
      expect(Object.keys(config.grounds)).toEqual(Object.keys(ringEdgeGrounds(ID, face, 'full')));
      expect(Object.keys(config.grounds)).toHaveLength(49);
      const report = sweepNeverRed(config);
      expect(report.failures).toEqual([]);
      expect(report.pixelSamples).toBeGreaterThan(0);
      expect(report.maxDesign.chroma).toBeLessThanOrEqual(DESIGN_LIMIT);
      expect(report.maxCheck.chroma).toBeLessThanOrEqual(CHECK_LIMIT);
    },
    LONG,
  );

  // D6-1 (d) (the designer's ruling at UI-151): the ring's outer edge's mixed grounds every 0.02 of β, the same pass
  // as the inner edge's: the float pass the full grid's, the 8-bit pass the default grid (D6-2 (3)).
  it(
    'the outer edge: no blend-graph colour over the outer band’s grounds, every 0.02 of β, is red, in float or on 8-bit pixels, with the margin',
    () => {
      const config = ringOuterSweepFor(ID, face, GRAPH.edges, undefined, 'full');
      expect(Object.keys(config.grounds)).toEqual(Object.keys(ringOuterGrounds(ID, face, 'full')));
      expect(Object.keys(config.grounds)).toHaveLength(49);
      const report = sweepNeverRed(config);
      expect(report.failures).toEqual([]);
      expect(report.pixelSamples).toBeGreaterThan(0);
      expect(report.maxDesign.chroma).toBeLessThanOrEqual(DESIGN_LIMIT);
      expect(report.maxCheck.chroma).toBeLessThanOrEqual(CHECK_LIMIT);
    },
    LONG,
  );

  // F1 (the designer's rulings of 2026-11-25): a bead is never translucent in colour. Its grey disc at every α over every
  // lit surface, and its colour disc at every fraction over its grey twin, on F1's full grid (neverRed.beadTwin.test.ts
  // runs the coarse one by default); the planted pre-F1 bead must fail here too, and the plant only adds its family.
  it(
    'the bead’s grey twin (F1): the grey disc and the colour disc over its twin stay out of both bands; the plant fails; the full grid really ran',
    () => {
      const full = beadTwinFamiliesFor(ID, face, 'full', { plant: true });
      const coarse = beadTwinFamiliesFor(ID, face, 'coarse', { plant: true });
      expect(coarse.slice(0, 3)).toEqual(beadTwinFamiliesFor(ID, face, 'coarse'));
      const planted = (f: { family: string }) => f.family.includes('(planted');
      expect(full.map((f) => f.family)).toEqual(coarse.map((f) => f.family));
      for (const [i, f] of full.entries()) expect([f.family, f.pixelBlends > coarse[i].pixelBlends]).toEqual([f.family, true]);
      const over = full
        .filter((f) => !planted(f) && (f.design.chroma > DESIGN_LIMIT || f.check.chroma > CHECK_LIMIT))
        .map((f) => `${f.family}: design C ${f.design.chroma.toFixed(5)}, check C ${f.check.chroma.toFixed(5)}`);
      expect(over).toEqual([]);
      const plant = full.find(planted)!;
      expect(plant.design.chroma).toBeGreaterThan(DESIGN_LIMIT);
      expect(plant.check.chroma).toBeGreaterThan(CHECK_LIMIT);
    },
    LONG,
  );

  it(
    'the edges: no anti-aliased pair reaches within the margin of either band, and the full grid really ran',
    () => {
      const { families, litFamilies, notFiner } = fullEdgeReport(ID, face);
      expect(litFamilies).toBeGreaterThan(0);
      expect(notFiner).toEqual([]);
      const over = families
        .filter((f) => f.design.chroma > DESIGN_LIMIT || f.check.chroma > CHECK_LIMIT)
        .map((f) => ({
          family: f.family,
          design: `C ${f.design.chroma.toFixed(5)} at ${f.design.hue.toFixed(1)}°`,
          check: `C ${f.check.chroma.toFixed(5)} at ${f.check.hue.toFixed(1)}°`,
        }));
      expect(over).toEqual([]);
    },
    LONG,
  );
});
