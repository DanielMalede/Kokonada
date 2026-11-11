/// <reference types="node" />
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
//     the model lacks (a remove by index, say) fails here before a storm could pass without it.

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
