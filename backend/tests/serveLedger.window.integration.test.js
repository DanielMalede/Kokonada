'use strict';

process.env.NODE_ENV = 'test';

// HX-2 — the exposure window may not reach past ServeEvent's time-to-live.
//
// getExposure reads LEDGER_EXPOSURE_DAYS back. If that window is longer than the TTL, the scorer
// quietly depends on rows the retention promise says are gone: it sees them between the TTL
// sweeps, and the next sweep changes the ranking under it. The window is therefore bounded by the
// TTL, whatever the env says.
//
// Real MongoDB with NO indexes built (autoIndex off), so the TTL monitor can never reap the old
// row mid-test: the only thing that can keep it out of the result is the read window itself.

jest.mock('../app/config/redis', () => ({ getRedis: () => null }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const ServeEvent = require('../app/models/ServeEvent');
const ledger = require('../app/services/ledger/serveLedger');

jest.setTimeout(120000);

const DAY = 24 * 3600 * 1000;
const userId = new mongoose.Types.ObjectId();
const ttlDays = () => {
  const [, opts] = ServeEvent.schema.indexes().find(([keys, o]) => keys.servedAt === 1 && o.expireAfterSeconds != null);
  return opts.expireAfterSeconds / 86400;
};

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_ledger_window_it', autoIndex: false });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  delete process.env.LEDGER_EXPOSURE_DAYS;
  await ServeEvent.collection.deleteMany({});
});

const serve = (canonicalKey, ageMs) => ServeEvent.collection.insertOne({
  userId, canonicalKey, moodKey: 'calm', bioState: { tempoBand: null, activity: null }, sessionId: null,
  servedAt: new Date(Date.now() - ageMs),
});

describe('getExposure never reads past the ServeEvent TTL', () => {
  it('by default: a row inside the TTL counts (control, so the guard is not vacuous)', async () => {
    await serve('isrc:INSIDE', (ttlDays() - 1) * DAY);

    const out = await ledger.getExposure(userId, ['isrc:INSIDE']);

    expect(out.get('isrc:INSIDE')).toHaveLength(1);
  });

  it('an env window longer than the TTL is bounded by it: a row older than the TTL is not counted', async () => {
    process.env.LEDGER_EXPOSURE_DAYS = '90';
    await serve('isrc:STALE', (ttlDays() + 15) * DAY); // alive only because no sweep has run yet
    await serve('isrc:INSIDE', (ttlDays() - 1) * DAY);

    const out = await ledger.getExposure(userId, ['isrc:STALE', 'isrc:INSIDE']);

    expect(out.has('isrc:STALE')).toBe(false);
    expect(out.get('isrc:INSIDE')).toHaveLength(1);
  });

  it('a SHORTER env window still applies', async () => {
    process.env.LEDGER_EXPOSURE_DAYS = '7';
    await serve('isrc:TEN', 10 * DAY);

    const out = await ledger.getExposure(userId, ['isrc:TEN']);

    expect(out.has('isrc:TEN')).toBe(false);
  });
});
