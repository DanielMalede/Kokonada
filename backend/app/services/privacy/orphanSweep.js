'use strict';

// J2 (BE-094; DT-11, DT-13, DT-14) — the daily sweep of deleted accounts' data, run by sessionTrim.
//
// A deleted account's data can outlive the deletion: a health-data sync or a recompute that wrote after the
// cascade ran (BE-028's batch lane), a server stopped between a write and its re-check. All of it sits
// under an id that no User doc carries any more: both deletion doors remove the User doc LAST. This finds
// those ids and runs the house cascade for each (erasure.eraseUserChildData), then the strict Redis purge.
// It is what the declarations' "within a day" for a deleted account rests on, so it must never erase a
// live account:
//   • DISCOVERY: every user id in every collection the cascade deletes (`distinct('userId')`; CASCADE_MODELS
//     is pinned to erasure.js's list by a lockstep test) and in every user-scoped Redis namespace (a SCAN per
//     userRedisPurge registry entry).
//   • An id is an orphan only when no User doc carries it, read on the PRIMARY (accountExistence), and read
//     AGAIN, for that id, right before its cascade. A doc with `deletedAt` set is an account, not an orphan.
//   • It REFUSES, deleting nothing (OrphanSweepRefused), when the users read returns none while ids exist,
//     or when the orphans are more than 5 and more than half of all ids: a wrong database, an empty
//     restore or a lagging read must never read as "everyone was deleted". A read that FAILS throws.
//   • At most ORPHAN_SWEEP_CAP accounts per run (each cascade includes the job purge, up to 2.5 s); the
//     rest is the backlog for the next run, and the line says how many (`orphanBacklog=`).
//   • An id found in Redis that cannot be an ObjectId names no account and has no Mongo rows: only its
//     keys are purged, never the Mongo cascade (its CastError would abort the run). It counts as one of
//     the run's erasures (`orphanErasures=`).
//   • ORPHAN_SWEEP_DISABLED (DT-13, house envFlag) stops the nightly run with no deploy; while it is set
//     the step logs one line, `[orphanSweep] disabled`, and still counts the backlog (read-only). The
//     operator's one-off clean (DT-12 C-2, the private count tool) calls sweepDeletedAccountOrphans
//     directly, on the owner's word, bound to the orphan count it recorded: any other count refuses.
// Lines carry counts and closed tokens only; an orphan's id is a deleted account's id and is never logged.

const BiometricLog = require('../../models/BiometricLog');
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
  BiometricLog, VitalSample, MedicalProfile, MorningState, RewardEvent, PersonalWeights, MusicProfile,
  PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack, ConsentRecord,
]);

const ORPHAN_SWEEP_CAP = 50;
const REFUSE_ABOVE = 5;
const KILL_SWITCH = 'ORPHAN_SWEEP_DISABLED';
const OBJECT_ID = /^[0-9a-f]{24}$/;

class OrphanSweepRefused extends Error {
  constructor(reason, { orphans, ids }) {
    super(`orphan sweep refused (${reason})`);
    this.name = 'OrphanSweepRefused';
    this.reason = reason;
    this.orphans = orphans;
    this.ids = ids;
  }
}

// An error's class name, or 'Error': never its message (a driver message can quote values).
const errorType = (e) => (typeof e?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(e.name) ? e.name : 'Error');

async function mongoIds() {
  const ids = new Set();
  for (const model of CASCADE_MODELS) {
    for (const value of await model.distinct('userId').read('primary')) {
      if (value != null) ids.add(String(value));
    }
  }
  return ids;
}

// A deployment with no Redis has no keys to find; a Redis that is configured but unusable is a failure,
// never "no keys" (the same rule as purgeUserKeysStrict).
async function redisIds() {
  const ids = new Set();
  const redis = getRedis();
  if (!redis) {
    if (process.env.REDIS_URL) throw new Error('Redis is configured but unavailable');
    return ids;
  }
  for (const ns of USER_KEY_NAMESPACES) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', ns.scan, 'COUNT', 500);
      cursor = next;
      for (const key of keys) {
        const id = ns.idOf(key);
        if (id) ids.add(id);
      }
    } while (cursor !== '0');
  }
  return ids;
}

/**
 * Read-only. `ids`: how many distinct user ids hold data; `accountIds`: how many of them could name an
 * account (ObjectIds); `accountsRead`: how many the users read found; `orphans`: the ids no User doc
 * carries, sorted.
 */
async function discoverOrphans() {
  const all = [...new Set([...await mongoIds(), ...await redisIds()])].sort();
  const accountIds = all.filter((id) => OBJECT_ID.test(id));
  const existing = await accountExistence.existingAccountIds(accountIds);
  return {
    ids: all.length,
    accountIds: accountIds.length,
    accountsRead: existing.size,
    orphans: all.filter((id) => !existing.has(id)),
  };
}

/**
 * Erases the data of up to ORPHAN_SWEEP_CAP deleted accounts. Returns `{ erased, failed, backlog, orphans,
 * ids }`. Throws OrphanSweepRefused (nothing deleted) under the guard above. `expectedOrphans`, for the
 * operator's one-off clean only: the orphan count it recorded; any other count refuses, and a matching one
 * passes the ratio guard (never the empty-users guard, never the cap).
 */
async function sweepDeletedAccountOrphans({ expectedOrphans } = {}) {
  const found = await discoverOrphans();
  const counts = { orphans: found.orphans.length, ids: found.ids };
  if (found.accountIds > 0 && found.accountsRead === 0) throw new OrphanSweepRefused('no_accounts_read', counts);
  if (expectedOrphans !== undefined) {
    if (expectedOrphans !== counts.orphans) throw new OrphanSweepRefused('count_mismatch', counts);
  } else if (counts.orphans > REFUSE_ABOVE && counts.orphans * 2 > counts.ids) {
    throw new OrphanSweepRefused('too_many', counts);
  }

  let erased = 0;
  let failed = 0;
  let stillAccounts = 0;
  for (const id of found.orphans.slice(0, ORPHAN_SWEEP_CAP)) {
    const scope = OBJECT_ID.test(id) ? 'account' : 'cache';
    try {
      if (scope === 'account') {
        // The per-id re-check: an account created since the discovery read is left alone.
        if ((await accountExistence.existingAccountIds([id])).has(id)) {
          stillAccounts += 1;
          continue;
        }
        await eraseUserChildData(id);
      }
      await purgeUserKeysStrict(id);
      erased += 1;
    } catch (err) {
      failed += 1; // left for the next run
      console.error(`[orphanSweep] erase failed scope=${scope} error=${errorType(err)}`);
    }
  }
  return { erased, failed, backlog: counts.orphans - erased - stillAccounts, ...counts };
}

/**
 * The sessionTrim step: `{ orphanErasures, orphanBacklog, failed }`. `orphanErasures` is the count, or
 * `disabled` (the switch is set) or `refused` (the guard refused; a failure for the run). `orphanBacklog`
 * is always the real number of orphans left, counted read-only when the sweep did not run.
 */
async function nightlyOrphanSweep() {
  if (disabled(process.env[KILL_SWITCH])) {
    console.warn('[orphanSweep] disabled');
    const { orphans } = await discoverOrphans();
    return { orphanErasures: 'disabled', orphanBacklog: orphans.length, failed: 0 };
  }
  try {
    const out = await sweepDeletedAccountOrphans();
    return { orphanErasures: out.erased, orphanBacklog: out.backlog, failed: out.failed };
  } catch (err) {
    if (!(err instanceof OrphanSweepRefused)) throw err;
    console.error(`[orphanSweep] refused reason=${err.reason} orphans=${err.orphans} ids=${err.ids}`);
    return { orphanErasures: 'refused', orphanBacklog: err.orphans, failed: 1 };
  }
}

module.exports = {
  CASCADE_MODELS,
  ORPHAN_SWEEP_CAP,
  KILL_SWITCH,
  OrphanSweepRefused,
  discoverOrphans,
  sweepDeletedAccountOrphans,
  nightlyOrphanSweep,
};
