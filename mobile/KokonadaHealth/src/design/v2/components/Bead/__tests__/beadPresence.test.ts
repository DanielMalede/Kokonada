import { emptyLedger, ledgerConfig, reconcile, type Ledger } from '../../../field/placementLedger.ts';
import { STATICS } from '../../../tokens/tokens.statics.generated.ts';
import { MAX_BEADS, presenceGone, presenceOf, presenceUpdate, type BeadPresence } from '../beadPresence.ts';

// Which beads are on the plate, entering or leaving (LEDGER §7: place, replace and remove move the bead; the
// oldest dissolves on a fourth tap). The store holds bare points, so identity comes from reading a change
// by value, the way the placement ledger reads it: the longest run of the shown taps that the new taps
// begin with stays; what is lost leaves; what follows the run enters. The ledger test below holds the two
// readings together, so a bead and its halo always answer to the same tap.

const A = { x: 0.6, y: 0.6 };
const B = { x: 0.6, y: -0.6 };
const C = { x: -0.6, y: -0.6 };
const D = { x: -0.6, y: 0.6 };
const live = (p: BeadPresence) => p.beads.filter((b) => !b.leaving);
const leaving = (p: BeadPresence) => p.beads.filter((b) => b.leaving);
const points = (beads: BeadPresence['beads']) => beads.map((b) => b.point);
const ids = (beads: BeadPresence['beads']) => beads.map((b) => b.id);

describe('presenceOf: the mount shows every tap at once', () => {
  it('gives each tap an id in order, marks it initial (no entrance), and none leaving', () => {
    const p = presenceOf([A, B]);
    expect(p.beads).toEqual([
      { id: 0, point: A, leaving: false, initial: true },
      { id: 1, point: B, leaving: false, initial: true },
    ]);
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
  it('a new tap enters with the next id; the others stay as they were', () => {
    const p = presenceUpdate(presenceOf([A]), [A, B]);
    expect(p.beads).toEqual([
      { id: 0, point: A, leaving: false, initial: true },
      { id: 1, point: B, leaving: false, initial: false },
    ]);
  });

  it('a fourth tap: the oldest leaves, the new one enters, the middle two stay', () => {
    const p = presenceUpdate(presenceOf([A, B, C]), [B, C, D]);
    expect(ids(live(p))).toEqual([1, 2, 3]);
    expect(points(live(p))).toEqual([B, C, D]);
    expect(leaving(p)).toEqual([{ id: 0, point: A, leaving: true, initial: true }]);
  });

  it('undo: the latest leaves', () => {
    const p = presenceUpdate(presenceOf([A, B]), [A]);
    expect(ids(live(p))).toEqual([0]);
    expect(ids(leaving(p))).toEqual([1]);
  });

  it('clear: every bead leaves', () => {
    const p = presenceUpdate(presenceOf([A, B, C]), []);
    expect(live(p)).toEqual([]);
    expect(ids(leaving(p))).toEqual([0, 1, 2]);
  });

  it('the same taps in a new array change nothing, and return the same presence', () => {
    const before = presenceOf([A, B]);
    expect(presenceUpdate(before, [{ ...A }, { ...B }])).toBe(before);
  });

  it('a tap placed again where a leaving bead is gets a new id; the leaving one keeps leaving', () => {
    const gone = presenceUpdate(presenceOf([A]), []);
    const back = presenceUpdate(gone, [A]);
    expect(back.beads).toEqual([
      { id: 0, point: A, leaving: true, initial: true },
      { id: 1, point: A, leaving: false, initial: false },
    ]);
  });

  it('ids only rise, and the beads stay in id order', () => {
    let p = presenceOf([]);
    for (const taps of [[A], [A, B], [A, B, C], [B, C, D], [B, C], [], [D]]) p = presenceUpdate(p, taps);
    const all = ids(p.beads);
    expect([...all].sort((a, b) => a - b)).toEqual(all);
    expect(new Set(all).size).toBe(all.length);
    expect(p.next).toBe(5);
  });
});

describe('presenceGone: a leaving bead finished its exit', () => {
  it('removes that bead, and only a leaving one', () => {
    const p = presenceUpdate(presenceOf([A, B]), [A]);
    expect(presenceGone(p, 1).beads).toEqual([{ id: 0, point: A, leaving: false, initial: true }]);
    expect(presenceGone(p, 0)).toBe(p);
    expect(presenceGone(p, 42)).toBe(p);
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
      presence = presenceUpdate(presence, taps);
      expect(ids(live(presence))).toEqual(ledger.store.map((p) => p.id));
    }
  });
});
