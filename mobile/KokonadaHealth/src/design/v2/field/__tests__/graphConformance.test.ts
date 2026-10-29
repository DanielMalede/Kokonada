import { oklabToOklch, oklchToOklab } from '../../color/oklab.ts';
import { tierFor } from '../../tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { NODE_TIER, buildFieldFrame } from '../fieldFrame.ts';
import { NODE, ROUTED_EDGES, WAYPOINT_EDGES, isWaypoint, selectColour, tripleRatio } from '../fieldLaw.ts';
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

// The token graph's own statement of the law (designer §2.4, amended at D5b; TASKS UI-121): the text the
// sweeps and the reviewers read must state the law the field draws, word for word where the designer
// gave the words. Before D5b it still said "λ = 1000", a slot ranking and H = max (UI-121). Since L6′
// (UI-137) it is the designer's Ruling 5, word for word, landed with the law it states.
//   UI-138: a literal alone let a stale text pass (UI-137: the pre-UI-125 L5 stood beside L5′). So each
// formula the text names is also held to the law: READING below is the text's selection clause by clause,
// each piece keyed by the words it reads, and every key must stand in the token text; composed, the reading
// must equal selectColour on random trials. A law change the text does not follow fails the reading; a text
// change that drops or rewrites a clause fails its key. The text's former statement (UI-137's stale words)
// and the text with only its β clause reverted are planted readings, and each must disagree with the law.
describe('§2.4: the token graph states the law in force', () => {
  const text = GRAPH as unknown as { selection: string; nodeColour: string; pixelK: string; tripleFade: string };

  it('selection: the designer’s Ruling 5, word for word (L5′ and L6′)', () => {
    expect(text.selection).toBe(
      'topTwoSoft over nodes, not slots: e_i = fade_i·(extent·ρ_i + λ·η_i), ρ_i = r_i²/(|q′ − c_i|² + κr_i²), η_i the halo\'s unfaded shape over its peak; each node n (J, C, R, I, R0) pools its slots: E_n = Σ e_i, H_n = min(peak, Σ h_i), and a node\'s colour is the e-weighted mean of its slots\' colours, each slot\'s mark weight read from H_n; E1 ≥ E2 ≥ E3 over the nodes, ties to the lower id; d1 = E1 − E3, d2 = E2 − E3, w1 = d1², w2 = d2², t = w2/(w1 + w2) (0 where w1 = 0), so t\'s slope is 0 on both sides of E2 = E3; straight edges mix C1→C2 by t; waypoint edges mix C1→N12 by s(2t), s(x) = 1 − (1 − x)², N12 = ((L1 + L2)/2, 0, 0), so the mix meets N12 with slope 0 from both sides and never passes it; the pair fades to N̄ = (e-weighted mean L over the slots, 0, 0) by β = smoothstep(0, θ, r), r = 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3), symmetric in the three strongest nodes, so β\'s slope is continuous across both swaps; with no third node r ≥ 1.5 and β = 1, the pair bit for bit; a same-node merge equals one slot bit for bit where β = 1 and within 1e-12 where β < 1.',
    );
    expect(text.selection).not.toContain('1000');
  });

  it('tripleFade: θ is described as the fade on r, and the selection names r', () => {
    expect(text.tripleFade).toBe('θ, the fade near the triple point, on r (selection)');
    expect(text.selection).toContain('β = smoothstep(0, θ, r), r = ');
  });

  /** A colour as the text has it: (L, a, b). */
  type Lab = { L: number; a: number; b: number };
  const mix = (p: Lab, q: Lab, x: number): Lab => ({ L: p.L + (q.L - p.L) * x, a: p.a + (q.a - p.a) * x, b: p.b + (q.b - p.b) * x });
  /** The standard smoothstep the text names. */
  const smooth = (e0: number, e1: number, x: number) => {
    const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return u * u * (3 - 2 * u);
  };
  const tokenWaypointIds = (a: number, b: number, routed: boolean) => {
    const name = (id: number) => NAMES.find((n) => NODE[n] === id) as Name;
    return tokenWaypoint(name(a), name(b), routed);
  };
  /** Each formula the selection text names, keyed by its words in the text, and read as code. */
  const READING = {
    'E_n = Σ e_i': (e: readonly number[], ids: readonly number[], n: number) => e.reduce((s, x, i) => (ids[i] === n ? s + x : s), 0),
    "a node's colour is the e-weighted mean of its slots' colours": (e: readonly number[], c: readonly Lab[], ids: readonly number[], n: number): Lab => {
      const mine = e.map((x, i) => (ids[i] === n && x > 0 ? i : -1)).filter((i) => i >= 0);
      const W = mine.reduce((s, i) => s + e[i], 0);
      return mine.length === 1 ? c[mine[0]] : mine.reduce((m, i) => ({ L: m.L + (e[i] * c[i].L) / W, a: m.a + (e[i] * c[i].a) / W, b: m.b + (e[i] * c[i].b) / W }), { L: 0, a: 0, b: 0 });
    },
    'E1 ≥ E2 ≥ E3 over the nodes, ties to the lower id': (E: readonly number[]) => [0, 1, 2, 3, 4].sort((a, b) => E[b] - E[a] || a - b),
    'd1 = E1 − E3, d2 = E2 − E3': (E1: number, E2: number, E3: number) => [E1 - E3, E2 - E3] as const,
    'w1 = d1², w2 = d2², t = w2/(w1 + w2) (0 where w1 = 0)': (d1: number, d2: number) => (d1 * d1 > 0 ? (d2 * d2) / (d1 * d1 + d2 * d2) : 0),
    'straight edges mix C1→C2 by t': (C1: Lab, C2: Lab, t: number) => mix(C1, C2, t),
    'waypoint edges mix C1→N12 by s(2t)': (C1: Lab, N12: Lab, t: number, s: (x: number) => number) => mix(C1, N12, s(2 * t)),
    's(x) = 1 − (1 − x)²': (x: number) => 1 - (1 - x) * (1 - x),
    'N12 = ((L1 + L2)/2, 0, 0)': (C1: Lab, C2: Lab): Lab => ({ L: (C1.L + C2.L) / 2, a: 0, b: 0 }),
    'the pair fades to N̄ = (e-weighted mean L over the slots, 0, 0) by β': (P: Lab, e: readonly number[], c: readonly Lab[], beta: number): Lab =>
      mix({ L: e.reduce((s, x, i) => s + x * c[i].L, 0) / e.reduce((s, x) => s + x, 0), a: 0, b: 0 }, P, beta),
    'β = smoothstep(0, θ, r)': (theta: number, r: number) => smooth(0, theta, r),
    'r = 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3)': (d1: number, d2: number, E1: number, E2: number, E3: number) => (3 * Math.sqrt(d1 * d1 - d1 * d2 + d2 * d2)) / (E1 + E2 + E3),
  } as const;
  type Clauses = typeof READING;
  /** The selection as the text states it, composed from READING (or from a planted set of clauses). */
  const textSelect = (R: Clauses, e: readonly number[], c: readonly Lab[], ids: readonly number[], routed: boolean, theta: number): Lab => {
    const E = [0, 1, 2, 3, 4].map((n) => R['E_n = Σ e_i'](e, ids, n));
    const C = [0, 1, 2, 3, 4].map((n) => R["a node's colour is the e-weighted mean of its slots' colours"](e, c, ids, n));
    const [i1, i2, i3] = R['E1 ≥ E2 ≥ E3 over the nodes, ties to the lower id'](E);
    const [E1, E2, E3] = [E[i1], E[i2], E[i3]];
    const [d1, d2] = R['d1 = E1 − E3, d2 = E2 − E3'](E1, E2, E3);
    const t = R['w1 = d1², w2 = d2², t = w2/(w1 + w2) (0 where w1 = 0)'](d1, d2);
    const P = tokenWaypointIds(i1, i2, routed)
      ? R['waypoint edges mix C1→N12 by s(2t)'](C[i1], R['N12 = ((L1 + L2)/2, 0, 0)'](C[i1], C[i2]), t, R['s(x) = 1 − (1 − x)²'])
      : R['straight edges mix C1→C2 by t'](C[i1], C[i2], t);
    const beta = R['β = smoothstep(0, θ, r)'](theta, R['r = 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3)'](d1, d2, E1, E2, E3));
    return R['the pair fades to N̄ = (e-weighted mean L over the slots, 0, 0) by β'](P, e, c, beta);
  };
  /** UI-137's stale text: w1 = E1 − E3, w2 = E2 − E3, waypoint C1→N12 by 2t, β = smoothstep(0, θ, w1/E1). */
  const STALE: Clauses = {
    ...READING,
    'w1 = d1², w2 = d2², t = w2/(w1 + w2) (0 where w1 = 0)': (d1: number, d2: number) => (d1 > 0 ? d2 / (d1 + d2) : 0),
    's(x) = 1 − (1 − x)²': (x: number) => x,
    'r = 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3)': (d1: number, _d2: number, E1: number) => d1 / E1,
  };
  /** The text with only its β clause reverted (Ruling 5: "β = smoothstep(0, θ, (E1 − E3)/E1), on the linear ratio"). */
  const RATIO_BETA: Clauses = { ...READING, 'r = 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3)': (d1: number, _d2: number, E1: number) => d1 / E1 };

  /** A seeded generator (Park–Miller, exact in float64). */
  const random = (seed: number) => {
    let x = (seed % 2147483646) + 1;
    return () => {
      x = (16807 * x) % 2147483647;
      return (x - 1) / 2147483646;
    };
  };
  /**
   * Trials that reach every clause: six slots, ids drawn with duplicates; in a third of them three distinct
   * nodes lead within 10% of each other (inside the triple fade), the other slots small, any id.
   */
  const trials = (seed: number, count: number) => {
    const next = random(seed);
    const NODE_IDS = NAMES.map((n) => NODE[n]);
    return Array.from({ length: count }, (_, k) => {
      const colours = Array.from({ length: 6 }, () => oklchToOklab({ L: 0.3 + 0.6 * next(), C: 0.15 * next(), h: 360 * next() }));
      const ids = Array.from({ length: 6 }, () => NODE_IDS[Math.floor(next() * NODE_IDS.length)]);
      let e: number[];
      if (k % 3 === 0) {
        const lead = [...NODE_IDS].sort(() => next() - 0.5).slice(0, 3);
        lead.forEach((id, i) => (ids[i] = id));
        e = [0.9 + 0.1 * next(), 0.9 + 0.1 * next(), 0.9 + 0.1 * next(), 0.02 * next(), 0.02 * next(), next() < 0.5 ? 0 : 0.02 * next()];
      } else {
        e = Array.from({ length: 6 }, () => (next() < 0.25 ? 0 : next()));
        if (!e.some((x) => x > 0)) e[0] = 1;
      }
      return { e, colours, ids, routed: next() < 0.5, theta: k % 2 === 0 ? BASE.field.graph.tripleFade : 0.25 };
    });
  };
  const dE = (p: Lab, q: Lab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);

  it('UI-138: every formula the reading reads stands in the token text, word for word', () => {
    const missing = Object.keys(READING).filter((words) => !text.selection.includes(words));
    expect(missing).toEqual([]);
  });

  it('UI-138: the text, read clause by clause, is the law: within 1e-12 of selectColour on 3000 random trials', () => {
    let worst = 0;
    for (const { e, colours, ids, routed, theta } of trials(138, 3000)) {
      worst = Math.max(worst, dE(textSelect(READING, e, colours, ids, routed, theta), selectColour(e, colours, ids, routed, theta)));
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  it('UI-138: the r the text names is the law’s r, bit for bit; with no third node r ≥ 1.5 (less float’s 4ε), so β = 1', () => {
    const next = random(1381);
    for (let n = 0; n < 1000; n++) {
      const [E1, E2, E3] = [next(), next(), next()].sort((a, b) => b - a);
      expect(READING['r = 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3)'](E1 - E3, E2 - E3, E1, E2, E3)).toBe(tripleRatio(E1, E2, E3));
      expect(tripleRatio(E1, E2, 0)).toBeGreaterThanOrEqual(1.5 - 4 * Number.EPSILON);
    }
  });

  it.each([
    ['UI-137’s stale text (linear w, the 2t leg, β on the ratio)', STALE],
    ['the text with only its β clause reverted (β on the ratio)', RATIO_BETA],
  ] as const)('planted: %s disagrees with the law', (_name, clauses) => {
    let off = 0;
    for (const { e, colours, ids, routed, theta } of trials(138, 3000)) {
      if (dE(textSelect(clauses, e, colours, ids, routed, theta), selectColour(e, colours, ids, routed, theta)) > 1e-6) off++;
    }
    expect(off).toBeGreaterThan(100);
  });

  it('nodeColour: w from the node’s pooled halo', () => {
    expect(text.nodeColour).toContain('w = smoothstep(−0.05, 0, H_n − k_field), H_n the node\'s pooled halo.');
    expect(text.nodeColour).not.toContain('h_i − k_field');
  });

  it('pixelK: the halos add, up to the peak (L2), never the largest one', () => {
    expect(text.pixelK).toBe('k = min(max(k_field, H), max(cap, peak)), where H = min(peak, Σ over the slots of h_i): the halos add, up to the peak');
  });
});
