import { inSrgbGamut } from '../../color/gamut.ts';
import { oklchToOklab, type Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { NODE, fieldOklab, isWaypoint, pixelTerms, pooledNodes, rankNodes, selectColour, slotColours, smoothstep, type FieldFrame } from '../fieldLaw.ts';
import { LAW_SEAM, seamPair, seamSelect, twinPixel, type Seam } from '../lawTwins.ts';
import { staticsFor } from '../statics.ts';

// UI-125 (F1, the designer's slope polish of law round 2, on the amended L4 of D5b): D3's seam was
// continuous but its slope broke, so Mach bands drew a pinwheel vertex and faint streaks.
//   Why: across the second-to-third swap line (E2 = E3) the ranked E2 and E3 trade places, so
//   w2 = E2 − E3 = |E_a − E_b| bends like |·| and t = w2/(w1 + w2) with it; and on a waypoint pair the
//   leg C1→N12 by 2t reaches N12 at full speed from each side, along two different directions.
//   L5′: w1 = (E1 − E3)², w2 = (E2 − E3)², t = w2/(w1 + w2) (0 where w1 = 0); w2 and its slope are 0 on
//   E2 = E3, so t has slope 0 from both sides there. The waypoint leg: P = C1 + (N12 − C1)·s(2t),
//   s(x) = 1 − (1 − x)², so s′(1) = 0 and the leg arrives at N12 with slope 0.
//   The mirrored form: with v = w_b/(w_a + w_b) the share of b along the pair a–b, the leg is
//   P = N12 + (C_a − N12)·(1 − 2v)² for v ≤ ½ (a leads) and P = N12 + (C_b − N12)·(2v − 1)² for v ≥ ½
//   (b leads): one curve through the swap, slope 0 at v = ½ from both sides.
// UI-139 (L6′, the designer's Ruling 1, and Ruling 1 round 2 for UI-142): β on the linear ratio
// (E1 − E3)/E1 read E1, which bends at the first-to-second swap, and E3, which bends at the second-to-
// third, so the slope still broke inside the triple fade (K 0.37–3.3 per R). L6′: β = smoothstep(0, θ, r),
// r = 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3), d1 = E1 − E3, d2 = E2 − E3; d1² − d1·d2 + d2² is
// ½·Σ_{i<j}(E_i − E_j)², symmetric in the three strongest nodes, so r does not bend at either swap.
//
// The slope proof: on the float law pixel (grain and dither 0), at each crossing of a swap locus found on
// horizontal and vertical lines through the face, the central second difference along the line,
// K(h) = |c(q + h) − 2c(q) + c(q − h)|/h in OKLab per R, h = 1e-4 R. At a kink K(h) tends to the jump in the
// first difference's slope and stays put as h shrinks; where the colour is smooth K(h) = |c″|·h + O(h²) and
// quarters with h. The amended a) of Ruling 1 round 2, at every 1–2 and 2–3 crossing, both faces, still
// and heaviest:
//   (i)   the kink clause, everywhere: K(h/4) ≤ 0.3·K(h) + 1e-9;
//   (ii)  where β = 1 at all three stencil samples: K(h) ≤ 0.05 per R;
//   (iii) where β < 1 at any stencil sample: K(h) ≤ 0.20 per R (|c″| ≤ 2000/R² at h = 1e-4 R), a smooth
//         curvature inside the grey fade, not a Mach band; it holds for θ ≥ 0.15 (curvature ~ 1/θ²), so a
//         token θ below 0.15 reopens it.
//   Measured at f4de6d4, and again at d8b8648 before L6′ landed (probe l6b-probe-slope): (i) everywhere;
//   (ii) worst 0.0474 (dark seam.waypoint); (iii) worst 0.165 (heaviest dark seam.waypoint).
// Exclusions, the only two: a stencil whose top-three node set changes across ±h, and a stencil within 2h
// of an exact triple tie (|g|/|∇g| < 2h, g the gap of the pair that does not swap: a lower bound on the
// distance, so a superset). Each is listed and held to the expected list below (none in these scenes);
// any other stencil whose ranks at ±h are not the two sides fails the case.
// b) each scene with a third lit node has ≥ 5 crossings with β < 1; a two-node scene has r ≥ 1.5, β = 1 bit
// for bit at every stencil sample, no crossing with β < 1, and the L5′ pair bit for bit.
// c) the planted β on the ratio (L6, with L5′ and the rest the law's) over the β < 1 crossings: worst
// K > 0.40 per R, and it fails (i) at half of them or more. UI-125's planted linear w and linear leg stay.

const THETA = BASE.field.graph.tripleFade;
const R_DP = BASE.plate.maxDiameter / 2;
const H = 1e-4;
/** (ii), and the UI-125 plants' margin: where β = 1. */
const BOUND = 0.05;
/** (iii): where β < 1 (Ruling 1 round 2). */
const FADE_BOUND = 0.2;
/**
 * b): with no third node r ≥ 1.5 in exact arithmetic (equality where E1 = E2); in float, fl(3·√Q)/(E1 + E2)
 * lands up to two units in the last place below 1.5 near the swap (1.4999999999999996 measured). β = 1 and the
 * pair are asserted bit for bit; r is held to 1.5 less four ε, which no θ ≤ 1 can reach.
 */
const R_FLOOR = 1.5 - 4 * Number.EPSILON;
/** c): the planted ratio β must exceed this over the β < 1 crossings. */
const RATIO_PLANT_FLOOR = 0.4;
const deltaE = (p: Oklab, q: Oklab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
/** r (L6′) as the designer wrote it: the test's own reading of the ruling, not the law's code. */
const rOf = (e1: number, e2: number, e3: number) => {
  const d1 = e1 - e3;
  const d2 = e2 - e3;
  return (3 * Math.sqrt(d1 * d1 - d1 * d2 + d2 * d2)) / (e1 + e2 + e3);
};

const hero = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: Record<string, { placements: Array<{ x: number; y: number }> }> } } } }).base.$root.hero.scenes;
/**
 * `three` and the two seam stills of the D3 board (build.mjs): a pair meeting a third, straight and waypoint;
 * and two pairs with no third: `seam` (I–J, waypoint) and J–C (straight, the drift probe's pair.JC).
 */
const STILLS: Record<string, ReadonlyArray<{ x: number; y: number }>> = {
  three: hero.three.placements,
  'seam.meet': [{ x: 0.45, y: 0.3 }, { x: 0.45, y: -0.3 }, { x: -0.5, y: 0 }],
  'seam.waypoint': [{ x: -0.3, y: 0.45 }, { x: 0.3, y: 0.45 }, { x: 0.35, y: -0.4 }],
  seam: hero.seam.placements,
  'pair.JC': [{ x: 0.566, y: 0.3 }, { x: 0.566, y: -0.3 }],
};
const TRIPLES: readonly string[] = ['three', 'seam.meet', 'seam.waypoint'];
const PAIRS: readonly string[] = ['seam', 'pair.JC'];
/** The exclusions each case may have (Ruling 1 round 2: none in these scenes); a new one fails until it is listed here, by name. */
const EXPECTED_EXCLUSIONS: Record<string, readonly string[]> = {};
/** The stills' state (the D3 board: s 0.3, no confidence, genesis off) and the heaviest presence. */
const STATES = { still: { stress: 0.3, confidence: null, genesis: false }, heaviest: { stress: 0, confidence: 1, genesis: true } } as const;
type State = keyof typeof STATES;
function frameOf(face: Face, scene: string, state: State): FieldFrame {
  const placements = STILLS[scene].map((p, i) => ({ x: p.x, y: p.y, fade: 1, ordinal: i }));
  const built = buildFieldFrame(
    { direction: 'abyss', face, placements, restFade: 0, ...STATES[state], tMs: 7000, breathPhase: 0.3, tier: 'full' },
    { centrePx: [120, 120], radiusPx: 80, pxPerDp: 80 / R_DP, fontScale: 1 },
    staticsFor('abyss', EXTENSIONS as never),
  );
  return { ...built, grain: { inside: 0, ground: 0 }, dither: 0 };
}

type Pixel = (frame: FieldFrame, q: readonly number[]) => Oklab;
const at = (frame: FieldFrame, q: readonly number[]): [number, number] => [frame.centrePx[0] + q[0] * frame.radiusPx, frame.centrePx[1] - q[1] * frame.radiusPx];
const LAW: Pixel = (frame, q) => fieldOklab(frame, ...at(frame, q));
const planted = (seam: Seam): Pixel => (frame, q) => twinPixel(frame, ...at(frame, q), { rank: 'nodes', w: 'node', seam });
const LINEAR_W = planted({ w: 'linear', leg: 'eased' });
const LINEAR_LEG = planted({ w: 'squared', leg: 'linear' });
/** c)'s CURRENT_BETA: β = smoothstep(0, θ, (E1 − E3)/E1) with L5′ and the rest the law's. */
const RATIO_BETA = planted({ w: 'squared', leg: 'eased', beta: 'ratio' });

/** The pooled nodes in rank order (ties to the lower id, as rankNodes), r over the top three, and β there. */
function ranked(frame: FieldFrame, q: readonly number[]) {
  const terms = pixelTerms(frame, ...at(frame, q));
  const { E } = pooledNodes(terms.e, slotColours(frame, terms), frame.nodes.map((n) => n.id));
  const order = [0, 1, 2, 3, 4].sort((a, b) => E[b] - E[a] || a - b);
  const r = E[order[0]] > 0 ? rOf(E[order[0]], E[order[1]], E[order[2]]) : 0;
  return { order, E, r, beta: E[order[0]] > 0 ? smoothstep(0, THETA, r) : 0 };
}

type Kind = '12' | '23';
interface Crossing {
  readonly q: [number, number];
  readonly dir: [number, number];
  readonly kind: Kind;
  /** The top three node ids on the side the line comes from. */
  readonly ids: readonly number[];
  /** β at the stencil's three samples, −h, 0 and +h. */
  readonly betas: readonly number[];
  /** r at the crossing. */
  readonly r: number;
  /** |g|/|∇g| at q, g the gap of the pair that does not swap: a lower bound on the distance to the triple point. */
  readonly dist: number;
}
const topSet = (o: readonly number[]) => o.slice(0, 3).sort().join();
/** The change between two rank orders: one adjacent swap of the top three, none, more than one, or a new top-three set (null). */
function swapKind(a: readonly number[], b: readonly number[]): Kind | 'same' | 'multi' | null {
  if (topSet(a) !== topSet(b)) return null;
  if (a[0] === b[1] && a[1] === b[0] && a[2] === b[2]) return '12';
  if (a[0] === b[0] && a[1] === b[2] && a[2] === b[1]) return '23';
  return a.slice(0, 3).join() === b.slice(0, 3).join() ? 'same' : 'multi';
}

/**
 * Every crossing of the 1–2 and 2–3 swap loci on lines 1/32 R apart, sampled at 1/256 R. An interval whose
 * ranks change by more than one adjacent swap is split until each piece holds one, so crossings near the
 * triple point are found, not skipped; each is bisected 60 times. A crossing counts where the swapping pair
 * is lit. The exclusions come back by name.
 */
function survey(frame: FieldFrame): { crossings: Crossing[]; excluded: string[] } {
  const crossings: Crossing[] = [];
  const excluded: string[] = [];
  const lim = frame.ringInner - 0.02;
  const name = (why: string, q: readonly number[], kind?: Kind) => `${why}${kind ? ` ${kind}` : ''} (${q.map((v) => v.toFixed(4)).join(', ')})`;
  for (const axis of [0, 1]) {
    for (let line = -30; line <= 30; line++) {
      const point = (s: number): [number, number] => (axis === 0 ? [s, line / 32] : [line / 32, s]);
      const dir: [number, number] = axis === 0 ? [1, 0] : [0, 1];
      const found = (lo: number, hi: number, a: readonly number[], b: readonly number[], depth: number): void => {
        const kind = swapKind(a, b);
        if (kind === 'same') return;
        if (kind === null || kind === 'multi') {
          // The top three changed between the samples, or two swaps lie between them: split.
          if (depth > 40) {
            excluded.push(name(kind === null ? 'set' : 'UNRESOLVED: two swaps within 2^-48 R', point((lo + hi) / 2)));
            return;
          }
          const m = (lo + hi) / 2;
          const om = ranked(frame, point(m)).order;
          found(lo, m, a, om, depth + 1);
          found(m, hi, om, b, depth + 1);
          return;
        }
        if (!(ranked(frame, point(lo)).E[kind === '23' ? a[2] : a[1]] > 0)) return;
        const [u, v] = kind === '23' ? [a[1], a[2]] : [a[0], a[1]];
        const f = (s: number) => {
          const r = ranked(frame, point(s));
          return r.E[u] - r.E[v];
        };
        let l = lo;
        let h = hi;
        const sign = Math.sign(f(l));
        for (let n = 0; n < 60; n++) {
          const m = (l + h) / 2;
          if (Math.sign(f(m)) === sign) l = m;
          else h = m;
        }
        const q = point((l + h) / 2);
        const side = (j: number) => ranked(frame, [q[0] + j * H * dir[0], q[1] + j * H * dir[1]]);
        const [m, z, p] = [side(-1), side(0), side(1)];
        const [g1, g2] = kind === '23' ? [a[0], a[1]] : [a[1], a[2]];
        const gap = (qq: readonly number[]) => {
          const r = ranked(frame, qq);
          return r.E[g1] - r.E[g2];
        };
        const eps = 1e-6;
        const gx = (gap([q[0] + eps, q[1]]) - gap([q[0] - eps, q[1]])) / (2 * eps);
        const gy = (gap([q[0], q[1] + eps]) - gap([q[0], q[1] - eps])) / (2 * eps);
        const dist = Math.abs(gap(q)) / Math.hypot(gx, gy);
        if (topSet(m.order) !== topSet(z.order) || topSet(p.order) !== topSet(z.order)) excluded.push(name('set', q, kind));
        else if (dist < 2 * H) excluded.push(name('triple', q, kind));
        else if (swapKind(m.order, p.order) !== kind) excluded.push(name('UNEXPLAINED: the ranks at ±h are not the two sides', q, kind));
        else crossings.push({ q, dir, kind, ids: a.slice(0, 3), betas: [m.beta, z.beta, p.beta], r: z.r, dist });
      };
      let prev: { s: number; order: number[] } | null = null;
      for (let k = -256; k <= 256; k++) {
        const s = k / 256;
        if (Math.hypot(...point(s)) > lim) {
          prev = null;
          continue;
        }
        const { order } = ranked(frame, point(s));
        if (prev) found(prev.s, s, prev.order, order, 0);
        prev = { s, order };
      }
    }
  }
  return { crossings, excluded };
}

/** Each case's frame and survey, computed once for every test that reads it. */
const surveys = new Map<string, { frame: FieldFrame; crossings: Crossing[]; excluded: string[] }>();
function surveyed(face: Face, scene: string, state: State) {
  const key = `${face} ${scene} ${state}`;
  let s = surveys.get(key);
  if (!s) {
    const frame = frameOf(face, scene, state);
    s = { frame, ...survey(frame) };
    surveys.set(key, s);
  }
  return s;
}

const K = (frame: FieldFrame, pixel: Pixel, c: Crossing, h: number) => {
  const p = (j: number) => pixel(frame, [c.q[0] + j * h * c.dir[0], c.q[1] + j * h * c.dir[1]]);
  const [m, z, n] = [p(-1), p(0), p(1)];
  return Math.hypot(n.L - 2 * z.L + m.L, n.a - 2 * z.a + m.a, n.b - 2 * z.b + m.b) / h;
};
/** Is β below 1 at any of the stencil's three samples? */
const fades = (c: Crossing) => c.betas.some((b) => b < 1);

/**
 * The amended a) over a set of crossings: the worst K(h) overall, where β = 1 and where β < 1; the crossings
 * that fail the kink clause (i); and those that fail (i), (ii) or (iii), each with r, β, the distance, K(h)
 * and K(h/4).
 */
function slopeProof(frame: FieldFrame, pixel: Pixel, cs: readonly Crossing[]) {
  let worst = 0;
  let worstOne = 0;
  let worstFade = 0;
  const kinks: string[] = [];
  const fails: string[] = [];
  for (const c of cs) {
    const k = K(frame, pixel, c, H);
    const quarter = K(frame, pixel, c, H / 4);
    const faded = fades(c);
    worst = Math.max(worst, k);
    if (faded) worstFade = Math.max(worstFade, k);
    else worstOne = Math.max(worstOne, k);
    const kink = !(quarter <= 0.3 * k + 1e-9);
    const line = `${c.kind} (${c.q.map((v) => v.toFixed(4)).join(', ')}): r ${c.r.toFixed(4)}, β ${Math.min(...c.betas).toFixed(4)}, distance ≥ ${c.dist.toExponential(2)} R, K ${k.toExponential(3)}, at h/4 ${quarter.toExponential(3)}`;
    if (kink) kinks.push(line);
    if (kink || !(k <= (faded ? FADE_BOUND : BOUND))) fails.push(line);
  }
  return { worst, worstOne, worstFade, kinks, fails };
}

const CASES = (['dark', 'light'] as Face[]).flatMap((face) => [...TRIPLES, ...PAIRS].flatMap((scene) => (Object.keys(STATES) as State[]).map((state) => [face, scene, state] as const)));
const TRIPLE_CASES = CASES.filter(([, scene]) => TRIPLES.includes(scene));
const PAIR_CASES = CASES.filter(([, scene]) => PAIRS.includes(scene));

describe('UI-139 and UI-142, the slope proof (Ruling 1 round 2, amended a)): every 1–2 and 2–3 crossing, inside the triple fade too', () => {
  it.each(CASES)('Abyss %s, %s, %s: (i) everywhere, (ii) where β = 1, (iii) where β < 1; the exclusions listed and counted', (face, scene, state) => {
    const { frame, crossings: cs, excluded } = surveyed(face, scene, state);
    const law = slopeProof(frame, LAW, cs);
    const expected = EXPECTED_EXCLUSIONS[`${face} ${scene} ${state}`] ?? [];
    console.info(
      `seamSlope ${face} ${scene} ${state}: crossings ${cs.length} (12 ${cs.filter((c) => c.kind === '12').length}, 23 ${cs.filter((c) => c.kind === '23').length}, β < 1 ${cs.filter(fades).length}); ` +
        `excluded ${excluded.length} [${excluded.join('; ')}]; law worst (ii) ${law.worstOne.toExponential(3)} per R, (iii) ${law.worstFade.toExponential(3)} per R`,
    );
    expect(excluded).toEqual(expected);
    expect(excluded.length).toBe(expected.length);
    expect(cs.length).toBeGreaterThan(50);
    expect(law.fails).toEqual([]);
  });

  it.each(TRIPLE_CASES)('Abyss %s, %s, %s: b) ≥ 5 crossings with β < 1; c) the planted ratio β exceeds 0.40 per R there and fails (i) at half of them or more', (face, scene, state) => {
    const { frame, crossings } = surveyed(face, scene, state);
    const faded = crossings.filter(fades);
    expect(faded.length).toBeGreaterThanOrEqual(5);
    const plant = slopeProof(frame, RATIO_BETA, faded);
    console.info(`seamSlope c) ${face} ${scene} ${state}: the ratio plant over ${faded.length} crossings with β < 1: worst ${plant.worst.toExponential(3)} per R, (i) fails at ${plant.kinks.length}`);
    expect(plant.worst).toBeGreaterThan(RATIO_PLANT_FLOOR);
    expect(plant.kinks.length).toBeGreaterThanOrEqual(faded.length / 2);
  });

  it.each(TRIPLE_CASES)('Abyss %s, %s, %s: UI-125’s plant, L5 as it was (linear w) with the rest the law’s, kinks across the second-to-third swap', (face, scene, state) => {
    const { frame, crossings } = surveyed(face, scene, state);
    const cs = crossings.filter((c) => c.kind === '23');
    expect(cs.length).toBeGreaterThan(40);
    const plant = slopeProof(frame, LINEAR_W, cs);
    expect(plant.worst).toBeGreaterThan(2 * BOUND);
    expect(plant.fails.length).toBeGreaterThan(cs.length / 4);
  });

  it.each(PAIR_CASES)('Abyss %s, %s, %s, no third node: r ≥ 1.5 and β = 1 bit for bit at every stencil sample, no crossing with β < 1, and the colour is the L5′ pair bit for bit', (face, scene, state) => {
    const { frame, crossings: cs } = surveyed(face, scene, state);
    expect(cs.length).toBeGreaterThan(20);
    expect(cs.filter(fades)).toHaveLength(0);
    const ids = frame.nodes.map((n) => n.id);
    const off: string[] = [];
    let belowExact = 0;
    for (const c of cs) {
      for (const j of [-1, 0, 1]) {
        const q = [c.q[0] + j * H * c.dir[0], c.q[1] + j * H * c.dir[1]];
        const terms = pixelTerms(frame, ...at(frame, q));
        const colours = slotColours(frame, terms);
        const { E, C } = pooledNodes(terms.e, colours, ids);
        const [i1, i2, e3] = rankNodes(E);
        const r = rOf(E[i1], E[i2], e3);
        const pair = seamPair(C[i1], C[i2], E[i1], E[i2], e3, isWaypoint(i1, i2, frame.restIntenseWaypoint), LAW_SEAM);
        const law = selectColour(terms.e, colours, ids, frame.restIntenseWaypoint, frame.tripleFade);
        if (r < 1.5) belowExact++;
        if (!(e3 === 0 && r >= R_FLOOR && smoothstep(0, THETA, r) === 1 && JSON.stringify(law) === JSON.stringify(pair))) off.push(`${c.kind} (${q.map((v) => v.toFixed(5)).join(', ')}): e3 ${e3}, r ${r}`);
      }
    }
    console.info(`seamSlope b) ${face} ${scene} ${state}: ${3 * cs.length} stencil samples, r below 1.5 by rounding at ${belowExact}`);
    expect(off).toEqual([]);
  });
});


describe('UI-125, the waypoint leg: s(2t) reaches N12 with slope 0 from both sides; the planted linear leg kinks', () => {
  const lab = (L: number, C: number, h: number) => oklchToOklab({ L, C, h });
  const J = lab(0.78, 0.09, 95);
  const I = lab(0.55, 0.11, 20);
  const C = lab(0.65, 0.08, 230);
  const ids = [NODE.J, NODE.I, NODE.C, NODE.R, NODE.R0, NODE.R0];
  /** The colour along the swap: J at 1 − u, I at 1 + u, a third at e3. */
  const along = (select: (e: number[], colours: Oklab[]) => Oklab, u: number, e3: number) => select([1 - u, 1 + u, e3, 0, 0, 0], [J, I, C, C, C, C]);
  const law = (e: number[], colours: Oklab[]) => selectColour(e, colours, ids, false, THETA);
  const linearLeg = (e: number[], colours: Oklab[]) => seamSelect(e, colours, ids, false, THETA, { w: 'squared', leg: 'linear' });

  it.each([0, 0.3])('with a third at e3 = %s: at the swap (t = ½) the colour is N12, and its one-sided slopes are O(ε) on both sides', (e3) => {
    const N = { L: (J.L + I.L) / 2, a: 0, b: 0 };
    expect(deltaE(along(law, 0, e3), N)).toBeLessThanOrEqual(1e-15);
    for (const eps of [1e-3, 1e-5]) {
      const right = deltaE(along(law, eps, e3), N) / eps;
      const left = deltaE(along(law, -eps, e3), N) / eps;
      expect(Math.max(left, right)).toBeLessThanOrEqual(10 * eps);
      // The plant arrives at full speed, from J's side and from I's, along two directions.
      const plantRight = deltaE(along(linearLeg, eps, e3), N) / eps;
      const plantLeft = deltaE(along(linearLeg, -eps, e3), N) / eps;
      expect(Math.min(plantLeft, plantRight)).toBeGreaterThan(0.05);
    }
  });

  it('the mirrored form: with v = w_I/(w_J + w_I), the pair is N12 + (C_J − N12)(1 − 2v)² for v ≤ ½ and N12 + (C_I − N12)(2v − 1)² for v ≥ ½', () => {
    const N = { L: (J.L + I.L) / 2, a: 0, b: 0 };
    let worst = 0;
    for (let k = -50; k <= 50; k++) {
      const u = k / 60;
      const e = [1 - u, 1 + u, 0, 0, 0, 0];
      const wJ = e[0] ** 2;
      const wI = e[1] ** 2;
      const v = wI / (wJ + wI);
      const end = v <= 0.5 ? J : I;
      const f = (1 - 2 * v) ** 2;
      const mirrored = { L: N.L + (end.L - N.L) * f, a: N.a + (end.a - N.a) * f, b: N.b + (end.b - N.b) * f };
      worst = Math.max(worst, deltaE(law(e, [J, I, C, C, C, C]), mirrored));
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  const LEG_CASES = CASES.filter(([, scene]) => ['seam', 'seam.waypoint', 'seam.meet'].includes(scene));
  it.each(LEG_CASES)('rendered, Abyss %s, %s, %s: at every crossing of a waypoint pair’s swap (through N12) the law holds a), and the planted linear leg fails it', (face, scene, state) => {
    const { frame, crossings } = surveyed(face, scene, state);
    const cs = crossings.filter((c) => c.kind === '12' && isWaypoint(c.ids[0], c.ids[1], frame.restIntenseWaypoint));
    expect(cs.length).toBeGreaterThan(20);
    expect(slopeProof(frame, LAW, cs).fails).toEqual([]);
    const plant = slopeProof(frame, LINEAR_LEG, cs);
    expect(plant.worst).toBeGreaterThan(2 * BOUND);
    expect(plant.fails.length).toBeGreaterThan(cs.length / 4);
  });

  it('a straight pair’s swap (first and second, the third unchanged) stays smooth too: a regression pin on both laws’ smooth part', () => {
    const { frame, crossings } = surveyed('dark', 'three', 'still');
    const cs = crossings.filter((c) => c.kind === '12');
    expect(cs.length).toBeGreaterThan(40);
    expect(cs.every((c) => !isWaypoint(c.ids[0], c.ids[1], frame.restIntenseWaypoint))).toBe(true);
    expect(slopeProof(frame, LAW, cs).fails).toEqual([]);
  });
});

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

describe('the plants are honest: the twin harness with the law’s seam is the law, bit for bit', () => {
  it('seamSelect(LAW_SEAM) equals selectColour on 2000 random trials, ids drawn with duplicates, both routings', () => {
    const next = random(125);
    const IDS = [NODE.J, NODE.C, NODE.R, NODE.I, NODE.R0];
    let off = 0;
    for (let n = 0; n < 2000; n++) {
      const colours = Array.from({ length: 6 }, () => gamutColour(next));
      const ids = Array.from({ length: 6 }, () => IDS[Math.floor(next() * IDS.length)]);
      const e = Array.from({ length: 6 }, () => (next() < 0.2 ? 0 : next()));
      if (!e.some((x) => x > 0)) e[0] = 1;
      const routed = next() < 0.5;
      if (JSON.stringify(seamSelect(e, colours, ids, routed, THETA, LAW_SEAM)) !== JSON.stringify(selectColour(e, colours, ids, routed, THETA))) off++;
    }
    expect(off).toBe(0);
  });
});
