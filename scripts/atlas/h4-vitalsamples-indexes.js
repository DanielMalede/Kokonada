// HITL H4 — production index builds for the `vitalsamples` collection (W4-004).
//
// WHY THIS FILE EXISTS INSTEAD OF THE INDEXES BEING BUILT ALREADY:
// the maintenance session that was asked to build them had NO MongoDB MCP server connected
// (no MongoDB tools were exposed to it at all), so it could not see, let alone verify, any
// deployment. Building indexes blind — or against a local/dev target — is worse than doing
// nothing, because it would close H4 on a false premise and leave production unindexed.
// So: Daniel runs these himself, against a target he has confirmed is production.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// BEFORE YOU PASTE — confirm you are on the RIGHT database.
// ─────────────────────────────────────────────────────────────────────────────────────────
// backend/.env points at Atlas cluster `cluster0.aowqhlx.mongodb.net` as user `Kokonada_Data`,
// but its MONGO_URI has NO database path and MONGO_DB_NAME is not set, so that config resolves
// to the DEFAULT database `test`. Production may well differ — the deployed service supplies its
// own MONGO_URI/MONGO_DB_NAME, which was not readable from the dev box.
//
// Run this first and make sure the answer is the database your API actually writes to:
//
//     db.getName()
//     db.vitalsamples.estimatedDocumentCount()
//     db.getSiblingDB('admin').runCommand({ connectionStatus: 1 })   // who am I connected as
//
// If `db.getName()` is not the production database, switch with `use <dbname>` before continuing.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE TWO INDEXES
// ─────────────────────────────────────────────────────────────────────────────────────────

// 1. The read path. Every baseline refresh filters by userId + metric and sorts by recordedAt
//    descending; without this, a user with a year of vitals turns a baseline read into a
//    collection scan. Mirrors backend/app/models/VitalSample.js:123.
db.vitalsamples.createIndex(
  { userId: 1, metric: 1, recordedAt: -1 },
  { background: true, name: 'userId_1_metric_1_recordedAt_-1' }
);

// 2. The 90-day retention TTL that makes the privacy declaration real rather than aspirational.
//    7776000 = 90 * 24 * 3600, i.e. VITAL_SAMPLE_RETENTION_DAYS's default of 90.
//    Mirrors backend/app/models/VitalSample.js:132.
//    NOTE: expireAfterSeconds is what makes this a TTL index. Created without it, this is a
//    plain index on recordedAt that silently expires NOTHING — verify it below, do not assume.
db.vitalsamples.createIndex(
  { recordedAt: 1 },
  { background: true, expireAfterSeconds: 7776000, name: 'recordedAt_1_ttl' }
);

// ─────────────────────────────────────────────────────────────────────────────────────────
// READ BACK AND VERIFY — do not close H4 on the createIndex return values alone.
// ─────────────────────────────────────────────────────────────────────────────────────────

db.vitalsamples.getIndexes();

// Assert the TTL really carries expireAfterSeconds = 7776000 (the failure mode this guards
// against is a TTL index created without the option, which never expires anything):
db.vitalsamples.getIndexes().filter(function (i) {
  return i.expireAfterSeconds !== undefined;
});

// Expected: exactly one entry, { key: { recordedAt: 1 }, expireAfterSeconds: 7776000, ... }
// If that array is EMPTY, the TTL did not take — drop the plain index and re-create it:
//   db.vitalsamples.dropIndex('recordedAt_1_ttl')
// then re-run step 2 above.
//
// If the index already exists with a DIFFERENT expireAfterSeconds, createIndex will not silently
// change it — use collMod instead:
//   db.runCommand({ collMod: 'vitalsamples',
//                   index: { keyPattern: { recordedAt: 1 }, expireAfterSeconds: 7776000 } })
