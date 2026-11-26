import { oklabToXyz, xyzToLinearSrgb, type Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { NODE, fieldOklab, inertNode, inertShadow, smoothstep, type FieldFrame, type FieldNodeFrame } from '../fieldLaw.ts';
import { samplePoints } from '../flashCount.ts';
import { QUAD } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// Law round 2, item 2a (QA-068; designer L1–L3, resilience B3): a node's share of a pixel is continuous
// in its own fade, and exactly zero at fade 0.
//   L1  the lobe has a core: ρ_i = r_i²/(|q′ − c_i|² + κ·r_i²), f_i = fade_i·ρ_i, κ = field.lobe.core;
//   L2  the halos add, up to the peak: H = min(haloPeak, Σ h_i);
//   L3  the selection weight is linear in the fade: e_i = fade_i·(extent·ρ_i + λ·η_i), λ = 1/κ.
// B3: at a fade φ the pixel is within Kφ of the pixel at fade 0, K = 0.32/κ (8 at κ 0.04; designer,
// UI-120), in Y and in OKLab ΔE separately (float, before the encode), exactly at the lobe's centre,
// 1e-4 R from it, and at every E4 sample.

const R_DP = BASE.plate.maxDiameter / 2;
const C_PX = 1.5 * R_DP;
const geometry = { centrePx: [C_PX, C_PX] as [number, number], radiusPx: R_DP, pxPerDp: 1, fontScale: 1 };
const statics = staticsFor('abyss', EXTENSIONS as never);
const FACES: Face[] = ['dark', 'light'];
const PHIS = [1e-6, 1e-4, 1e-3, 1e-2, 0.05];

/** WCAG relative luminance of a float OKLab colour, clamped to the gamut in linear light. */
const relY = (c: Oklab) => {
  const [r, g, b] = xyzToLinearSrgb(oklabToXyz(c)).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const deltaE = (p: Oklab, q: Oklab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
const pixelAt = (frame: FieldFrame, [qx, qy]: readonly [number, number]) => fieldOklab(frame, frame.centrePx[0] + qx * frame.radiusPx, frame.centrePx[1] - qy * frame.radiusPx);

/**
 * A real Abyss frame from the builder (the four quadrant beads and the face's rest lobes at fade 1,
 * c = 1, genesis), unwarped and with no grain or dither, so a lobe's centre is a known pixel. Its nodes
 * are the templates the cases place.
 */
function base(face: Face): { frame: FieldFrame; of: Record<'J' | 'C' | 'R' | 'I' | 'R0', FieldNodeFrame> } {
  const built = buildFieldFrame(
    {
      direction: 'abyss', face, placements: QUAD.map((q, i) => ({ x: q.x, y: q.y, fade: 1, ordinal: i })), restFade: 1,
      stress: 0, confidence: 1, genesis: true, tMs: 7000, breathPhase: 0.3, tier: 'full',
    },
    geometry,
    statics,
  );
  const find = (id: number, rest: boolean) => built.nodes.find((n) => n.id === id && (n.bead === null) === rest && n.fade > 0)!;
  return {
    frame: { ...built, warp: { ...built.warp, amount: 0 }, grain: { inside: 0, ground: 0 }, dither: 0 },
    of: { J: find(NODE.J, false), C: find(NODE.C, false), R: find(NODE.R, false), I: find(NODE.I, false), R0: find(NODE.R0, true) },
  };
}

/** A node moved to c: Abyss centres a placement's lobe on its bead (centreAlpha 1, centreBeta 0). */
const at = (node: FieldNodeFrame, c: readonly [number, number], fade = 1): FieldNodeFrame => ({ ...node, fade, centre: [c[0], c[1]], bead: node.bead === null ? null : [c[0], c[1]] });
const away = (c: readonly [number, number], distance: number, deg: number): [number, number] => [c[0] + distance * Math.cos((deg * Math.PI) / 180), c[1] + distance * Math.sin((deg * Math.PI) / 180)];
const withNodes = (frame: FieldFrame, nodes: FieldNodeFrame[]): FieldFrame => ({ ...frame, nodes: [...nodes, ...Array.from({ length: 6 - nodes.length }, inertNode)] });

type Kind = 'R0' | 'J' | 'C' | 'R' | 'I';
interface Case { readonly label: string; readonly fading: Kind; readonly centre: readonly [number, number]; readonly others: ReadonlyArray<readonly [Kind, number, number]> }
/**
 * The fading node (a rest lobe, or a placement lobe with its halo) and the others at fade 1, 0.3–0.6 R
 * from its centre: one neighbour on a straight edge, on the J–I waypoint edge, and two neighbours, so
 * the seam's third node is lit too.
 */
const CASES: readonly Case[] = [
  ...[0.3, 0.45, 0.6].map((dist) => ({ label: `rest lobe, calm at ${dist} R`, fading: 'R0' as Kind, centre: [-0.3, 0.35] as const, others: [['C', dist, -30]] as const })),
  { label: 'rest lobe, intense at 0.45 R', fading: 'R0', centre: [-0.3, 0.35], others: [['I', 0.45, 150]] },
  { label: 'rest lobe, calm at 0.3 R and reflective at 0.6 R', fading: 'R0', centre: [-0.3, 0.35], others: [['C', 0.3, -30], ['R', 0.6, -120]] },
  ...[0.3, 0.45, 0.6].map((dist) => ({ label: `intense bead, joy at ${dist} R (waypoint)`, fading: 'I' as Kind, centre: [-0.4, 0.4] as const, others: [['J', dist, 0]] as const })),
  { label: 'calm bead, reflective at 0.45 R', fading: 'C', centre: [0.4, -0.4], others: [['R', 0.45, 180]] },
  { label: 'joy bead, calm at 0.3 R and intense at 0.6 R', fading: 'J', centre: [0.4, 0.4], others: [['C', 0.3, -90], ['I', 0.6, 180]] },
];

describe('the new law’s tokens (designer L1, L3, L6)', () => {
  it('field.lobe.core κ is 0.04, field.graph.lambda λ is 25, and λ·κ = 1: a halo at its peak weighs what a lobe weighs at its core', () => {
    expect(BASE.field.lobe.core).toBe(0.04);
    expect(BASE.field.graph.lambda).toBe(25);
    expect(BASE.field.graph.lambda * BASE.field.lobe.core).toBeCloseTo(1, 12);
  });

  it('the builder carries κ and λ from the tokens into every frame', () => {
    const { frame } = base('dark');
    expect([frame.lobeCore, frame.lambda]).toEqual([BASE.field.lobe.core, BASE.field.graph.lambda]);
  });
});

describe('L1: the lobe has a core, so a lobe at fade φ gives at most φ/κ, never a pixel’s whole weight', () => {
  it.each(FACES)('%s face: a lone rest lobe at its own centre weighs smoothstep(0.55, 1.6, φ/κ) of the field', (face) => {
    const { frame, of } = base(face);
    const flat = { ...frame, vignette: 0, centreLift: 0, shadows: [inertShadow(), inertShadow()] };
    const c: [number, number] = [-0.3, 0.35];
    for (const phi of [0.01, 0.02, 0.04, 0.06]) {
      const f = withNodes(flat, [at(of.R0, c, phi)]);
      const k = Math.min(f.kField * smoothstep(0.55, 1.6, phi / f.lobeCore) * f.mask.face, f.kMax);
      const g = f.grounds.face;
      const out = pixelAt(f, c);
      expect(out.L).toBeCloseTo(g.L + (of.R0.field.L - g.L) * k, 9);
    }
  });
});

describe('L2: the halos add, up to the peak (H = min(haloPeak, Σh))', () => {
  // In the ring the field is absent (extent 0), so k is H itself.
  it.each(FACES)('%s face: two halves of one halo at one spot draw the whole halo, and two whole halos draw no more than one', (face) => {
    const { frame, of } = base(face);
    const ring: [number, number] = [0, (frame.ringInner + 1) / 2];
    const whole = pixelAt(withNodes(frame, [at(of.C, ring, 1)]), ring);
    const halves = pixelAt(withNodes(frame, [at(of.C, ring, 0.6), at(of.C, ring, 0.4)]), ring);
    // Two, not three: three equal nodes are an exact triple tie, which the seam law fades to N̄ (L6).
    const two = pixelAt(withNodes(frame, [at(of.C, ring, 1), at(of.C, ring, 1)]), ring);
    expect(deltaE(halves, whole)).toBeLessThan(1e-12);
    expect(deltaE(two, whole)).toBeLessThan(1e-12);
    // Not vacuous: the halo shows there, and a half halo alone is less.
    expect(deltaE(whole, frame.grounds.ring)).toBeGreaterThan(0.02);
    expect(deltaE(pixelAt(withNodes(frame, [at(of.C, ring, 0.6)]), ring), whole)).toBeGreaterThan(0.005);
  });
});

describe('fade 0 is the inert slot, bit for bit (designer: “exactly zero at fade 0”)', () => {
  it.each(FACES)('%s face: every case’s frame with its fading node at fade 0 equals the frame with that slot inert, at every sample', (face) => {
    const { frame, of } = base(face);
    const points = samplePoints('cycle4');
    let checked = 0;
    for (const c of CASES) {
      const others = c.others.map(([k, dist, deg]) => at(of[k], away(c.centre, dist, deg)));
      const zero = withNodes(frame, [at(of[c.fading], c.centre, 0), ...others]);
      const inert = withNodes(frame, [inertNode(), ...others]);
      for (const p of [c.centre, ...points]) {
        expect(pixelAt(zero, p)).toEqual(pixelAt(inert, p));
        checked++;
      }
    }
    expect(checked).toBe(CASES.length * (points.length + 1));
  });
});

/**
 * B3 (the designer's ruling, UI-120): |Y(φ) − Y(0)| ≤ Kφ and ΔE_OK(φ, 0) ≤ Kφ, checked separately, with
 * K = 0.32/κ from the token field.lobe.core (8 at κ 0.04). A lobe at fade φ weighs up to φ/κ at its core,
 * so the constant follows κ; the 0.32 is the designer's, never loosened to fit a measurement.
 */
const B3_K = 0.32 / BASE.field.lobe.core;

interface B3Measure { readonly worstY: number; readonly worstE: number; readonly worstYAt: string; readonly worstEAt: string; readonly over: string[]; readonly checked: number }

/** Every case, φ and point on one face, with the frame's κ replaced by `kappa` (only the lobe core). */
function measureB3(face: Face, kappa: number, bound: number): B3Measure {
  const { frame: built, of } = base(face);
  const frame = { ...built, lobeCore: kappa };
  const points = samplePoints('cycle4');
  const over: string[] = [];
  let worstY = 0;
  let worstE = 0;
  let worstYAt = '';
  let worstEAt = '';
  let checked = 0;
  for (const c of CASES) {
    const others = c.others.map(([k, dist, deg]) => at(of[k], away(c.centre, dist, deg)));
    const zero = withNodes(frame, [at(of[c.fading], c.centre, 0), ...others]);
    const where: Array<readonly [string, readonly [number, number]]> = [
      ['centre', c.centre],
      ['1e-4 R off', [c.centre[0] + 1e-4, c.centre[1]]],
      ...points.map((p) => [`E4 (${p[0].toFixed(3)}, ${p[1].toFixed(3)})`, p] as const),
    ];
    for (const phi of PHIS) {
      const lit = withNodes(frame, [at(of[c.fading], c.centre, phi), ...others]);
      for (const [name, p] of where) {
        const a = pixelAt(lit, p);
        const b = pixelAt(zero, p);
        const y = Math.abs(relY(a) - relY(b)) / phi;
        const e = deltaE(a, b) / phi;
        const label = `${c.label}, φ ${phi}, ${name}`;
        checked++;
        // A non-finite measurement (κ 0 at a lobe's exact centre) is a failure, never a pass.
        if (!Number.isFinite(y) || y > worstY) [worstY, worstYAt] = [Number.isFinite(y) ? y : Infinity, label];
        if (!Number.isFinite(e) || e > worstE) [worstE, worstEAt] = [Number.isFinite(e) ? e : Infinity, label];
        if (!(y <= bound) || !(e <= bound)) over.push(`${label}: ΔY ${y.toFixed(3)}φ, ΔE ${e.toFixed(3)}φ`);
      }
    }
  }
  return { worstY, worstE, worstYAt, worstEAt, over, checked };
}

describe('B3: no win at a tiny fade, |ΔY| ≤ Kφ and ΔE_OK ≤ Kφ with K = 0.32/κ (designer, UI-120)', () => {
  it('K comes from the token: κ (field.lobe.core) is pinned at 0.04, so K is 8', () => {
    expect(BASE.field.lobe.core).toBe(0.04);
    expect(B3_K).toBeCloseTo(8, 12);
  });

  it.each(FACES)('%s face: every fading node, at its centre, 1e-4 R from it and at every E4 sample, for φ from 1e-6 to 0.05, Y and ΔE each within Kφ', (face) => {
    const m = measureB3(face, BASE.field.lobe.core, B3_K);
    // The measured constants, for the record (UI-120 asks for the ΔE worst, not only Y).
    console.info(`B3 ${face} κ ${BASE.field.lobe.core} K ${B3_K}: worst ΔY ${m.worstY.toFixed(3)}φ at ${m.worstYAt}; worst ΔE ${m.worstE.toFixed(3)}φ at ${m.worstEAt}`);
    expect({ over: m.over.slice(0, 12), count: m.over.length }).toEqual({ over: [], count: 0 });
    expect(m.checked).toBe(CASES.length * PHIS.length * (samplePoints('cycle4').length + 2));
    // Not vacuous: the fading node does move the pixels, in proportion to φ, in Y and in ΔE.
    expect(m.worstY).toBeGreaterThan(0.05);
    expect(m.worstE).toBeGreaterThan(0.05);
  });

  // Planted controls: a sharper core (smaller κ) lets a lobe at fade φ win the pixel, and the token's K
  // must catch it. Only the lobe core is planted; λ stays the token's. The bound is one statement over
  // both faces, so a plant fails it when any face goes over (κ 0.01 goes over on dark only).
  it.each([0, 0.004, 0.01])('planted κ %s fails the token’s bound K = 0.32/0.04 on the two faces', (kappa) => {
    let over = 0;
    let worst = 0;
    for (const face of FACES) {
      const m = measureB3(face, kappa, B3_K);
      console.info(`B3 plant ${face} κ ${kappa}: worst ΔY ${m.worstY.toFixed(3)}φ at ${m.worstYAt}; worst ΔE ${m.worstE.toFixed(3)}φ at ${m.worstEAt}; ${m.over.length} of ${m.checked} over ${B3_K}φ`);
      over += m.over.length;
      worst = Math.max(worst, m.worstY, m.worstE);
    }
    expect(over).toBeGreaterThan(0);
    expect(worst).toBeGreaterThan(B3_K);
  });
});
