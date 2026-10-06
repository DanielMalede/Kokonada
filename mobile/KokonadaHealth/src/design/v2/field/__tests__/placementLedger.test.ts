/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { emptyLedger, placementsOf, reconcile, type Ledger } from '../placementLedger.ts';

// The placement ledger (architect re-rule §3): the visual layer's own record of the placements,
// derived from successive tap arrays and nothing else. A placement's ordinal (how many placements came
// before it) keys its drift for its whole life, its fade-out included, so a fourth tap never re-indexes
// the survivors (critic item 5, accepted). The cold-lane Tap stays exactly {x, y}: the ledger reads
// taps structurally, never imports src/state, and is never persisted.
//
// T4 builds the classification only: which taps arrived, which leave, and their ordinals and roles.
// Fades, crossfades, admission and pruning are T5.

const tap = (x: number, y: number) => ({ x, y });
const live = (l: Ledger) => l.entries.filter((e) => e.role === 'live');
const leaving = (l: Ledger) => l.entries.filter((e) => e.role === 'leaving');
const ordinals = (es: Ledger['entries']) => es.map((e) => e.ordinal);

describe('reconcile: classifying a new taps array, by reference', () => {
  const a = tap(0.5, 0.5);
  const b = tap(0.5, -0.5);
  const c = tap(-0.5, -0.5);
  const d = tap(-0.5, 0.5);

  it('starts empty', () => {
    expect(emptyLedger()).toEqual({ taps: [], next: 0, entries: [], change: 'none' });
  });

  it('a push: the new tap is live with the next ordinal, stamped now', () => {
    const one = reconcile(emptyLedger(), [a], 100);
    expect(one.change).toBe('push');
    expect(one.entries).toEqual([{ ordinal: 0, x: 0.5, y: 0.5, role: 'live', sinceMs: 100 }]);
    const two = reconcile(one, [a, b], 250);
    expect(two.change).toBe('push');
    expect(two.entries).toEqual([
      { ordinal: 0, x: 0.5, y: 0.5, role: 'live', sinceMs: 100 },
      { ordinal: 1, x: 0.5, y: -0.5, role: 'live', sinceMs: 250 },
    ]);
    expect(two.next).toBe(2);
  });

  it('a push with a shift (a fourth tap): the oldest leaves, the survivors keep their ordinals', () => {
    let l = reconcile(emptyLedger(), [a], 0);
    l = reconcile(l, [a, b], 10);
    l = reconcile(l, [a, b, c], 20);
    l = reconcile(l, [b, c, d], 30);
    expect(l.change).toBe('replace');
    expect(ordinals(live(l))).toEqual([1, 2, 3]);
    expect(leaving(l)).toEqual([{ ordinal: 0, x: 0.5, y: 0.5, role: 'leaving', sinceMs: 30 }]);
    expect(live(l).map((e) => e.sinceMs)).toEqual([10, 20, 30]);
  });

  it('a pop (the latest removed): it leaves, the rest stay', () => {
    let l = reconcile(reconcile(emptyLedger(), [a], 0), [a, b], 10);
    l = reconcile(l, [a], 40);
    expect(l.change).toBe('pop');
    expect(ordinals(live(l))).toEqual([0]);
    expect(leaving(l)).toEqual([{ ordinal: 1, x: 0.5, y: -0.5, role: 'leaving', sinceMs: 40 }]);
  });

  it('a clear: every live placement leaves', () => {
    let l = reconcile(reconcile(emptyLedger(), [a], 0), [a, b], 10);
    l = reconcile(l, [], 50);
    expect(l.change).toBe('clear');
    expect(live(l)).toEqual([]);
    expect(ordinals(leaving(l))).toEqual([0, 1]);
    expect(leaving(l).every((e) => e.sinceMs === 50)).toBe(true);
  });

  it('an ordinal is never reused: a pop then a push takes a new one', () => {
    let l = reconcile(reconcile(emptyLedger(), [a], 0), [a, b], 10);
    l = reconcile(l, [a], 20);
    const e = tap(0.1, 0.9);
    l = reconcile(l, [a, e], 30);
    expect(l.change).toBe('push');
    expect(ordinals(live(l))).toEqual([0, 2]);
    expect(ordinals(leaving(l))).toEqual([1]);
  });

  it('the same taps again (the same array, or a new array of the same taps) change nothing', () => {
    const l = reconcile(reconcile(emptyLedger(), [a], 0), [a, b], 10);
    const same = reconcile(l, l.taps, 999);
    expect(same.change).toBe('none');
    expect(same.entries).toBe(l.entries);
    const copy = reconcile(l, [a, b], 999);
    expect(copy.change).toBe('none');
    expect(copy.entries).toBe(l.entries);
  });

  it('anything else resets (a hydrate, a restart): ordinals 0..n−1, all live, nothing leaving', () => {
    const l = reconcile(reconcile(emptyLedger(), [a], 0), [a, b], 10);
    const hydrated = [tap(0.5, 0.5), tap(0.5, -0.5)]; // equal values, new objects: not the same taps
    const r = reconcile(l, hydrated, 70);
    expect(r.change).toBe('reset');
    expect(r.entries).toEqual([
      { ordinal: 0, x: 0.5, y: 0.5, role: 'live', sinceMs: 70 },
      { ordinal: 1, x: 0.5, y: -0.5, role: 'live', sinceMs: 70 },
    ]);
    expect(r.next).toBe(2);
    expect(reconcile(l, [b, a], 80).change).toBe('reset'); // reordered
    expect(reconcile(l, [a, b, c, d], 80).change).toBe('reset'); // more than one new tap
  });

  it('reads taps structurally: only x and y are kept', () => {
    const extra = { x: 0.2, y: 0.3, persistedSomething: true } as { x: number; y: number };
    expect(reconcile(emptyLedger(), [extra], 5).entries[0]).toEqual({ ordinal: 0, x: 0.2, y: 0.3, role: 'live', sinceMs: 5 });
  });
});

describe('placementsOf: the ledger as the builder’s placements, with every fade given', () => {
  it('each entry keeps its ordinal and role, and takes its fade from the caller', () => {
    let l = reconcile(emptyLedger(), [tap(0.5, 0.5)], 0);
    l = reconcile(l, [...l.taps, tap(0.5, -0.5)], 10);
    l = reconcile(l, [...l.taps, tap(-0.5, -0.5)], 20);
    l = reconcile(l, [l.taps[1], l.taps[2], tap(-0.5, 0.5)], 30);
    const fades: Record<number, number> = { 0: 0.3, 1: 1, 2: 1, 3: 0.7 };
    expect(placementsOf(l, (e) => fades[e.ordinal])).toEqual([
      { x: 0.5, y: 0.5, ordinal: 0, role: 'leaving', fade: 0.3 },
      { x: 0.5, y: -0.5, ordinal: 1, role: 'live', fade: 1 },
      { x: -0.5, y: -0.5, ordinal: 2, role: 'live', fade: 1 },
      { x: -0.5, y: 0.5, ordinal: 3, role: 'live', fade: 0.7 },
    ]);
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
});
