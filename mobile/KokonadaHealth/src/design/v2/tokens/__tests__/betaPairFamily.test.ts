import { BETA_PAIR_GRIDS, betaPairFamilyFor, betaPairGrounds, fieldSweepFor, ringEdgeGrounds, ringOuterGrounds, type GraphEdges } from '../neverRedSweeps.ts';
import { EXTENSIONS } from '../tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';

// UI-165 (the designer, D6 round 2): the β pair family (iv) of criterion G (D5b), with the band's mixed grounds,
// α and β, among its backgrounds (D6-3 (ii)), runs on a small grid in the default jest run, with a planted red that
// must fail; the same family runs on the full grid in the evidence lane (scripts/field/bandEvidence.mts), under the
// UI-160 stamp. Per node, the segment between its presence-ramp extremes × stress × shimmer × the mark weight w,
// used as an endpoint of every straight edge and both legs of every waypoint edge, faded by β toward the achromatic
// N̄ with N̄.L at the node set's L extremes, over every ground: float exactly (convex hulls) against the design band,
// and 8-bit sampled (every pixel the dither and grain reach) against the check band.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: Face[] = ['dark', 'light'];
const CASES = IDS.flatMap((id) => FACES.map((face) => [id, face] as const));
const GRAPH = (EXTENSIONS.base['field.graph'] as unknown as { edges: GraphEdges }).edges;

describe('UI-165: the β pair family’s grids', () => {
  it('full: criterion G’s own grid, as the designer read it (p 0.5/1, stress 0/1, shimmer −/0/+, w 0/1; t quarters; seven fades; k 0.1/0.3/0.5/kMax; arcs every 0.25°; the band every 0.1)', () => {
    expect(BETA_PAIR_GRIDS.full).toEqual({
      presences: [0.5, 1],
      stresses: [0, 1],
      turns: [-1, 0, 1],
      marks: [0, 1],
      ts: [0, 0.25, 0.5, 0.75, 1],
      fades: [{ beta: 1 }, { beta: 0.6, at: 'min' }, { beta: 0.6, at: 'max' }, { beta: 0.3, at: 'min' }, { beta: 0.3, at: 'max' }, { beta: 0, at: 'min' }, { beta: 0, at: 'max' }],
      ks: [0.1, 0.3, 0.5],
      arcStepDeg: 0.25,
      bandSteps: 10,
    });
  });

  it('coarse: a subset of the full grid on every axis but the arc step, the band still on both sides', () => {
    const { coarse, full } = BETA_PAIR_GRIDS;
    for (const axis of ['presences', 'stresses', 'turns', 'marks', 'ts', 'ks'] as const) for (const v of coarse[axis]) expect(full[axis]).toContain(v);
    for (const f of coarse.fades) expect(full.fades).toContainEqual(f);
    expect(coarse.bandSteps).toBeGreaterThanOrEqual(2);
  });
});

describe.each(CASES)('UI-165: the β pair family, %s, %s face', (id, face) => {
  it('its backgrounds, on the full grid: the field sweep’s grounds and the band’s mixed grounds α and β, every 0.1 (the probe’s, by name and value)', () => {
    expect(betaPairGrounds(id, face, GRAPH, BETA_PAIR_GRIDS.full)).toEqual({ ...fieldSweepFor(id, face, GRAPH).grounds, ...ringEdgeGrounds(id, face), ...ringOuterGrounds(id, face) });
  });

  it('coarse grid, the shipped graph: 0 failures, float and 8-bit, over grounds that hold the band’s α and β mixes', () => {
    const report = betaPairFamilyFor(id, face, GRAPH, 'coarse');
    const names = Object.keys(report.grounds);
    expect(names.filter((n) => n.startsWith('face·ring α')).length).toBe(BETA_PAIR_GRIDS.coarse.bandSteps - 1);
    expect(names.filter((n) => n.startsWith('ring·outside β')).length).toBe(BETA_PAIR_GRIDS.coarse.bandSteps - 1);
    expect(report.pixel.composites).toBeGreaterThan(10000);
    expect(report.float.failures).toEqual([]);
    expect(report.pixel.failures).toBe(0);
    expect(report.pixel.worst.chroma).toBeLessThan(report.limits.check);
  });

  it('coarse grid, a planted red node X (hue 20°, chroma 0.12, L 0.6) on a straight edge with J: both passes fail, on J–X', () => {
    const report = betaPairFamilyFor(id, face, GRAPH, 'coarse', { plant: true });
    expect(report.float.failures.length).toBeGreaterThan(0);
    expect(report.float.failures.every((f) => f.startsWith('J-X'))).toBe(true);
    expect(report.pixel.failures).toBeGreaterThan(0);
    expect(report.pixel.worst.where.startsWith('J-X')).toBe(true);
  });
});
