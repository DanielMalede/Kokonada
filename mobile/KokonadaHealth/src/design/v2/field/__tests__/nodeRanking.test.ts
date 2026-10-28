import { inSrgbGamut } from '../../color/gamut.ts';
import { oklchToOklab, type Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { NODE, NODE_BINS, NODE_SLOTS, compositePixel, encodeSrgb8, fieldOklab, pixelTerms, pooledNodes, rankNodes, selectColour, slotColours, smoothstep, type FieldFrame } from '../fieldLaw.ts';
import { slotRankedSelect, twinPixel } from '../lawTwins.ts';
import { staticsFor } from '../statics.ts';

// Law round 2, D5b (TASKS UI-122 and UI-129; the designer's amended L4, §2.4 and DSN-049, read at 42869fb):
//   L4 (amended): rank nodes, not slots. A node is a NODE id, five bins; each slot with fade > 0 belongs
//   to the bin of its id. E_n = Σ e_i over the slots of n; H_n = min(haloPeak, Σ h_i over the slots of n);
//   a bead slot's colour c_i = (1 − w_n)·turned_i + w_n·halo_i, w_n = smoothstep(−0.05, 0, H_n − k_field);
//   a node's colour is a guarded running mean, in ascending slot order, over its slots with e_i > 0:
//   W′ = W + e_i; C_n = W > 0 ? C_n + (c_i − C_n)·(e_i/W′) : c_i; W = W′; where E_n = 0, C_n = (0, 0, 0).
//   E1 ≥ E2 ≥ E3 over the five bins, ties to the lower id; L5 and L6 read E_n and C_n; N̄ over the slots.
// The architect's plan (UI-122, 2026-10-28) adds: a same-node merge equals one slot at the summed e (the
// slot-ranking twin fails it); one node in two slots of different colours is continuous across their e
// swap (a strongest-slot twin fails it); the corners are finite (a twin without the W guard is NaN).

const THETA = BASE.field.graph.tripleFade;
const IDS = [NODE.J, NODE.C, NODE.R, NODE.I, NODE.R0];
const deltaE = (p: Oklab, q: Oklab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
type Select = (e: readonly number[], colours: readonly Oklab[], ids: readonly number[], routed: boolean) => Oklab;
const law: Select = (e, colours, ids, routed) => selectColour(e, colours, ids, routed, THETA);
const slots: Select = (e, colours, ids, routed) => slotRankedSelect(e, colours, ids, routed, THETA);
/** A planted twin: each node's colour is its strongest slot's (ties to the lower slot), not the e-weighted mean. */
const strongest: Select = (e, colours, ids, routed) => {
  const pick = colours.map((c, i) => {
    let best = i;
    for (let j = 0; j < e.length; j++) if (ids[j] === ids[i] && e[j] > e[best]) best = j;
    return colours[best];
  });
  return selectColour(e, pick, ids, routed, THETA);
};

function random(seed: number) {
  let x = (seed % 2147483646) + 1;
  return () => {
    x = (16807 * x) % 2147483647;
    return (x - 1) / 2147483646;
  };
}
function gamutColour(next: () => number): Oklab {
  for (;;) {
    const c = oklchToOklab({ L: 0.15 + 0.8 * next(), C: 0.2 * next(), h: 360 * next() });
    if (inSrgbGamut(c)) return c;
  }
}
const finite = (c: Oklab) => [c.L, c.a, c.b].every(Number.isFinite);
const pick = <T,>(next: () => number, from: readonly T[]) => from[Math.floor(next() * from.length)];

describe('the node bins (L4 amended)', () => {
  it('NODE_BINS is 5, and every NODE id is a whole bin below it (the shader’s loops are bound by NODE_BINS)', () => {
    expect(NODE_BINS).toBe(5);
    const ids = Object.values(NODE);
    expect(ids.every((id) => Number.isInteger(id) && id >= 0 && id < NODE_BINS)).toBe(true);
    expect(new Set(ids).size).toBe(NODE_BINS);
  });

  it('pools by id: E_n = Σ e_i, C_n the e-weighted running mean in ascending slot order, a slot at e = 0 skipped, an empty bin (0, 0, 0)', () => {
    const a = { L: 0.6, a: 0.1, b: -0.05 };
    const b = { L: 0.3, a: -0.02, b: 0.08 };
    const x = { L: 0.9, a: 0.3, b: 0.3 }; // at e = 0: never read
    const { E, C } = pooledNodes([1, 0, 3, 0.5, 0, 0], [a, x, b, x, x, x], [NODE.J, NODE.J, NODE.J, NODE.C, NODE.R, NODE.R]);
    expect(E).toEqual([4, 0.5, 0, 0, 0]);
    const s = 3 / 4;
    expect(C[NODE.J]).toEqual({ L: a.L + (b.L - a.L) * s, a: a.a + (b.a - a.a) * s, b: a.b + (b.b - a.b) * s });
    expect(C[NODE.C]).toEqual(x);
    for (const n of [NODE.R, NODE.I, NODE.R0]) expect(C[n]).toEqual({ L: 0, a: 0, b: 0 });
  });

  it('ranks the bins: E1 ≥ E2 ≥ E3, ties to the lower id', () => {
    expect(rankNodes([1, 3, 2, 0, 0])).toEqual([1, 2, 1]);
    expect(rankNodes([2, 2, 2, 0, 0])).toEqual([0, 1, 2]);
    expect(rankNodes([0, 0, 0, 0, 5])).toEqual([4, 0, 0]);
  });
});

interface Scene { colours: Oklab[]; ids: number[]; e: number[]; routed: boolean }
/** Node n in k slots of one colour, beside 1–3 other nodes (distinct ids), shuffled into the six slots. */
function splitScene(next: () => number, k: number): { split: Scene; merged: Scene; n: number } {
  const n = pick(next, IDS);
  const others = IDS.filter((id) => id !== n).sort(() => next() - 0.5).slice(0, 1 + Math.floor(next() * 3));
  const c = gamutColour(next);
  const parts = Array.from({ length: k }, () => 0.05 + next());
  const items = [...parts.map((v) => ({ id: n, e: v, c })), ...others.map((id) => ({ id, e: 0.05 + 1.5 * next(), c: gamutColour(next) }))];
  while (items.length < NODE_SLOTS) items.push({ id: pick(next, IDS), e: 0, c: gamutColour(next) });
  const order = items.map((_, i) => i).sort(() => next() - 0.5);
  const placed = order.map((i) => items[i]);
  const routed = next() < 0.5;
  const split = { colours: placed.map((p) => p.c), ids: placed.map((p) => p.id), e: placed.map((p) => p.e), routed };
  // The merged twin: the node's first slot carries the summed e, in the order the pool adds it; its other slots are empty.
  const mine = placed.map((p, i) => (p.id === n && p.e > 0 ? i : -1)).filter((i) => i >= 0);
  let sum = 0;
  for (const i of mine) sum += placed[i].e;
  const e = placed.map((p, i) => (i === mine[0] ? sum : mine.includes(i) ? 0 : p.e));
  return { split, merged: { ...split, e }, n };
}
const run = (select: Select, s: Scene) => select(s.e, s.colours, s.ids, s.routed);
/** The seam's β at the node level, from the bins. */
const betaOf = (s: Scene) => {
  const { E } = pooledNodes(s.e, s.colours, s.ids);
  const [i1, , e3] = rankNodes(E);
  return smoothstep(0, THETA, (E[i1] - e3) / E[i1]);
};

describe('a node placed more than once is one mood (L4 amended; DSN-049)', () => {
  it('a same-node merge equals one slot at the summed e: bit for bit where β = 1, within 1e-12 everywhere (N̄ is summed over the slots)', () => {
    const next = random(51);
    const off: string[] = [];
    let atOne = 0;
    let faded = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const { split, merged } = splitScene(next, 2 + (trial % 2));
      const a = run(law, split);
      const b = run(law, merged);
      if (betaOf(merged) === 1) {
        atOne++;
        if (JSON.stringify(a) !== JSON.stringify(b)) off.push(`trial ${trial}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);
      } else {
        faded++;
        if (deltaE(a, b) > 1e-12) off.push(`trial ${trial} (β < 1): ΔE ${deltaE(a, b).toExponential(3)}`);
      }
    }
    expect(off).toEqual([]);
    expect(atOne).toBeGreaterThan(100);
    expect(faded).toBeGreaterThan(20);
  });

  it('the planted slot-ranking twin fails the merge (a node’s halves compete with each other and with a third)', () => {
    const next = random(51);
    let failures = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const { split, merged } = splitScene(next, 2 + (trial % 2));
      if (deltaE(run(slots, split), run(law, merged)) > 1e-3) failures++;
    }
    expect(failures).toBeGreaterThan(100);
  });

  it('one node in two slots of different colours is continuous across their e swap: the jump shrinks linearly with ε (a strongest-slot twin jumps)', () => {
    const jumps = (select: Select) => {
      const next = random(52);
      const bad: string[] = [];
      for (let trial = 0; trial < 200; trial++) {
        const n = pick(next, IDS);
        const m = pick(next, IDS.filter((id) => id !== n));
        const [cA, cB, cM] = [gamutColour(next), gamutColour(next), gamutColour(next)];
        const x = 0.2 + next();
        const em = 0.2 + 2 * next();
        const third = next() < 0.5 ? 0.5 * next() : 0;
        const tId = pick(next, IDS.filter((id) => id !== n && id !== m));
        const routed = next() < 0.5;
        const at = (eps: number, sign: number) =>
          select([x + sign * eps, em, x - sign * eps, third, 0, 0], [cA, cM, cB, gamutColour(random(trial)), cA, cA], [n, m, n, tId, NODE.R0, NODE.R0], routed);
        const jump = (eps: number) => deltaE(at(eps, 1), at(eps, -1));
        const fine = jump(1e-6);
        const coarse = jump(1e-3);
        if (!(fine <= 1e-2 * coarse + 1e-12)) bad.push(`trial ${trial}: ${fine.toExponential(3)} at 1e-6 against ${coarse.toExponential(3)} at 1e-3`);
      }
      return bad;
    };
    expect(jumps(law)).toEqual([]);
    expect(jumps(strongest).length).toBeGreaterThan(100);
  });

  it('three slots of one id and no other node: one mood at full colour, never the triple grey (the accepted change)', () => {
    const c = { L: 0.62, a: 0.08, b: 0.05 };
    const out = law([1, 1, 1, 0, 0, 0], [c, c, c, c, c, c], [NODE.J, NODE.J, NODE.J, NODE.R0, NODE.R0, NODE.R0], false);
    expect(out).toEqual(c);
    // The slot law greyed it: β = 0 at its exact triple tie.
    expect(run(slots, { e: [1, 1, 1, 0, 0, 0], colours: [c, c, c, c, c, c], ids: [NODE.J, NODE.J, NODE.J, NODE.R0, NODE.R0, NODE.R0], routed: false })).toEqual({ L: c.L, a: 0, b: 0 });
    // Different ids keep the grey.
    expect(law([1, 1, 1, 0, 0, 0], [c, c, c, c, c, c], [NODE.J, NODE.C, NODE.R, NODE.R0, NODE.R0, NODE.R0], false)).toEqual({ L: c.L, a: 0, b: 0 });
  });
});

describe('the corners are finite (architect, UI-122)', () => {
  const c = (L: number, a: number, b: number) => ({ L, a, b });
  const cs = [c(0.5, 0.1, 0), c(0.4, 0, 0.1), c(0.7, -0.1, 0), c(0.3, 0, -0.1), c(0.6, 0.05, 0.05), c(0.55, -0.05, 0.02)];

  it('all bins zero: every node colour is (0, 0, 0) and every E_n is 0', () => {
    const { E, C } = pooledNodes([0, 0, 0, 0, 0, 0], cs, [0, 1, 2, 3, 4, 0]);
    expect(E).toEqual([0, 0, 0, 0, 0]);
    expect(C.every((x) => x.L === 0 && x.a === 0 && x.b === 0)).toBe(true);
  });

  it('a pixel with no weight at all is finite: the ground', () => {
    const frame = sceneFrame('dark', []);
    const empty = { ...frame, nodes: frame.nodes.map((node) => ({ ...node, fade: 0 })) };
    expect(finite(fieldOklab(empty, empty.centrePx[0], empty.centrePx[1]))).toBe(true);
  });

  it.each([
    ['two nodes each in two slots, tied', [1, 1, 1, 1, 0, 0], [NODE.J, NODE.C, NODE.J, NODE.C, NODE.R0, NODE.R0]],
    ['a node in three slots beside two others, tied', [1, 1, 1, 3, 3, 0], [NODE.J, NODE.J, NODE.J, NODE.C, NODE.I, NODE.R0]],
    ['all six slots one id', [0.3, 0.2, 0.5, 0.1, 0.9, 0.4], [NODE.I, NODE.I, NODE.I, NODE.I, NODE.I, NODE.I]],
    ['all six slots one id, some at e = 0 first', [0, 0, 0.5, 0, 0.9, 0], [NODE.I, NODE.I, NODE.I, NODE.I, NODE.I, NODE.I]],
    ['an exact triple tie of nodes, each in two slots', [1, 1, 1, 1, 1, 1], [NODE.J, NODE.C, NODE.R, NODE.J, NODE.C, NODE.R]],
  ])('%s: finite, for every routing', (_label, e, ids) => {
    for (const routed of [false, true]) expect(finite(law(e as number[], cs, ids as number[], routed))).toBe(true);
  });

  it('two nodes each in two slots, tied: the midpoint of their means (and a waypoint pair meets at N)', () => {
    const out = law([1, 1, 1, 1, 0, 0], cs, [NODE.J, NODE.C, NODE.J, NODE.C, NODE.R0, NODE.R0], false);
    const mJ = { L: (cs[0].L + cs[2].L) / 2, a: (cs[0].a + cs[2].a) / 2, b: (cs[0].b + cs[2].b) / 2 };
    const mC = { L: (cs[1].L + cs[3].L) / 2, a: (cs[1].a + cs[3].a) / 2, b: (cs[1].b + cs[3].b) / 2 };
    expect(deltaE(out, { L: (mJ.L + mC.L) / 2, a: (mJ.a + mC.a) / 2, b: (mJ.b + mC.b) / 2 })).toBeLessThan(1e-15);
    const way = law([1, 1, 1, 1, 0, 0], cs, [NODE.J, NODE.I, NODE.J, NODE.I, NODE.R0, NODE.R0], false);
    expect([way.a, way.b]).toEqual([0, 0]);
  });

  it('a twin without the W guard (every slot of a node, e = 0 included, by e_i/W′) is NaN where a node’s first slot is empty', () => {
    const unguarded = (e: readonly number[], colours: readonly Oklab[], ids: readonly number[]) => {
      const C: Oklab[] = [];
      for (let n = 0; n < NODE_BINS; n++) {
        let W = 0;
        let m = { L: 0, a: 0, b: 0 };
        for (let i = 0; i < e.length; i++) {
          if (ids[i] !== n) continue;
          const W2 = W + e[i];
          const s = e[i] / W2;
          m = { L: m.L + (colours[i].L - m.L) * s, a: m.a + (colours[i].a - m.a) * s, b: m.b + (colours[i].b - m.b) * s };
          W = W2;
        }
        C.push(m);
      }
      return C;
    };
    const e = [0, 0, 0.5, 0, 0.9, 0];
    const ids = [NODE.I, NODE.I, NODE.I, NODE.I, NODE.I, NODE.I];
    expect(finite(unguarded(e, cs, ids)[NODE.I])).toBe(false);
    expect(finite(pooledNodes(e, cs, ids).C[NODE.I])).toBe(true);
  });
});

// Criterion F: "every scene where each id appears once, and both rest tables, 8-bit identical TS frames
// before/after (float ≤ 1e-6), on UI-122's own commit". The law before D5b is the twin with both pieces
// swapped back (lawTwins.ts: slot ranking, w from h_i); the D5b probe holds that twin to 42869fb's own
// fieldLaw.ts. The hero scenes with one placement per id, the rest tables of both faces, at tension 0 and
// 1, genesis on and off, warped, grained and dithered.
// Re-authored at UI-125 (not loosened): L5′ changes every scene's seam, so "before/after" is now D5b's two
// pieces alone, the twin on the law's own seam (lawTwins.ts LAW_SEAM); the bound and the scenes are as they were.
const hero = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: Record<string, { placements?: Array<{ node: string; x: number; y: number }> }> } } } }).base.$root.hero.scenes;
const R_DP = BASE.plate.maxDiameter / 2;
function sceneFrame(face: Face, placements: ReadonlyArray<{ x: number; y: number }>, stress = 0, genesis = true): FieldFrame {
  return buildFieldFrame(
    { direction: 'abyss', face, placements: placements.map((p, i) => ({ x: p.x, y: p.y, fade: 1, ordinal: i })), restFade: placements.length === 0 ? 1 : 0, stress, confidence: genesis ? 1 : null, genesis, tMs: 7000, breathPhase: 0.3, tier: 'full' },
    { centrePx: [60.3, 59.6], radiusPx: 24, pxPerDp: 24 / R_DP, fontScale: 1 },
    staticsFor('abyss', EXTENSIONS as never),
  );
}
/** The pixel with no field and no halo: the ground, composited as the law composites it. */
const compositeGround = (frame: FieldFrame, x: number, y: number) => {
  const terms = pixelTerms(frame, x, y);
  return compositePixel(frame, { ...terms, k: 0 }, terms.ground, x, y);
};
const ONCE = Object.entries(hero).filter(([, s]) => s.placements !== undefined && !s.placements.some((p) => p.node === 'neutral')).map(([name]) => name);

describe('criterion F: where each id appears once, and on both rest tables, the law is the law before D5b', () => {
  it('the scenes: rest, the four one.* scenes, seam, three and replace, each id at most once', () => {
    expect(ONCE.sort()).toEqual(['one.calm', 'one.intense', 'one.joy', 'one.reflective', 'replace', 'rest', 'seam', 'three']);
    for (const name of ONCE) {
      const nodes = hero[name].placements!.map((p) => p.node);
      expect(new Set(nodes).size).toBe(nodes.length);
    }
  });

  it.each((['dark', 'light'] as Face[]).flatMap((face) => ONCE.map((name) => [face, name] as const)))('%s, %s: every pixel 8-bit identical, float within 1e-6', (face, name) => {
    let worst = 0;
    let off = 0;
    let lit = 0;
    for (const [stress, genesis] of [[0, true], [1, false]] as const) {
      const frame = sceneFrame(face, hero[name].placements!, stress, genesis);
      if (name === 'rest') expect(frame.nodes.filter((n) => n.fade > 0).length).toBe(staticsFor('abyss', EXTENSIONS as never).restLobes[face].length);
      // Every third pixel each way here (the D5b probe draws every pixel against 42869fb's own code).
      for (let y = 1; y < 120; y += 3) {
        for (let x = 1; x < 120; x += 3) {
          const now = fieldOklab(frame, x + 0.5, y + 0.5);
          const before = twinPixel(frame, x + 0.5, y + 0.5, { rank: 'slots', w: 'slot' });
          worst = Math.max(worst, deltaE(now, before));
          if (encodeSrgb8(now).join() !== encodeSrgb8(before).join()) off++;
          if (deltaE(now, compositeGround(frame, x + 0.5, y + 0.5)) > 0) lit++;
        }
      }
    }
    expect({ off, within: worst <= 1e-6 }).toEqual({ off: 0, within: true });
    expect(lit).toBeGreaterThan(300); // not vacuous: the field is drawn
  });

  it('not vacuous: with one id in two slots (J, J, C) the law and the slot twin do differ', () => {
    const frame = sceneFrame('dark', [{ x: 0.566, y: 0.566 }, { x: 0.3, y: 0.75 }, { x: 0.566, y: -0.566 }]);
    expect(frame.nodes.filter((n) => n.fade > 0).map((n) => n.id).sort()).toEqual([NODE.J, NODE.J, NODE.C]);
    let off = 0;
    for (let y = 0; y < 120; y += 2) for (let x = 0; x < 120; x += 2) if (deltaE(fieldOklab(frame, x + 0.5, y + 0.5), twinPixel(frame, x + 0.5, y + 0.5, { rank: 'slots', w: 'slot' })) > 1e-6) off++;
    expect(off).toBeGreaterThan(20);
    // slotColours is the law's: w from H_n of the slot's own id.
    const terms = pixelTerms(frame, 0.566 * 24 + 60.3, 59.6 - 0.566 * 24);
    expect(slotColours(frame, terms)).toHaveLength(NODE_SLOTS);
  });
});
