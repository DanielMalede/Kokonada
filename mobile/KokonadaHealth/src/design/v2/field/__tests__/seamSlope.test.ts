import { inSrgbGamut } from '../../color/gamut.ts';
import { oklchToOklab, type Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { NODE, fieldOklab, isWaypoint, pixelTerms, pooledNodes, rankNodes, selectColour, slotColours, smoothstep, type FieldFrame } from '../fieldLaw.ts';
import { LAW_SEAM, seamSelect, twinPixel, type Seam } from '../lawTwins.ts';
import { staticsFor } from '../statics.ts';

// UI-125 (F1, the designer's slope polish of law round 2, on the amended L4 of D5b): D3's seam was
// continuous but its slope broke, so Mach bands drew a pinwheel vertex and faint streaks.
//   Why: across the second-to-third swap line (E2 = E3) the ranked E2 and E3 trade places, so
//   w2 = E2 − E3 = |E_a − E_b| bends like |·| and t = w2/(w1 + w2) with it; and on a waypoint pair the
//   leg C1→N12 by 2t reaches N12 at full speed from each side, along two different directions.
//   L5′: w1 = (E1 − E3)², w2 = (E2 − E3)², t = w2/(w1 + w2) (0 where w1 = 0); w2 and its slope are 0 on
//   E2 = E3, so t has slope 0 from both sides there. The waypoint leg: P = C1 + (N12 − C1)·s(2t),
//   s(x) = 1 − (1 − x)², so s′(1) = 0 and the leg arrives at N12 with slope 0. β is unchanged:
//   smoothstep(0, θ, (E1 − E3)/E1) on the linear ratio (the designer: "no other change").
//   The mirrored form: with v = w_b/(w_a + w_b) the share of b along the pair a–b, the leg is
//   P = N12 + (C_a − N12)·(1 − 2v)² for v ≤ ½ (a leads) and P = N12 + (C_b − N12)·(2v − 1)² for v ≥ ½
//   (b leads): one curve through the swap, slope 0 at v = ½ from both sides.
//
// The slope proof (resilience's done-when for UI-125): on the float law pixel (grain and dither 0), at
// each crossing of a swap locus found on horizontal and vertical lines through the face, the central
// second difference along the line, K(h) = |c(q + h) − 2c(q) + c(q − h)|/h in OKLab per R. At a kink K(h)
// tends to the jump in the first difference's slope and stays put as h shrinks; where the colour is
// smooth K(h) = |c″|·h + O(h²) and quarters with h. Measured at d0f47a8 (probe ui125-probe-slope, the
// stills' frames): L5′ at most 0.0254 at h = 1e-4 R, 0.0063 at h/4; the old law and the planted linear w
// 0.67 to 8.3, unchanged at h/4. The bound, 0.05 per R at h = 1e-4 R with K(h/4) ≤ 0.3·K(h) + 1e-9 at
// every crossing, sits 2× above the new law's worst and at least 2.6× below every plant's worst.
//   Left out, and stated: crossings where β < 1 at any stencil point, inside the triple fade (L6). There
//   β reads E1 and E3, the ranked largest and third, which bend across both loci, so a kink stays under
//   L5′ and under every reading of β (probe ui125-probe-beta); UI-125 changes L5 alone (reported to the
//   designer). Crossings within h of another locus are left out too (their stencil spans two loci).

const THETA = BASE.field.graph.tripleFade;
const R_DP = BASE.plate.maxDiameter / 2;
const H = 1e-4;
const BOUND = 0.05;
const deltaE = (p: Oklab, q: Oklab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);

const hero = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: Record<string, { placements: Array<{ x: number; y: number }> }> } } } }).base.$root.hero.scenes;
/** `three` and the two seam stills of the D3 board (build.mjs): a pair meeting a third, straight and waypoint. */
const STILLS: Record<string, ReadonlyArray<{ x: number; y: number }>> = {
  three: hero.three.placements,
  'seam.meet': [{ x: 0.45, y: 0.3 }, { x: 0.45, y: -0.3 }, { x: -0.5, y: 0 }],
  'seam.waypoint': [{ x: -0.3, y: 0.45 }, { x: 0.3, y: 0.45 }, { x: 0.35, y: -0.4 }],
  seam: hero.seam.placements,
};
/** The stills' state (the D3 board: s 0.3, no confidence, genesis off) and the heaviest presence. */
const STATES = { still: { stress: 0.3, confidence: null, genesis: false }, heaviest: { stress: 0, confidence: 1, genesis: true } } as const;
function frameOf(face: Face, scene: string, state: keyof typeof STATES): FieldFrame {
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

/** The pooled nodes in rank order (ties to the lower id, as rankNodes), and β there. */
function ranked(frame: FieldFrame, q: readonly number[]) {
  const terms = pixelTerms(frame, ...at(frame, q));
  const { E } = pooledNodes(terms.e, slotColours(frame, terms), frame.nodes.map((n) => n.id));
  const order = [0, 1, 2, 3, 4].sort((a, b) => E[b] - E[a] || a - b);
  const [i1, , e3] = rankNodes(E);
  return { order, E, beta: E[i1] > 0 ? smoothstep(0, THETA, (E[i1] - e3) / E[i1]) : 0 };
}

interface Crossing { readonly q: [number, number]; readonly dir: [number, number]; readonly ids: readonly number[] }
/**
 * The crossings of a locus on lines 1/32 R apart, sampled at 1/256 R and bisected 60 times: '23' where the
 * second and third swap (the first unchanged), '12' where the first and second swap (the third unchanged).
 * Kept only where the swapping pair is lit, β = 1 at the stencil's three points and the ranks at ±h are the two
 * sides' (one locus inside the stencil).
 */
function crossings(frame: FieldFrame, kind: '23' | '12'): Crossing[] {
  const out: Crossing[] = [];
  const lim = frame.ringInner - 0.02;
  const swapped = (a: readonly number[], b: readonly number[]) =>
    kind === '23' ? a[0] === b[0] && a[1] === b[2] && a[2] === b[1] : a[0] === b[1] && a[1] === b[0] && a[2] === b[2];
  for (const axis of [0, 1]) {
    for (let line = -30; line <= 30; line++) {
      const point = (s: number): [number, number] => (axis === 0 ? [s, line / 32] : [line / 32, s]);
      let prev: { s: number; order: number[] } | null = null;
      for (let k = -256; k <= 256; k++) {
        const s = k / 256;
        if (Math.hypot(...point(s)) > lim) {
          prev = null;
          continue;
        }
        const { order, E } = ranked(frame, point(s));
        if (prev && swapped(prev.order, order) && E[order[kind === '23' ? 2 : 1]] > 0) {
          const [u, v] = kind === '23' ? [prev.order[1], prev.order[2]] : [prev.order[0], prev.order[1]];
          const f = (x: number) => {
            const r = ranked(frame, point(x));
            return r.E[u] - r.E[v];
          };
          let lo = prev.s;
          let hi = s;
          const sign = Math.sign(f(lo));
          for (let n = 0; n < 60; n++) {
            const m = (lo + hi) / 2;
            if (Math.sign(f(m)) === sign) lo = m;
            else hi = m;
          }
          const q = point((lo + hi) / 2);
          const dir: [number, number] = axis === 0 ? [1, 0] : [0, 1];
          const side = (j: number) => ranked(frame, [q[0] + j * H * dir[0], q[1] + j * H * dir[1]]);
          const [m, z, p] = [side(-1), side(0), side(1)];
          if (m.beta === 1 && z.beta === 1 && p.beta === 1 && swapped(m.order, p.order) && m.order.join() === prev.order.join()) out.push({ q, dir, ids: prev.order.slice(0, 3) });
        }
        prev = { s, order };
      }
    }
  }
  return out;
}

const K = (frame: FieldFrame, pixel: Pixel, c: Crossing, h: number) => {
  const p = (j: number) => pixel(frame, [c.q[0] + j * h * c.dir[0], c.q[1] + j * h * c.dir[1]]);
  const [m, z, n] = [p(-1), p(0), p(1)];
  return Math.hypot(n.L - 2 * z.L + m.L, n.a - 2 * z.a + m.a, n.b - 2 * z.b + m.b) / h;
};

/** The proof over a set of crossings: the worst K(h), and the crossings that break the bound or do not quarter. */
function slopeProof(frame: FieldFrame, pixel: Pixel, cs: readonly Crossing[]) {
  let worst = 0;
  const kinks: string[] = [];
  for (const c of cs) {
    const k = K(frame, pixel, c, H);
    const quarter = K(frame, pixel, c, H / 4);
    worst = Math.max(worst, k);
    if (!(k <= BOUND && quarter <= 0.3 * k + 1e-9)) kinks.push(`(${c.q.map((v) => v.toFixed(4)).join(', ')}): K ${k.toExponential(3)}, at h/4 ${quarter.toExponential(3)}`);
  }
  return { worst, kinks };
}

const CASES = (['dark', 'light'] as Face[]).flatMap((face) => (['three', 'seam.meet', 'seam.waypoint'] as const).flatMap((scene) => (Object.keys(STATES) as Array<keyof typeof STATES>).map((state) => [face, scene, state] as const)));

describe('UI-125, the slope proof: across E2 = E3 the colour’s slope is continuous (L5′), and the planted linear w kinks', () => {
  it.each(CASES)('Abyss %s, %s, %s: K(h) ≤ 0.05 per R and quarters with h at every crossing of the second-to-third swap', (face, scene, state) => {
    const frame = frameOf(face, scene, state);
    const cs = crossings(frame, '23');
    expect(cs.length).toBeGreaterThan(40);
    const law = slopeProof(frame, LAW, cs);
    expect(law.kinks).toEqual([]);
    // The plant: L5 as it was (linear w) with everything else the law's, so the kink is w's alone.
    const plant = slopeProof(frame, LINEAR_W, cs);
    expect(plant.worst).toBeGreaterThan(2 * BOUND);
    expect(plant.kinks.length).toBeGreaterThan(cs.length / 4);
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

  const LEG_CASES = (['dark', 'light'] as Face[]).flatMap((face) => (['seam', 'seam.waypoint', 'seam.meet'] as const).flatMap((scene) => (Object.keys(STATES) as Array<keyof typeof STATES>).map((state) => [face, scene, state] as const)));
  it.each(LEG_CASES)('rendered, Abyss %s, %s, %s: at every crossing of a waypoint pair’s swap (through N12) K(h) ≤ 0.05 per R and quarters with h', (face, scene, state) => {
    const frame = frameOf(face, scene, state);
    const cs = crossings(frame, '12').filter((c) => isWaypoint(c.ids[0], c.ids[1], frame.restIntenseWaypoint));
    expect(cs.length).toBeGreaterThan(20);
    expect(slopeProof(frame, LAW, cs).kinks).toEqual([]);
    const plant = slopeProof(frame, LINEAR_LEG, cs);
    expect(plant.worst).toBeGreaterThan(2 * BOUND);
    expect(plant.kinks.length).toBeGreaterThan(cs.length / 4);
  });

  it('a straight pair’s swap (first and second, the third unchanged) stays smooth too: a regression pin on both laws’ smooth part', () => {
    const frame = frameOf('dark', 'three', 'still');
    const cs = crossings(frame, '12');
    expect(cs.length).toBeGreaterThan(40);
    expect(cs.every((c) => !isWaypoint(c.ids[0], c.ids[1], frame.restIntenseWaypoint))).toBe(true);
    expect(slopeProof(frame, LAW, cs).kinks).toEqual([]);
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
