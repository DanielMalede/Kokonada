'use strict';

// BE-016 (DEC-111, DEC-118 K1 and F1): the daily sweep, run by sessionTrim, that finishes the
// session-health erasure for every account with a withdrawal on file:
//   • an erasure the withdrawal could not finish (`User.healthErasurePendingAt` is set), including
//     its user-scoped Redis purge, whose failure leaves no other trace;
//   • withdrawals made before this code existed, and any write that landed after an erasure and was
//     not undone (a process that died before its own re-check).
// It applies the SAME windows rule as the withdrawal (sessionHealthPolicy.windowsFor), so a re-granted
// account's rows from after the re-grant are never touched and a user who never granted is never
// erased. Every filter matches only rows that still hold a value, so a clean account costs reads only.
//
// HEALTH_ERASURE_SWEEP_DISABLED stops the backlog with no deploy; an owed erasure still finishes, since
// its withdrawal already ran the same rule in part. A rollback restores no data, so if the count script
// (scripts/sessionHealthCount.js, the sweep's dry run) shows rows that are lawful now, this is the
// switch to pull before the next run.

const User = require('../../models/User');
const ConsentRecord = require('../../models/ConsentRecord');
const { disabled } = require('../../utils/envFlag');
const { windowsFor } = require('./sessionHealthPolicy');
const { eraseSessionHealth, readHistory } = require('./sessionHealthErasure');

const KILL_SWITCH = 'HEALTH_ERASURE_SWEEP_DISABLED';
const DEFAULT_BATCH = 200;

// How many accounts one run may erase. A clean account does not count against it, so a backlog is
// worked through over successive nights and never starves behind accounts that owe nothing.
function sweepBatch() {
  const n = Number(process.env.HEALTH_ERASURE_SWEEP_BATCH);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_BATCH;
}

// Accounts with an owed record first, then every account with a withdrawal on file; each once. With
// `owedOnly` (the kill switch), only the owed records: the backlog waits.
async function _candidates({ owedOnly = false } = {}) {
  const purpose = require('./consent').HEALTH_CONSENT_PURPOSE;
  const owed = await User.find({ healthErasurePendingAt: { $ne: null } }).select('_id healthErasurePendingAt').lean();
  const withdrawn = owedOnly ? [] : await ConsentRecord.distinct('userId', { purpose, status: 'withdrawn' });
  const pending = new Map(owed.map((u) => [String(u._id), u.healthErasurePendingAt]));
  const ids = [...new Set([...owed.map((u) => String(u._id)), ...withdrawn.map(String)])];
  return { ids, pending };
}

const changedAnything = (counts) => Object.values(counts).some((n) => n > 0);

async function _clearOwed(userId, value) {
  await User.updateOne({ _id: userId, healthErasurePendingAt: value }, { $set: { healthErasurePendingAt: null } });
}

/**
 * Returns { count, failed }: `count` is the accounts this run erased something for or whose owed
 * erasure it finished (the `healthErasures=` token); `failed` the accounts whose erasure is still
 * incomplete (their owed record stays for the next run). One account's failure never stops the rest.
 */
async function sweepOwedHealthErasures({ now = new Date() } = {}) {
  const backlogOff = disabled(process.env[KILL_SWITCH]);
  if (backlogOff) console.warn(`[sessionHealth] sweep disabled by ${KILL_SWITCH} (owed erasures still finish)`);
  const cap = sweepBatch();
  const { ids, pending } = await _candidates({ owedOnly: backlogOff });
  let erased = 0;
  let failed = 0;
  for (const id of ids) {
    if (erased >= cap) break;
    const owedSince = pending.get(id) ?? null;
    try {
      const windows = windowsFor(await readHistory(id), now);
      if (!windows) {
        // Nothing is owed after all (no grant before the withdrawal); the record is cleared, nothing erased.
        if (owedSince) await _clearOwed(id, owedSince);
        continue;
      }
      const counts = await eraseSessionHealth(id, windows, { purgeRedis: !!owedSince });
      if (owedSince) await _clearOwed(id, owedSince);
      if (owedSince || changedAnything(counts)) erased += 1;
    } catch {
      failed += 1; // the steps that failed are named on the error; the owed record stays
    }
  }
  return { count: erased, failed };
}

module.exports = { sweepOwedHealthErasures, KILL_SWITCH };
