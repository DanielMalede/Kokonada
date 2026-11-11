/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import reducer, * as slice from '../emotionSlice';
import { addTap, clearTaps, undoTap, type EmotionState, type Tap } from '../emotionSlice';
// The storms' own generator (resilience round 1 F3's LCG) and store model.
import { lcg, store as stormStore } from '../../../design/v2/field/ledgerStorms.ts';

// The cold lane's contract with the field's storm harness (architect T5 r1 §5, T10). The ledger storms
// (src/design/v2/field/ledgerStorms.ts) drive the placement ledger with a model of this slice's taps, never
// the slice itself: nothing in src/design/v2 imports src/state. So the storms prove the ledger against the
// real cold lane only while that model is the reducer. This pins it:
//   · after every operation of seeded sequences of adds (past the cap, so with its shift, and with
//     coordinates the slice does not check), undos and clears (on an empty list too), the model's taps
//     equal the reducer's;
//   · the reading the ledger relies on (architect T5 r1 §1 (c): "The reading assumes the cold lane's
//     operation set") holds: every other action of the slice leaves the taps as they were, so an operation
//     the model lacks (a remove by index, say) fails here before a storm could pass without it;
//   · and the modelled operations themselves (resilience T10 RA-27): undoTap and clearTaps with any payload do
//     exactly the model's undo and clear, addTap is the model's add for every kind of tap, the slice has exactly its
//     seven actions and no extraReducers.

type Op = { readonly kind: 'add'; readonly tap: Tap; readonly tapKind: number } | { readonly kind: 'undo' } | { readonly kind: 'clear' };
type Model = { add(t: Tap): void; undo(): void; clear(): void; taps(): readonly Tap[] };
type Creator = (payload?: unknown) => { type: string; payload?: unknown };
type Reducer = (state: EmotionState, action: { type: string; payload?: unknown }) => EmotionState;

/** Every kind of tap the storms add, and some the slice lets through: a random point, zero, NaN, ±Infinity. */
const TAP_KINDS = 9;
const tapFor = (kind: number, r: number): Tap =>
  [
    { x: 0.566, y: 0.566 },
    { x: 0.03, y: -0.02 },
    { x: 0.15, y: 0 },
    { x: 0, y: -1 },
    { x: 1.3, y: -0.4 },
    { x: 2 * r - 1, y: 1 - 2 * ((r * 7) % 1) },
    { x: 0, y: 0 },
    { x: Number.NaN, y: 0.5 },
    { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY },
  ][kind];

/** One seeded sequence of the cold lane's tap operations: 60% adds, 25% undos, 15% clears. */
function sequence(seed: number, length: number): Op[] {
  const next = lcg(seed);
  const ops: Op[] = [];
  for (let i = 0; i < length; i++) {
    const roll = next();
    if (roll < 0.6) {
      const tapKind = Math.floor(next() * TAP_KINDS);
      ops.push({ kind: 'add', tap: tapFor(tapKind, next()), tapKind });
    }
    else ops.push(roll < 0.85 ? { kind: 'undo' } : { kind: 'clear' });
  }
  return ops;
}

const same = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));
const equalTaps = (a: readonly Tap[], b: readonly Tap[]) => a.length === b.length && a.every((t, i) => same(t.x, b[i].x) && same(t.y, b[i].y));

/** The first operation after which a model's taps and the reducer's differ, or null. */
function divergence(model: Model, ops: readonly Op[]): { at: number; kind: Op['kind'] } | null {
  let state: EmotionState = reducer(undefined, { type: '@@INIT' });
  for (const [at, op] of ops.entries()) {
    if (op.kind === 'add') {
      model.add({ ...op.tap });
      state = reducer(state, addTap({ ...op.tap }));
    } else if (op.kind === 'undo') {
      model.undo();
      state = reducer(state, undoTap());
    } else {
      model.clear();
      state = reducer(state, clearTaps());
    }
    if (!equalTaps(model.taps(), state.taps)) return { at, kind: op.kind };
  }
  return null;
}

const SEQUENCES = Array.from({ length: 24 }, (_, i) => sequence(i + 1, 400));

describe('the storms’ store model is the cold lane’s reducer', () => {
  it('over 24 seeded sequences of 400 adds, undos and clears, the model’s taps equal the reducer’s after every operation', () => {
    expect(SEQUENCES.map((ops) => divergence(stormStore(), ops)).filter((d) => d !== null)).toEqual([]);
  });

  it('the sequences are not vacuous: they add past the cap, undo and clear an empty list, and add every kind of tap', () => {
    const seen = { pastCap: 0, emptyUndo: 0, emptyClear: 0 };
    const kinds = new Set<number>();
    for (const ops of SEQUENCES) {
      let state: EmotionState = reducer(undefined, { type: '@@INIT' });
      for (const op of ops) {
        if (op.kind === 'add') {
          if (state.taps.length === 3) seen.pastCap++;
          kinds.add(op.tapKind);
          state = reducer(state, addTap(op.tap));
        } else if (op.kind === 'undo') {
          if (state.taps.length === 0) seen.emptyUndo++;
          state = reducer(state, undoTap());
        } else {
          if (state.taps.length === 0) seen.emptyClear++;
          state = reducer(state, clearTaps());
        }
      }
    }
    expect(Object.values(seen).every((n) => n > 0)).toBe(true);
    expect(kinds.size).toBe(TAP_KINDS);
  });

  // Planted controls: a model that differs from the reducer in any one rule is caught by the same comparison.
  const model = (add: (taps: Tap[], t: Tap) => Tap[], undo: (taps: Tap[]) => Tap[], clear: (taps: Tap[]) => Tap[]): Model => {
    let taps: Tap[] = [];
    return { add: (t) => { taps = add(taps, t); }, undo: () => { taps = undo(taps); }, clear: () => { taps = clear(taps); }, taps: () => taps };
  };
  const fin = (v: number) => (Number.isFinite(v) ? v : 0);
  it.each<[string, () => Model]>([
    ['a model with the reducer’s rules (the control)', () => model((ts, t) => [...ts, t].slice(-3), (ts) => ts.slice(0, -1), () => [])],
    ['an add that keeps four taps (no shift at the cap)', () => model((ts, t) => [...ts, t].slice(-4), (ts) => ts.slice(0, -1), () => [])],
    ['an undo that drops the oldest', () => model((ts, t) => [...ts, t].slice(-3), (ts) => ts.slice(1), () => [])],
    ['a clear that keeps the latest tap', () => model((ts, t) => [...ts, t].slice(-3), (ts) => ts.slice(0, -1), (ts) => ts.slice(-1))],
    ['an add that reads a non-finite coordinate as 0 (the ledger does, the cold lane does not)', () => model((ts, t) => [...ts, { x: fin(t.x), y: fin(t.y) }].slice(-3), (ts) => ts.slice(0, -1), () => [])],
  ])('%s', (name, make) => {
    const caught = SEQUENCES.some((ops) => divergence(make(), ops) !== null);
    expect(caught).toBe(!name.includes('the control'));
  });
});

describe('the cold lane changes its taps only by the operations the model covers', () => {
  // The model's operations, and the two actions that replace the list whole (read by value: a mount's reset,
  // or a change like any other).
  const MODELLED = ['addTap', 'undoTap', 'clearTaps'];
  const REPLACE = ['hydrate', 'resetEmotion'];
  const CREATORS = Object.entries(slice).filter(([, v]) => typeof v === 'function' && typeof (v as { type?: unknown }).type === 'string') as Array<[string, Creator]>;
  const THREE: EmotionState = { taps: [{ x: 0.5, y: 0.5 }, { x: -0.5, y: 0.2 }, { x: 0.1, y: -0.7 }], activity: null, textPrompt: '' };
  const PAYLOADS: unknown[] = [undefined, 0, 1, 2, 'running', { x: 0.5, y: 0.5 }, { taps: [] }];

  /** Each action outside the modelled and replacing ones, with a payload, that leaves the taps list it was given. */
  const movers = (run: Reducer, creators: ReadonlyArray<[string, Creator]>) => {
    const moved: string[] = [];
    for (const [name, create] of creators) {
      if (MODELLED.includes(name) || REPLACE.includes(name)) continue;
      for (const payload of PAYLOADS) {
        let next: EmotionState;
        try {
          next = run(THREE, create(payload));
        } catch {
          continue;
        }
        if (next.taps !== THREE.taps) moved.push(`${name}(${JSON.stringify(payload)})`);
      }
    }
    return moved;
  };

  it('the slice still has the actions the model and the ledger’s reading name, and others', () => {
    expect(CREATORS.map(([name]) => name)).toEqual(expect.arrayContaining([...MODELLED, ...REPLACE]));
    expect(CREATORS.length).toBeGreaterThan(MODELLED.length + REPLACE.length);
  });

  it('every other action leaves the taps exactly as they were (the same list), whatever its payload', () => {
    expect(movers(reducer as Reducer, CREATORS)).toEqual([]);
  });

  it('planted: a slice with an action that removes a tap by index is caught by the same check', () => {
    const planted: Reducer = (state, action) => (action.type === 'emotion/removeTapAt' ? { ...state, taps: state.taps.filter((_, i) => i !== Number(action.payload ?? 0)) } : reducer(state, action));
    const removeTapAt: Creator = (payload) => ({ type: 'emotion/removeTapAt', payload });
    expect(movers(planted, [...CREATORS, ['removeTapAt', removeTapAt]]).length).toBeGreaterThan(0);
  });
});

// RA-27 (resilience T10, UI-200): the check above skips the modelled actions, so an undoTap that honoured an index
// payload passed it; and extraReducers were never looked at. Each check runs on the real slice and on a plant.
describe('the modelled operations take no payload, addTap is the model’s add, and the slice has nothing else', () => {
  const PAYLOADS: unknown[] = [undefined, 0, 1, 2, -1, 'running', { index: 1 }, { x: 0.5, y: 0.5 }, { taps: [] }];
  const STARTS: Tap[][] = [[], [{ x: 0.5, y: 0.5 }], [{ x: 0.5, y: 0.5 }, { x: -0.5, y: 0.2 }], [{ x: 0.5, y: 0.5 }, { x: -0.5, y: 0.2 }, { x: 0.1, y: -0.7 }]];
  const stateOf = (taps: readonly Tap[]): EmotionState => ({ taps: taps.map((t) => ({ ...t })), activity: null, textPrompt: '' });
  /** The model's taps after one operation from `taps`. */
  const modelAfter = (taps: readonly Tap[], op: (m: Model) => void) => {
    const m = stormStore(taps.map((t) => ({ ...t })));
    op(m);
    return m.taps();
  };
  /** Every start and payload where a reducer's undoTap(payload) or clearTaps(payload) differs from the model's undo or clear. */
  const payloadMismatches = (run: Reducer): string[] => {
    const out: string[] = [];
    for (const taps of STARTS) {
      for (const payload of PAYLOADS) {
        if (!equalTaps(run(stateOf(taps), { type: undoTap.type, payload }).taps, modelAfter(taps, (m) => m.undo()))) out.push(`undoTap(${JSON.stringify(payload)}) from ${taps.length}`);
        if (!equalTaps(run(stateOf(taps), { type: clearTaps.type, payload }).taps, modelAfter(taps, (m) => m.clear()))) out.push(`clearTaps(${JSON.stringify(payload)}) from ${taps.length}`);
      }
    }
    return out;
  };
  const real = reducer as Reducer;

  it('undoTap and clearTaps, whatever their payload, do exactly the model’s undo and clear, from 0 to 3 taps', () => {
    expect(payloadMismatches(real)).toEqual([]);
  });

  it('planted: an undoTap that honours an index payload is caught, and a clearTaps that keeps the tap a payload names', () => {
    const indexUndo: Reducer = (state, action) => (action.type === undoTap.type && typeof action.payload === 'number'
      ? { ...state, taps: state.taps.filter((_, i) => i !== action.payload) } : real(state, action));
    const keepingClear: Reducer = (state, action) => (action.type === clearTaps.type && typeof action.payload === 'number'
      ? { ...state, taps: state.taps.filter((_, i) => i === action.payload) } : real(state, action));
    expect([payloadMismatches(indexUndo).length > 0, payloadMismatches(keepingClear).length > 0]).toEqual([true, true]);
  });

  it('addTap is the model’s add for every kind of tap, NaN, ±Infinity and off the disc included, from 0 to 3 taps', () => {
    const mismatches: string[] = [];
    for (const taps of STARTS) {
      for (let kind = 0; kind < TAP_KINDS; kind++) {
        const t = tapFor(kind, 0.37);
        if (!equalTaps(reducer(stateOf(taps), addTap({ ...t })).taps, modelAfter(taps, (m) => m.add({ ...t })))) mismatches.push(`addTap(${JSON.stringify(t)}) from ${taps.length}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  const SEVEN = ['addTap', 'clearTaps', 'hydrate', 'resetEmotion', 'setActivity', 'setTextPrompt', 'undoTap'];
  const exactlySeven = (names: readonly string[]) => JSON.stringify([...names].sort()) === JSON.stringify(SEVEN);
  const extraReducersIn = (source: string) => /\bextraReducers\b/.test(source);
  const SOURCE = fs.readFileSync(path.resolve(__dirname, '../emotionSlice.ts'), 'utf8');
  const NAMES = Object.entries(slice).filter(([, v]) => typeof v === 'function' && typeof (v as { type?: unknown }).type === 'string').map(([name]) => name);

  it('the slice’s actions are exactly the seven, and its source has no extraReducers', () => {
    expect([exactlySeven(NAMES), extraReducersIn(SOURCE)]).toEqual([true, false]);
  });

  it('planted: an eighth action, or extraReducers in the slice, is caught by the same checks', () => {
    const withExtra = SOURCE.replace("  name: 'emotion',", () => "  name: 'emotion',\n  extraReducers: (builder) => builder,");
    expect(withExtra).not.toBe(SOURCE);
    expect([exactlySeven([...NAMES, 'removeTapAt']), extraReducersIn(withExtra)]).toEqual([false, true]);
  });
});
