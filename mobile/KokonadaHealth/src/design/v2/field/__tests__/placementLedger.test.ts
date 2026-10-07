/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE } from '../../tokens/tokens.generated.ts';
import { progress, crossfade } from '../crossfade.ts';
import { buildFieldFrame, nodeAt } from '../fieldFrame.ts';
import { NODE_SLOTS } from '../fieldLaw.ts';
import { frameState, geometry, stormDeps } from '../ledgerStorms.ts';
import { ADMISSION, emptyLedger, fades, needsFrames, reconcile, type Ledger, type LedgerConfig, type LedgerFades, type Tap } from '../placementLedger.ts';
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
const ABYSS: LedgerConfig = { restLobes: 2, neutralLobe: true };
const LINEN: LedgerConfig = { restLobes: 2, neutralLobe: false };
const tap = (x: number, y: number): Tap => ({ x, y });
const J = tap(0.566, 0.566);
const C = tap(0.566, -0.566);
const R = tap(-0.566, -0.566);
const I = tap(-0.566, 0.566);
const n = (k: number) => tap(0.02 * k, 0.03); // neutral: r < 0.15

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
    expect(f).toEqual({ placements: [], ended: [], restFade: 1, restSlots: [0, 1], demand: 2 });
    expect(needsFrames(emptyLedger(ABYSS))).toBe(false);
  });

  it('the admission limits are the ruled ones', () => {
    expect(ADMISSION).toEqual({ entering: 2, leaving: 2, live: 3, nodes: NODE_SLOTS, netting: true });
  });
});

describe('a push: the first placement crossfades in, the rest glow out (designer 2.6)', () => {
  it('starts on the frame it arrives, stamped there: u 0, then the settle curve; the rest lobes fall as 1 − u²', () => {
    const s = store();
    const { frames, at } = run(emptyLedger(ABYSS), s, 0, 700, 'settle', { 100: () => s.add(C) });
    expect(at(99).f.placements).toEqual([]);
    expect(at(100).f.placements.map((p) => [p.id, p.fade, p.role, p.slot])).toEqual([[0, 0, 'live', 2]]);
    expect(at(100).f.restFade).toBe(1);
    expect(at(400).f.placements[0].fade).toBe(crossfade(progress('settle', 300)).in);
    expect(at(400).f.restFade).toBe(crossfade(progress('settle', 300)).out);
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

  it('Linen: a neutral first tap keeps the glow lit (it has no lobe there)', () => {
    const s = store();
    const { at } = run(emptyLedger(LINEN), s, -1, 700, 'settle', { 0: () => s.add(n(1)) });
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
    expect(mid[0].fade).toBe(crossfade(progress('settle', 300)).out);
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
  // The planted case (designer): Linen, three neutral placements, rest lobes lit; two taps inside one
  // settle window are admitted as one swap and then one swap (two swaps would need 7 nodes).
  it('Linen neutral3: one swap, then one swap; never more than NODE_SLOTS nodes', () => {
    const s = store([n(1), n(2), n(3)]);
    const ledger = reconcile(emptyLedger(LINEN), s.input(), 0, 'settle');
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
    const { frames } = run(emptyLedger(LINEN), s, -1, 4000, 'settle', Object.fromEntries([0, 30, 60, 90, 120, 150].map((t, k) => [t, () => s.add(k % 2 ? n(k) : [J, C, R, I][k % 4])])));
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].ledger.starts !== frames[i - 1].ledger.starts) expect(frames[i].ledger.admitted).toBeGreaterThan(0);
    }
  });

  // L1: the prefix stops at the first change that does not fit, even where a later one would. Linen,
  // three neutrals, rest lobes lit; a clear, then two new neutral taps, in one settle window. The
  // waiting change is three leaves and two enters: swaps (n1, n4), (n2, n5), then n3 alone. One swap
  // fits (6 nodes); the second would make 7, so the start stops there, though n3's leave alone fits.
  it('the prefix stops at the first change that does not fit (Linen: a clear and two taps admit one swap)', () => {
    const s = store([n(1), n(2), n(3)]);
    const ledger = reconcile(emptyLedger(LINEN), s.input(), 0, 'settle');
    const { at } = run(ledger, s, 1, 2000, 'settle', { 1000: () => { s.clear(); s.add(n(4)); s.add(n(5)); } });
    expect(at(1000).ledger.admitted).toBe(1);
    expect(at(1000).f.placements.map((p) => [p.id, p.role, p.fade])).toEqual([[0, 'leaving', 1], [1, 'live', 1], [2, 'live', 1], [3, 'live', 0]]);
    expect(at(1600).f.placements.filter((p) => p.role === 'leaving').map((p) => p.id)).toEqual([1, 2]);
  });

  // L2: rest lobes count while they rise. Linen [n1, n2, J]: the undo of J brings the glow back, so the
  // rest lobes rise in the same crossfade; with n3 entering that is 3 + 1 + 2 = 6, and the next swap
  // (n1 for n4) would make 7, so it waits.
  it('rest lobes count while they rise: Linen, an undo of the only lobe and two taps admit the undo and one tap', () => {
    const s = store([n(1), n(2), J]);
    const ledger = reconcile(emptyLedger(LINEN), s.input(), 0, 'settle');
    expect(fades(ledger).restFade).toBe(0);
    const { at } = run(ledger, s, 1, 2000, 'settle', { 1000: () => { s.undo(); s.add(n(3)); s.add(n(4)); } });
    const f = at(1000).f;
    expect(f.placements.map((p) => [p.id, p.role, p.fade])).toEqual([[0, 'live', 1], [1, 'live', 1], [2, 'leaving', 1], [3, 'live', 0]]);
    expect([f.restFade, f.restSlots.length, f.demand]).toEqual([0, 2, 6]);
    expect(at(1600).f.placements.find((p) => p.id === 4)!.fade).toBe(0);
  });

  // The architect's counter (L13): Linen with neutrals only and the rest lobes lit. Two quick undos,
  // or a clear's first crossfade, leave 1 live + 2 leaving + 2 rest lobes: 5 nodes, 4 not live.
  it.each([
    ['two quick undos, seen in one frame', (s: ReturnType<typeof store>) => ({ 1000: () => { s.undo(); s.undo(); } })],
    ['a clear', (s: ReturnType<typeof store>) => ({ 1000: () => s.clear() })],
  ])('Linen, %s: two leave together, each keeping its slot, with the rest lobes lit beside them', (_name, acts) => {
    const s = store([n(1), n(2), n(3)]);
    const ledger = reconcile(emptyLedger(LINEN), s.input(), 0, 'settle');
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
  const linen = stormDeps('linen', staticsFor('linen', EXTENSIONS as never));
  /** Frames at 1 ms, each built and packed: the worst occupancy over demand, and the first throw. */
  function drive(first: Tap[], later: Record<number, Tap[]>, to: number) {
    let ledger = emptyLedger(linen.config);
    let taps = first;
    let seq = 1;
    let over = 0;
    let threw: string | null = null;
    for (let t = 0; t <= to; t++) {
      if (later[t]) { taps = later[t]; seq++; }
      ledger = reconcile(ledger, { seq, taps }, t, 'settle');
      const f = fades(ledger);
      try {
        const frame = buildFieldFrame(frameState('linen', 'light', f), geometry, linen.statics);
        packFrame(frame);
        const occupied = frame.nodes.filter((nd) => nd.fade > 0 || nd.bead !== null).length;
        over = Math.max(over, occupied - f.demand);
      } catch (error) {
        threw = threw ?? `${(error as Error).name} at ${t} ms: ${(error as Error).message}`;
      }
    }
    return { over, threw, ledger };
  }

  it.each([['NaN', NaN], ['Infinity', Infinity]])('Linen, taps [n1, n2, %s], then two neutral taps inside one settle window: never throws, never over demand', (_, bad) => {
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
    const f = fades(reconcile(emptyLedger(linen.config), { seq: 1, taps: [tap(NaN, 0.5), tap(0.4, Infinity)] }, 0, 'settle'));
    expect(f.placements.map((p) => [p.x, p.y, p.node])).toEqual([[0, 0.5, nodeAt(0, 0.5)], [0.4, 0, nodeAt(0.4, 0)]]);
  });
});
