import { emptyLedger, ledgerConfig, reconcile, type Ledger } from '../../../field/placementLedger.ts';
import { STATICS } from '../../../tokens/tokens.statics.generated.ts';
import { MAX_BEADS, presenceExitStarted, presenceGone, presenceOf, presenceUpdate, type BeadPresence } from '../beadPresence.ts';
import { entranceOpacity, PRESS_MS } from '../beadTimeline.ts';

// Which beads are on the plate, entering or leaving (LEDGER §7: place, replace and remove move the bead; the
// oldest dissolves on a fourth tap). The store holds bare points, so identity comes from reading a change
// by value, the way the placement ledger reads it: the longest run of the shown taps that the new taps
// begin with stays; what is lost leaves; what follows the run enters. The ledger test below holds the two
// readings together, so a bead and its halo always answer to the same tap.
//
// Ruling 2 (2026-11-25): one presence serves the beads and the rim words. Each entry carries when its entrance began
// (placedAt), when its exit began (leftAt) and its opacity at that moment (startOpacity), so the rim words can fade back
// in step with the bead (beadOpacityAt). Under reduced motion a bead is whole in one frame and gone in one (F1), so a
// still-tier placement has no entrance and a still-tier removal leaves nothing behind.

const A = { x: 0.6, y: 0.6 };
const B = { x: 0.6, y: -0.6 };
const C = { x: -0.6, y: -0.6 };
const D = { x: -0.6, y: 0.6 };
const T0 = 1000;
const live = (p: BeadPresence) => p.beads.filter((b) => !b.leaving);
const leaving = (p: BeadPresence) => p.beads.filter((b) => b.leaving);
const points = (beads: BeadPresence['beads']) => beads.map((b) => b.point);
const ids = (beads: BeadPresence['beads']) => beads.map((b) => b.id);
/** A bead shown whole from its first frame, live. */
const whole = (id: number, point: { x: number; y: number }) => ({ id, point, leaving: false, placedAt: null, leftAt: null, playedAt: null, playMs: null, startOpacity: 1 });
const update = (p: BeadPresence, taps: ReadonlyArray<{ x: number; y: number }>, nowMs = T0) => presenceUpdate(p, taps, nowMs, 'full');

describe('presenceOf: the mount shows every tap at once', () => {
  it('gives each tap an id in order, shown whole (no entrance), none leaving', () => {
    const p = presenceOf([A, B]);
    expect(p.beads).toEqual([whole(0, A), whole(1, B)]);
    expect(p.next).toBe(2);
    expect(presenceOf([]).beads).toEqual([]);
  });

  it('reads at most the cold lane’s three, the newest, and a non-finite coordinate as 0, as the ledger reads the store', () => {
    expect(MAX_BEADS).toBe(3);
    expect(points(presenceOf([A, B, C, D]).beads)).toEqual([B, C, D]);
    expect(points(presenceOf([{ x: NaN, y: 0.2 }]).beads)).toEqual([{ x: 0, y: 0.2 }]);
  });
});

describe('presenceUpdate: a change, read by value', () => {
  it('a new tap enters with the next id, its entrance stamped now; the others stay as they were', () => {
    const p = update(presenceOf([A]), [A, B]);
    expect(p.beads).toEqual([whole(0, A), { id: 1, point: B, leaving: false, placedAt: T0, leftAt: null, playedAt: null, playMs: null, startOpacity: 1 }]);
  });

  it('a fourth tap: the oldest leaves, the new one enters, the middle two stay', () => {
    const p = update(presenceOf([A, B, C]), [B, C, D]);
    expect(ids(live(p))).toEqual([1, 2, 3]);
    expect(points(live(p))).toEqual([B, C, D]);
    expect(leaving(p)).toEqual([{ id: 0, point: A, leaving: true, placedAt: null, leftAt: T0, playedAt: null, playMs: null, startOpacity: 1 }]);
  });

  it('undo: the latest leaves', () => {
    const p = update(presenceOf([A, B]), [A]);
    expect(ids(live(p))).toEqual([0]);
    expect(ids(leaving(p))).toEqual([1]);
  });

  it('clear: every bead leaves', () => {
    const p = update(presenceOf([A, B, C]), []);
    expect(live(p)).toEqual([]);
    expect(ids(leaving(p))).toEqual([0, 1, 2]);
  });

  it('the same taps in a new array change nothing, and return the same presence', () => {
    const before = presenceOf([A, B]);
    expect(update(before, [{ ...A }, { ...B }])).toBe(before);
  });

  it('a tap placed again where a leaving bead is gets a new id; the leaving one keeps leaving', () => {
    const gone = update(presenceOf([A]), [], T0);
    const back = update(gone, [A], T0 + 50);
    expect(back.beads).toEqual([
      { id: 0, point: A, leaving: true, placedAt: null, leftAt: T0, playedAt: null, playMs: null, startOpacity: 1 },
      { id: 1, point: A, leaving: false, placedAt: T0 + 50, leftAt: null, playedAt: null, playMs: null, startOpacity: 1 },
    ]);
  });

  it('ids only rise, and the beads stay in id order', () => {
    let p = presenceOf([]);
    for (const taps of [[A], [A, B], [A, B, C], [B, C, D], [B, C], [], [D]]) p = update(p, taps);
    const all = ids(p.beads);
    expect([...all].sort((a, b) => a - b)).toEqual(all);
    expect(new Set(all).size).toBe(all.length);
    expect(p.next).toBe(5);
  });
});

describe('ruling 2: a leaving bead carries its leftAt and its opacity at that moment', () => {
  it('a bead caught in its entrance leaves from the entrance’s opacity then; an opaque one from 1', () => {
    const placed = update(presenceOf([]), [A], T0);
    for (const after of [0, 30, 60, PRESS_MS, 500]) {
      const gone = update(placed, [], T0 + after);
      expect(gone.beads).toEqual([{ id: 0, point: A, leaving: true, placedAt: T0, leftAt: T0 + after, playedAt: null, playMs: null, startOpacity: entranceOpacity(after) }]);
    }
    expect(entranceOpacity(30)).toBeGreaterThan(0);
    expect(entranceOpacity(30)).toBeLessThan(1);
  });

  it('a leaving bead keeps its stamps through later changes', () => {
    const gone = update(update(presenceOf([]), [A], T0), [], T0 + 30);
    const later = update(gone, [B], T0 + 90);
    expect(later.beads[0]).toEqual(gone.beads[0]);
  });
});

describe('the still tier (F1: one frame in, one frame out)', () => {
  it('a tap placed under reduced motion is whole from its first frame: no entrance', () => {
    const p = presenceUpdate(presenceOf([A]), [A, B], T0, 'still');
    expect(p.beads).toEqual([whole(0, A), whole(1, B)]);
  });

  it('a tap taken away under reduced motion is gone in the same frame: nothing leaves', () => {
    const p = presenceUpdate(presenceOf([A, B, C]), [B, C, D], T0, 'still');
    expect(p.beads).toEqual([whole(1, B), whole(2, C), whole(3, D)]);
    expect(presenceUpdate(presenceOf([A, B]), [], T0, 'still').beads).toEqual([]);
  });

  it('turning reduced motion on ends every exit in that frame, the same taps or not; turning it on with none leaving changes nothing', () => {
    const leavingOne = update(presenceOf([A, B]), [A], T0);
    expect(presenceUpdate(leavingOne, [A], T0 + 10, 'still').beads).toEqual([whole(0, A)]);
    const settled = presenceOf([A]);
    expect(presenceUpdate(settled, [A], T0, 'still')).toBe(settled);
  });

  it('the low tier moves beads exactly as the full one', () => {
    const steps: Array<ReadonlyArray<{ x: number; y: number }>> = [[A], [A, B], [B], [B, C, D], []];
    let full = presenceOf([]);
    let low = presenceOf([]);
    steps.forEach((taps, i) => {
      full = presenceUpdate(full, taps, T0 + 40 * i, 'full');
      low = presenceUpdate(low, taps, T0 + 40 * i, 'low');
    });
    expect(low).toEqual(full);
  });
});

describe('presenceGone: a leaving bead finished its exit', () => {
  it('removes that bead, and only a leaving one', () => {
    const p = update(presenceOf([A, B]), [A]);
    expect(presenceGone(p, 1).beads).toEqual([whole(0, A)]);
    expect(presenceGone(p, 0)).toBe(p);
    expect(presenceGone(p, 42)).toBe(p);
  });
});

describe('presenceExitStarted: the leaving bead’s clock was seen to start its exit (the time the rim words read it on)', () => {
  it('stamps playedAt and playMs on that leaving bead only, once: the first report stands', () => {
    const p = update(presenceOf([A, B]), [A]);
    const stamped = presenceExitStarted(p, 1, T0 + 300, 350);
    expect(stamped.beads).toEqual([whole(0, A), { id: 1, point: B, leaving: true, placedAt: null, leftAt: T0, playedAt: T0 + 300, playMs: 350, startOpacity: 1 }]);
    expect(stamped.next).toBe(p.next);
    expect(presenceExitStarted(stamped, 1, T0 + 500, 450)).toBe(stamped);
  });

  it('a live bead, an unknown id, an unreadable time or a length that is not above 0 changes nothing', () => {
    const p = update(presenceOf([A, B]), [A]);
    expect(presenceExitStarted(p, 0, T0 + 10, 350)).toBe(p);
    expect(presenceExitStarted(p, 42, T0 + 10, 350)).toBe(p);
    for (const at of [Number.NaN, Number.POSITIVE_INFINITY]) expect(presenceExitStarted(p, 1, at, 350)).toBe(p);
    for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(presenceExitStarted(p, 1, T0 + 10, ms)).toBe(p);
  });
});

// The ledger and the beads read the store the same way: for every step of a long seeded storm of
// adds (the cold lane's ring of three), undos and clears, the live beads' ids are the ledger's store ids.
describe('the beads and the placement ledger agree on every tap’s identity', () => {
  it('over a seeded storm of add, undo and clear', () => {
    const config = ledgerConfig('abyss', STATICS.abyss['field.rest'].lobes.dark, { radiusPx: 150, pxPerDp: 1 });
    const pool = [A, B, C, D, { x: 0.05, y: 0.02 }, { x: -0.2, y: 0.9 }];
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let taps: Array<{ x: number; y: number }> = [];
    let ledger: Ledger = emptyLedger(config);
    ledger = reconcile(ledger, { seq: 0, taps }, 0, 'settle');
    let presence = presenceOf(taps);
    for (let step = 1; step <= 400; step++) {
      const roll = random();
      if (roll < 0.6) taps = [...taps, pool[Math.floor(random() * pool.length)]].slice(-3);
      else if (roll < 0.92) taps = taps.slice(0, -1);
      else taps = [];
      ledger = reconcile(ledger, { seq: step, taps }, step * 37, 'settle');
      presence = update(presence, taps, step * 37);
      expect(ids(live(presence))).toEqual(ledger.store.map((p) => p.id));
    }
  });
});
