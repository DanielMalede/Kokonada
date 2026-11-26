// B8-7 (the architect's B8 plan at 199b138; resilience QA-068's S7, TASKS UI-190): the storm scenes' tap script. Each case
// is a cycle of cold-lane inputs at fixed times from the scene's start, repeated for as long as the scene runs, so a
// recording that starts at any moment holds at least one whole case: a pure function of the elapsed time, no randomness,
// no wall clock.
//   · first: rest for 2 s, then the first tap, rest → one.calm (S7 (i)), held, then undone back to rest;
//   · toggle: rest for 2 s, then a toggle storm on the one.calm spot, one change every 143 ms (7 a second) for 3 s, 21
//     changes (S7 (ii)), then one undo back to rest once the storm has long settled;
//   · idle: one change every 2 s, add one.calm then undo, so every change follows a 2 s idle (UI-190, L19's latency).

import {
  IDLE_MS, STORM_CASES, STORM_PERIOD_MS, STORM_SPAN_MS, nextChangeAfter, stormCountAt, stormScript, stormTapsAt, type StormScript,
} from '../storm/stormScript';

const CALM = { x: 0.566, y: -0.566 };
const times = (s: StormScript) => s.changes.map((c) => c.atMs);
const shapes = (s: StormScript) => s.changes.map((c) => (c.taps.length === 0 ? 'rest' : 'calm'));

describe('the storm constants', () => {
  it('143 ms between storm taps, 7 a second, for 3 s; a 2 s idle', () => {
    expect(STORM_PERIOD_MS).toBe(143);
    expect(Math.round(1000 / STORM_PERIOD_MS)).toBe(7);
    expect(STORM_SPAN_MS).toBe(3000);
    expect(IDLE_MS).toBe(2000);
    expect(STORM_CASES).toEqual(['first', 'toggle', 'idle']);
  });
});

describe('the scripts', () => {
  it('first: rest, the first tap at 2 s (rest → one.calm), undone at 6 s; a 10 s cycle', () => {
    const s = stormScript('first', CALM);
    expect(s.cycleMs).toBe(10000);
    expect(times(s)).toEqual([2000, 6000]);
    expect(shapes(s)).toEqual(['calm', 'rest']);
    expect(s.changes[0].taps).toEqual([CALM]);
  });

  it('toggle: 21 changes 143 ms apart from 2 s, add then undo on the calm spot, then one undo at 9 s; a 12 s cycle', () => {
    const s = stormScript('toggle', CALM);
    expect(s.cycleMs).toBe(12000);
    const storm = Array.from({ length: 21 }, (_, i) => 2000 + 143 * i);
    expect(times(s)).toEqual([...storm, 9000]);
    expect(shapes(s)).toEqual([...storm.map((_, i) => (i % 2 === 0 ? 'calm' : 'rest')), 'rest']);
    // 7 a second for 3 s: the storm's 21 changes span 20 periods, inside 3 s.
    expect(storm[20] - storm[0]).toBe(2860);
    expect(storm.filter((t) => t >= 2000 && t < 3000)).toHaveLength(7);
  });

  it('idle: one change every 2 s, add one.calm then undo; a 4 s cycle', () => {
    const s = stormScript('idle', CALM);
    expect(s.cycleMs).toBe(4000);
    expect(times(s)).toEqual([2000, 4000]);
    expect(shapes(s)).toEqual(['calm', 'rest']);
  });

  it.each(STORM_CASES)('%s: starts at rest, its last change is back to rest, every change inside the cycle and a new array', (c) => {
    const s = stormScript(c, CALM);
    expect(s.initial).toEqual([]);
    expect(s.changes[s.changes.length - 1].taps).toEqual([]);
    const t = times(s);
    expect(t.every((x, i) => x > 0 && x <= s.cycleMs && (i === 0 || x > t[i - 1]))).toBe(true);
    expect(new Set(s.changes.map((x) => x.taps)).size).toBe(s.changes.length);
    // Consecutive inputs always differ by value: every change is a change the ledger sees.
    const states = [s.initial, ...s.changes.map((x) => x.taps)];
    for (let i = 1; i < states.length; i++) expect(states[i]).not.toEqual(states[i - 1]);
  });
});

describe('the script over time', () => {
  const s = stormScript('toggle', CALM);

  it('the count of changes so far, across cycles; nothing before the first change', () => {
    expect(stormCountAt(s, 0)).toBe(0);
    expect(stormCountAt(s, 1999.9)).toBe(0);
    expect(stormCountAt(s, 2000)).toBe(1);
    expect(stormCountAt(s, 2142.9)).toBe(1);
    expect(stormCountAt(s, 2143)).toBe(2);
    expect(stormCountAt(s, 4860)).toBe(21);
    expect(stormCountAt(s, 8999)).toBe(21);
    expect(stormCountAt(s, 9000)).toBe(22);
    expect(stormCountAt(s, 12000 + 2000)).toBe(23);
    expect(stormCountAt(s, 3 * 12000 + 2143)).toBe(3 * 22 + 2);
    expect(stormCountAt(s, -5)).toBe(0);
  });

  it('the taps at a count: the initial before the first change, else the last change\'s own array', () => {
    expect(stormTapsAt(s, 0)).toBe(s.initial);
    expect(stormTapsAt(s, 1)).toBe(s.changes[0].taps);
    expect(stormTapsAt(s, 2)).toBe(s.changes[1].taps);
    expect(stormTapsAt(s, 22)).toBe(s.changes[21].taps);
    expect(stormTapsAt(s, 23)).toBe(s.changes[0].taps);
  });

  it('the next change after an elapsed time, across the cycle\'s end', () => {
    expect(nextChangeAfter(s, 0)).toBe(2000);
    expect(nextChangeAfter(s, 2000)).toBe(2143);
    expect(nextChangeAfter(s, 4860)).toBe(9000);
    expect(nextChangeAfter(s, 9000)).toBe(14000);
    expect(nextChangeAfter(s, 12000)).toBe(14000);
    const idle = stormScript('idle', CALM);
    expect(nextChangeAfter(idle, 3999)).toBe(4000);
    expect(nextChangeAfter(idle, 4000)).toBe(6000);
    expect(stormCountAt(idle, 4000)).toBe(2);
    expect(stormCountAt(idle, 6000)).toBe(3);
  });

  it('is a pure function of the elapsed time: the same times give the same counts', () => {
    const ts = Array.from({ length: 400 }, (_, i) => i * 37.5);
    expect(ts.map((t) => stormCountAt(s, t))).toEqual(ts.map((t) => stormCountAt(stormScript('toggle', CALM), t)));
  });
});
