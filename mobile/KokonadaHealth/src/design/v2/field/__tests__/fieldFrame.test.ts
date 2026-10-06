import { oklabToOklch } from '../../color/oklab.ts';
import { breathCycles, breathLevel } from '../../motion/breathLaw.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { NODE } from '../fieldLaw.ts';
import { buildFieldFrame, fixedFieldBreath, staticsFor, type FieldState } from '../fieldFrame.ts';
import { packFrame } from '../uniforms.ts';

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
  placements: [{ node: 'C', x: 0.5, y: 0.3 }],
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
    expect(f.nodes[0].bead).toEqual([0.5 * (1 - f.beadRadius), 0.3 * (1 - f.beadRadius)]);
    expect(f.nodes[0].id).toBe(NODE.C);
  });

  it('a placement’s chroma is its distance from the centre, times the bead chroma scale', () => {
    const f = buildFieldFrame(state('linen', 'light', { placements: [{ node: 'C', x: 0.3, y: 0.4 }] }), geometry, statics('linen'));
    const anchor = BASE.emotion.calm.deep.oklch;
    expect(oklabToOklch(f.nodes[0].halo).C).toBeCloseTo(anchor[1] * 0.5 * DIRECTIONS.linen.bead.chromaScale, 9);
  });

  it('centres a lobe by the direction’s rule: at the bead (Abyss), or 1.12R out along its angle (Linen)', () => {
    const still = { tMs: 0, stress: 1 }; // full stress: no extra drift, and at t = 0 none along x
    const abyss = buildFieldFrame(state('abyss', 'dark', still), geometry, statics('abyss'));
    expect(abyss.nodes[0].centre[0]).toBeCloseTo(abyss.nodes[0].bead![0], 12);
    const linen = buildFieldFrame(state('linen', 'dark', still), geometry, statics('linen'));
    const angle = Math.atan2(0.3, 0.5);
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
    const neutral = { placements: [{ node: 'neutral' as const, x: 0.2, y: 0.2 }] };
    const abyss = buildFieldFrame(state('abyss', 'dark', neutral), geometry, statics('abyss'));
    expect(abyss.nodes[0].id).toBe(NODE.R0);
    expect(abyss.nodes[0].radius).toBeGreaterThan(0);
    const linen = buildFieldFrame(state('linen', 'dark', neutral), geometry, statics('linen'));
    expect(linen.nodes[0].id).toBe(NODE.R0);
    expect(linen.nodes[0].radius).toBe(0); // no lobe; its halo stays
  });

  it('keeps the latest three placements: a fourth replaces the oldest', () => {
    const four = ['J', 'C', 'R', 'I'].map((node, i) => ({ node: node as 'J', x: 0.1 * i, y: 0.2 }));
    const f = buildFieldFrame(state('abyss', 'dark', { placements: four }), geometry, statics('abyss'));
    expect(f.nodes.slice(0, 3).map((n) => n.id)).toEqual([NODE.C, NODE.R, NODE.I]);
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
      state('basin', 'dark', { stress: NaN, confidence: Infinity, tMs: -Infinity, breathPhase: NaN, placements: [{ node: 'J', x: NaN, y: 5 }] }),
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

// QA-068: nothing in the field moves faster than a 3 Hz oscillation of the same amplitude would.
describe('no uniform moves faster than 3 Hz', () => {
  it.each(IDS)('%s: over a whole period, sampled every 5 ms', (id) => {
    const samples: number[][] = [];
    for (let t = 0; t < T; t += 5) samples.push(packFrame(buildFieldFrame(state(id, 'dark', { tMs: t }), geometry, statics(id))));
    const width = samples[0].length;
    for (let u = 0; u < width; u++) {
      const values = samples.map((s) => s[u]);
      const amplitude = (Math.max(...values) - Math.min(...values)) / 2;
      if (amplitude === 0) continue;
      let fastest = 0;
      for (let i = 1; i < values.length; i++) fastest = Math.max(fastest, Math.abs(values[i] - values[i - 1]) / 0.005);
      expect(fastest).toBeLessThanOrEqual(2 * Math.PI * 3 * amplitude);
    }
  });
});
