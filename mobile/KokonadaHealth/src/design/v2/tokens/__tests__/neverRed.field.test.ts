import { graphSegments, pivotComposite, sweepNeverRed, type NeverRedSweep } from '../../color/blendSpace.ts';
import { ditherReachable } from '../../color/redBand.ts';
import { buildFieldFrame, type FieldState } from '../../field/fieldFrame.ts';
import { groundAt, regionOf } from '../../field/fieldLaw.ts';
import { staticsFor } from '../../field/statics.ts';
import { CHECK_BAND, DESIGN_BAND, faceShadingGrounds, fieldSweepFor, type GraphEdges } from '../neverRedSweeps.ts';
import { EXTENSIONS } from '../tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';

// QA-065 over the signed blend graph (addendum §2.4): every reachable segment, every local ground
// the field or a halo lands on, k up to max(cap, halo peak), the pivot, the shimmer turning each
// end of a segment on its own, and the field's L dither and grain on 8-bit pixels. Each sweep keeps
// DEC-081's margin below both floors. Its own file, so jest runs it beside the edge sweep.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const CASES = IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const));
const GRAPH = EXTENSIONS.base['field.graph'] as unknown as { edges: GraphEdges };
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;

const sweepFor = (id: DirectionId, face: Face, edges?: { straight: Array<[string, string]>; waypoint: Array<[string, string]> }): NeverRedSweep =>
  fieldSweepFor(id, face, GRAPH.edges, edges);

// The plate's shadows (designer ruling 2.9, with the critic's text the designer adopted): they multiply
// the local ground's L before the composite, G.L ← G.L·(1 − Σ strength·P), over the face's plate.shadow
// and plate.shadow2. Outer shadows (plate.depth > 0) land outside the rim, where the field lands only
// if mask.outside > 0; inner ones (< 0) on the face. A shadow with no strength or no blur draws nothing
// (fieldFrame.ts). The sweep samples each shadowed ground at P ∈ {0, 0.5, 1}, because quantisation near
// black is not monotone in L; P = 0 is the ground itself.
function shadowsOf(id: DirectionId, face: Face): { under: 'face' | 'ground' | null; sum: number } {
  const d = DIRECTIONS[id];
  const drawn = [d.plate.shadow[face], d.plate.shadow2[face]].filter((t) => t.strength !== 0 && t.blur > 0);
  const under = d.plate.depth < 0 ? 'face' : d.plate.depth > 0 && d.field.mask.outside > 0 ? 'ground' : null;
  return drawn.length === 0 ? { under: null, sum: 0 } : { under, sum: drawn.reduce((t, x) => t + x.strength, 0) };
}

// The close-out (Abyss only): no shipped direction draws a plate shadow, so no shadowed ground is
// swept here; the sampler's shadowed grounds are held on the fixture directions (fixturePaths.test.ts).
it('no shipped direction draws a shadow under the field, so no shadowed ground is swept', () => {
  expect(CASES.filter(([id, face]) => shadowsOf(id, face).under !== null)).toEqual([]);
});

// Tripwire (UI-096). The sweep samples a shadowed ground at P 0.5 and 1 only, which misses failures at
// intermediate P (the QA-065 probe found them between 0.125 and 0.6875). Before any direction draws a
// plate shadow, the certified P-sampler (law round 2, D8) has to replace it.
it('tripwire (UI-096): every shipped plate-shadow strength is 0 until the certified P-sampler exists', () => {
  const drawn = CASES.flatMap(([id, face]) =>
    [DIRECTIONS[id].plate.shadow[face], DIRECTIONS[id].plate.shadow2[face]].filter((t) => t.strength !== 0).map((t) => `${id} ${face} (strength ${t.strength})`),
  );
  if (drawn.length > 0) {
    throw new Error(`UI-096: ${drawn.join(', ')} draws a plate shadow, but the never-red sweep samples a shadowed ground at P 0.5 and 1 only. Build the certified P-sampler (law round 2, D8) first.`);
  }
  expect(drawn).toEqual([]);
});

// HIGH-3 (resilience, law round 2): the law draws the face ground at L·(1 + vignette·ρ²) +
// centreLift·(1 − ρ²), ρ = d / ringInner, on L only (fieldLaw.ts groundAt), so the sweeps take the
// shaded face, not only the flat plate.face token. faceShadingGrounds samples ρ² evenly, ends included,
// at an L step no larger than the sweep's L amplitude A (dither plus grain). Every 8-bit pass that
// dithers over L ± A then sees every pixel any ρ² can show; the float passes step L by A, as the grain
// shifts do. The edge sweep's face-lit families take the same grounds (neverRed.edges.test.ts).
describe('HIGH-3: the face’s vignette and centre lift are swept', () => {
  const amplitude = (id: DirectionId) => BASE.field.dither.amplitude + Math.max(DIRECTIONS[id].field.grain.ground, DIRECTIONS[id].field.grain.inside);
  const plainFace = (id: DirectionId, face: Face) => {
    const [L, a, b] = DIRECTIONS[id].color[face].plate.face.oklab;
    return { L, a, b };
  };
  const rho2Of = (key: string) => Number(key.replace(/^face ρ² /, ''));
  // The face ground at every sample, the plain face included, by L.
  const faceLs = (id: DirectionId, face: Face) => [plainFace(id, face).L, ...Object.values(faceShadingGrounds(id, face)).map((g) => g.L)].sort((x, y) => x - y);
  const hull = (id: DirectionId, face: Face) => {
    const Ls = faceLs(id, face);
    return [Ls[0], Ls[Ls.length - 1]];
  };

  // Law round 2, item 6 (designer §6): the rest vignette deepens to −0.18, L 0.123 at the face's edge.
  it('Abyss: vignette −0.18 on the dark face and none on the light; lift 0.03 on the light face and none on the dark', () => {
    expect(DIRECTIONS.abyss.plate.face).toEqual({ vignette: { dark: -0.18, light: 0 }, centreLift: { dark: 0, light: 0.03 } });
    const dark = plainFace('abyss', 'dark').L;
    const light = plainFace('abyss', 'light').L;
    const [darkMin, darkMax] = hull('abyss', 'dark');
    const [lightMin, lightMax] = hull('abyss', 'light');
    expect([darkMin / dark, darkMax]).toEqual([expect.closeTo(0.82, 12), dark]);
    expect(darkMin).toBeCloseTo(0.123, 12);
    expect([lightMin, lightMax - light]).toEqual([light, expect.closeTo(0.03, 12)]);
  });

  it('Abyss: the samples are ρ² ½ and 1 on the dark face and 0 and ½ on the light; the other end is the plain face', () => {
    expect(Object.keys(faceShadingGrounds('abyss', 'dark')).sort()).toEqual(['face ρ² 0.5', 'face ρ² 1']);
    expect(Object.keys(faceShadingGrounds('abyss', 'light')).sort()).toEqual(['face ρ² 0', 'face ρ² 0.5']);
  });

  it.each(CASES)('%s, %s face: ρ² in [0, 1] with both ends taken, each sample the law’s ground on L only, at an L step of at most A', (id, face) => {
    const d = DIRECTIONS[id];
    const g = plainFace(id, face);
    const law = (rho2: number) => g.L * (1 + d.plate.face.vignette[face] * rho2) + d.plate.face.centreLift[face] * (1 - rho2);
    const samples = faceShadingGrounds(id, face);
    for (const [key, ground] of Object.entries(samples)) {
      const rho2 = rho2Of(key);
      expect(rho2).toBeGreaterThanOrEqual(0);
      expect(rho2).toBeLessThanOrEqual(1);
      expect(ground).toEqual({ L: law(rho2), a: g.a, b: g.b });
    }
    // Both ends of the face are swept: as a sample, or as the plain face itself.
    for (const end of [0, 1]) expect(Object.keys(samples).map(rho2Of).includes(end) || law(end) === g.L).toBe(true);
    const Ls = faceLs(id, face);
    for (let i = 1; i < Ls.length; i++) expect(Ls[i] - Ls[i - 1]).toBeLessThanOrEqual(amplitude(id) + 1e-12);
  });

  // Reach (law, not tokens): the law's face ground over every face pixel, at the smallest and largest
  // plate and font scales 1 and 2, lies inside the swept range and reaches both of its ends.
  const GEOMETRIES = [BASE.plate.minDiameter, BASE.plate.maxDiameter].flatMap((diameter) => [1, 2].map((fontScale) => ({ diameter, fontScale })));
  it.each(CASES.flatMap(([id, face]) => GEOMETRIES.map((g) => [id, face, g.diameter, g.fontScale] as const)))('%s, %s face, plate %s dp, font scale %s: the law’s face ground, scanned at 1 px, stays in the swept range and reaches both ends', (id, face, diameter, fontScale) => {
    const radiusPx = diameter / 2;
    const state: FieldState = { direction: id, face, placements: [], restFade: 1, stress: 0, confidence: 1, genesis: false, tMs: 7000, breathPhase: 0.3, tier: 'full' };
    const frame = buildFieldFrame(state, { centrePx: [radiusPx, radiusPx], radiusPx, pxPerDp: 1, fontScale }, staticsFor(id, EXTENSIONS as never));
    const scanned: number[] = [];
    for (let px = 0; px / radiusPx < frame.ringInner; px++) {
      expect(regionOf(px / radiusPx, frame)).toBe('face');
      scanned.push(groundAt('face', px / radiusPx, frame).L);
    }
    const [lo, hi] = hull(id, face);
    expect(scanned.filter((L) => L < lo - 1e-9 || L > hi + 1e-9)).toEqual([]);
    expect(Math.min(...scanned) - lo).toBeLessThanOrEqual(0.005);
    expect(hi - Math.max(...scanned)).toBeLessThanOrEqual(0.005);
  });

  // The samples are enough: for every node of the graph composited over the face at k 0, ½ and the cap,
  // the pixels the dither reaches from the samples are exactly the pixels it reaches from a 1/256 ρ² grid.
  const pixelsOver = (id: DirectionId, face: Face, grounds: Array<{ L: number; a: number; b: number }>, amplitudeL: number) => {
    const cfg = sweepFor(id, face);
    const keys = new Set<string>();
    for (const node of Object.values(cfg.graph.nodes)) {
      for (const k of [0, 0.5, DIRECTIONS[id].field.cap[face]]) {
        for (const ground of grounds) {
          for (const p of ditherReachable(pivotComposite(node, ground, k, cfg.kp), amplitudeL)) keys.add(p.map((c) => Math.round(c * 255)).join(','));
        }
      }
    }
    return [...keys].sort();
  };
  const fineGrid = (id: DirectionId, face: Face) => {
    const d = DIRECTIONS[id];
    const g = plainFace(id, face);
    return Array.from({ length: 257 }, (_, i) => ({ L: g.L * (1 + d.plate.face.vignette[face] * (i / 256)) + d.plate.face.centreLift[face] * (1 - i / 256), a: g.a, b: g.b }));
  };
  const swept = (id: DirectionId, face: Face) => [plainFace(id, face), ...Object.values(faceShadingGrounds(id, face))];

  it.each(CASES)('%s, %s face: the samples, dithered over ±A, show every pixel a 1/256 ρ² grid shows', (id, face) => {
    expect(pixelsOver(id, face, swept(id, face), amplitude(id))).toEqual(pixelsOver(id, face, fineGrid(id, face), amplitude(id)));
  });

  it.each(CASES)('bites: %s, %s face, without the dither the same samples miss pixels the fine grid shows', (id, face) => {
    const fromSamples = pixelsOver(id, face, swept(id, face), 0);
    const fromGrid = pixelsOver(id, face, fineGrid(id, face), 0);
    expect(fromGrid.filter((p) => !fromSamples.includes(p)).length).toBeGreaterThan(0);
  });
});

describe.each(CASES)('QA-065 field segments (upsampling and Skia not yet covered): %s, %s face', (id, face) => {
  // The sweep's inputs, pinned: dropping a ground, a k bound, a segment or the grain from the
  // amplitude would otherwise leave this block green while it checked less.
  it('sweeps the grounds, k range, segments and dither amplitude this direction can show', () => {
    const cfg = sweepFor(id, face);
    const d = DIRECTIONS[id];
    const { under, sum } = shadowsOf(id, face);
    const shadowed = under === null ? [] : [`${under} shadowed 0.5`, `${under} shadowed 1`];
    const shading = Object.keys(faceShadingGrounds(id, face));
    expect(shading.length).toBeGreaterThan(0);
    expect(Object.keys(cfg.grounds).sort()).toEqual([...(d.field.mask.outside > 0 ? ['face', 'ground', 'ring'] : ['face', 'ring']), ...shadowed, ...shading].sort());
    for (const key of shading) expect(cfg.grounds[key]).toEqual(faceShadingGrounds(id, face)[key]);
    // Each shadowed ground is its ground with L·(1 − Σ strength·P): L only, so a neutral one stays neutral.
    if (under !== null) {
      for (const P of [0.5, 1]) {
        const g = cfg.grounds[under];
        expect(cfg.grounds[`${under} shadowed ${P}`]).toEqual({ L: g.L * (1 - sum * P), a: g.a, b: g.b });
      }
    }
    expect(cfg.kMax).toBe(Math.max(d.field.cap[face], face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight));
    expect(graphSegments(cfg.graph)).toHaveLength(d.field.graph.restIntenseRoute === 'waypoint' ? 17 : 16);
    expect(cfg.ditherAmplitude).toBe(BASE.field.dither.amplitude + Math.max(d.field.grain.ground, d.field.grain.inside));
  });

  // The resolutions, pinned the same way (resilience round 2, FIX-3): a coarser grid, a lost shimmer
  // or pivot, or a swapped band would otherwise go in unseen. A deliberate change edits these here.
  it('sweeps at k 0.01 and shimmer 1° in float, t and k 0.2 and chroma scales ¼, ½ and 1 on 8-bit pixels, with the pivot, shimmer and bands', () => {
    const cfg = sweepFor(id, face);
    const d = DIRECTIONS[id];
    expect(cfg.grid).toEqual({ kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.2, pixelKStep: 0.2, chromaScales: [0.25, 0.5, 1] });
    expect(cfg.kp).toBe(d.field.pivot);
    expect(cfg.shimmerDeg).toBe(d.field.shimmer.deg);
    expect(cfg.designBand).toEqual(DESIGN_BAND);
    expect(cfg.checkBand).toEqual(CHECK_BAND);
  });

  // The sweeps project's grid (UI-073): only the 8-bit grid is finer; everything else is the same.
  it('at full resolution, t and k 0.1 and shimmer 1° on 8-bit pixels, and nothing else changes', () => {
    const coarse = sweepFor(id, face);
    const full = fieldSweepFor(id, face, GRAPH.edges, undefined, 'full');
    expect(full.grid).toEqual({ kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.1, pixelKStep: 0.1, chromaScales: [0.25, 0.5, 1], pixelShimmerStepDeg: 1 });
    expect({ ...full, grid: coarse.grid }).toEqual(coarse);
  });

  it('no blend-graph colour composited over a local ground is red, in float or on 8-bit pixels, with the margin', () => {
    const report = sweepNeverRed(sweepFor(id, face));
    expect(report.failures).toEqual([]);
    expect(report.pixelSamples).toBeGreaterThan(0);
    expect(report.maxDesign.chroma).toBeLessThanOrEqual(DESIGN_LIMIT);
    expect(report.maxCheck.chroma).toBeLessThanOrEqual(CHECK_LIMIT);
  });

  it('bites: the planted straight joy–intense edge fails', () => {
    const planted = sweepFor(id, face, { straight: [['J', 'I']], waypoint: [] });
    const report = sweepNeverRed({ ...planted, grid: { ...planted.grid, pixelTStep: 0.5, pixelKStep: 0.5 } });
    expect(report.failures.some((f) => f.segment === 'J-I' && f.check === 'design-band')).toBe(true);
  });
});
