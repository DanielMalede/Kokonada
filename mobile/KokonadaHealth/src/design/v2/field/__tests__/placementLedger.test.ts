/// <reference types="node" />
jest.mock('../../tokens/tokens.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule());
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());
import * as fs from 'fs';
import * as path from 'path';
import { FIXTURE_OUTER, actualTokens } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS } from '../../tokens/tokens.generated.ts';
import { progress, crossfade, overlapOmega } from '../crossfade.ts';
import { buildFieldFrame, lobeAnchor, nodeAt } from '../fieldFrame.ts';
import { NODE_SLOTS } from '../fieldLaw.ts';
import { frameState, geometry, stormDeps } from '../ledgerStorms.ts';
import { ADMISSION, emptyLedger, fades, ledgerConfig, needsFrames, reconcile, type Ledger, type LedgerConfig, type LedgerFades, type Tap } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';
import { packFrame } from '../uniforms.ts';

// The placement ledger (architect admission §1, designer final rulings (1) and (2), resilience
// admission §1): the visual layer's record of the placements, derived from the cold-lane taps alone.
//   · reconcile(prev, {seq, taps}, nowMs, mode) runs once per frame on the UI thread;
//   · a fresh ledger's first input is the only reset: its taps are shown at once, with no animation
//     (a mount; a lab scene mounts a fresh ledger, so its order is its ordinal). Any other seq change,
//     forward or backward, is read by value, as the pops and adds that keep the most taps; several
//     store changes seen in one frame are read as their events, so nothing steps;
//   · pending changes are netted, never queued raw: an enter followed by a leave of the same
//     placement cancels, so what waits is the difference between the field and the store. The
//     waiting leaves and enters, each in arrival order, pair into swaps;
//   · crossfades are serialized: none restarts or interrupts another, every fade starts from 0 or 1,
//     and starts are at least motion.settle.duration apart in every mode;
//   · admission is the arrival-order prefix of those swaps (then any lone leaves or enters), stopping
//     at the first that does not fit: at most 2 entering and 2 leaving, at most 3 live after, and live +
//     entering + leaving + rest lobes (above 0 or rising) within NODE_SLOTS; every start admits one;
//   · one pool of NODE_SLOTS stable slots: a node keeps its slot from entering until its fade reaches
//     0, and freed slots are reused lowest first. There is no eviction.

const SETTLE = BASE.motion.settle.duration;
/** Two rest lobes (Abyss's light table), on the storms' plate: the overlap law reads their centres (L7). */
const TWO_REST: ReadonlyArray<readonly [number, number]> = [[-0.35, -0.3], [0.4, 0.35]];
const ABYSS: LedgerConfig = ledgerConfig('abyss', TWO_REST, geometry);
/** A hand-built config: two rest lobes, and neutral placements with no lobe (the binding neutral3 case). */
const NO_NEUTRAL_LOBE: LedgerConfig = { ...ABYSS, neutralLobe: false };
const tap = (x: number, y: number): Tap => ({ x, y });
const J = tap(0.566, 0.566);
const C = tap(0.566, -0.566);
const R = tap(-0.566, -0.566);
const I = tap(-0.566, 0.566);
const n = (k: number) => tap(0.02 * k, 0.03); // neutral: r < 0.15
/** ν·r_L, from the tokens: an independent oracle for the ledger's ω (L7). */
const REACH = BASE.field.crossfade.overlapFar * DIRECTIONS.abyss.field.lobe.radius;
/** The bead radius on the storms' plate, as the builder reads it. */
const BEAD = DIRECTIONS.abyss.bead.diameter / 2 / (geometry.radiusPx / geometry.pxPerDp);
/** A tap's undrifted lobe centre on Abyss, which centres a lobe on its bead (centreAlpha 1, centreBeta 0). */
const lobe = (t: Tap): [number, number] => [t.x * (1 - BEAD), t.y * (1 - BEAD)];
/** A tap whose lobe centre is `d` from C's, turning clockwise round the plate centre (C's radius kept). */
const fromC = (d: number): Tap => {
  const r = Math.hypot(C.x, C.y);
  const turn = 2 * Math.asin(d / (1 - BEAD) / (2 * r));
  const a = Math.atan2(C.y, C.x) - turn;
  return tap(r * Math.cos(a), r * Math.sin(a));
};

/** A stateful store with the cold lane's semantics (emotionSlice): a new array and a new seq per change. */
function store(initial: Tap[] = []) {
  let taps = initial;
  let seq = initial.length > 0 ? 1 : 0;
  return {
    add(t: Tap) { taps = [...taps, t].slice(-3); seq++; },
    undo() { taps = taps.slice(0, -1); seq++; },
    clear() { taps = []; seq++; },
    input: () => ({ seq, taps }),
  };
}

/** Run a ledger over 1 ms frames from `from` to `to`, applying the store's actions at their times. */
function run(ledger: Ledger, s: ReturnType<typeof store>, from: number, to: number, mode: 'settle' | 'reduced', actions: Record<number, () => void> = {}) {
  const frames: Array<{ t: number; f: LedgerFades; ledger: Ledger }> = [];
  for (let t = from; t <= to; t++) {
    actions[t]?.();
    ledger = reconcile(ledger, s.input(), t, mode);
    frames.push({ t, f: fades(ledger), ledger });
  }
  return { ledger, frames, at: (t: number) => frames.find((x) => x.t === t)! };
}

const shown = (f: LedgerFades) => f.placements.map((p) => [p.x, p.y, p.role, Math.round(p.fade * 1000) / 1000]);

describe('the ledger at rest', () => {
  it('starts with nothing placed and the rest lobes lit, in the lowest slots', () => {
    const f = fades(emptyLedger(ABYSS));
    expect(f).toEqual({ placements: [], ended: [], restFade: 1, restFades: [1, 1], restSlots: [0, 1], demand: 2 });
    expect(needsFrames(emptyLedger(ABYSS))).toBe(false);
  });

  it('the admission limits are the ruled ones', () => {
    expect(ADMISSION).toEqual({ entering: 2, leaving: 2, live: 3, nodes: NODE_SLOTS, netting: true });
  });
});

describe('a push: the first placement crossfades in, the rest glow out (designer 2.6)', () => {
  it('starts on the frame it arrives, stamped there: u 0, then the settle curve; each rest lobe falls as 1 − u^(1+ω), ω from its distance to the new lobe (L7)', () => {
    const s = store();
    const { frames, at } = run(emptyLedger(ABYSS), s, 0, 700, 'settle', { 100: () => s.add(C) });
    expect(at(99).f.placements).toEqual([]);
    expect(at(100).f.placements.map((p) => [p.id, p.fade, p.role, p.slot])).toEqual([[0, 0, 'live', 2]]);
    expect(at(100).f.restFade).toBe(1);
    expect(at(400).f.placements[0].fade).toBe(crossfade(progress('settle', 300)).in);
    const omegas = TWO_REST.map((r) => overlapOmega(Math.hypot(r[0] - lobe(C)[0], r[1] - lobe(C)[1]), REACH));
    expect(omegas.every((w) => w > 0.8 && w < 0.95)).toBe(true); // both near enough to hand over a little
    expect(at(400).f.restFades).toEqual(omegas.map((w) => crossfade(progress('settle', 300), w).out));
    expect(at(400).f.restFade).toBe(Math.max(...at(400).f.restFades));
    expect(at(700).f.placements[0].fade).toBe(1);
    expect(at(700).f.restFade).toBe(0);
    expect(at(700).f.restSlots).toEqual([]);
    expect(frames.filter((x) => x.ledger.starts !== frames[0].ledger.starts).length).toBeGreaterThan(0);
    expect(at(700).ledger.starts).toBe(1);
  });

  it('under reduced motion the ramp is 150 ms, linear', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, 0, 300, 'reduced', { 10: () => s.add(C) });
    expect(at(85).f.placements[0].fade).toBeCloseTo(0.5, 12);
    expect(at(160).f.placements[0].fade).toBe(1);
  });

  it('no neutral lobe: a neutral first tap keeps the glow lit (it has no lobe there)', () => {
    const s = store();
    const { at } = run(emptyLedger(NO_NEUTRAL_LOBE), s, -1, 700, 'settle', { 0: () => s.add(n(1)) });
    for (const t of [0, 300, 700]) expect(at(t).f.restFade).toBe(1);
  });

  it('needsFrames while a crossfade runs or a change waits, and not after', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 1300, 'settle', { 0: () => s.add(C), 100: () => s.add(R) });
    expect(needsFrames(at(300).ledger)).toBe(true);
    expect(needsFrames(at(599).ledger)).toBe(true); // R waits for its start, due at 600
    expect(needsFrames(at(650).ledger)).toBe(true);
    expect(needsFrames(at(1300).ledger)).toBe(false);
  });
});

describe('serialized crossfades: starts at least motion.settle.duration apart, in every mode', () => {
  it.each(['settle', 'reduced'] as const)('%s: a second tap waits for the spacing, then starts from 0', (mode) => {
    const s = store();
    const { frames, at } = run(emptyLedger(ABYSS), s, -1, 2000, mode, { 0: () => s.add(C), 50: () => s.add(R) });
    const starts = frames.filter((x, i) => i > 0 && x.ledger.starts !== frames[i - 1].ledger.starts).map((x) => x.t);
    expect(starts).toEqual([0, SETTLE]);
    const r = (t: number) => at(t).f.placements.find((p) => p.id === 1);
    expect(r(SETTLE - 1)).toBeUndefined();
    expect(r(SETTLE)!.fade).toBe(0);
  });
});

describe('change detection by seq, classification by value', () => {
  it('the same seq again, or a new seq with the same taps, is no change: one start, the same fades', () => {
    const s = store();
    const plain = run(emptyLedger(ABYSS), s, 0, 700, 'settle', { 1: () => s.add(C) });
    let ledger = emptyLedger(ABYSS);
    const t2 = store();
    const series: LedgerFades[] = [];
    for (let t = 0; t <= 700; t++) {
      if (t === 1) t2.add(C);
      const { seq, taps } = t2.input();
      // even frames: the same seq, a fresh array of equal taps; odd frames: a new seq, equal taps.
      const input = t % 2 === 0 ? { seq, taps: taps.map((x) => ({ ...x })) } : { seq: seq + Math.floor(t / 2), taps: taps.map((x) => ({ ...x })) };
      ledger = reconcile(ledger, input, t, 'settle');
      series.push(fades(ledger));
    }
    expect(ledger.starts).toBe(1);
    expect(series).toEqual(plain.frames.map((x) => x.f));
  });

  it('a fourth tap (push with shift): the oldest leaves as the new one enters, in one crossfade; the survivors keep id, slot and fade', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 3000, 'settle', { 0: () => s.add(J), 600: () => s.add(C), 1200: () => s.add(R), 1800: () => s.add(I) });
    const before = at(1799).f.placements;
    const mid = at(2100).f.placements;
    // J entered while the rest lobes held slots 0 and 1; they freed them as J's crossfade ended.
    expect(before.map((p) => [p.id, p.slot])).toEqual([[0, 2], [1, 0], [2, 1]]);
    expect(before.map((p) => p.fade).every((v) => v > 0.999)).toBe(true); // R's own ramp ends at 1800 ms
    expect(mid.map((p) => [p.id, p.role, p.slot])).toEqual([[0, 'leaving', 2], [1, 'live', 0], [2, 'live', 1], [3, 'live', 3]]);
    // L7: J leaves as I enters, a quadrant apart: ω ≈ 0.98, nearly the hold.
    const omega = overlapOmega(Math.hypot(lobe(J)[0] - lobe(I)[0], lobe(J)[1] - lobe(I)[1]), REACH);
    expect(omega).toBeGreaterThan(0.97);
    expect(omega).toBeLessThan(0.99);
    expect(mid[0].fade).toBe(crossfade(progress('settle', 300), omega).out);
    expect(mid[3].fade).toBe(crossfade(progress('settle', 300)).in);
    expect(at(2400).f.ended).toEqual([0]);
    expect(at(2401).f.placements.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('a pop: the latest leaves', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 3000, 'settle', { 0: () => s.add(J), 600: () => s.add(C), 1200: () => s.add(R), 1900: () => s.undo() });
    expect(shown(at(2000).f).map((x) => x[2])).toEqual(['live', 'live', 'leaving']);
    expect(at(2500).f.ended).toEqual([2]);
  });

  it('a clear: every placement leaves, at most two per crossfade, oldest first', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 4000, 'settle', { 0: () => s.add(J), 600: () => s.add(C), 1200: () => s.add(R), 1900: () => s.clear() });
    expect(at(1900).f.placements.filter((p) => p.role === 'leaving').map((p) => p.id)).toEqual([0, 1]);
    expect(at(2500).f.ended).toEqual([0, 1]);
    expect(at(2500).f.placements.filter((p) => p.role === 'leaving').map((p) => p.id)).toEqual([2]);
    expect(at(3100).f.ended).toEqual([2]);
    expect(at(3100).f.restFade).toBe(1);
  });

  it('several store changes seen in one frame read as their events, never as a reset', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 3000, 'settle', { 0: () => s.add(J), 600: () => s.add(C), 1200: () => { s.undo(); s.add(R); } });
    expect(at(1200).f.placements.map((p) => [p.id, p.role, p.fade])).toEqual([[0, 'live', 1], [1, 'leaving', 1], [2, 'live', 0]]);
  });

  // Resilience round 1 F5 and architect round 1 §1 (c): only a fresh ledger's first input resets.
  it('a seq that goes backwards is read by value like any change: animated, never a reset (only a fresh ledger resets)', () => {
    const s = store();
    const { ledger } = run(emptyLedger(ABYSS), s, -1, 700, 'settle', { 0: () => s.add(J) });
    const restarted = reconcile(ledger, { seq: 0, taps: [C, R] }, 701, 'settle');
    expect(fades(restarted).placements.map((p) => [p.id, p.role, p.fade])).toEqual([[0, 'leaving', 1], [1, 'live', 0], [2, 'live', 0]]);
    expect(needsFrames(restarted)).toBe(true);
  });

  it('two writers alternating {seq 5, [J]} and {seq 4, [C]} every frame for 3 s: no fade steps, and starts stay at least 600 ms apart', () => {
    let ledger = emptyLedger(ABYSS);
    let before = new Map<number, number>();
    const starts: number[] = [];
    let seen = 0;
    const slope = 4 / 0.6 / 1000;
    const steps: string[] = [];
    for (let t = 0; t <= 3000; t++) {
      ledger = reconcile(ledger, t % 2 === 0 ? { seq: 5, taps: [J] } : { seq: 4, taps: [C] }, t, 'settle');
      if (ledger.starts !== seen) { seen = ledger.starts; starts.push(t); }
      const f = fades(ledger);
      const now = new Map<number, number>(f.placements.map((p) => [p.id, p.fade]));
      for (const e of f.ended) now.set(e, 0);
      for (const [id, fade] of now) {
        const was = before.get(id);
        if (was === undefined ? fade !== 0 && t > 0 : Math.abs(fade - was) > slope * 1.001 + 1e-12) steps.push(`id ${id} at ${t} ms`);
      }
      before = new Map([...now].filter(([id]) => !f.ended.includes(id)));
    }
    expect(steps.slice(0, 3)).toEqual([]);
    expect(starts.slice(1).map((t, k) => t - starts[k]).filter((g) => g < SETTLE)).toEqual([]);
    expect(starts.length).toBeGreaterThan(1);
  });

  it('a forward change no single store operation explains is still animated: the most taps kept, the rest leave and enter', () => {
    const s = store();
    const { ledger } = run(emptyLedger(ABYSS), s, -1, 1300, 'settle', { 0: () => s.add(J), 600: () => s.add(C) });
    const next = reconcile(ledger, { seq: 3, taps: [C, R, I] }, 1301, 'settle');
    expect(fades(next).placements.map((p) => [p.id, p.node, p.role, p.fade])).toEqual([[0, 'J', 'leaving', 1], [1, 'C', 'live', 1], [2, 'R', 'live', 0], [3, 'I', 'live', 0]]);
  });

  it('a fresh ledger given a scene’s taps reads them as a reset: the scene order is the ordinal', () => {
    const f = fades(reconcile(emptyLedger(ABYSS), { seq: 1, taps: [J, C, R] }, 0, 'settle'));
    expect(f.placements.map((p) => [p.id, p.ordinal, p.node, p.fade])).toEqual([[0, 0, 'J', 1], [1, 1, 'C', 1], [2, 2, 'R', 1]]);
  });
});

describe('netting: pending changes are netted against the store, never queued raw', () => {
  it('a tap undone before it is admitted never appears, and nothing is left waiting', () => {
    const s = store();
    const { frames } = run(emptyLedger(ABYSS), s, -1, 2000, 'settle', { 0: () => s.add(J), 100: () => s.add(C), 200: () => s.undo() });
    expect(frames.some((x) => x.f.placements.some((p) => p.id === 1))).toBe(false);
    const last = frames[frames.length - 1].ledger;
    expect(last.starts).toBe(1);
    expect([last.leaves.length, last.enters.length, needsFrames(last)]).toEqual([0, 0, false]);
  });

  it('a replace queues its leave before its enter: never four live', () => {
    const s = store([J, C, R]);
    let ledger = reconcile(emptyLedger(ABYSS), s.input(), 0, 'settle');
    const { frames } = run(ledger, s, 1, 2000, 'settle', { 10: () => s.add(I) });
    ledger = frames[frames.length - 1].ledger;
    for (const x of frames) expect(x.f.placements.filter((p) => p.role === 'live').length).toBeLessThanOrEqual(3);
    expect(fades(ledger).placements.map((p) => p.node)).toEqual(['C', 'R', 'I']);
  });
});

describe('admission (designer final ruling (1)): the arrival-order prefix that fits, no eviction', () => {
  // The planted case (designer): no neutral lobe, three neutral placements, rest lobes lit; two taps inside one
  // settle window are admitted as one swap and then one swap (two swaps would need 7 nodes).
  it('neutral3 with no neutral lobe: one swap, then one swap; never more than NODE_SLOTS nodes', () => {
    const s = store([n(1), n(2), n(3)]);
    const ledger = reconcile(emptyLedger(NO_NEUTRAL_LOBE), s.input(), 0, 'settle');
    expect(fades(ledger).restFade).toBe(1);
    const { frames } = run(ledger, s, 1, 3000, 'settle', { 1000: () => s.add(n(4)), 1100: () => s.add(n(5)), 1200: () => s.add(n(6)) });
    const startFrames = frames.filter((x, i) => i > 0 && x.ledger.starts !== frames[i - 1].ledger.starts);
    expect(startFrames.map((x) => x.t)).toEqual([1000, 1600, 2200]);
    expect(startFrames.map((x) => [x.f.placements.filter((p) => p.role === 'leaving').length, x.f.placements.filter((p) => p.fade === 0).length])).toEqual([[1, 1], [1, 1], [1, 1]]);
    for (const x of frames) expect(x.f.demand).toBeLessThanOrEqual(NODE_SLOTS);
    expect(frames.some((x) => x.f.demand === NODE_SLOTS)).toBe(true);
  });

  it('every start admits at least one pending change', () => {
    const s = store();
    const { frames } = run(emptyLedger(NO_NEUTRAL_LOBE), s, -1, 4000, 'settle', Object.fromEntries([0, 30, 60, 90, 120, 150].map((t, k) => [t, () => s.add(k % 2 ? n(k) : [J, C, R, I][k % 4])])));
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].ledger.starts !== frames[i - 1].ledger.starts) expect(frames[i].ledger.admitted).toBeGreaterThan(0);
    }
  });

  // L1: the prefix stops at the first change that does not fit, even where a later one would. No neutral
  // lobe, three neutrals, rest lobes lit; a clear, then two new neutral taps, in one settle window. The
  // waiting change is three leaves and two enters: swaps (n1, n4), (n2, n5), then n3 alone. One swap
  // fits (6 nodes); the second would make 7, so the start stops there, though n3's leave alone fits.
  it('the prefix stops at the first change that does not fit (no neutral lobe: a clear and two taps admit one swap)', () => {
    const s = store([n(1), n(2), n(3)]);
    const ledger = reconcile(emptyLedger(NO_NEUTRAL_LOBE), s.input(), 0, 'settle');
    const { at } = run(ledger, s, 1, 2000, 'settle', { 1000: () => { s.clear(); s.add(n(4)); s.add(n(5)); } });
    expect(at(1000).ledger.admitted).toBe(1);
    expect(at(1000).f.placements.map((p) => [p.id, p.role, p.fade])).toEqual([[0, 'leaving', 1], [1, 'live', 1], [2, 'live', 1], [3, 'live', 0]]);
    expect(at(1600).f.placements.filter((p) => p.role === 'leaving').map((p) => p.id)).toEqual([1, 2]);
  });

  // L2: rest lobes count while they rise. No neutral lobe, [n1, n2, J]: the undo of J brings the glow back, so the
  // rest lobes rise in the same crossfade; with n3 entering that is 3 + 1 + 2 = 6, and the next swap
  // (n1 for n4) would make 7, so it waits.
  it('rest lobes count while they rise: no neutral lobe, an undo of the only lobe and two taps admit the undo and one tap', () => {
    const s = store([n(1), n(2), J]);
    const ledger = reconcile(emptyLedger(NO_NEUTRAL_LOBE), s.input(), 0, 'settle');
    expect(fades(ledger).restFade).toBe(0);
    const { at } = run(ledger, s, 1, 2000, 'settle', { 1000: () => { s.undo(); s.add(n(3)); s.add(n(4)); } });
    const f = at(1000).f;
    expect(f.placements.map((p) => [p.id, p.role, p.fade])).toEqual([[0, 'live', 1], [1, 'live', 1], [2, 'leaving', 1], [3, 'live', 0]]);
    expect([f.restFade, f.restSlots.length, f.demand]).toEqual([0, 2, 6]);
    expect(at(1600).f.placements.find((p) => p.id === 4)!.fade).toBe(0);
  });

  // The architect's counter (L13): no neutral lobe, neutrals only and the rest lobes lit. Two quick undos,
  // or a clear's first crossfade, leave 1 live + 2 leaving + 2 rest lobes: 5 nodes, 4 not live.
  it.each([
    ['two quick undos, seen in one frame', (s: ReturnType<typeof store>) => ({ 1000: () => { s.undo(); s.undo(); } })],
    ['a clear', (s: ReturnType<typeof store>) => ({ 1000: () => s.clear() })],
  ])('no neutral lobe, %s: two leave together, each keeping its slot, with the rest lobes lit beside them', (_name, acts) => {
    const s = store([n(1), n(2), n(3)]);
    const ledger = reconcile(emptyLedger(NO_NEUTRAL_LOBE), s.input(), 0, 'settle');
    const slotsBefore = fades(ledger).placements.map((p) => p.slot);
    const { at } = run(ledger, s, 1, 2000, 'settle', acts(s));
    const mid = at(1300).f;
    expect(mid.placements.filter((p) => p.role === 'leaving').length).toBe(2);
    expect(mid.placements.length + mid.restSlots.length).toBe(5);
    expect(mid.placements.map((p) => p.slot)).toEqual(slotsBefore);
    expect(mid.restFade).toBe(1);
  });
});

describe('slots: one pool, stable from entering to fade 0, reused lowest first', () => {
  it('no node changes slot while it is shown, and no two share one', () => {
    const s = store();
    const acts: Record<number, () => void> = {};
    [J, C, R, I, J, C, R].forEach((t, k) => { acts[k * 250] = () => s.add(t); });
    acts[2000] = () => s.undo();
    acts[2600] = () => s.clear();
    const { frames } = run(emptyLedger(ABYSS), s, -1, 5000, 'reduced', acts);
    const slotOf = new Map<number, number>();
    for (const x of frames) {
      const used = [...x.f.placements.map((p) => p.slot), ...x.f.restSlots];
      expect(new Set(used).size).toBe(used.length);
      for (const p of x.f.placements) {
        if (slotOf.has(p.id)) expect(p.slot).toBe(slotOf.get(p.id));
        slotOf.set(p.id, p.slot);
      }
    }
  });
});

describe('the clock behind u (resilience finding 9)', () => {
  it('a long frame advances u by at most motion.dtClamp; time running backwards never lowers it', () => {
    const s = store();
    let ledger = reconcile(emptyLedger(ABYSS), s.input(), 0, 'settle');
    s.add(C);
    ledger = reconcile(ledger, s.input(), 10, 'settle'); // the start, stamped: u 0
    expect(fades(ledger).placements[0].fade).toBe(0);
    ledger = reconcile(ledger, s.input(), 60_000, 'settle'); // a minute away: one clamped step
    expect(fades(ledger).placements[0].fade).toBe(crossfade(progress('settle', BASE.motion.dtClamp)).in);
    const before = fades(ledger).placements[0].fade;
    ledger = reconcile(ledger, s.input(), 5, 'settle'); // backwards
    expect(fades(ledger).placements[0].fade).toBe(before);
  });

  // L4: spacing is kept on the ledger's own clamped clock, the one the ramp runs on, so a long frame
  // cannot let a second crossfade start while the first still runs.
  it('a long frame never lets a second crossfade start while the first runs', () => {
    const s = store();
    let ledger = reconcile(emptyLedger(ABYSS), s.input(), 0, 'settle');
    s.add(C);
    ledger = reconcile(ledger, s.input(), 10, 'settle');
    s.add(R);
    ledger = reconcile(ledger, s.input(), 60_000, 'settle');
    expect(ledger.starts).toBe(1);
    expect(fades(ledger).placements.map((p) => p.id)).toEqual([0]);
    for (let t = 60_001; t <= 60_600; t++) ledger = reconcile(ledger, s.input(), t, 'settle');
    expect(ledger.starts).toBe(2);
  });
});

describe('the ledger stays in the visual layer', () => {
  const FIELD = path.resolve(__dirname, '..');
  const sources = fs.readdirSync(FIELD).filter((f) => /\.tsx?$/.test(f)).map((f) => ({ f, s: fs.readFileSync(path.join(FIELD, f), 'utf8') }));

  it('the scan sees the ledger', () => {
    expect(sources.map((x) => x.f)).toContain('placementLedger.ts');
  });

  it('nothing in v2/field imports the app state or dispatches', () => {
    expect(sources.filter(({ s }) => /from\s+['"][^'"]*\/state\//.test(s) || /\bdispatch\s*\(/.test(s)).map((x) => x.f)).toEqual([]);
  });

  it('the cold-lane Tap is still exactly {x, y}', () => {
    const slice = fs.readFileSync(path.resolve(FIELD, '../../../state/cold/emotionSlice.ts'), 'utf8');
    expect(slice).toMatch(/export interface Tap \{\s*x: number;\s*y: number;\s*\}/);
  });

  // Resilience round 1 F4: the ledger reads at most the cold lane's three taps (readTaps).
  it('the cold lane holds at most three taps, the ledger\'s live limit', () => {
    const slice = fs.readFileSync(path.resolve(FIELD, '../../../state/cold/emotionSlice.ts'), 'utf8');
    const held = /const MAX_TAPS = (\d+);/.exec(slice);
    expect(held).not.toBeNull();
    expect(Number(held![1])).toBe(ADMISSION.live);
  });
});

// Resilience round 1 F4 (architect round 1 G-b): the ledger and the builder read a tap the same way.
// A non-finite coordinate is read as 0 by both, and the ledger reads at most the cold lane's three
// taps, so the frame never holds more than the ledger's demand and the builder never throws.
describe('the ledger reads the store as the builder does', () => {
  // On the fixture direction fixture-outer (neutral placements with no lobe), where the builder and the
  // ledger must agree on the lobe rule as well as on the taps.
  it('the fixture mock: fixture-outer exists, BASE and DIRECTIONS.abyss are the shipped objects', () => {
    expect(BASE).toBe(actualTokens().BASE);
    expect(DIRECTIONS.abyss).toBe(actualTokens().DIRECTIONS.abyss);
    expect(DIRECTIONS[FIXTURE_OUTER].field.lobe.neutralLobe).toBe(0);
  });
  // Built on the light face, so the ledger counts the light face's rest lobes (UI-112).
  const outer = stormDeps(FIXTURE_OUTER, staticsFor(FIXTURE_OUTER, EXTENSIONS as never), 'light');
  /** Frames at 1 ms, each built and packed: the worst occupancy over demand, and the first throw. */
  function drive(first: Tap[], later: Record<number, Tap[]>, to: number) {
    let ledger = emptyLedger(outer.config);
    let taps = first;
    let seq = 1;
    let over = 0;
    let threw: string | null = null;
    for (let t = 0; t <= to; t++) {
      if (later[t]) { taps = later[t]; seq++; }
      ledger = reconcile(ledger, { seq, taps }, t, 'settle');
      const f = fades(ledger);
      try {
        const frame = buildFieldFrame(frameState(FIXTURE_OUTER, outer.face, f), geometry, outer.statics);
        packFrame(frame);
        const occupied = frame.nodes.filter((nd) => nd.fade > 0 || nd.bead !== null).length;
        over = Math.max(over, occupied - f.demand);
      } catch (error) {
        threw = threw ?? `${(error as Error).name} at ${t} ms: ${(error as Error).message}`;
      }
    }
    return { over, threw, ledger };
  }

  it.each([['NaN', NaN], ['Infinity', Infinity]])('fixture-outer, taps [n1, n2, %s], then two neutral taps inside one settle window: never throws, never over demand', (_, bad) => {
    const odd = tap(bad, bad);
    const { over, threw } = drive([n(1), n(2), odd], { 100: [n(2), odd, n(4)], 200: [odd, n(4), n(5)] }, 3000);
    expect({ threw, over: Math.max(0, over) }).toEqual({ threw: null, over: 0 });
  });

  it('a raw input of five taps is read as its last three', () => {
    const five = [n(1), n(2), n(3), n(4), n(5)];
    const { over, threw, ledger } = drive(five, {}, 100);
    expect({ threw, over: Math.max(0, over) }).toEqual({ threw: null, over: 0 });
    expect(fades(ledger).placements.map((p) => [p.x, p.y])).toEqual([n(3), n(4), n(5)].map((p) => [p.x, p.y]));
  });

  it('a non-finite coordinate is read as 0, as the builder reads it, so both give the tap the same node', () => {
    const f = fades(reconcile(emptyLedger(outer.config), { seq: 1, taps: [tap(NaN, 0.5), tap(0.4, Infinity)] }, 0, 'settle'));
    expect(f.placements.map((p) => [p.x, p.y, p.node])).toEqual([[0, 0.5, nodeAt(0, 0.5)], [0.4, 0, nodeAt(0.4, 0)]]);
  });
});

// Law round 2, item 2b (designer L7, amending 2.6): the outgoing fade is 1 − u^(1+ω_j), ω_j =
// smoothstep(0, ν·r_L, δ_j), δ_j the distance from the outgoing lobe's undrifted centre to the nearest
// incoming undrifted centre in the same crossfade (1 with none), ν = field.crossfade.overlapFar. The
// ledger computes ω once per crossfade, at its start, for every leaving placement and every rest lobe.
describe('L7: the overlap crossfade, ω computed once per crossfade by the ledger', () => {
  it('Abyss centres a lobe on its bead, so the test oracle is the bead (centreAlpha 1, centreBeta 0)', () => {
    expect([DIRECTIONS.abyss.field.lobe.centreAlpha, DIRECTIONS.abyss.field.lobe.centreBeta]).toEqual([1, 0]);
    expect(ABYSS.overlap).toEqual({ rest: TWO_REST, centreAlpha: 1, centreBeta: 0, beadRadius: BEAD, reach: REACH });
    const near = lobe(fromC(0.5 * 0.95));
    expect(Math.hypot(near[0] - lobe(C)[0], near[1] - lobe(C)[1])).toBeCloseTo(0.5 * 0.95, 12);
  });

  /** A same-spot (or near-spot) swap: C, then an undo and a re-add inside the spacing, so a leave and an enter pair at the next start. */
  const swap = (again: Tap, mode: 'settle' | 'reduced', config: LedgerConfig = ABYSS, to = 1400) => {
    const s = store();
    return run(emptyLedger(config), s, -1, to, mode, { 0: () => s.add(C), 100: () => s.undo(), 200: () => s.add(again) });
  };

  it.each(['settle', 'reduced'] as const)('%s: a same-spot swap crossfades linearly, ω = 0: the pair sums to 1 at every frame', (mode) => {
    const { frames } = swap(C, mode);
    const during = frames.filter((x) => x.t >= SETTLE && x.f.placements.length === 2);
    expect(during.length).toBeGreaterThan(mode === 'settle' ? 590 : 140);
    for (const { t, f } of during) {
      const [out, inn] = f.placements;
      expect([out.id, out.role, inn.id, inn.role]).toEqual([0, 'leaving', 1, 'live']);
      const u = progress(mode, t - SETTLE);
      expect(inn.fade).toBe(crossfade(u).in);
      expect(out.fade).toBe(crossfade(u, 0).out);
      expect(Math.abs(out.fade + inn.fade - 1)).toBeLessThanOrEqual(1e-15);
    }
  });

  it.each([0.25, 0.5, 0.75, 1])('a near-spot swap at δ = %s·r_L: the leaving lobe falls as 1 − u^(1+ω(δ))', (k) => {
    const omega = overlapOmega(k * 0.95, REACH);
    const { at } = swap(fromC(k * 0.95), 'settle');
    const f = at(SETTLE + 200).f;
    expect(f.placements.map((p) => [p.id, p.role])).toEqual([[0, 'leaving'], [1, 'live']]);
    expect(f.placements[0].fade).toBeCloseTo(crossfade(progress('settle', 200), omega).out, 12);
    expect(f.placements[1].fade).toBe(crossfade(progress('settle', 200)).in);
  });

  it('a leave with nothing coming in holds, ω = 1 (1 − u²): a pop with a lobe still live, so no rest lobe rises', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 2000, 'settle', { 0: () => s.add(J), 600: () => s.add(C), 1300: () => s.undo() });
    const f = at(1500).f;
    expect(f.placements.map((p) => [p.id, p.role])).toEqual([[0, 'live'], [1, 'leaving']]);
    expect(f.restFades).toEqual([]);
    expect(f.placements[1].fade).toBe(crossfade(progress('settle', 200)).out);
    expect(f.placements[1].fade).toBe(1 - progress('settle', 200) ** 2);
  });

  it('the last lobe leaving as the rest lobes rise: its ω is from the nearest rising rest centre', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 2000, 'settle', { 0: () => s.add(C), 700: () => s.undo() });
    const omega = overlapOmega(Math.min(...TWO_REST.map((r) => Math.hypot(r[0] - lobe(C)[0], r[1] - lobe(C)[1]))), REACH);
    expect(omega).toBeLessThan(0.95);
    const f = at(900).f;
    expect(f.placements[0].role).toBe('leaving');
    expect(f.placements[0].fade).toBe(crossfade(progress('settle', 200), omega).out);
    expect(f.restFades).toEqual([crossfade(progress('settle', 200)).in, crossfade(progress('settle', 200)).in]);
  });

  it('ω is fixed for the life of a crossfade: changes that arrive mid-ramp wait, and the leaving curve never moves', () => {
    const plain = swap(C, 'settle');
    // Mid-swap, a tap lands right beside C (it waits for the spacing), and is undone and re-made nearer.
    const s = store();
    const busy = run(emptyLedger(ABYSS), s, -1, 1199, 'settle', {
      0: () => s.add(C), 100: () => s.undo(), 200: () => s.add(C), 700: () => s.add(fromC(0.1)), 800: () => s.undo(), 900: () => s.add(fromC(0.2)),
    });
    expect(busy.at(1000).ledger.enters).toHaveLength(1); // the change waits for the spacing
    for (let t = SETTLE; t < 2 * SETTLE; t++) {
      const leaving = busy.at(t).f.placements.find((p) => p.id === 0)!;
      expect(leaving.fade).toBe(plain.at(t).f.placements.find((p) => p.id === 0)!.fade);
      expect(leaving.fade).toBe(crossfade(progress('settle', t - SETTLE), 0).out);
    }
    // And fades() never recomputes ω: the same ledger read under a config whose reach is 0 (every ω 1)
    // draws the same fades, mid-ramp.
    const mid = busy.at(SETTLE + 150).ledger;
    const reread: Ledger = { ...mid, config: { ...mid.config, overlap: { ...mid.config.overlap, reach: 0 } } };
    expect(fades(reread)).toEqual(fades(mid));
  });

  it('the planted hold: a config whose reach is 0 gives ω = 1 everywhere, the designer 2.6 curve, at the same spot too', () => {
    const held: LedgerConfig = { ...ABYSS, overlap: { ...ABYSS.overlap, reach: 0 } };
    const f = swap(C, 'settle', held).at(SETTLE + 200).f;
    expect(f.placements[0].fade).toBe(crossfade(progress('settle', 200)).out);
    expect(f.placements[0].fade + f.placements[1].fade).toBeGreaterThan(1.1);
  });

  it('ledgerConfig reads the direction and the plate as the builder does: ν·r_L from the tokens, the bead radius in plate units', () => {
    const cfg = ledgerConfig('abyss', [[-0.3, 0.35]], { radiusPx: 80, pxPerDp: 80 / 170 });
    expect(cfg.restLobes).toBe(1);
    expect(cfg.neutralLobe).toBe(DIRECTIONS.abyss.field.lobe.neutralLobe > 0);
    expect(cfg.overlap.reach).toBe(1.25 * DIRECTIONS.abyss.field.lobe.radius);
    expect(cfg.overlap.beadRadius).toBe(DIRECTIONS.abyss.bead.diameter / 2 / (80 / (80 / 170)));
    expect(cfg.overlap.rest).toEqual([[-0.3, 0.35]]);
  });

  it('a config whose rest count disagrees with its rest centres is refused', () => {
    expect(() => emptyLedger({ ...ABYSS, restLobes: 1 })).toThrow(RangeError);
  });
});

// UI-134 (designer Ruling 3 after UI-125): "Drift is keyed by a drift key, equal to the ordinal except: a
// placement with the same node id landing within ν·r_L of a placement still leaving, or that ended within
// one crossfade duration before it, takes that placement's drift key and drift phase; its drift clock
// carries on. Ids and ordinals stay unique, the counter still increments; E3's identity, enter/leave and
// single-start checks unchanged." As built: at a start, each entrant (in arrival order) is matched against
// the donors, the placements leaving in that start and those that ended at most rampDuration(mode) before
// it, on the same node and an undrifted anchor (lobeAnchor) at most ν·r_L away; it takes the nearest
// donor's key (ties to the lower key). A donor gives its key once, and never one that a placement staying
// on the field already carries, so no two live placements share a key. The drift is a function of the key
// and the field clock t alone (fieldFrame.ts offset), so the key carries the drift phase.
describe('UI-134: the drift key, a re-add inherits it, never the ordinal or the id', () => {
  const keys = (f: LedgerFades) => f.placements.map((p) => [p.id, p.ordinal, p.driftKey, p.role]);

  it.each(['settle', 'reduced'] as const)('%s: a same-spot re-add takes the drift key of the placement still leaving, for its whole life; ids, ordinals and the counter unchanged', (mode) => {
    const s = store();
    const { at, ledger } = run(emptyLedger(ABYSS), s, -1, 3000, mode, { 0: () => s.add(C), 100: () => s.undo(), 200: () => s.add(C) });
    expect(keys(at(SETTLE - 1).f)).toEqual([[0, 0, 0, 'live']]);
    expect(keys(at(SETTLE + 10).f)).toEqual([[0, 0, 0, 'leaving'], [1, 1, 0, 'live']]);
    expect(keys(at(3000).f)).toEqual([[1, 1, 0, 'live']]);
    expect(ledger.next).toBe(2);
    expect(ledger.starts).toBe(2);
  });

  it('a fresh tap, and a reset, take their ordinal as their key', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 2000, 'settle', { 0: () => s.add(J), 600: () => s.add(C) });
    expect(keys(at(2000).f)).toEqual([[0, 0, 0, 'live'], [1, 1, 1, 'live']]);
    const f = fades(reconcile(emptyLedger(ABYSS), { seq: 1, taps: [J, C, C] }, 0, 'settle'));
    expect(f.placements.map((p) => p.driftKey)).toEqual([0, 1, 2]);
  });

  /** C placed, then undone at 700 (a lone leave); the ledger's clock when C ends, and when a re-add `gap` ms later starts. */
  const reAddAfterEnd = (gap: number, mode: 'settle' | 'reduced') => {
    const s = store();
    const first = run(emptyLedger(ABYSS), s, -1, 2000, mode, { 0: () => s.add(C), 700: () => s.undo() });
    const end = first.frames.find((x) => x.f.ended.includes(0))!;
    const t2 = store();
    const second = run(emptyLedger(ABYSS), t2, -1, end.t + gap + 1000, mode, { 0: () => t2.add(C), 700: () => t2.undo(), [end.t + gap]: () => t2.add(C) });
    const started = second.frames.find((x) => x.ledger.starts === 3)!;
    return { endedAt: end.ledger.clock, startedAt: started.ledger.lastStart, f: started.f };
  };

  it('settle: a re-add that starts within one crossfade duration of the leaver’s end takes its key, at both ends of the window; one ms later, a fresh key', () => {
    const window = BASE.motion.settle.duration;
    for (const gap of [0, window]) {
      const r = reAddAfterEnd(gap, 'settle');
      expect(r.startedAt - r.endedAt).toBe(gap);
      expect(keys(r.f)).toEqual([[1, 1, 0, 'live']]);
    }
    const late = reAddAfterEnd(window + 1, 'settle');
    expect(late.startedAt - late.endedAt).toBe(window + 1);
    expect(keys(late.f)).toEqual([[1, 1, 1, 'live']]);
  });

  it('reduced: the ramp (150 ms) is shorter than the spacing (600 ms), so a re-add after a lone leave starts outside the window, and takes a fresh key', () => {
    const r = reAddAfterEnd(0, 'reduced');
    expect(r.startedAt - r.endedAt).toBe(SETTLE - BASE.motion.fadeReduced.duration);
    expect(r.startedAt - r.endedAt).toBeGreaterThan(BASE.motion.fadeReduced.duration);
    expect(keys(r.f)).toEqual([[1, 1, 1, 'live']]);
  });

  /** `from` placed, undone and replaced by `again` inside the spacing: the leave and the enter pair at one start. */
  const replacedFrom = (from: Tap, again: Tap, config: LedgerConfig = ABYSS) => {
    const s = store();
    return run(emptyLedger(config), s, -1, SETTLE + 10, 'settle', { 0: () => s.add(from), 100: () => s.undo(), 200: () => s.add(again) }).at(SETTLE + 10).f;
  };
  // Two calm taps far apart: from near the +x axis toward the −y axis (both in C's quadrant, inside the
  // disc), so the anchors can be put at, or just past, ν·r_L.
  const P = tap(0.97, -0.03);
  const Q = (d: number) => tap(P.x - d / (1 - BEAD) / Math.SQRT2, P.y - d / (1 - BEAD) / Math.SQRT2);
  const delta = (a: Tap, b: Tap) => Math.hypot(lobe(a)[0] - lobe(b)[0], lobe(a)[1] - lobe(b)[1]);

  it('a same-node re-add within ν·r_L of the leaver takes its key, up to the reach itself; past it, a fresh key', () => {
    expect([nodeAt(P.x, P.y), nodeAt(Q(REACH * 1.01).x, Q(REACH * 1.01).y)]).toEqual(['C', 'C']);
    expect(Math.hypot(Q(REACH * 1.01).x, Q(REACH * 1.01).y)).toBeLessThan(1);
    expect(delta(P, Q(REACH * 0.99))).toBeCloseTo(REACH * 0.99, 12);
    expect(keys(replacedFrom(P, Q(REACH * 0.99)))).toEqual([[0, 0, 0, 'leaving'], [1, 1, 0, 'live']]);
    expect(keys(replacedFrom(P, Q(REACH * 1.01)))).toEqual([[0, 0, 0, 'leaving'], [1, 1, 1, 'live']]);
    // The edge, exactly: a reach equal to the ledger's own δ inherits; the float just below it does not.
    const [a, b] = [lobeAnchor(P.x, P.y, BEAD, 1, 0), lobeAnchor(Q(REACH).x, Q(REACH).y, BEAD, 1, 0)];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const reaching = (reach: number): LedgerConfig => ({ ...ABYSS, overlap: { ...ABYSS.overlap, reach } });
    expect(keys(replacedFrom(P, Q(REACH), reaching(d)))[1]).toEqual([1, 1, 0, 'live']);
    expect(keys(replacedFrom(P, Q(REACH), reaching(d * (1 - Number.EPSILON))))[1]).toEqual([1, 1, 1, 'live']);
  });

  it('another node, however near, takes a fresh key: C replaced by a joy tap just across the axis', () => {
    const across = tap(0.566, 0.01);
    expect(nodeAt(across.x, across.y)).toBe('J');
    expect(delta(C, across)).toBeLessThan(REACH);
    expect(keys(replacedFrom(C, across))).toEqual([[0, 0, 0, 'leaving'], [1, 1, 1, 'live']]);
  });

  it('a live placement is no donor: a second tap at C beside a live C takes a fresh key', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 1400, 'settle', { 0: () => s.add(C), 600: () => s.add(C) });
    expect(keys(at(1400).f)).toEqual([[0, 0, 0, 'live'], [1, 1, 1, 'live']]);
  });

  it('a donor gives its key once: two taps at C entering together at C’s end take its key and a fresh one', () => {
    const s = store();
    const { at } = run(emptyLedger(ABYSS), s, -1, 2200, 'settle', { 0: () => s.add(C), 700: () => s.undo(), 800: () => s.add(C), 900: () => s.add(C) });
    expect(at(1300).ledger.starts).toBe(3);
    expect(keys(at(2200).f)).toEqual([[1, 1, 0, 'live'], [2, 2, 2, 'live']]);
  });
});
