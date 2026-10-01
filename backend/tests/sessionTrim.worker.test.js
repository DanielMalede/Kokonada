'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

// The daily retention job (sessionTrim), on REAL MongoDB. It used to be proven against a mocked
// `updateMany` that recorded a filter nobody ever ran, so "old rows are trimmed" was a claim about
// an object literal. Every assertion here reads the rows back from a real server.
//
// Two clocks share this job:
//   • T3.1 — the encrypted, re-identifying context (contextPrompt + the HR snapshot) is redacted
//     after SESSION_SENSITIVE_RETENTION_DAYS (30).
//   • HX-2 — provider track data (Spotify Terms IV.3.1.a, YouTube III.E.4.c): the five provider
//     fields on every PlaylistSession, every ServeEvent and every UnclassifiedTrack row are gone
//     before the row is 30 days old. The cutoff is 29 days and cannot be raised by env.
//
// RETIRED under DEC-091: the old pin "keeps trackSummary / trackIds intact" (this file, formerly
// lines 38-42). Past 29 days they are provider content and are stripped; Kokonada's own fields stay.

jest.mock('../app/config/redis', () => ({ getRedis: () => null }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const PlaylistSession   = require('../app/models/PlaylistSession');
const ServeEvent        = require('../app/models/ServeEvent');
const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const { process: runJob } = require('../app/workers/sessionTrim.worker');

jest.setTimeout(120000);

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_session_trim_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  delete process.env.SESSION_SENSITIVE_RETENTION_DAYS;
  delete process.env.PROVIDER_CONTENT_RETENTION_DAYS;
  await Promise.all([PlaylistSession.deleteMany({}), ServeEvent.deleteMany({}), UnclassifiedTrack.deleteMany({})]);
});

const userId = new mongoose.Types.ObjectId();

// A generated session exactly as biometricHandler writes one, then back-dated on the raw collection
// (timestamps would otherwise stamp "now").
async function session(ageMs, over = {}) {
  const doc = await PlaylistSession.create({
    userId,
    emotionTaps: [{ x: 0.2, y: -0.4 }],
    contextPrompt: 'late walk home',
    moodKey: 'bio:active:walking',
    biometricSnapshot: { heartRate: 72, activity: 'walking' },
    targetGenres: ['ambient', 'downtempo'],
    musicProvider: 'spotify',
    externalPlaylistId: 'hidden-playlist-1',
    trackIds: ['trk1', 'trk2'],
    trackKeys: ['isrc:AAA', 'isrc:BBB'],
    trackSummary: [{ id: 'trk1', title: 'Song A', artist: 'Artist A' }],
    skipCount: 2,
    ...over,
  });
  const createdAt = ago(ageMs);
  await PlaylistSession.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
  return { id: doc._id, createdAt };
}

const raw = (id) => PlaylistSession.collection.findOne({ _id: id });

const PROVIDER_FIELDS_STRIPPED = {
  trackIds: [], trackKeys: [], trackSummary: [], targetGenres: [], externalPlaylistId: null,
};

describe('sessionTrim — provider track data is gone before the session is 30 days old (HX-2 M1)', () => {
  it('strips the five provider fields from every session older than 29 days, whatever its provider', async () => {
    const spotifyOld = await session(35 * DAY);
    const youtubeOld = await session(35 * DAY, { musicProvider: 'youtube' });

    await runJob();

    for (const { id } of [spotifyOld, youtubeOld]) {
      const row = await raw(id);
      expect(row).toMatchObject(PROVIDER_FIELDS_STRIPPED);
    }
  });

  it('keeps Kokonada\'s own fields on a stripped row (the History entry survives)', async () => {
    const old = await session(35 * DAY);

    await runJob();

    const row = await raw(old.id);
    expect(row).not.toBeNull();                                  // field-level trim, never a delete
    expect(row.moodKey).toBe('bio:active:walking');
    expect(row.emotionTaps).toEqual([{ x: 0.2, y: -0.4 }]);
    expect(row.biometricSnapshot.activity).toBe('walking');
    expect(row.skipCount).toBe(2);
    expect(row.createdAt.getTime()).toBe(old.createdAt.getTime());
    expect(row.musicProvider).toBe('spotify');
  });

  it('cuts at 29 days: 29 days + 1 hour is stripped, 28 days 23 hours is untouched', async () => {
    const past = await session(29 * DAY + HOUR);
    const inside = await session(29 * DAY - HOUR);

    await runJob();

    expect(await raw(past.id)).toMatchObject(PROVIDER_FIELDS_STRIPPED);
    const kept = await raw(inside.id);
    expect(kept.trackIds).toEqual(['trk1', 'trk2']);
    expect(kept.trackSummary).toEqual([{ id: 'trk1', title: 'Song A', artist: 'Artist A' }]);
    expect(kept.externalPlaylistId).toBe('hidden-playlist-1');
  });

  it('is idempotent: a second run touches nothing and reports 0 stripped', async () => {
    await session(35 * DAY);
    await session(40 * DAY, { musicProvider: 'youtube' });

    const first = await runJob();
    const second = await runJob();

    expect(first.stripped).toBe(2);
    expect(second.stripped).toBe(0);
  });

  it('reaches a row that holds only ONE provider field (the filter is its own, not the contextPrompt one)', async () => {
    // The T3.1 filter matches only rows still carrying contextPrompt/heartRate. A row whose
    // sensitive fields were already trimmed but which still holds track data must still be reached.
    const onlyPlaylist = await session(40 * DAY, {
      contextPrompt: null, biometricSnapshot: { heartRate: null, activity: 'resting' },
      trackIds: [], trackKeys: [], trackSummary: [], targetGenres: [],
    });

    const res = await runJob();

    expect(res.stripped).toBe(1);
    expect((await raw(onlyPlaylist.id)).externalPlaylistId).toBeNull();
  });

  it.each([['90'], ['30'], ['365']])('clamps the window to 29 days whatever the env says (PROVIDER_CONTENT_RETENTION_DAYS=%s)', async (env) => {
    process.env.PROVIDER_CONTENT_RETENTION_DAYS = env;
    const old = await session(29 * DAY + HOUR);

    await runJob();

    expect(await raw(old.id)).toMatchObject(PROVIDER_FIELDS_STRIPPED);
  });

  it('honours a SHORTER env window (7 days)', async () => {
    process.env.PROVIDER_CONTENT_RETENTION_DAYS = '7';
    const eightDays = await session(8 * DAY);

    await runJob();

    expect(await raw(eightDays.id)).toMatchObject(PROVIDER_FIELDS_STRIPPED);
  });

  it.each([['abc'], ['0'], ['-5'], ['']])('falls back to 29 days on a non-positive or unreadable env value (%p)', async (env) => {
    process.env.PROVIDER_CONTENT_RETENTION_DAYS = env;
    const young = await session(10 * DAY);
    const old = await session(29 * DAY + HOUR);

    await runJob();

    expect((await raw(young.id)).trackIds).toEqual(['trk1', 'trk2']);
    expect(await raw(old.id)).toMatchObject(PROVIDER_FIELDS_STRIPPED);
  });
});

describe('sessionTrim — the encrypted sensitive fields (T3.1, unchanged)', () => {
  it('redacts contextPrompt and the HR snapshot on sessions older than 30 days, returning the count', async () => {
    const old = await session(31 * DAY);
    const young = await session(20 * DAY);

    const res = await runJob();

    expect(res.trimmed).toBe(1);
    const row = await raw(old.id);
    expect(row.contextPrompt).toBeNull();
    expect(row.biometricSnapshot.heartRate).toBeNull();
    const kept = await PlaylistSession.findById(young.id);
    expect(kept.contextPrompt).toBe('late walk home');
    expect(kept.biometricSnapshot.heartRate).toBe(72);
  });

  it('only targets rows that still carry sensitive data (idempotent re-runs)', async () => {
    await session(31 * DAY);

    expect((await runJob()).trimmed).toBe(1);
    expect((await runJob()).trimmed).toBe(0);
  });

  it('honours a configurable sensitive-data window', async () => {
    process.env.SESSION_SENSITIVE_RETENTION_DAYS = '7';
    const eightDays = await session(8 * DAY);

    await runJob();

    expect((await raw(eightDays.id)).contextPrompt).toBeNull();
  });
});

describe('sessionTrim — ServeEvent rows are deleted past 29 days (HX-2 M2)', () => {
  const serve = (ageMs) => ServeEvent.create({ userId, canonicalKey: 'isrc:AAA', moodKey: 'calm', servedAt: ago(ageMs) });

  it('deletes rows served more than 29 days ago and keeps younger ones', async () => {
    await serve(29 * DAY + HOUR);
    await serve(45 * DAY);
    const young = await serve(29 * DAY - HOUR);

    const res = await runJob();

    expect(res.serveEvents).toBe(2);
    const left = await ServeEvent.find({}).lean();
    expect(left.map((r) => String(r._id))).toEqual([String(young._id)]);
  });
});

describe('sessionTrim — UnclassifiedTrack rows (HX-2 M3)', () => {
  const pooled = (ageMs, provider = 'spotify') => UnclassifiedTrack.create({
    userId, track: { id: `x-${ageMs}`, provider, name: 'Song A' }, reason: 'ingest', createdAt: ago(ageMs),
  });

  it('backfills createdAt from the row\'s own ObjectId when the field is missing', async () => {
    // A row from before createdAt existed. The TTL/job clock ignores a document without the
    // field, so it would live forever — the backfill uses the true insert time, never "now".
    const born = Date.now() - 3 * DAY;
    const _id = mongoose.Types.ObjectId.createFromTime(Math.floor(born / 1000));
    await UnclassifiedTrack.collection.insertOne({ _id, userId, track: { id: 'legacy', provider: 'spotify' }, attempts: 0 });

    const res = await runJob();

    expect(res.unclassifiedBackfilled).toBe(1);
    const row = await UnclassifiedTrack.collection.findOne({ _id });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt.getTime()).toBe(Math.floor(born / 1000) * 1000);
    expect(await UnclassifiedTrack.countDocuments({ createdAt: { $exists: false } })).toBe(0);
  });

  it('a backfilled row older than 29 days is deleted in the SAME run', async () => {
    const _id = mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - 40 * DAY) / 1000));
    await UnclassifiedTrack.collection.insertOne({ _id, userId, track: { id: 'ancient', provider: 'youtube_music' }, attempts: 0 });

    await runJob();

    expect(await UnclassifiedTrack.countDocuments({ _id })).toBe(0);
  });

  it('deletes pooled rows older than 29 days, whatever their provider, and keeps younger ones', async () => {
    await pooled(29 * DAY + HOUR, 'spotify');
    await pooled(35 * DAY, 'youtube_music');
    const young = await pooled(5 * DAY, 'spotify');

    const res = await runJob();

    expect(res.unclassifiedExpired).toBe(2);
    const left = await UnclassifiedTrack.find({}).lean();
    expect(left.map((r) => String(r._id))).toEqual([String(young._id)]);
  });
});

describe('sessionTrim — the [sessionTrim] line is the production check, and carries counts only (M10)', () => {
  it('logs exactly one line of counts, with no title, artist, ID or URI in it', async () => {
    await session(35 * DAY);
    await ServeEvent.create({ userId, canonicalKey: 'isrc:AAA', servedAt: ago(40 * DAY) });
    const lines = [];
    const spies = ['log', 'info', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation((...a) => lines.push(a.join(' '))));

    await runJob();

    spies.forEach((s) => s.mockRestore());
    const trim = lines.filter((l) => l.includes('[sessionTrim]'));
    expect(trim).toHaveLength(1);
    // REVERSED under DEC-119 (the owner's signature, BE-016): the line gains `healthErasures=\d+`, the
    // daily sweep that finishes a withdrawal's session-health erasure (DEC-111, DEC-118 K1). It was
    // `... unclassifiedExpired=\d+ spotifyErasures=\d+ failures=\d+$`. The new token sits before
    // `spotifyErasures=`, so the line still ends `spotifyErasures=N failures=N`, which
    // spotifyDisconnectErasure.integration.test.js pins and DEC-119 does not reverse. Still counts only.
    expect(trim[0]).toMatch(/^\[sessionTrim\] trimmed=\d+ stripped=\d+ serveEvents=\d+ unclassifiedBackfilled=\d+ unclassifiedExpired=\d+ healthErasures=\d+ spotifyErasures=\d+ failures=\d+$/);
    const all = lines.join('\n');
    for (const secret of ['Song A', 'Artist A', 'trk1', 'isrc:', 'hidden-playlist-1', String(userId)]) {
      expect(all).not.toContain(secret);
    }
  });

  it('a failing step does not stop the others; the run counts it and then fails loudly', async () => {
    const old = await session(35 * DAY);
    const spy = jest.spyOn(ServeEvent, 'deleteMany').mockRejectedValueOnce(new Error('Atlas hiccup'));
    const lines = [];
    const logSpy = jest.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runJob()).rejects.toThrow(/1 step/);

    spy.mockRestore(); logSpy.mockRestore(); errSpy.mockRestore();
    expect(await raw(old.id)).toMatchObject(PROVIDER_FIELDS_STRIPPED); // the other steps still ran
    expect(lines.find((l) => l.startsWith('[sessionTrim]'))).toMatch(/failures=1$/);
  });
});
