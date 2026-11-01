import { sweepNeverRed, type NeverRedSweep } from '../../color/blendSpace.ts';
import { oklabToSrgb, srgbToOklab, type Oklab } from '../../color/oklab.ts';
import { edgeMixOklab } from '../../field/fieldLaw.ts';
import {
  BAND_REFINE_STEP,
  BAND_SAMPLES,
  BAND_STEP,
  CHECK_BAND,
  bandGridSweepFor,
  bandSpecFor,
  certifyBand,
  distanceToRed,
  fieldSweepFor,
  halfStepReach,
  type GraphEdges,
} from '../neverRedSweeps.ts';
import { EXTENSIONS } from '../tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';

// Law round 2, D6-2 (the designer's ruling at UI-153): the band's 8-bit never-red grid. (1) α ∈ {0, 1} are the
// face and ring families; (2) α ∈ {0.25, 0.5, 0.75} on the full 8-bit grid (t, k, the shimmer's full range);
// (3) the fine pass, α every 0.02 on the default grid; (4) a margin certificate: for every cell of (2),
// m = the OKLab distance from the sampled colour to the red-exclusion band, and the cell passes only if
// m > S·Δα/2 + q8, S = |ring − face_f| (an α cell) or |outside − ring| (a β cell), Δα = 0.25, q8 the largest
// OKLab move of a half-step 8-bit rounding on the band's grounds, computed. A failing cell is re-swept locally
// at α every 0.02; the run reports how many were refined. The same for β (D6-1).
//
// (2) and (4) cost about half an hour locally per run, past the CI sweeps job's 15-minute budget, so they live
// in the scheduled evidence lane (scripts/field/bandEvidence.mts; its pin is scripts/field/__tests__/
// bandEvidence.test.ts). This file holds their pieces on small grids in the default run: what the full grid is,
// the distance, the rounding reach, S, q8, the cells it certifies and the cells it refines, each with a plant.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: Face[] = ['dark', 'light'];
const CASES = IDS.flatMap((id) => FACES.map((face) => [id, face] as const));
const GRAPH = EXTENSIONS.base['field.graph'] as unknown as { edges: GraphEdges };
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
const A = BASE.field.dither.amplitude + Math.max(DIRECTIONS.abyss.field.grain.ground, DIRECTIONS.abyss.field.grain.inside);
const lab = (c: { oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const dist = (x: Oklab, y: Oklab) => Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
/** The sides by hand: α from the face at ρ = 1 to the ring; β from the ring to the outside ground. */
const sidesOf = (id: DirectionId, face: Face, edge: 'alpha' | 'beta') => {
  const d = DIRECTIONS[id];
  const f = lab(d.color[face].plate.face);
  const faceEdge = { L: f.L * (1 + d.plate.face.vignette[face]), a: f.a, b: f.b };
  const ring = lab(d.color[face].plate.ring);
  return edge === 'alpha' ? { from: faceEdge, to: ring, label: 'face·ring α' } : { from: ring, to: lab(d.color[face].ground), label: 'ring·outside β' };
};
/** A small 8-bit grid, so a whole certificate runs in seconds here. */
const SMALL: NeverRedSweep['grid'] = { kStep: 0.25, shimmerStepDeg: 6, pixelTStep: 0.5, pixelKStep: 0.5, chromaScales: [1], pixelShimmerStepDeg: 6 };

describe('D6-2 (UI-153): the band grid, ruled', () => {
  it('the samples are 0.25, 0.5 and 0.75, the cell 0.25 wide, the refinement every 0.02', () => {
    expect([BAND_SAMPLES, BAND_STEP, BAND_REFINE_STEP]).toEqual([[0.25, 0.5, 0.75], 0.25, 0.02]);
  });

  it.each(CASES.flatMap(([id, face]) => (['alpha', 'beta'] as const).map((edge) => [id, face, edge] as const)))(
    '(2) %s, %s face, %s: the full 8-bit grid (never thinned) over the three samples, the law’s OKLab mixes, nothing else changed',
    (id, face, edge) => {
      const full = fieldSweepFor(id, face, GRAPH.edges, undefined, 'full');
      const cfg = bandGridSweepFor(id, face, GRAPH.edges, edge);
      const { from, to, label } = sidesOf(id, face, edge);
      expect(cfg.grid).toEqual({ kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.1, pixelKStep: 0.1, chromaScales: [0.25, 0.5, 1], pixelShimmerStepDeg: 1 });
      expect({ ...cfg, grounds: full.grounds }).toEqual(full);
      expect(cfg.grounds).toEqual(Object.fromEntries([0.25, 0.5, 0.75].map((s) => [`${label} ${s}`, edgeMixOklab(from, to, s)])));
      const spec = bandSpecFor(id, face, GRAPH.edges, edge);
      expect(spec.config).toEqual(cfg);
      expect([spec.from, spec.to, spec.label]).toEqual([from, to, label]);
    },
  );
});

// ------------------------------------------------------------------ the distance and the rounding reach

/** The red region's boundary, densely: the arc at the floor across the band, and both edge rays out to C 0.5. */
function boundary(floor: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const RAD = Math.PI / 180;
  const width = (CHECK_BAND.hueTo - CHECK_BAND.hueFrom + 360) % 360;
  for (let i = 0; i <= 6000; i++) {
    const h = (CHECK_BAND.hueFrom + (width * i) / 6000) * RAD;
    pts.push([floor * Math.cos(h), floor * Math.sin(h)]);
  }
  for (const hue of [CHECK_BAND.hueFrom, CHECK_BAND.hueTo]) for (let i = 0; i <= 6000; i++) pts.push([(floor + (0.5 * i) / 6000) * Math.cos(hue * RAD), (floor + (0.5 * i) / 6000) * Math.sin(hue * RAD)]);
  return pts;
}

describe('D6-2 (4): the certificate’s pieces', () => {
  it('distanceToRed is the ab distance to the check band’s red region at chroma floor − margin, 0 inside it (brute force over its boundary)', () => {
    const edge = boundary(CHECK_LIMIT);
    const brute = (a: number, b: number) => Math.min(...edge.map(([x, y]) => Math.hypot(a - x, b - y)));
    const RAD = Math.PI / 180;
    let outside = 0;
    for (let i = 0; i < 400; i++) {
      // Points on a spiral through every hue, at chroma 0 to 0.06: inside, beside and far from the region.
      const h = (i * 137.5) % 360;
      const C = (0.06 * ((i * 61) % 400)) / 400;
      const p: Oklab = { L: 0.3 + (i % 7) / 10, a: C * Math.cos(h * RAD), b: C * Math.sin(h * RAD) };
      const inRegion = C >= CHECK_LIMIT && ((h - CHECK_BAND.hueFrom + 360) % 360) <= ((CHECK_BAND.hueTo - CHECK_BAND.hueFrom + 360) % 360);
      const m = distanceToRed(p, CHECK_BAND, CHECK_LIMIT);
      if (inRegion) expect(m).toBe(0);
      else {
        outside++;
        expect(Math.abs(m - brute(p.a, p.b))).toBeLessThan(2e-5);
      }
    }
    expect(outside).toBeGreaterThan(200);
    // L never decides redness.
    expect(distanceToRed({ L: 0.1, a: 0.01, b: 0.002 }, CHECK_BAND, CHECK_LIMIT)).toBe(distanceToRed({ L: 0.9, a: 0.01, b: 0.002 }, CHECK_BAND, CHECK_LIMIT));
  });

  it('halfStepReach is the largest OKLab move over the ±½-step cube around the clamped 8-bit colour (oklab.ts by hand)', () => {
    const byHand = (c: Oklab) => {
      const rgb = oklabToSrgb(c).map((v) => Math.min(1, Math.max(0, v)));
      const base = srgbToOklab(rgb as unknown as [number, number, number]);
      let worst = 0;
      for (const dr of [-0.5, 0.5]) for (const dg of [-0.5, 0.5]) for (const db of [-0.5, 0.5]) {
        const p = [rgb[0] + dr / 255, rgb[1] + dg / 255, rgb[2] + db / 255].map((v) => Math.min(1, Math.max(0, v)));
        worst = Math.max(worst, dist(srgbToOklab(p as unknown as [number, number, number]), base));
      }
      return worst;
    };
    for (const c of [{ L: 0.123, a: -0.0125, b: -0.0217 }, { L: 0.5, a: 0.05, b: -0.02 }, { L: 0.97, a: -0.007, b: -0.004 }, { L: 1.01, a: 0, b: 0 }, { L: 0.02, a: 0, b: 0 }]) {
      expect(halfStepReach(c)).toBeCloseTo(byHand(c), 12);
    }
    // Rounding moves a dark colour further in OKLab than a mid one: the cube root near black.
    expect(halfStepReach({ L: 0.05, a: 0, b: 0 })).toBeGreaterThan(halfStepReach({ L: 0.6, a: 0, b: 0 }));
  });
});

// ------------------------------------------------------------------ the certificate, on a small grid

const smallSpec = (id: DirectionId, face: Face, edge: 'alpha' | 'beta', graph?: Partial<NeverRedSweep['graph']>) => {
  const spec = bandSpecFor(id, face, GRAPH.edges, edge);
  return { ...spec, config: { ...spec.config, grid: SMALL, graph: { ...spec.config.graph, ...graph } } };
};

describe.each(CASES.flatMap(([id, face]) => (['alpha', 'beta'] as const).map((edge) => [id, face, edge] as const)))('D6-2 (4): the certificate, %s, %s face, %s', (id, face, edge) => {
  const spec = smallSpec(id, face, edge);
  const cert = certifyBand(spec);

  it('S is |to − from|, Δ 0.25, q8 computed on the band’s grounds at L − A, L and L + A, and the threshold S·Δ/2 + q8', () => {
    const { from, to } = sidesOf(id, face, edge);
    expect(cert.S).toBe(dist(to, from));
    const vs = [...Array.from({ length: 51 }, (_, i) => i / 50), 0.25, 0.5, 0.75];
    const q8 = Math.max(...vs.flatMap((v) => [-A, 0, A].map((dL) => {
      const g = edgeMixOklab(from, to, v);
      return halfStepReach({ L: g.L + dL, a: g.a, b: g.b });
    })));
    expect(cert.q8).toBe(q8);
    expect(cert.q8).toBeGreaterThan(0);
    expect(cert.threshold).toBe((cert.S * 0.25) / 2 + cert.q8);
  });

  it('it certifies exactly the 8-bit cells sweepNeverRed checks on the same grid', () => {
    expect(cert.cells).toBe(sweepNeverRed(spec.config).pixelSamples);
    expect(cert.cells).toBeGreaterThan(1000);
  });

  it('every cell it does not certify is refined at every 0.02 inside its own 0.25 cell, and none of those is red', () => {
    expect(cert.refined.cells).toBe(cert.failing + cert.outOfGamut);
    expect(cert.refined.values).toEqual({ 0.25: [0.14, 0.16, 0.18, 0.2, 0.22, 0.24, 0.26, 0.28, 0.3, 0.32, 0.34, 0.36], 0.5: [0.38, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 0.62], 0.75: [0.64, 0.66, 0.68, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84, 0.86] });
    expect(cert.refined.overLimit).toBe(0);
    expect(cert.refined.maxCheck).toBeLessThanOrEqual(CHECK_LIMIT);
    expect(cert.worst.m).toBeGreaterThan(0);
  });
});

describe('D6-2 (4): the certificate bites', () => {
  const RAD = Math.PI / 180;
  const node = (C: number): Oklab => ({ L: 0.6, a: C * Math.cos(20 * RAD), b: C * Math.sin(20 * RAD) });

  it('a planted node close to red: its cells fail the certificate and are refined; a red one is caught there, over the limit', () => {
    const near = certifyBand(smallSpec('abyss', 'dark', 'alpha', { nodes: { ...bandSpecFor('abyss', 'dark', GRAPH.edges, 'alpha').config.graph.nodes, X: node(0.017) }, straight: [...bandSpecFor('abyss', 'dark', GRAPH.edges, 'alpha').config.graph.straight, ['J', 'X']] }));
    const clean = certifyBand(smallSpec('abyss', 'dark', 'alpha'));
    expect(near.failing).toBeGreaterThan(clean.failing);
    expect(near.refined.cells).toBeGreaterThan(clean.refined.cells);
    expect(near.refined.overLimit).toBe(0);
    const red = certifyBand(smallSpec('abyss', 'dark', 'alpha', { nodes: { ...bandSpecFor('abyss', 'dark', GRAPH.edges, 'alpha').config.graph.nodes, X: node(0.04) }, straight: [...bandSpecFor('abyss', 'dark', GRAPH.edges, 'alpha').config.graph.straight, ['J', 'X']] }));
    expect(red.worst.m).toBe(0);
    expect(red.refined.overLimit).toBeGreaterThan(0);
    expect(red.refined.maxCheck).toBeGreaterThan(CHECK_LIMIT);
  });

  it('a colour whose dither leaves the sRGB gamut is never certified (the clamp is not an OKLab move): the light face’s near-white grounds', () => {
    const light = certifyBand(smallSpec('abyss', 'light', 'alpha'));
    expect(light.outOfGamut).toBeGreaterThan(0);
    expect(light.refined.cells).toBeGreaterThanOrEqual(light.outOfGamut);
  });

  it('without the refinement nothing is re-swept, and the counts stand', () => {
    const spec = smallSpec('abyss', 'dark', 'beta');
    const quick = certifyBand(spec, { refine: false });
    const full = certifyBand(spec);
    expect([quick.cells, quick.failing, quick.outOfGamut]).toEqual([full.cells, full.failing, full.outOfGamut]);
    expect(quick.refined.cells).toBe(0);
  });
});
