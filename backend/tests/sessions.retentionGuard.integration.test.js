'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

// HX-2 M4 — the History DTO never serves provider track data past the window, even on a day the
// daily job did not run. Real MongoDB, the real listSessions controller.
//
// The guard HIDES; it deletes nothing. The daily job is the deleter (sessionTrim.worker.test.js),
// and this suite pins that difference so nobody counts the guard as erasure.

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const PlaylistSession = require('../app/models/PlaylistSession');
const { listSessions } = require('../app/controllers/sessionsController');

jest.setTimeout(120000);

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const userId = new mongoose.Types.ObjectId();

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_sessions_guard_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  delete process.env.PROVIDER_CONTENT_RETENTION_DAYS;
  await PlaylistSession.deleteMany({});
});

async function session(ageMs, over = {}) {
  const doc = await PlaylistSession.create({
    userId,
    emotionTaps: [{ x: 0.1, y: 0.1 }],
    contextPrompt: 'rainy morning',
    moodKey: 'calm',
    biometricSnapshot: { heartRate: 64, activity: 'resting' },
    targetGenres: ['ambient'],
    musicProvider: 'spotify',
    trackIds: ['trk1', 'trk2', 'trk3'],
    trackKeys: ['isrc:A', 'isrc:B', 'isrc:C'],
    trackSummary: [{ id: 'trk1', title: 'Song A', artist: 'Artist A' }],
    ...over,
  });
  await PlaylistSession.collection.updateOne({ _id: doc._id }, { $set: { createdAt: new Date(Date.now() - ageMs) } });
  return doc._id;
}

async function history() {
  const res = { body: null, json(b) { this.body = b; return this; }, status() { return this; } };
  const next = jest.fn();
  await listSessions({ user: { _id: userId }, query: {} }, res, next);
  expect(next).not.toHaveBeenCalled();
  return new Map(res.body.items.map((i) => [i.id, i]));
}

describe('GET /api/sessions — provider track data is never served past 29 days', () => {
  it('an untrimmed row older than 29 days (the job has not run) returns tracks:[] and trackCount:0', async () => {
    const old = await session(29 * DAY + HOUR);

    const item = (await history()).get(String(old));

    expect(item.tracks).toEqual([]);
    expect(item.trackCount).toBe(0);
    expect(JSON.stringify(item)).not.toMatch(/Song A|Artist A|trk1/);
  });

  it('a row inside the window still shows its tracks (control)', async () => {
    const young = await session(29 * DAY - HOUR);

    const item = (await history()).get(String(young));

    expect(item.tracks).toEqual([{ id: 'trk1', title: 'Song A', artist: 'Artist A' }]);
    expect(item.trackCount).toBe(3);
  });

  it('an old row keeps the History entry itself: title, mood, activity and date are still served', async () => {
    const old = await session(40 * DAY);

    const item = (await history()).get(String(old));

    expect(item.moodKey).toBe('calm');
    expect(item.activity).toBe('resting');
    expect(typeof item.title).toBe('string');
    expect(new Date(item.createdAt).getTime()).toBeLessThan(Date.now() - 39 * DAY);
  });

  it('a row the job already trimmed returns tracks:[] and trackCount:0', async () => {
    const trimmed = await session(40 * DAY, { trackIds: [], trackKeys: [], trackSummary: [], targetGenres: [] });

    const item = (await history()).get(String(trimmed));

    expect(item.tracks).toEqual([]);
    expect(item.trackCount).toBe(0);
  });

  it('follows a SHORTER env window, like the job does', async () => {
    process.env.PROVIDER_CONTENT_RETENTION_DAYS = '7';
    const eightDays = await session(8 * DAY);

    const item = (await history()).get(String(eightDays));

    expect(item.tracks).toEqual([]);
    expect(item.trackCount).toBe(0);
  });

  it('the guard only hides: the stored row is unchanged until the job runs (never counted as deletion)', async () => {
    const old = await session(40 * DAY);

    await history();

    const row = await PlaylistSession.collection.findOne({ _id: old });
    expect(row.trackIds).toEqual(['trk1', 'trk2', 'trk3']);
  });
});
