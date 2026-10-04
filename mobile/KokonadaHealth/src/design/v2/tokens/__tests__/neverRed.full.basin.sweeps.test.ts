import { CHECK_BAND, DESIGN_BAND, fullEdgeReport, fullFieldReport, type GraphEdges } from '../neverRedSweeps.ts';
import { EXTENSIONS } from '../tokens.extensions.generated.ts';
import { BASE, type DirectionId, type Face } from '../tokens.generated.ts';

// UI-073: QA-065 at full resolution for one direction, in the sweeps project (jest.sweeps.config.js),
// which CI runs in its own gated job, one file per direction, two workers. The default run keeps the
// coarse grids (neverRed.field.test.ts and neverRed.edges.test.ts pin both grids). Inside the design
// band, the exact float pass plus about 0.004 of rounding bounds the check band; the blind spot is a
// colour just outside 345–55° with C ≳ 0.016 that rounding turns into 350–50°, and only a fine 8-bit
// grid sees it. Both bands keep DEC-081's margin.

const ID: DirectionId = 'basin';
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
