import { inSrgbGamut } from '../../color/gamut.ts';
import { oklchToOklab, type Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { NODE, fieldOklab, isWaypoint, pooledNodes, rankNodes, selectColour, smoothstep, type FieldFrame } from '../fieldLaw.ts';
import { staticsFor } from '../statics.ts';

// Law round 2, item 3 (DSN-049; designer L4–L6, architect §3, resilience B4): the seam.
//   L4  (amended at D5b, TASKS UI-122) rank nodes, not slots: each node pools its slots, E_n = Σ e_i and
//       C_n the e-weighted mean of its slots' colours; E1 ≥ E2 ≥ E3 over the five bins (ties to the lower id);
//   L5′ (UI-125) w1 = (E1 − E3)², w2 = (E2 − E3)², t = w2/(w1 + w2) where w1 > 0, else 0; straight edges
//       mix C1→C2 by t, waypoint edges C1→N12 by s(2t), s(x) = 1 − (1 − x)², N12 = ((C1.L + C2.L)/2, 0, 0);
//   L6  the pair fades to N̄ = (Σ e_i·c_i.L / Σ e_i over all six slots, 0, 0) by β = smoothstep(0, θ,
//       (E1 − E3)/E1), θ = field.graph.tripleFade.
// Since UI-125 the bare and unguarded twins are built on L5′, so each still differs from the law in the
// one piece it plants (the slope properties and their plants are in seamSlope.test.ts).
// Each property is run on planted twins too (the old law, the bare pair without the fade, the
// unguarded division), and each twin must fail it: a property that passes every twin is blind. The
// trials draw node ids at random, duplicates included, so since D5b every twin pools and ranks nodes as
// the law does (a deliberate re-authoring of the pin, not a loosening: the slot-ranked twins are in
// lawTwins.ts, and nodeRanking.test.ts and sameSpotSwap.test.ts watch them fail the node properties).

const THETA = BASE.field.graph.tripleFade;
const IDS = [NODE.J, NODE.C, NODE.R, NODE.I, NODE.R0];
const deltaE = (p: Oklab, q: Oklab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
type Select = (e: readonly number[], colours: readonly Oklab[], ids: readonly number[], routed: boolean) => Oklab;
const law: Select = (e, colours, ids, routed) => selectColour(e, colours, ids, routed, THETA);

/** The pooled nodes, the two strongest and the third, ties to the lower id (L4 amended), as the law ranks them. */
function rank(e: readonly number[], colours: readonly Oklab[], ids: readonly number[]): { E: number[]; C: Oklab[]; i1: number; i2: number; e3: number } {
  const { E, C } = pooledNodes(e, colours, ids);
  const [i1, i2, e3] = rankNodes(E);
  return { E, C, i1, i2, e3 };
}
/** t under L5′: the squared leads over the third; 0 where w1 = 0 unless `unguarded`. */
const seamT = (e1: number, e2: number, e3: number, unguarded = false) => {
  const d1 = e1 - e3;
  const d2 = e2 - e3;
  const w1 = d1 * d1;
  const w2 = d2 * d2;
  return w1 > 0 || unguarded ? w2 / (w1 + w2) : 0;
};
/** The pair at t: C1→C2 by t, or the waypoint leg C1→N12 by s(2t) (`linearLeg`: by 2t, the old law's leg). */
const pairAt = (c1: Oklab, c2: Oklab, t: number, waypoint: boolean, linearLeg = false): Oklab => {
  if (waypoint) {
    const x = 2 * t;
    const s = linearLeg ? x : 1 - (1 - x) * (1 - x);
    const nL = (c1.L + c2.L) / 2;
    return { L: c1.L + (nL - c1.L) * s, a: c1.a * (1 - s), b: c1.b * (1 - s) };
  }
  return { L: c1.L + (c2.L - c1.L) * t, a: c1.a + (c2.a - c1.a) * t, b: c1.b + (c2.b - c1.b) * t };
};
/** The law before round 2 (on nodes): t = max(0, E2 − E3)/(E1 + max(0, E2 − E3)), no fade to N̄. */
const legacy: Select = (e, colours, ids, routed) => {
  const { E, C, i1, i2, e3 } = rank(e, colours, ids);
  const w2 = Math.max(0, E[i2] - e3);
  return pairAt(C[i1], C[i2], w2 / (E[i1] + w2), isWaypoint(i1, i2, routed), true);
};
/** The bare candidate: L5′'s pair without L6's fade to N̄. */
const bare: Select = (e, colours, ids, routed) => {
  const { E, C, i1, i2, e3 } = rank(e, colours, ids);
  return pairAt(C[i1], C[i2], seamT(E[i1], E[i2], e3), isWaypoint(i1, i2, routed));
};
/** L5′ and L6 with the guard on t removed: 0/0 at an exact triple tie. */
const unguarded: Select = (e, colours, ids, routed) => {
  const { E, C, i1, i2, e3 } = rank(e, colours, ids);
  const P = pairAt(C[i1], C[i2], seamT(E[i1], E[i2], e3, true), isWaypoint(i1, i2, routed));
  const beta = smoothstep(0, THETA, (E[i1] - e3) / E[i1]);
  const sum = e.reduce((s, x) => s + x, 0);
  const nL = e.reduce((s, x, i) => s + x * colours[i].L, 0) / sum;
  return { L: P.L * beta + nL * (1 - beta), a: beta * P.a, b: beta * P.b };
};

/** A seeded generator (Park–Miller, exact in float64), so every failure names a trial that can be replayed. */
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
interface Trial { readonly colours: Oklab[]; readonly ids: number[]; readonly routed: boolean; readonly slots: number[] }
/** Six random gamut colours, six random node ids, a random routing and a random order of the six slots. */
function trials(seed: number, count: number): Trial[] {
  const next = random(seed);
  return Array.from({ length: count }, () => {
    const slots = [0, 1, 2, 3, 4, 5].sort(() => next() - 0.5);
    return { colours: Array.from({ length: 6 }, () => gamutColour(next)), ids: Array.from({ length: 6 }, () => IDS[Math.floor(next() * IDS.length)]), routed: next() < 0.5, slots };
  });
}
/** Weights placed into the trial's slot order: the k-th value goes to slot slots[k]. */
const placed = (trial: Trial, values: readonly number[]) => {
  const e = [0, 0, 0, 0, 0, 0];
  values.forEach((v, k) => (e[trial.slots[k]] = v));
  return e;
};

const E3S = [0, 0.25, 0.5, 0.9, 0.99];
/** B4 (i): across e1 = e ± ε against e2 = e ∓ ε, with a third at e3, the jump shrinks linearly with ε. */
function firstSecondSwap(select: Select): string[] {
  const bad: string[] = [];
  trials(11, 120).forEach((trial, n) => {
    for (const e3 of E3S) {
      const jump = (eps: number) => {
        const below = e3 * 0.5;
        return deltaE(select(placed(trial, [1 + eps, 1 - eps, e3, below]), trial.colours, trial.ids, trial.routed), select(placed(trial, [1 - eps, 1 + eps, e3, below]), trial.colours, trial.ids, trial.routed));
      };
      const fine = jump(1e-6);
      const coarse = jump(1e-3);
      if (!(fine <= 1e-2 * coarse + 1e-12)) bad.push(`trial ${n}, e3 ${e3}: jump ${fine.toExponential(3)} at 1e-6 against ${coarse.toExponential(3)} at 1e-3`);
    }
  });
  return bad;
}
/** B4 (ii): the same across the second and third (e2 = e ± ε against e3 = e ∓ ε), the first at 1. */
function secondThirdSwap(select: Select): string[] {
  const bad: string[] = [];
  trials(12, 120).forEach((trial, n) => {
    for (const e of [0.25, 0.5, 0.9, 0.99]) {
      const jump = (eps: number) =>
        deltaE(select(placed(trial, [1, e + eps, e - eps, e * 0.3]), trial.colours, trial.ids, trial.routed), select(placed(trial, [1, e - eps, e + eps, e * 0.3]), trial.colours, trial.ids, trial.routed));
      const fine = jump(1e-6);
      const coarse = jump(1e-3);
      if (!(fine <= 1e-2 * coarse + 1e-12)) bad.push(`trial ${n}, e ${e}: jump ${fine.toExponential(3)} at 1e-6 against ${coarse.toExponential(3)} at 1e-3`);
    }
  });
  return bad;
}
/** B4 (iii): 64 points with |e_i − 1| ≤ δ for the top three, in every order: the colours’ spread tends to 0. */
function triplePoint(select: Select): { spreads: number[][]; bad: string[] } {
  const bad: string[] = [];
  const spreads: number[][] = [];
  trials(13, 40).forEach((trial, n) => {
    const next = random(1000 + n);
    const row = [1e-2, 1e-4, 1e-6].map((delta) => {
      const out: Oklab[] = [];
      for (let k = 0; k < 64; k++) {
        const near = [0, 1, 2].map(() => 1 + delta * (2 * next() - 1)).sort((x, y) => y - x);
        const order = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]][k % 6];
        out.push(select(placed(trial, [...order.map((i) => near[i]), n % 2 === 0 ? 0 : 0.5]), trial.colours, trial.ids, trial.routed));
      }
      let spread = 0;
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) spread = Math.max(spread, deltaE(out[i], out[j]));
      return spread;
    });
    spreads.push(row);
    if (!(row[2] <= 1e-3 && row[2] <= row[1] && row[1] <= row[0])) bad.push(`trial ${n}: spreads ${row.map((s) => s.toExponential(2)).join(', ')}`);
  });
  return { spreads, bad };
}
/** B4 (iv): an exact tie of the top three (and of all six) gives a finite colour. */
function exactTie(select: Select): string[] {
  const bad: string[] = [];
  trials(14, 40).forEach((trial, n) => {
    for (const values of [[1, 1, 1], [1, 1, 1, 0.5], [1, 1, 1, 1, 1, 1], [0.3, 0.3, 0.3, 0.3]]) {
      const c = select(placed(trial, values), trial.colours, trial.ids, trial.routed);
      if (![c.L, c.a, c.b].every(Number.isFinite)) bad.push(`trial ${n}, e ${values.join('/')}: (${c.L}, ${c.a}, ${c.b})`);
    }
  });
  return bad;
}

describe('the seam’s token (designer L6)', () => {
  it('field.graph.tripleFade θ is 0.15', () => {
    expect(THETA).toBe(0.15);
  });

  it('the builder carries θ from the tokens into every frame', () => {
    const frame = buildFieldFrame(
      { direction: 'abyss', face: 'dark', placements: [], restFade: 1, stress: 0, confidence: null, genesis: false, tMs: 0, breathPhase: 0, tier: 'full' },
      { centrePx: [100, 100], radiusPx: 80, pxPerDp: 1, fontScale: 1 },
      staticsFor('abyss', EXTENSIONS as never),
    );
    expect(frame.tripleFade).toBe(BASE.field.graph.tripleFade);
  });
});

describe('B4 on selectColour, with each planted twin failing the property it guards', () => {
  it('(i) where the first and second swap, the colour is continuous: the jump shrinks linearly with ε, whatever e3', () => {
    expect(firstSecondSwap(law)).toEqual([]);
    expect(firstSecondSwap(legacy).length).toBeGreaterThan(100); // the old law jumps by e3/(2e − e3)·|c2 − c1|
  });

  it('(ii) where the second and third swap, the colour is continuous too (a regression pin)', () => {
    expect(secondThirdSwap(law)).toEqual([]);
    expect(secondThirdSwap(legacy)).toEqual([]);
  });

  it('(iii) at the triple point the colours meet: spread(δ) falls with δ, and spread(1e-6) ≤ 1e-3', () => {
    const { bad, spreads } = triplePoint(law);
    expect(bad).toEqual([]);
    // Not vacuous: at δ = 1e-2 the three still differ.
    expect(Math.max(...spreads.map((r) => r[0]))).toBeGreaterThan(1e-3);
    // The twins fail at every real triple point: the three near-tied slots are three distinct nodes, and
    // the fourth (at 0.5 in odd trials) adds to none of them. Under node ranking a trial whose near-tied
    // slots share an id has no triple point (one node holds two of them), so no twin can fail it there.
    const real = trials(13, 40).flatMap((t, n) => {
      const top = [0, 1, 2].map((k) => t.ids[t.slots[k]]);
      return new Set(top).size === 3 && (n % 2 === 0 || !top.includes(t.ids[t.slots[3]])) ? [`trial ${n}`] : [];
    });
    expect(real.length).toBeGreaterThan(12);
    const failed = (select: Select) => triplePoint(select).bad.map((b) => b.split(':')[0]);
    expect(failed(bare)).toEqual(real); // the pair alone keeps the ordering's colour
    expect(failed(legacy)).toEqual(real);
  });

  it('(iv) an exact triple tie gives a finite colour', () => {
    expect(exactTie(law)).toEqual([]);
    expect(exactTie(unguarded).length).toBeGreaterThan(30);
  });

  it('(v) t ≤ ½: on a waypoint pair the colour never passes N (its ab is the leader’s, scaled by 0..1); on a straight pair with no third it is nearer the leader', () => {
    const bad: string[] = [];
    let waypoints = 0;
    let pooled = 0;
    trials(15, 400).forEach((trial, n) => {
      const next = random(2000 + n);
      const values = [1, next(), next() * 0.9, next() * 0.5].sort((x, y) => y - x);
      for (const third of [true, false]) {
        const e = placed(trial, third ? values : values.slice(0, 2));
        const c = law(e, trial.colours, trial.ids, trial.routed);
        const { E, C, i1, i2 } = rank(e, trial.colours, trial.ids);
        if (E.filter((x) => x > 0).length < e.filter((x) => x > 0).length) pooled++;
        const c1 = C[i1];
        const c2 = C[i2];
        if (isWaypoint(i1, i2, trial.routed)) {
          waypoints++;
          const cross = c.a * c1.b - c.b * c1.a;
          const dot = c.a * c1.a + c.b * c1.b;
          if (!(Math.abs(cross) <= 1e-12 && dot >= -1e-15 && Math.hypot(c.a, c.b) <= Math.hypot(c1.a, c1.b) + 1e-12)) bad.push(`trial ${n} waypoint: (${c.a}, ${c.b}) against leader (${c1.a}, ${c1.b})`);
        } else if (!third && deltaE(c, c1) > deltaE(c, c2) + 1e-12) {
          bad.push(`trial ${n} straight: nearer the second`);
        }
      }
    });
    expect(bad).toEqual([]);
    expect(waypoints).toBeGreaterThan(20);
    expect(pooled).toBeGreaterThan(50); // the trials do place one id in two slots
  });

  // Re-authored at UI-125. Before it, with e3 = 0 the law was the pre-round-2 law bit for bit (t = E2/(E1 +
  // E2)); L5′ squares the weights, so two-node pixels now mix by t = E2²/(E1² + E2²): an intended change
  // of the designer's law, measured for the owner (UI-125's report). What still holds, bit for bit, is
  // that with no third node L6's fade is inert: β = 1 and the colour is the bare pair. The legacy twin
  // differs there now (not vacuous: it is the old t).
  it('with no third node (e3 = 0) β is 1: the law is the bare pair, bit for bit, and no longer the pre-round-2 law', () => {
    const off: string[] = [];
    let moved = 0;
    trials(16, 400).forEach((trial, n) => {
      const next = random(3000 + n);
      const e = placed(trial, [1, next()]);
      const c = law(e, trial.colours, trial.ids, trial.routed);
      if (JSON.stringify(c) !== JSON.stringify(bare(e, trial.colours, trial.ids, trial.routed))) off.push(`trial ${n}`);
      if (deltaE(c, legacy(e, trial.colours, trial.ids, trial.routed)) > 1e-9) moved++;
    });
    expect(off).toEqual([]);
    expect(moved).toBeGreaterThan(200);
  });

  it('(vi) slot order does not matter: a permutation of the six slots gives the same colour (to 1e-12)', () => {
    const bad: string[] = [];
    trials(17, 200).forEach((trial, n) => {
      const next = random(4000 + n);
      const e = [next(), next(), next(), next() * 0.5, 0, next() * 0.2];
      const shuffle = [0, 1, 2, 3, 4, 5].sort(() => next() - 0.5);
      const c = law(e, trial.colours, trial.ids, trial.routed);
      const p = law(shuffle.map((i) => e[i]), shuffle.map((i) => trial.colours[i]), shuffle.map((i) => trial.ids[i]), trial.routed);
      if (deltaE(c, p) > 1e-12) bad.push(`trial ${n}: ${deltaE(c, p).toExponential(3)}`);
    });
    expect(bad).toEqual([]);
  });

  it('(vi, D5b) shuffling one id’s slots among themselves gives the same colour (to 1e-12): a node’s mean does not depend on its slots’ order', () => {
    const bad: string[] = [];
    let shuffled = 0;
    trials(18, 300).forEach((trial, n) => {
      const next = random(5000 + n);
      const e = [next(), next(), next(), next() * 0.5, next() * 0.3, next() * 0.2];
      const counts = IDS.map((id) => trial.ids.filter((x) => x === id).length);
      const id = IDS[counts.indexOf(Math.max(...counts))];
      const mine = trial.ids.map((x, i) => (x === id ? i : -1)).filter((i) => i >= 0);
      if (mine.length < 2) return;
      shuffled++;
      const turned = [...mine.slice(1), mine[0]];
      const order = [0, 1, 2, 3, 4, 5].map((i) => (mine.includes(i) ? turned[mine.indexOf(i)] : i));
      const c = law(e, trial.colours, trial.ids, trial.routed);
      const p = law(order.map((i) => e[i]), order.map((i) => trial.colours[i]), order.map((i) => trial.ids[i]), trial.routed);
      if (deltaE(c, p) > 1e-12) bad.push(`trial ${n}: ${deltaE(c, p).toExponential(3)}`);
    });
    expect(bad).toEqual([]);
    expect(shuffled).toBeGreaterThan(200);
  });
});

// B4 (vi), rendered: radial lines through the face at 1/256 R on the law's float pixel, every
// neighbouring pair over ΔE 0.02 bisected 20 times, and a jump still above 0.01 is a seam. The region
// edges are left out (item 4, the ring's anti-aliasing, is D6), so each line stops inside the face.
// Grain and dither are 0: they are per pixel by design.
const hero = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: Record<string, { placements: Array<{ x: number; y: number }> }> } } } }).base.$root.hero.scenes;
const SEAM_SCENES: Record<string, ReadonlyArray<{ x: number; y: number }>> = {
  rest: hero.rest.placements,
  seam: hero.seam.placements,
  three: hero.three.placements,
  // Two placements meeting a third near the plate centre: a long first–second seam with the third lit.
  meet: [{ x: 0.45, y: 0.3 }, { x: 0.45, y: -0.3 }, { x: -0.5, y: 0 }],
};

function seamJumps(frame: FieldFrame): string[] {
  const at = (r: number, angle: number) => {
    const q = [r * Math.cos(angle), r * Math.sin(angle)];
    return fieldOklab(frame, frame.centrePx[0] + q[0] * frame.radiusPx, frame.centrePx[1] - q[1] * frame.radiusPx);
  };
  const found: string[] = [];
  const step = 1 / 256;
  const end = frame.ringInner - 1e-9;
  for (let line = 0; line < 64; line++) {
    const angle = (2 * Math.PI * (line + 0.5)) / 64;
    let r0 = 0;
    let c0 = at(r0, angle);
    while (r0 < end) {
      const r1 = Math.min(r0 + step, end);
      const c1 = at(r1, angle);
      if (deltaE(c0, c1) > 0.02) {
        let [a, b] = [r0, r1];
        for (let k = 0; k < 20; k++) {
          const m = (a + b) / 2;
          const cm = at(m, angle);
          if (deltaE(at(a, angle), cm) >= deltaE(cm, at(b, angle))) b = m;
          else a = m;
        }
        const jump = deltaE(at(a, angle), at(b, angle));
        if (jump > 0.01) found.push(`line ${line} at r ${a.toFixed(5)}: ΔE ${jump.toFixed(4)}`);
      }
      r0 = r1;
      c0 = c1;
    }
  }
  return found;
}

describe('B4 (vi): the rendered seam has no jump (float law pixel, radial lines inside the face)', () => {
  const cases = (['dark', 'light'] as Face[]).flatMap((face) => Object.keys(SEAM_SCENES).map((scene) => [face, scene] as const));
  it.each(cases)('Abyss %s face, %s', (face, scene) => {
    const placements = SEAM_SCENES[scene].map((p, i) => ({ x: p.x, y: p.y, fade: 1, ordinal: i }));
    const built = buildFieldFrame(
      { direction: 'abyss', face, placements, restFade: placements.length === 0 ? 1 : 0, stress: 0, confidence: 1, genesis: true, tMs: 7000, breathPhase: 0.3, tier: 'full' },
      { centrePx: [120, 120], radiusPx: 80, pxPerDp: 80 / (BASE.plate.maxDiameter / 2), fontScale: 1 },
      staticsFor('abyss', EXTENSIONS as never),
    );
    const frame = { ...built, grain: { inside: 0, ground: 0 }, dither: 0 };
    expect(seamJumps(frame)).toEqual([]);
  });
});
