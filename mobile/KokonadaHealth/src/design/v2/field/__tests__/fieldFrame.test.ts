import { oklabToOklch } from '../../color/oklab.ts';
import { breathCycles, breathLevel } from '../../motion/breathLaw.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { LIVE_SLOTS, NODE, NODE_SLOTS, inertNode } from '../fieldLaw.ts';
import { buildFieldFrame, fixedFieldBreath, nodeAt, placementRamp, type FieldState, type Placement } from '../fieldFrame.ts';
import { emptyLedger, placementsOf, reconcile } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';
import { FIELD_UNIFORMS, packFrame } from '../uniforms.ts';

// The uniform builder: tokens, the extensions the caller passes in (app code may not import them),
// and the state of the moment, to one FieldFrame. Everything that moves with t, s, c, the breath or
// the placements is computed here, in JS, never in the shader.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const T = BASE.field.clock.T;
const geometry = { centrePx: [200, 300] as [number, number], radiusPx: 150, pxPerDp: 1, fontScale: 1 };
const statics = (id: DirectionId) => staticsFor(id, EXTENSIONS as never);
const state = (id: DirectionId, face: Face, overrides: Partial<FieldState> = {}): FieldState => ({
  direction: id,
  face,
  placements: [{ x: 0.5, y: -0.3 }], // calm: x ≥ 0 pleasant, y < 0 less energy
  stress: 0,
  confidence: null,
  genesis: false,
  tMs: 7000,
  breathPhase: 0.3,
  tier: 'full',
  ...overrides,
});

describe('the statics come from the extensions the caller passes in', () => {
  it.each(IDS)('%s: rest lobes and drift harmonics, as the tokens hold them', (id) => {
    const s = statics(id);
    const ext = EXTENSIONS as unknown as Record<string, Record<string, { lobes?: unknown }>>;
    expect(s.restLobes).toEqual(ext[id]['field.rest'].lobes);
    expect(s.drift.harmonics).toEqual([[2, 3], [3, 2], [1, 2]]);
    expect(s.drift.phases).toEqual([[0, 0], [1.3, 0.7], [2.1, 4]]);
  });

  // The port's whole output, value by value (architect, fork 1, 1B). When the statics move to their
  // own generated module (1D), this pin is what proves the move changed nothing.
  const DRIFT = { harmonics: [[2, 3], [3, 2], [1, 2]], phases: [[0, 0], [1.3, 0.7], [2.1, 4]] };
  const FALLBACK_STOPS = { position: [0, 0.585, 0.63, 0.7, 0.815, 0.926, 1], weight: [1, 1, 0.89, 0.565, 0.171, 0.021, 0] };
  it.each([
    ['abyss', [[-0.35, -0.3], [0.4, 0.35]]],
    ['basin', [[0, 0]]],
    ['linen', [[-0.97, -0.56], [0.97, 0.56]]],
  ] as Array<[DirectionId, number[][]]>)('%s: every value of the port, pinned (rest lobes, drift, fallback stops)', (id, restLobes) => {
    expect(statics(id)).toEqual({ restLobes, drift: DRIFT, fallbackStops: FALLBACK_STOPS });
  });

  it('pins every direction', () => {
    expect([...IDS].sort()).toEqual(['abyss', 'basin', 'linen']);
  });
});

describe('the frame for a moment', () => {
  it.each(IDS)('%s: the geometry in plate units, from the tokens and the plate size', (id) => {
    const d = DIRECTIONS[id];
    const f = buildFieldFrame(state(id, 'dark'), geometry, statics(id));
    const rDp = geometry.radiusPx / geometry.pxPerDp;
    expect(f.ringInner).toBeCloseTo(1 - BASE.plate.labelBand.min / rDp, 12);
    expect(f.moatOuter).toBeCloseTo(1 + d.field.mask.moat / rDp, 12);
    expect(f.beadRadius).toBeCloseTo(d.bead.diameter / 2 / rDp, 12);
    expect(f.haloRadius).toBeCloseTo(BASE.field.halo.diameter / 2 / rDp, 12);
    expect(f.kMax).toBe(Math.max(d.field.cap.dark, BASE.field.halo.peakDark));
    expect(f.restIntenseWaypoint).toBe(d.field.graph.restIntenseRoute === 'waypoint');
  });

  it('a bead sits at its unit-disc position scaled to the layout radius, R minus the bead', () => {
    const f = buildFieldFrame(state('abyss', 'dark'), geometry, statics('abyss'));
    expect(f.nodes[0].bead).toEqual([0.5 * (1 - f.beadRadius), -0.3 * (1 - f.beadRadius)]);
    expect(f.nodes[0].id).toBe(NODE.C);
  });

  // Designer 2.7 with the critic's lightness (this was fieldFrame.test.ts:59-63): r 0.375 is p 0.5.
  it('a placement’s chroma is its ramp p times the bead chroma scale, and at p 0.5 its lightness is halfway from the rest glow', () => {
    const f = buildFieldFrame(state('linen', 'light', { placements: [{ x: 0.225, y: -0.3 }] }), geometry, statics('linen'));
    const anchor = BASE.emotion.calm.deep.oklch;
    const restGlow = DIRECTIONS.linen.color.light.field.restGlow.oklab[0];
    expect(oklabToOklch(f.nodes[0].halo).C).toBeCloseTo(anchor[1] * 0.5 * DIRECTIONS.linen.bead.chromaScale, 9);
    expect(f.nodes[0].halo.L).toBeCloseTo((restGlow + anchor[0]) / 2, 12);
  });

  it('centres a lobe by the direction’s rule: at the bead (Abyss), or 1.12R out along its angle (Linen)', () => {
    const still = { tMs: 0, stress: 1 }; // full stress: no extra drift, and at t = 0 none along x
    const abyss = buildFieldFrame(state('abyss', 'dark', still), geometry, statics('abyss'));
    expect(abyss.nodes[0].centre[0]).toBeCloseTo(abyss.nodes[0].bead![0], 12);
    const linen = buildFieldFrame(state('linen', 'dark', still), geometry, statics('linen'));
    const angle = Math.atan2(-0.3, 0.5);
    // At t = 0 lobe 0's drift is (sin 0, cos 0)·A_d: none along x, A_d(1) = A0·(1 − 0.4) along y.
    const drift = DIRECTIONS.linen.field.drift.A0 * (1 - BASE.field.stress.speed);
    expect(linen.nodes[0].centre[0]).toBeCloseTo(1.12 * Math.cos(angle), 9);
    expect(linen.nodes[0].centre[1]).toBeCloseTo(1.12 * Math.sin(angle) + drift, 9);
  });

  it('shows the rest lobes in the rest glow when nothing is placed, and none once a bead is', () => {
    const rest = buildFieldFrame(state('abyss', 'dark', { placements: [] }), geometry, statics('abyss'));
    expect(rest.nodes.filter((n) => n.fade > 0).map((n) => n.id)).toEqual([NODE.R0, NODE.R0]);
    const placed = buildFieldFrame(state('abyss', 'dark'), geometry, statics('abyss'));
    expect(placed.nodes.filter((n) => n.fade > 0).map((n) => n.id)).toEqual([NODE.C]);
  });

  it('a neutral placement lights the rest glow, with a lobe only where the direction has one', () => {
    const neutral = { placements: [{ x: 0.05, y: 0.05 }] }; // one.neutral (this was (0.2, 0.2), r 0.28: not neutral)
    const abyss = buildFieldFrame(state('abyss', 'dark', neutral), geometry, statics('abyss'));
    expect(abyss.nodes[0].id).toBe(NODE.R0);
    expect(abyss.nodes[0].radius).toBeGreaterThan(0);
    const linen = buildFieldFrame(state('linen', 'dark', neutral), geometry, statics('linen'));
    expect(linen.nodes[0].id).toBe(NODE.R0);
    expect(linen.nodes[0].radius).toBe(0); // no lobe; its halo stays
  });

  // Resilience QA-068 change 3 (it replaces "keeps the latest three placements: a fourth replaces
  // the oldest", which locked in the cut). A placement's identity is its ordinal; in a scene, its
  // order in the list.
  it('a fourth tap: the oldest stays until its fade is 0, and every surviving lobe keeps its centre', () => {
    const [J, C, R, I] = [[0.566, 0.566], [0.566, -0.566], [-0.566, -0.566], [-0.566, 0.566]].map(([x, y]) => ({ x, y }));
    const before = buildFieldFrame(state('abyss', 'dark', { placements: [J, C, R] }), geometry, statics('abyss'));
    const after = buildFieldFrame(state('abyss', 'dark', { placements: [{ ...J, fade: 0.3 }, C, R, { ...I, fade: 0.7 }] }), geometry, statics('abyss'));
    const byId = (frame: typeof before, id: number) => frame.nodes.find((n) => n.id === id && n.fade > 0)!;
    expect(byId(after, NODE.C).centre).toEqual(byId(before, NODE.C).centre);
    expect(byId(after, NODE.R).centre).toEqual(byId(before, NODE.R).centre);
    expect(byId(after, NODE.J).fade).toBe(0.3);
    expect(after.nodes.filter((n) => n.fade > 0)).toHaveLength(4);
  });
});

// Architect re-rule §4 T4 (critic items 5 and 6, with the designer's sentence): six node slots, three
// for live placements and three shared by rest lobes and leaving placements; slots are assigned
// deterministically (live by ordinal to 0–2; rest lobes by index, then leaving by ordinal, to 3–5), and
// a lobe's drift belongs to its placement's ordinal, mod the drift tables, for its whole life.
describe('six node slots and the ordinal', () => {
  const at = (x: number, y: number, more: Record<string, unknown> = {}) => ({ x, y, ...more });

  it('live placements take slots 0–2 by ordinal; rest lobes, then leaving placements by ordinal, take 3–5; the rest is inert', () => {
    const f = buildFieldFrame(
      state('abyss', 'dark', {
        placements: [at(0.5, 0.5, { ordinal: 5 }), at(-0.5, -0.5, { ordinal: 2, role: 'leaving', fade: 0.4 }), at(0.5, -0.5, { ordinal: 3 })],
        restFade: 0.5,
      }),
      geometry,
      statics('abyss'),
    );
    expect(f.nodes).toHaveLength(NODE_SLOTS);
    expect(f.nodes.map((n) => [n.id, n.fade])).toEqual([
      [NODE.C, 1], // ordinal 3
      [NODE.J, 1], // ordinal 5
      [NODE.R0, 0], // no third live placement
      [NODE.R0, 0.5], // rest lobe 0
      [NODE.R0, 0.5], // rest lobe 1
      [NODE.R, 0.4], // leaving, ordinal 2
    ]);
    expect(f.nodes[2]).toEqual(inertNode());
  });

  it('more than three live placements: the oldest beyond three take shared slots, as leaving, with their fades', () => {
    const f = buildFieldFrame(state('abyss', 'dark', { placements: [at(0.5, 0.5, { fade: 0.2 }), at(0.5, -0.5), at(-0.5, -0.5), at(-0.5, 0.5)] }), geometry, statics('abyss'));
    expect(f.nodes.slice(0, LIVE_SLOTS).map((n) => n.id)).toEqual([NODE.C, NODE.R, NODE.I]);
    expect(f.nodes.slice(LIVE_SLOTS).map((n) => [n.id, n.fade])).toEqual([[NODE.J, 0.2], [NODE.R0, 0], [NODE.R0, 0]]);
  });

  it('a lobe’s drift is its ordinal’s, mod the drift tables, wherever its slot', () => {
    const centreOf = (placements: Placement[], id: number) =>
      buildFieldFrame(state('abyss', 'dark', { placements, tMs: 7000 }), geometry, statics('abyss')).nodes.find((n) => n.id === id && n.fade > 0)!.centre;
    const C = at(0.5, -0.5);
    const tables = statics('abyss').drift.harmonics.length;
    expect(tables).toBe(3);
    expect(centreOf([{ ...C, ordinal: 4 }], NODE.C)).toEqual(centreOf([{ ...C, ordinal: 1 }], NODE.C));
    expect(centreOf([{ ...C, ordinal: 4 }], NODE.C)).not.toEqual(centreOf([{ ...C, ordinal: 0 }], NODE.C));
    // The same ordinal, alone or behind two others, in slot 0 or slot 2: the same centre.
    expect(centreOf([at(0.5, 0.5, { ordinal: 0 }), at(-0.5, -0.5, { ordinal: 1 }), { ...C, ordinal: 2 }], NODE.C)).toEqual(centreOf([{ ...C, ordinal: 2 }], NODE.C));
  });

  it('rest lobe i drifts on table i', () => {
    const rest = buildFieldFrame(state('abyss', 'dark', { placements: [], tMs: 7000 }), geometry, statics('abyss'));
    const lobes = statics('abyss').restLobes;
    const d = DIRECTIONS.abyss.field.drift;
    const A = d.A0 * (1 + (d.D - 1) * 1);
    const T0 = (i: number) => {
      const [kx, ky] = statics('abyss').drift.harmonics[i];
      const [px, py] = statics('abyss').drift.phases[i];
      return [lobes[i][0] + A * Math.sin((2 * Math.PI * kx * 7000) / T + px), lobes[i][1] + A * Math.cos((2 * Math.PI * ky * 7000) / T + py)];
    };
    const restNodes = rest.nodes.filter((n) => n.fade > 0);
    expect(restNodes).toHaveLength(2);
    restNodes.forEach((n, i) => {
      expect(n.centre[0]).toBeCloseTo(T0(i)[0], 12);
      expect(n.centre[1]).toBeCloseTo(T0(i)[1], 12);
    });
  });

  it('through the ledger: after a fourth tap every surviving placement keeps its centre, and the same ledger packs the same uniforms', () => {
    const [J, C, R, I] = [[0.566, 0.566], [0.566, -0.566], [-0.566, -0.566], [-0.566, 0.566]].map(([x, y]) => ({ x, y }));
    let l = reconcile(emptyLedger(), [J], 0);
    l = reconcile(l, [J, C], 10);
    l = reconcile(l, [J, C, R], 20);
    const frameOf = (fades: Record<number, number>) =>
      buildFieldFrame(state('abyss', 'dark', { placements: placementsOf(l, (e) => fades[e.ordinal] ?? 1), tMs: 7000 }), geometry, statics('abyss'));
    const before = frameOf({});
    l = reconcile(l, [C, R, I], 30);
    expect(l.change).toBe('replace');
    const after = frameOf({ 0: 0.6, 3: 0.4 });
    for (const id of [NODE.C, NODE.R]) {
      expect(after.nodes.find((n) => n.id === id)!.centre).toEqual(before.nodes.find((n) => n.id === id)!.centre);
    }
    expect(after.nodes.find((n) => n.id === NODE.J)!.fade).toBe(0.6);
    expect(packFrame(frameOf({ 0: 0.6, 3: 0.4 }))).toEqual(packFrame(after));
  });
});

// Designer 2.7, with the critic's lightness (accepted): p ramps from placement.neutralRadius to
// placement.rampEnd; a node's halo is (L: lerp(L_R0, L_tier, p); ab: p·bead.chromaScale·tier.ab), and its
// field colour is that under tension; the node is a function of (x, y).
describe('placement chroma and lightness, and the node from (x, y)', () => {
  const { neutralRadius, rampEnd } = BASE.placement;
  const QUADRANTS = { J: 'joy', C: 'calm', R: 'reflective', I: 'intense' } as const;
  /** Each quadrant's diagonal. */
  const DIAGONAL = { J: [1, 1], C: [1, -1], R: [-1, -1], I: [-1, 1] } as const;
  const at = (node: keyof typeof DIAGONAL, r: number) => ({ x: (DIAGONAL[node][0] * r) / Math.SQRT2, y: (DIAGONAL[node][1] * r) / Math.SQRT2 });

  it.each([
    [0.15, 0],
    [0.375, 0.5],
    [0.6, 1],
    [0.8, 1],
    [1.4, 1],
  ])('r %s gives p %s', (r, p) => {
    expect([neutralRadius, rampEnd]).toEqual([0.15, 0.6]);
    expect(placementRamp(r, 0)).toBeCloseTo(p, 12);
    expect(placementRamp(0, -r)).toBeCloseTo(p, 12);
  });

  it('the node: neutral inside placement.neutralRadius, otherwise the quadrant by sign (x ≥ 0 pleasant, y ≥ 0 more energy)', () => {
    expect([nodeAt(0.1, 0), nodeAt(0.07, -0.07), nodeAt(0, 0), nodeAt(-0.1, 0.05)]).toEqual(['neutral', 'neutral', 'neutral', 'neutral']);
    expect([nodeAt(0.5, 0.5), nodeAt(0.5, -0.5), nodeAt(-0.5, -0.5), nodeAt(-0.5, 0.5)]).toEqual(['J', 'C', 'R', 'I']);
    expect([nodeAt(0, 0.8), nodeAt(0, -0.8), nodeAt(0.8, 0), nodeAt(-0.8, 0)]).toEqual(['J', 'C', 'J', 'I']);
    expect(nodeAt(0.15, 0)).toBe('J'); // r = neutralRadius is not neutral: it is p 0
  });

  it('a placement inside the neutral radius is built as the neutral node, in every quadrant', () => {
    const glow = DIRECTIONS.abyss.color.dark.field.restGlow.oklab;
    for (const node of ['J', 'C', 'R', 'I'] as const) {
      const f = buildFieldFrame(state('abyss', 'dark', { placements: [at(node, 0.1)] }), geometry, statics('abyss'));
      expect(f.nodes[0].id).toBe(NODE.R0);
      expect(f.nodes[0].halo).toEqual({ L: glow[0], a: glow[1], b: glow[2] });
    }
  });

  it.each(IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const)))('%s, %s face: L = lerp(L_R0, L_tier, p) and ab = p·chromaScale·tier.ab, in every quadrant', (id, face) => {
    const d = DIRECTIONS[id];
    const L0 = d.color[face].field.restGlow.oklab[0];
    const tier = face === 'dark' ? 'core' : 'deep';
    for (const node of ['J', 'C', 'R', 'I'] as const) {
      const anchor = BASE.emotion[QUADRANTS[node]][tier].oklab;
      for (const [r, p] of [[0.15, 0], [0.2, 0.05 / 0.45], [0.375, 0.5], [0.6, 1], [0.9, 1]]) {
        const f = buildFieldFrame(state(id, face, { placements: [at(node, r)] }), geometry, statics(id));
        expect(f.nodes[0].id).toBe(NODE[node]);
        expect(f.nodes[0].halo.L).toBeCloseTo(L0 + (anchor[0] - L0) * p, 12);
        expect(f.nodes[0].halo.a).toBeCloseTo(anchor[1] * p * d.bead.chromaScale, 12);
        expect(f.nodes[0].halo.b).toBeCloseTo(anchor[2] * p * d.bead.chromaScale, 12);
      }
    }
  });

  // The critic's near.* scenes, as test data here (scribing them into the hero $extensions is
  // capture data, outside B4): one bead at (±0.141, ±0.141), r 0.2, p 0.11.
  it.each([
    ['near.joy', 0.141, 0.141, 'J'],
    ['near.calm', 0.141, -0.141, 'C'],
    ['near.reflective', -0.141, -0.141, 'R'],
    ['near.intense', -0.141, 0.141, 'I'],
  ] as const)('%s: its quadrant at p 0.11, its lightness p of the way from the rest glow', (_name, x, y, node) => {
    expect(nodeAt(x, y)).toBe(node);
    expect(placementRamp(x, y)).toBeCloseTo(0.11, 2);
    for (const face of ['dark', 'light'] as Face[]) {
      const f = buildFieldFrame(state('basin', face, { placements: [{ x, y }] }), geometry, statics('basin'));
      const L0 = DIRECTIONS.basin.color[face].field.restGlow.oklab[0];
      const Lt = BASE.emotion[QUADRANTS[node]][face === 'dark' ? 'core' : 'deep'].oklab[0];
      expect(Math.abs(f.nodes[0].halo.L - L0)).toBeCloseTo(placementRamp(x, y) * Math.abs(Lt - L0), 12);
    }
  });

  // "Every hard placement and never-red scene in the tokens already agrees with the sign rule"
  // (designer 2.7): every placement the token extensions name carries the node its (x, y) gives.
  it('every placement the token scenes name is the node its position gives', () => {
    const found: Array<{ node: string; x: number; y: number }> = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.node === 'string' && typeof o.x === 'number' && typeof o.y === 'number') found.push({ node: o.node, x: o.x, y: o.y });
        Object.values(o).forEach(walk);
      }
    };
    walk(EXTENSIONS);
    expect(found.length).toBeGreaterThan(40);
    expect(found.filter((b) => nodeAt(b.x, b.y) !== b.node)).toEqual([]);
  });
});

// DSN-021: tension lowers chroma (both faces), lightness (dark only) and the weight; it never raises them.
describe('stress never raises lightness, chroma or weight', () => {
  it.each(IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const)))('%s, %s face', (id, face) => {
    let previous: { L: number; C: number; k: number } | null = null;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const f = buildFieldFrame(state(id, face, { stress: s, breathPhase: 0.4 }), geometry, statics(id));
      const lch = oklabToOklch(f.nodes[0].field);
      const now = { L: lch.L, C: lch.C, k: f.kField };
      if (previous) {
        expect(now.L).toBeLessThanOrEqual(previous.L + 1e-12);
        expect(now.C).toBeLessThanOrEqual(previous.C + 1e-12);
        expect(now.k).toBeLessThanOrEqual(previous.k + 1e-12);
      }
      previous = now;
      // The halo is a mark: no tension reaches it.
      expect(f.nodes[0].halo).toEqual(buildFieldFrame(state(id, face, { stress: 0 }), geometry, statics(id)).nodes[0].halo);
    }
  });
});

describe('the breath, the still and the tiers', () => {
  it('computes n in JS, as a whole number, and the phase from it (resilience MEDIUM-2)', () => {
    const law = { masterPeriodMs: T, nRest: 11, nStress: 6, inhale: 0.4 };
    for (const s of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const b = fixedFieldBreath('abyss', s, 12345);
      expect(Number.isInteger(b.n)).toBe(true);
      expect(b.n).toBe(breathCycles(law, s));
      expect(b.phase).toBeCloseTo(((b.n * 12345) % T) / T, 12);
    }
  });

  it('the breath widens the lobe and lifts the presence by the direction’s amplitudes', () => {
    const d = DIRECTIONS.abyss;
    const at = (phase: number) => buildFieldFrame(state('abyss', 'dark', { breathPhase: phase }), geometry, statics('abyss'));
    const exhaled = at(0);
    const inhaled = at(d.field.breath.inhale); // the top of the breath, b = 1
    expect(breathLevel(d.field.breath.inhale, d.field.breath.inhale)).toBe(1);
    expect(inhaled.nodes[0].radius / exhaled.nodes[0].radius).toBeCloseTo(1 + d.field.breath.ampRadius, 9);
    expect(inhaled.kField / exhaled.kField).toBeCloseTo(1 / (1 - d.field.breath.ampPresence), 9);
  });

  it('the still draws t*, b = 0.5 and no shimmer, whatever the clock says', () => {
    const d = DIRECTIONS.abyss;
    const still = buildFieldFrame(state('abyss', 'dark', { tier: 'still', tMs: 33333, breathPhase: 0.9 }), geometry, statics('abyss'));
    const atStar = buildFieldFrame(state('abyss', 'dark', { tier: 'full', tMs: d.field.stillTime }), geometry, statics('abyss'));
    expect(still.warp.cos).toBeCloseTo(atStar.warp.cos, 12);
    expect(still.shimmer).toEqual({ cos: 1, sin: 0 });
    const midBreath = buildFieldFrame(state('abyss', 'dark', { tier: 'full', tMs: d.field.stillTime, breathPhase: d.field.breath.inhale / 2 }), geometry, statics('abyss'));
    expect(still.kField).toBeCloseTo(midBreath.kField, 12);
  });

  it('tier low draws two octaves and no shimmer; tier full three, and turns', () => {
    const low = buildFieldFrame(state('abyss', 'dark', { tier: 'low', tMs: 5000 }), geometry, statics('abyss'));
    const full = buildFieldFrame(state('abyss', 'dark', { tier: 'full', tMs: 5000 }), geometry, statics('abyss'));
    expect([low.warp.octaves, full.warp.octaves]).toEqual([BASE.field.tiers.low.octaves, BASE.field.tiers.full.octaves]);
    expect(low.shimmer).toEqual({ cos: 1, sin: 0 });
    expect(full.shimmer.sin).not.toBe(0);
  });
});

describe('the builder clamps what it is given', () => {
  it('NaN, Infinity and out-of-range inputs give a finite frame within range', () => {
    const f = buildFieldFrame(
      state('basin', 'dark', { stress: NaN, confidence: Infinity, tMs: -Infinity, breathPhase: NaN, placements: [{ x: NaN, y: 5 }] }),
      geometry,
      statics('basin'),
    );
    expect(packFrame(f).every(Number.isFinite)).toBe(true);
    expect(f.nodes[0].bead![0]).toBe(0);
    expect(Math.hypot(...f.nodes[0].bead!)).toBeLessThanOrEqual(1);
  });

  it('wraps t modulo T: t and t + T give the same frame', () => {
    const a = buildFieldFrame(state('abyss', 'dark', { tMs: 4321 }), geometry, statics('abyss'));
    const b = buildFieldFrame(state('abyss', 'dark', { tMs: 4321 + T }), geometry, statics('abyss'));
    expect(packFrame(b)).toEqual(packFrame(a));
  });
});

// QA-068 (P0, WCAG 2.3.1): no luminance modulation at 3 Hz or faster. DSN-032: nothing periodic is
// faster than 0.2 Hz (no period under 5.0 s). This block is the PERIODIC path: the clock and the
// breath move; every event input (placements, fades, restFade, stress, confidence) is held still.
// It is scoped by input, never by skipping a uniform. One-shot crossfades: 'QA-068, the event path'.
const STEP = 10; // ms
const THREE = [
  { node: 'J' as const, x: 0.566, y: 0.566 },
  { node: 'C' as const, x: 0.566, y: -0.566 },
  { node: 'R' as const, x: -0.566, y: -0.566 },
];
const offsetOf = (name: string) => { let o = 0; for (const u of FIELD_UNIFORMS) { if (u.name === name) return o; o += u.floats; } throw new Error(name); };
const K_FIELD = offsetOf('uWeight'); // kField is uWeight.x: it carries the breath
/** Sample index of each turning point; a turn counts once the value has come back more than `hold` from its running extreme. */
function turningPoints(values: readonly number[], hold: number): number[] {
  const turns: number[] = [];
  let dir = 0;
  let extreme = values[0];
  let at = 0;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (dir === 0) {
      if (Math.abs(v - extreme) > hold) { dir = Math.sign(v - extreme); extreme = v; at = i; }
    } else if (dir * (v - extreme) >= 0) {
      extreme = v; at = i;
    } else if (Math.abs(v - extreme) > hold) {
      turns.push(at); dir = -dir; extreme = v; at = i;
    }
  }
  return turns;
}

describe('QA-068, the periodic path: nothing modulates at 3 Hz, nothing periodic is faster than 0.2 Hz', () => {
  const ROWS = IDS.flatMap((id) => (['dark', 'light'] as Face[]).flatMap((face) => [0, 0.5, 1].flatMap((s) =>
    (['full', 'low'] as const).flatMap((tier) => (['rest', 'three'] as const).map((scene) => [id, face, s, tier, scene] as const)))));

  it.each(ROWS)('%s %s, s %s, tier %s, %s: every uniform over T and across the wrap', (id, face, s, tier, scene) => {
    const samples: number[][] = [];
    for (let t = 0; t <= T; t += STEP) { // t = T wraps to 0, so the last step crosses the seam
      const breathPhase = fixedFieldBreath(id, s, t).phase; // the breath moves (it was held at 0.3)
      samples.push(packFrame(buildFieldFrame(state(id, face, { tMs: t, stress: s, tier, breathPhase, placements: scene === 'rest' ? [] : THREE }), geometry, statics(id))));
    }
    const k = samples.map((v) => v[K_FIELD]);
    expect(Math.max(...k) - Math.min(...k)).toBeGreaterThan(0); // the breath really reached the frame
    for (let u = 0; u < samples[0].length; u++) {
      const values = samples.map((v) => v[u]);
      const range = Math.max(...values) - Math.min(...values);
      if (range === 0) continue;
      // No step: no change faster than a 3 Hz sine of the same amplitude (catches jumps, the seam included).
      let fastest = 0;
      for (let i = 1; i < values.length; i++) fastest = Math.max(fastest, Math.abs(values[i] - values[i - 1]) / (STEP / 1000));
      expect(fastest).toBeLessThanOrEqual(2 * Math.PI * 3 * (range / 2));
      // Frequency, whatever the waveform: like turns (max to max, min to min) at least 5.0 s apart.
      const turns = turningPoints(values, range * 1e-6);
      for (let i = 2; i < turns.length; i++) expect((turns[i] - turns[i - 2]) * STEP).toBeGreaterThanOrEqual(5000 - STEP);
    }
  });

  it.each(IDS)('%s: the still tier moves nothing over T', (id) => {
    const at = (t: number) => packFrame(buildFieldFrame(state(id, 'dark', { tier: 'still', tMs: t, breathPhase: fixedFieldBreath(id, 0, t).phase }), geometry, statics(id)));
    const first = at(0);
    for (let t = 997; t <= T; t += 997) expect(at(t)).toEqual(first);
  });
});
