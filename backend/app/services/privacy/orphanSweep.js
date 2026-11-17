'use strict';

// J2 (BE-094; DT-11, DT-14, and DT-13 FINAL of 2026-10-04) — the sweep of deleted accounts' data, run daily
// by sessionTrim.
//
// A deleted account's data can outlive the deletion: a health-data sync or a recompute that wrote after the
// cascade ran (BE-028's batch lane), a server stopped between a write and its re-check. All of it sits under
// an id that no User doc carries any more: both deletion doors remove the User doc LAST. This finds those ids
// and runs the house cascade for each (erasure.eraseUserChildData), then the strict Redis purge. It is what
// the declarations' "within a day" for a deleted account rests on, so it must never erase a live account,
// and must not run before the production record and the owner's clean.
//
//   DISCOVERY (DT-14). Every user id in every collection the cascade deletes (`distinct('userId')`;
//   CASCADE_MODELS is pinned to erasure.js's list by a lockstep test) and in every user-scoped Redis
//   namespace (a SCAN per userRedisPurge registry entry). An id is an orphan only when no User doc carries
//   it, read on the PRIMARY (accountExistence), and read AGAIN, for that id, right before its cascade. A doc
//   with `deletedAt` set is an account. An id found in Redis that cannot be an ObjectId names no account and
//   has no Mongo rows: it is purged in Redis only, never passed to the Mongo cascade (its CastError would
//   end the run), and it counts like any orphan.
//
//   ARMING (DT-13 §A, §C). The nightly run erases only while the marker document `opsmarkers/_id:
//   'orphan-sweep'` exists with exactly its v1 shape, read on the primary. Only armOrphanSweep writes it, and
//   only once a fresh discovery finds no orphan at all, so it cannot be armed before the owner's clean.
//   ORPHAN_SWEEP_DISABLED (house envFlag rules) can only DISARM. The reader never creates the collection.
//
//   THE NIGHTLY RUN (§B) never throws to the worker loop; it returns `{ count, backlog, failed }`:
//     disarmed            read-only discovery; `disabled`, the real backlog, one `[orphanSweep] disarmed` line;
//     any read failure    `refused`, backlog `unknown`, a failure (the marker, the discovery or the users);
//     armed               DT-14: refuses (deleting nothing) when the users read returns none while ids exist,
//                         or when the orphans are more than 5 and more than half of all ids; 50 accounts a
//                         run, the rest is the backlog.
//   THE FORCED RUN (§B; the private count tool, on the owner's word): the exact orphan count and the 8-hex
//   fingerprint of the exact set (orphanSetFingerprint) replace ONLY the ratio refusal; the users-empty
//   refusal stays, and the cap is lifted for the verified set. The marker is not consulted: this is the
//   clean that comes before arming.
//
// Lines carry counts and closed tokens only; an orphan's id is a deleted account's id and is never logged.

const crypto = require('crypto');
const mongoose = require('mongoose');
const BiometricLog = require('../../models/BiometricLog');
const HealthSample = require('../../models/HealthSample');
const VitalSample = require('../../models/VitalSample');
const MedicalProfile = require('../../models/MedicalProfile');
const MorningState = require('../../models/MorningState');
const { RewardEvent } = require('../../models/RewardEvent');
const { PersonalWeights } = require('../../models/PersonalWeights');
const MusicProfile = require('../../models/MusicProfile');
const PlaylistSession = require('../../models/PlaylistSession');
const ServeEvent = require('../../models/ServeEvent');
const Identity = require('../../models/Identity');
const RefreshToken = require('../../models/RefreshToken');
const UnclassifiedTrack = require('../../models/UnclassifiedTrack');
const ConsentRecord = require('../../models/ConsentRecord');
const accountExistence = require('./accountExistence');
const { eraseUserChildData } = require('./erasure');
const { purgeUserKeysStrict, USER_KEY_NAMESPACES } = require('../../utils/userRedisPurge');
const { getRedis } = require('../../config/redis');
const { disabled } = require('../../utils/envFlag');

/** Every collection erasure.eraseUserChildData deletes by userId (lockstep: orphanSweep.integration.test.js). */
const CASCADE_MODELS = Object.freeze([
  BiometricLog, HealthSample, VitalSample, MedicalProfile, MorningState, RewardEvent, PersonalWeights, MusicProfile,
  PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack, ConsentRecord,
]);

const ORPHAN_SWEEP_CAP = 50;
const REFUSE_ABOVE = 5;
const KILL_SWITCH = 'ORPHAN_SWEEP_DISABLED';
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

// The marker: one document in `opsmarkers`, holding no user data. Its model is defined here, not in
// app/models, so no model-discovery guard (retention, export, erasure lockstep) ever sees it. It never
// creates its collection (autoCreate and autoIndex off): only armOrphanSweep's write does. It is written
// through the model, never the raw driver (resilience N3, tests/youtubeTokenWriters.structural.test.js).
const MARKER_COLLECTION = 'opsmarkers';
const MARKER_ID = 'orphan-sweep';
const MARKER_FIELDS = ['_id', 'armedAt', 'deployedCommit', 'kind', 'recordSha256', 'recountOrphans', 'v'];
const ARM_CONFIRM = 'arm-orphan-sweep';
const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_HEX = /^[0-9a-f]{40}$/;
const SET_HEX = /^[0-9a-f]{8}$/;

class OrphanSweepRefused extends Error {
  constructor(reason, { orphans, ids } = {}) {
    super(`orphan sweep refused (${reason})`);
    this.name = 'OrphanSweepRefused';
    this.reason = reason;
    this.orphans = orphans;
    this.ids = ids;
  }
}

// An error's class name, or 'Error': never its message (a driver message can quote values).
const errorType = (e) => (typeof e?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(e.name) ? e.name : 'Error');

/** An id as the set holds it: a 24-hex id in lower case, anything else as it is. */
const normalizeId = (id) => (OBJECT_ID.test(String(id)) ? String(id).toLowerCase() : String(id));

/**
 * §B: the fingerprint of an orphan set — normalised, de-duplicated, sorted, joined by '\n', the first 8 hex
 * characters of its sha256. The private count tool prints the same for the same set (pinned vector).
 */
function orphanSetFingerprint(ids) {
  const set = [...new Set([...ids].map(normalizeId))].sort();
  return crypto.createHash('sha256').update(set.join('\n')).digest('hex').slice(0, 8);
}

// Compiled once per mongoose: a second load of this module (a cleared cache entry) reuses it.
const Marker = mongoose.models.OpsMarker || mongoose.model('OpsMarker', new mongoose.Schema({
  _id: String,
  v: Number,
  kind: String,
  armedAt: Date,
  recordSha256: String,
  recountOrphans: Number,
  deployedCommit: String,
}, { collection: MARKER_COLLECTION, versionKey: false, autoCreate: false, autoIndex: false, strict: 'throw' }));

/** The marker as stored (every field, known or not), read on the primary. */
const readMarker = () => Marker.findOne({ _id: MARKER_ID }).read('primary').lean();

function validMarker(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (Object.keys(doc).sort().join(',') !== MARKER_FIELDS.join(',')) return false;
  return doc._id === MARKER_ID
    && doc.v === 1
    && doc.kind === MARKER_ID
    && doc.armedAt instanceof Date && !Number.isNaN(doc.armedAt.getTime())
    && typeof doc.recordSha256 === 'string' && SHA256_HEX.test(doc.recordSha256)
    && doc.recountOrphans === 0
    && typeof doc.deployedCommit === 'string' && COMMIT_HEX.test(doc.deployedCommit);
}

/**
 * §A: may the nightly run erase? `{ armed, reason }`, reason ∈ absent | malformed | override | read-error
 * (null when armed). A primary read; never creates the collection; never throws.
 */
async function isArmed() {
  if (disabled(process.env[KILL_SWITCH])) return { armed: false, reason: 'override' };
  let doc;
  try {
    doc = await readMarker();
  } catch {
    return { armed: false, reason: 'read-error' };
  }
  if (!doc) return { armed: false, reason: 'absent' };
  return validMarker(doc) ? { armed: true, reason: null } : { armed: false, reason: 'malformed' };
}

async function mongoIds(into) {
  for (const model of CASCADE_MODELS) {
    for (const value of await model.distinct('userId').read('primary')) {
      if (value != null) into.add(normalizeId(value));
    }
  }
}

// A deployment with no Redis has no keys to find; a Redis that is configured but unusable is a failure,
// never "no keys" (the same rule as purgeUserKeysStrict). `keyNames` keeps the exact name of every key
// found, per id: the erase deletes exactly those, so no discovered key falls outside the purge (a
// `ledger:<id>` with no sub-key, an upper-case spelling) and no id is ever turned into a pattern.
async function redisIds(into, keyNames) {
  const redis = getRedis();
  if (!redis) {
    if (process.env.REDIS_URL) throw new Error('Redis is configured but unavailable');
    return;
  }
  for (const ns of USER_KEY_NAMESPACES) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', ns.scan, 'COUNT', 500);
      cursor = next;
      for (const key of keys) {
        const raw = ns.idOf(key);
        if (!raw) continue;
        const id = normalizeId(raw);
        into.add(id);
        if (!keyNames.has(id)) keyNames.set(id, new Set());
        keyNames.get(id).add(key);
      }
    } while (cursor !== '0');
  }
}

async function discover() {
  const all = new Set();
  const keyNames = new Map();
  await mongoIds(all);
  await redisIds(all, keyNames);
  const ids = [...all].sort();
  const accountIds = ids.filter((id) => OBJECT_ID.test(id));
  const existing = await accountExistence.existingAccountIds(accountIds);
  return {
    ids: ids.length,
    accountIds: accountIds.length,
    accountsRead: existing.size,
    orphans: ids.filter((id) => !existing.has(id)),
    keyNames,
  };
}

/** Read-only. The counts, the orphan ids (sorted) and their set fingerprint. Throws on a read error. */
async function discoverOrphans() {
  const { keyNames: _keyNames, ...found } = await discover();
  return { ...found, set: orphanSetFingerprint(found.orphans) };
}

/** Deletes exactly the named keys, by name: never a pattern. */
async function deleteKeyNames(names) {
  if (!names.length) return 0;
  const redis = getRedis();
  if (!redis) throw new Error('Redis is configured but unavailable');
  return redis.del(...names);
}

async function eraseOne(id, keyNames) {
  const found = [...(keyNames.get(id) || [])];
  if (!OBJECT_ID.test(id)) {
    // Not an ObjectId: no account, no Mongo rows, and never a pattern built from it (resilience §7: an id
    // like `*` would match every user). Exactly the keys discovery found under it.
    await deleteKeyNames(found);
    return 'erased';
  }
  // The per-id re-check: an account created since the discovery read is left alone.
  if ((await accountExistence.existingAccountIds([id])).has(id)) return 'account';
  await eraseUserChildData(id);
  // Hex is safe in a pattern, so the registry purge runs too, then the exact names it may not reach.
  await purgeUserKeysStrict(id);
  await deleteKeyNames(found);
  return 'erased';
}

/** After the loop: the orphans still there, by a fresh read-only discovery; `unknown` if it cannot be read. */
async function backlogNow() {
  try {
    return { backlog: (await discover()).orphans.length, failed: 0 };
  } catch (err) {
    console.error(`[orphanSweep] backlog read failed error=${errorType(err)}`);
    return { backlog: 'unknown', failed: 1 };
  }
}

const refusedRead = () => {
  console.error('[orphanSweep] refused reason=read-error');
  return { count: 'refused', backlog: 'unknown', failed: 1 };
};
const refusedGuard = (reason, found) => {
  console.error(`[orphanSweep] refused reason=${reason} orphans=${found.orphans.length} ids=${found.ids}`);
  return { count: 'refused', backlog: found.orphans.length, failed: 1 };
};

/**
 * §B. `{ count, backlog, failed }`; never throws. `count` is the deleted accounts erased, or `disabled` or
 * `refused`; `backlog` the orphans left (`unknown` when they could not be counted). `armed` is the one
 * injectable predicate; `force` with `expectedOrphans` and `expectedSet` is the private tool's clean.
 */
async function sweepDeletedAccountOrphans({ armed = isArmed, force = false, expectedOrphans, expectedSet } = {}) {
  let state = { armed: true, reason: null };
  if (!force) {
    try {
      state = await armed();
    } catch {
      state = { armed: false, reason: 'read-error' };
    }
    if (state.reason === 'read-error') return refusedRead();
  }

  let found;
  try {
    found = await discover();
  } catch {
    return refusedRead();
  }
  if (!state.armed) {
    console.warn(`[orphanSweep] disarmed reason=${state.reason} backlog=${found.orphans.length}`);
    return { count: 'disabled', backlog: found.orphans.length, failed: 0 };
  }

  if (found.accountIds > 0 && found.accountsRead === 0) return refusedGuard('no_accounts_read', found);
  if (force) {
    if (!Number.isInteger(expectedOrphans) || typeof expectedSet !== 'string' || !SET_HEX.test(expectedSet)) {
      return refusedGuard('bad_expectation', found);
    }
    if (found.orphans.length !== expectedOrphans) return refusedGuard('count_mismatch', found);
    if (orphanSetFingerprint(found.orphans) !== expectedSet) return refusedGuard('set_mismatch', found);
  } else if (found.orphans.length > REFUSE_ABOVE && found.orphans.length * 2 > found.ids) {
    return refusedGuard('too_many', found);
  }

  let erased = 0;
  let failed = 0;
  for (const id of force ? found.orphans : found.orphans.slice(0, ORPHAN_SWEEP_CAP)) {
    try {
      if ((await eraseOne(id, found.keyNames)) === 'erased') erased += 1;
    } catch (err) {
      failed += 1; // left for the next run
      console.error(`[orphanSweep] erase failed scope=${OBJECT_ID.test(id) ? 'account' : 'cache'} error=${errorType(err)}`);
    }
  }
  // Never `orphans - erased`: a key the purge did not reach would read as gone. A fresh count instead.
  const after = await backlogNow();
  return { count: erased, backlog: after.backlog, failed: failed + after.failed };
}

/**
 * §C: arms the nightly run. Refuses (OrphanSweepRefused, nothing written) unless the confirm literal is
 * right, `recordSha256` is 64 hex, `deployedCommit` is 40 hex, and a fresh discovery finds no orphan at all.
 * A second arm changes nothing.
 */
async function armOrphanSweep({ confirm, recordSha256, deployedCommit } = {}) {
  if (confirm !== ARM_CONFIRM) throw new OrphanSweepRefused('confirm');
  if (typeof recordSha256 !== 'string' || !SHA256_HEX.test(recordSha256)) throw new OrphanSweepRefused('record-sha256');
  if (typeof deployedCommit !== 'string' || !COMMIT_HEX.test(deployedCommit)) throw new OrphanSweepRefused('deployed-commit');
  const found = await discover();
  if (found.orphans.length > 0) throw new OrphanSweepRefused('orphans', { orphans: found.orphans.length, ids: found.ids });
  if (validMarker(await readMarker())) return { armed: true, v: 1 };
  await Marker.replaceOne(
    { _id: MARKER_ID },
    { v: 1, kind: MARKER_ID, armedAt: new Date(), recordSha256, recountOrphans: 0, deployedCommit },
    { upsert: true, writeConcern: { w: 'majority' } },
  );
  return { armed: true, v: 1 };
}

/** §C: disarms the nightly run (deletes the marker). */
async function disarmOrphanSweep() {
  const res = await Marker.deleteOne({ _id: MARKER_ID }, { writeConcern: { w: 'majority' } });
  return { disarmed: res.deletedCount };
}

module.exports = {
  CASCADE_MODELS,
  ORPHAN_SWEEP_CAP,
  KILL_SWITCH,
  OrphanSweepRefused,
  orphanSetFingerprint,
  isArmed,
  discoverOrphans,
  sweepDeletedAccountOrphans,
  armOrphanSweep,
  disarmOrphanSweep,
};
