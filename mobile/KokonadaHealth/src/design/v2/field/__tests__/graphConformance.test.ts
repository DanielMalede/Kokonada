import { oklabToOklch } from '../../color/oklab.ts';
import { tierFor } from '../../tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { NODE_TIER, buildFieldFrame } from '../fieldFrame.ts';
import { NODE, ROUTED_EDGES, WAYPOINT_EDGES, isWaypoint } from '../fieldLaw.ts';
import { staticsFor } from '../statics.ts';

// The blend graph has one source: the tokens (designer §2.4, field.graph). The never-red sweeps read
// it from there; the law, the builder and the shader carry their own copy of two facts from it, the
// waypoint edges and the node tier. These tests hold each copy to the tokens (architect, fork 1:
// G8 and G9), so the field cannot draw a graph the sweeps never checked.

type Name = keyof typeof NODE;
interface Graph {
  readonly nodes: Record<string, string>;
  readonly nodeTier: Record<Face, 'core' | 'deep'>;
  readonly edges: {
    readonly straight: ReadonlyArray<readonly [string, string]>;
    readonly waypoint: ReadonlyArray<readonly [string, string]>;
    readonly restIntense: readonly [string, string];
  };
}
const GRAPH = EXTENSIONS.base['field.graph'] as unknown as Graph;
const NAMES = Object.keys(NODE) as Name[];
const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: Face[] = ['dark', 'light'];

const joins = (edge: readonly [string, string], a: string, b: string) => (edge[0] === a && edge[1] === b) || (edge[0] === b && edge[1] === a);
/** What the tokens say about the ordered pair (a, b): a waypoint edge, or R0–I in a direction that routes it. */
const tokenWaypoint = (a: Name, b: Name, routed: boolean) =>
  GRAPH.edges.waypoint.some((edge) => joins(edge, a, b)) || (routed && joins(GRAPH.edges.restIntense, a, b));

describe('G8: the law routes through N exactly the token graph’s waypoint edges', () => {
  it('the law’s nodes are the token graph’s nodes', () => {
    expect([...NAMES].sort()).toEqual(Object.keys(GRAPH.nodes).sort());
  });

  it.each([false, true])('over all 25 ordered pairs, R0–I routed: %s', (routed) => {
    const pairs = NAMES.flatMap((a) => NAMES.map((b) => [a, b] as const));
    expect(pairs).toHaveLength(25);
    const law = pairs.map(([a, b]) => `${a}–${b} ${isWaypoint(NODE[a], NODE[b], routed)}`);
    expect(law).toEqual(pairs.map(([a, b]) => `${a}–${b} ${tokenWaypoint(a, b, routed)}`));
    // J–I both ways, and R0–I both ways once routed: the count shows the check is not vacuous.
    expect(law.filter((line) => line.endsWith('true'))).toHaveLength(routed ? 4 : 2);
  });

  it('the edge tables the shader is generated from are the law’s', () => {
    const name = (id: number) => NAMES.find((n) => NODE[n] === id);
    expect(WAYPOINT_EDGES.map(([a, b]) => [name(a), name(b)])).toEqual(GRAPH.edges.waypoint.map((e) => [...e]));
    expect(ROUTED_EDGES.map(([a, b]) => [name(a), name(b)])).toEqual([[...GRAPH.edges.restIntense]]);
  });

  it.each(IDS)('%s: the builder routes R0–I exactly when the direction’s token says “waypoint”', (id) => {
    const frame = buildFieldFrame(
      { direction: id, face: 'dark', placements: [], stress: 0, confidence: null, genesis: false, tMs: 0, breathPhase: 0, tier: 'full', restFade: 1 },
      { centrePx: [100, 100], radiusPx: 80, pxPerDp: 0.5, fontScale: 1 },
      staticsFor(id, EXTENSIONS as never),
    );
    expect(frame.restIntenseWaypoint).toBe(DIRECTIONS[id].field.graph.restIntenseRoute === 'waypoint');
  });
});

describe('G9: each face draws the token’s node tier', () => {
  it('the builder’s tier table is the token’s', () => {
    expect(NODE_TIER).toEqual(GRAPH.nodeTier);
  });

  it('the never-red sweeps check the same tier', () => {
    for (const face of FACES) expect(tierFor(face)).toBe(GRAPH.nodeTier[face]);
  });

  // A bead at p = 1 shows its anchor at the tier's lightness and hue, with chroma × the bead scale.
  const QUADRANTS = { J: 'joy', C: 'calm', R: 'reflective', I: 'intense' } as const;
  /** Each quadrant at r = 1 on its own side (x ≥ 0 pleasant, y ≥ 0 more energy), so p = 1. */
  const AT = { J: [0.6, 0.8], C: [0.6, -0.8], R: [-0.6, -0.8], I: [-0.6, 0.8] } as const;
  it.each(IDS.flatMap((id) => FACES.map((face) => [id, face] as const)))('%s, %s face: every quadrant’s halo is its tier’s anchor', (id, face) => {
    for (const [node, quadrant] of Object.entries(QUADRANTS) as Array<[keyof typeof QUADRANTS, (typeof QUADRANTS)[keyof typeof QUADRANTS]]>) {
      const frame = buildFieldFrame(
        { direction: id, face, placements: [{ x: AT[node][0], y: AT[node][1], fade: 1 }], stress: 0, confidence: 1, genesis: false, tMs: 0, breathPhase: 0, tier: 'full', restFade: 0 },
        { centrePx: [100, 100], radiusPx: 80, pxPerDp: 0.5, fontScale: 1 },
        staticsFor(id, EXTENSIONS as never),
      );
      const anchor = BASE.emotion[quadrant][GRAPH.nodeTier[face]].oklch;
      const halo = oklabToOklch(frame.nodes[0].halo);
      expect(halo.L).toBeCloseTo(anchor[0], 9);
      expect(halo.C).toBeCloseTo(anchor[1] * DIRECTIONS[id].bead.chromaScale, 9);
      expect(halo.h).toBeCloseTo(anchor[2], 6);
    }
  });
});
