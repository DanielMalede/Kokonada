'use strict';

// W4-D08 — batch ingest reported `inserted` rows that were silently dropped.
//
// The defect, measured (not inferred) while building W4-002: `BiometricLog.insertMany(docs,
// { ordered: false })` writes the valid rows, DOES NOT reject, and returns no accounting the
// callers used — so `persistMetrics` returned `inserted: hrDocs.length`, the ATTEMPTED count.
// A x2 PPG artifact on a workout reading clears the model's `max: 300` cap easily, so the batch
// API reported full success on a lossy write and a backfill client reconciling on `inserted`
// believed data landed that had not.
//
// These pins run against a REAL mongodb-memory-server, deliberately: the bug lives exactly at the
// Mongoose/Mongo seam, and §1 forbids a green mock for an integration boundary. A mocked
// `insertMany` is what let this survive in the first place — every existing unit suite mocks it to
// resolve `[]`, which is precisely the shape that cannot express "one of these did not land".
//
// Zero-knowledge note (§0.2.2), and the reason the reject vocabulary is closed: Mongoose's own
// validator messages quote the offending value ("`fitbit` is not a valid enum value for path
// `source`"). Passing those through would put user data into a DTO and a log line. Only the
// path and the validator KIND ever leave this seam.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV       = 'test';
// The state-vector recompute enqueue at the tail of persistMetrics is a graceful no-op without a
// Redis URL — make sure none is inherited so these tests never reach for a broker.
delete process.env.REDIS_URL;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const BiometricLog = require('../app/models/BiometricLog');
const { insertManyAccounted, mergeRejected, NO_REJECTS } = require('../app/services/wearable/insertAccounted');
const { persistMetrics } = require('../app/services/wearable/metricStore');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_w4d08_accounting' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await BiometricLog.deleteMany({});
});

const userId = () => new mongoose.Types.ObjectId();

// A valid BiometricLog row; `over` deliberately breaks one field per case.
const row = (over = {}, i = 0) => ({
  userId: over.userId !== undefined ? over.userId : userId(),
  heartRate: 60,
  activity: 'unknown',
  source: 'garmin',
  recordedAt: new Date(Date.UTC(2026, 0, 15, 3, 0, i)),
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('insertManyAccounted — the count is what Mongo actually took', () => {
  it('reports every row on a clean batch, with no rejects', async () => {
    const docs = [row({}, 1), row({}, 2), row({}, 3)];
    const res = await insertManyAccounted(BiometricLog, docs);

    expect(res.inserted).toBe(3);
    expect(res.rejected).toEqual({ count: 0, reasons: [] });
    expect(await BiometricLog.countDocuments({})).toBe(3);
  });

  it('THE DEFECT: an out-of-range heart rate is counted as rejected, never as inserted', async () => {
    // 340 bpm is in-band for the adapter and out of range for the model (max 300).
    const docs = [row({}, 1), row({ heartRate: 340 }, 2), row({}, 3)];
    const res = await insertManyAccounted(BiometricLog, docs);

    expect(res.inserted).toBe(2);                                   // NOT docs.length
    expect(res.rejected.count).toBe(1);
    expect(res.rejected.reasons).toEqual([
      { path: 'heartRate', reason: 'user-defined', count: 1 },
    ]);
    expect(await BiometricLog.countDocuments({})).toBe(2);          // and the DB agrees
    expect(res.inserted).toBe(await BiometricLog.countDocuments({}));
  });

  it('aggregates mixed failure kinds per (path, reason), one count per rejected DOCUMENT', async () => {
    const docs = [
      row({}, 1),                        // valid
      row({ heartRate: 340 }, 2),        // custom range validator on the encrypted field
      row({ heartRate: 400 }, 3),        // same (path, reason) → folds into one row, count 2
      row({ source: 'fitbit' }, 4),      // enum
      row({ activity: 'dancing' }, 5),   // enum, different path
      row({ userId: null }, 6),          // required
    ];
    const res = await insertManyAccounted(BiometricLog, docs);

    expect(res.inserted).toBe(1);
    expect(res.rejected.count).toBe(5);
    // Sorted for a stable assertion; the helper's own order is deterministic but unspecified.
    expect([...res.rejected.reasons].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'activity',  reason: 'enum',         count: 1 },
      { path: 'heartRate', reason: 'user-defined', count: 2 },
      { path: 'source',    reason: 'enum',         count: 1 },
      { path: 'userId',    reason: 'required',     count: 1 },
    ]);
    expect(await BiometricLog.countDocuments({})).toBe(1);
  });

  it('counts a document that fails on two paths ONCE, while naming both reasons', async () => {
    const docs = [row({ heartRate: 340, source: 'fitbit' }, 1)];
    const res = await insertManyAccounted(BiometricLog, docs);

    expect(res.inserted).toBe(0);
    expect(res.rejected.count).toBe(1);                             // one document, not two
    expect(res.rejected.reasons).toHaveLength(2);                   // both paths surfaced
    expect(res.rejected.reasons.map(r => r.path).sort()).toEqual(['heartRate', 'source']);
  });

  it('ZERO-KNOWLEDGE: the reject report carries no submitted value, only path + kind', async () => {
    const docs = [
      row({ heartRate: 347 }, 1),
      row({ source: 'fitbit' }, 2),
    ];
    const res = await insertManyAccounted(BiometricLog, docs);
    const serialized = JSON.stringify(res.rejected);

    // The two things Mongoose's own messages would have leaked.
    expect(serialized).not.toMatch(/347/);
    expect(serialized).not.toMatch(/fitbit/);
    // No message/value passthrough of any kind: the shape is exactly the closed vocabulary.
    for (const r of res.rejected.reasons) {
      expect(Object.keys(r).sort()).toEqual(['count', 'path', 'reason']);
      expect(r.reason).toMatch(/^[a-z0-9-]+$/);                     // a token, never a sentence
      expect(typeof r.count).toBe('number');
    }
  });

  it('makes no DB call and reports zeroes for an empty batch', async () => {
    const spy = jest.spyOn(BiometricLog, 'insertMany');
    try {
      expect(await insertManyAccounted(BiometricLog, [])).toEqual({
        inserted: 0, rejected: { count: 0, reasons: [] },
      });
      expect(await insertManyAccounted(BiometricLog, null)).toEqual({
        inserted: 0, rejected: { count: 0, reasons: [] },
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('under-reports rather than over-reports when the driver returns an unexpected shape', async () => {
    // The direction matters and is the whole point of the task: an over-report is silent data
    // loss, while an under-report is at worst a re-send, and the `source@recordedAt` dedupe
    // makes a re-send idempotent. A legacy/mocked array return is counted by its length.
    const fake = { insertMany: async () => [{}, {}] };
    expect(await insertManyAccounted(fake, [row({}, 1), row({}, 2), row({}, 3)])).toEqual({
      inserted: 2, rejected: { count: 0, reasons: [] },
    });

    const opaque = { insertMany: async () => undefined };
    const res = await insertManyAccounted(opaque, [row({}, 1)]);
    expect(res.inserted).toBe(0);                                   // never docs.length
  });

  it('ZERO-KNOWLEDGE: the warn it emits carries path + kind + counts, never a vital', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await insertManyAccounted(BiometricLog, [row({ heartRate: 347 }, 1), row({}, 2)]);

      const lines = warn.mock.calls.map(c => c.join(' '));
      const mine = lines.filter(l => l.includes('insertAccounted'));
      expect(mine).toHaveLength(1);                                 // silent unless something dropped
      expect(mine[0]).not.toMatch(/347/);
      expect(mine[0]).toMatch(/rejected=1/);
      expect(mine[0]).toMatch(/heartRate:user-defined=1/);
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing at all when the batch is clean', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await insertManyAccounted(BiometricLog, [row({}, 1), row({}, 2)]);
      expect(warn.mock.calls.map(c => c.join(' ')).filter(l => l.includes('insertAccounted'))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('still THROWS on a server-side bulk write error — loud is not the bug being fixed', async () => {
    // W4-D08 is about SILENT loss. A MongoBulkWriteError already surfaces, and swallowing it here
    // would mask real infrastructure failure; the dedupe makes the caller's retry idempotent.
    const id = new mongoose.Types.ObjectId();
    await expect(
      insertManyAccounted(BiometricLog, [row({ _id: id }, 1), row({ _id: id }, 2)]),
    ).rejects.toThrow(/duplicate key|E11000/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('mergeRejected — a backfill is many batches but one answer', () => {
  const r = (path, reason, count) => ({ path, reason, count });

  it('sums counts and folds identical (path, reason) pairs', () => {
    const a = { count: 2, reasons: [r('heartRate', 'user-defined', 2)] };
    const b = { count: 3, reasons: [r('heartRate', 'user-defined', 1), r('source', 'enum', 2)] };
    expect(mergeRejected(a, b)).toEqual({
      count: 5,
      reasons: [r('heartRate', 'user-defined', 3), r('source', 'enum', 2)],
    });
  });

  it('mutates neither argument — a fold in a loop must not corrupt its own accumulator', () => {
    const a = { count: 1, reasons: [r('heartRate', 'user-defined', 1)] };
    const b = { count: 1, reasons: [r('heartRate', 'user-defined', 1)] };
    const before = JSON.stringify([a, b]);
    mergeRejected(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it('is an identity over the empty report, so a clean run folds to a clean report', () => {
    const a = { count: 1, reasons: [r('activity', 'enum', 1)] };
    expect(mergeRejected(NO_REJECTS, a)).toEqual(a);
    expect(mergeRejected(a, NO_REJECTS)).toEqual(a);
    expect(mergeRejected(NO_REJECTS, NO_REJECTS)).toEqual({ count: 0, reasons: [] });
  });

  it('tolerates undefined halves — a lane that reports no rejects at all is not an error', () => {
    expect(mergeRejected(undefined, undefined)).toEqual({ count: 0, reasons: [] });
    expect(mergeRejected({ count: 1, reasons: [r('source', 'enum', 1)] }, undefined))
      .toEqual({ count: 1, reasons: [r('source', 'enum', 1)] });
  });
});
// ─────────────────────────────────────────────────────────────────────────────
describe('persistMetrics — the W4-D08 reproduction, end to end', () => {
  const hr = (value, i) => ({
    metric: 'heartRate', value, unit: 'bpm', source: 'garmin',
    recordedAt: new Date(Date.UTC(2026, 0, 15, 4, 0, i)),
  });

  it('reports the rows that actually landed when one sample is out of range', async () => {
    const uid = userId().toString();
    const metrics = [];
    for (let i = 0; i < 10; i += 1) metrics.push(hr(i === 4 ? 340 : 60 + i, i));

    const res = await persistMetrics(uid, metrics);

    expect(res.inserted).toBe(9);                                   // was 10 — the defect
    expect(res.rejected.count).toBe(1);
    expect(res.rejected.reasons).toEqual([
      { path: 'heartRate', reason: 'user-defined', count: 1 },
    ]);
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(9);
  });

  it('reports a clean batch truthfully and with an empty reject report', async () => {
    const uid = userId().toString();
    const res = await persistMetrics(uid, [hr(60, 1), hr(61, 2), hr(62, 3)]);

    expect(res.inserted).toBe(3);
    expect(res.rejected).toEqual({ count: 0, reasons: [] });
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(3);
  });

  it('reports zeroes, not undefined, when the batch carries no heart rate at all', async () => {
    const uid = userId().toString();
    const res = await persistMetrics(uid, [
      { metric: 'restingHeartRate', value: 52, recordedAt: new Date('2026-01-15T04:00:00Z') },
    ]);
    expect(res.inserted).toBe(0);
    expect(res.rejected).toEqual({ count: 0, reasons: [] });
  });
});
