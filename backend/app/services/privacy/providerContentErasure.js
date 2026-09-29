'use strict';

// Provider track data: retention and erasure (HX-2).
//
// "Provider track data" is what a music provider's API handed us about tracks — IDs, canonical
// keys, titles/artists, the genre targets a playlist was built for, and the external playlist ID.
// Spotify Developer Terms IV.3.1.a forbid storing it indefinitely and V.8 require deleting it on
// disconnect; YouTube API Policy III.E.4.c caps it at 30 calendar days. Kokonada's OWN record of a
// moment (the mood, the emotion taps, the activity, the skip count, when it happened) is not
// provider data and stays, so History keeps its entries.
//
// Clock: 30 days is the promise; the job cuts at 29 so a once-a-day run can never overshoot it.
// The window can be made SHORTER by env, never longer.

const PlaylistSession = require('../../models/PlaylistSession');
const ServeEvent = require('../../models/ServeEvent');
const UnclassifiedTrack = require('../../models/UnclassifiedTrack');
const { PROVIDER_CONTENT_MAX_DAYS, SERVE_EVENT_TTL_SECONDS } = require('../../config/retention');

const DAY_MS = 24 * 3600 * 1000;

// The five PlaylistSession fields that carry provider track data, and their emptied values.
const PROVIDER_CONTENT_FIELDS = Object.freeze(['trackIds', 'trackKeys', 'trackSummary', 'targetGenres', 'externalPlaylistId']);
const STRIPPED = Object.freeze({ trackIds: [], trackKeys: [], trackSummary: [], targetGenres: [], externalPlaylistId: null });

// A row still holding ANY of the five. This is the strip's own filter — the T3.1 sensitive trim
// matches only rows still carrying contextPrompt/heartRate, which a provider-only row may not.
const HOLDS_PROVIDER_CONTENT = Object.freeze({
  $or: [
    { 'trackIds.0': { $exists: true } },
    { 'trackKeys.0': { $exists: true } },
    { 'trackSummary.0': { $exists: true } },
    { 'targetGenres.0': { $exists: true } },
    { externalPlaylistId: { $ne: null } },
  ],
});

// Every collection that can hold provider track data, and the clock that bounds it. A model that
// gains such a field without an entry here (or a named exception) fails
// tests/providerContentClock.structural.test.js. `jobCount` is the key the daily sessionTrim run
// reports for the step; `ttlSeconds` is a schema TTL backstop where one exists.
const PROVIDER_CONTENT_CLOCKS = Object.freeze({
  PlaylistSession: Object.freeze({ mechanism: 'field-trim', field: 'createdAt', fields: PROVIDER_CONTENT_FIELDS, jobCount: 'stripped' }),
  ServeEvent: Object.freeze({ mechanism: 'delete', field: 'servedAt', jobCount: 'serveEvents', ttlSeconds: SERVE_EVENT_TTL_SECONDS }),
  // No TTL index yet: a new TTL-indexed user collection must be registered in the Retention table
  // of docs/PRIVACY_DECLARATIONS.md in the same change (wave4.retentionDocs.test.js), and that doc
  // is edited with the M11 declarations. Until then the daily job is the clock.
  UnclassifiedTrack: Object.freeze({ mechanism: 'delete', field: 'createdAt', jobCount: 'unclassifiedExpired' }),
});

function providerContentRetentionDays() {
  const n = Number(process.env.PROVIDER_CONTENT_RETENTION_DAYS);
  if (!Number.isFinite(n) || n <= 0) return PROVIDER_CONTENT_MAX_DAYS;
  return Math.min(n, PROVIDER_CONTENT_MAX_DAYS);
}

function providerContentCutoff(now = Date.now()) {
  return new Date(now - providerContentRetentionDays() * DAY_MS);
}

// Empty the five provider fields on every PlaylistSession matching `filter`. Idempotent: a row
// already stripped no longer matches. Returns the number of rows changed.
async function stripProviderContent(filter) {
  const res = await PlaylistSession.updateMany({ $and: [filter, HOLDS_PROVIDER_CONTENT] }, { $set: { ...STRIPPED } });
  return res?.modifiedCount ?? 0;
}

// On disconnect: the same strip for ONE user's sessions from ONE provider, at any age.
function purgeProviderData(userId, provider) {
  return stripProviderContent({ userId, musicProvider: provider });
}

// Delete ServeEvent rows served before the cutoff. The 30-day TTL index is only the backstop.
async function expireServeEvents(cutoff) {
  const res = await ServeEvent.deleteMany({ servedAt: { $lt: cutoff } });
  return res?.deletedCount ?? 0;
}

// A pool row written before `createdAt` existed has no clock at all. Stamp it with its TRUE insert
// time — the ObjectId's timestamp — never "now", which would grant it a fresh window. The pipeline
// update is safe here: UnclassifiedTrack has no encrypted field for a setter to miss.
async function backfillUnclassifiedCreatedAt() {
  const res = await UnclassifiedTrack.updateMany(
    { $or: [{ createdAt: { $exists: false } }, { createdAt: null }] },
    [{ $set: { createdAt: { $toDate: '$_id' } } }],
    { updatePipeline: true },
  );
  return res?.modifiedCount ?? 0;
}

async function expireUnclassifiedTracks(cutoff) {
  const res = await UnclassifiedTrack.deleteMany({ createdAt: { $lt: cutoff } });
  return res?.deletedCount ?? 0;
}

module.exports = {
  PROVIDER_CONTENT_MAX_DAYS,
  PROVIDER_CONTENT_FIELDS,
  PROVIDER_CONTENT_CLOCKS,
  HOLDS_PROVIDER_CONTENT,
  providerContentRetentionDays,
  providerContentCutoff,
  stripProviderContent,
  purgeProviderData,
  expireServeEvents,
  backfillUnclassifiedCreatedAt,
  expireUnclassifiedTracks,
};
