'use strict';

const MedicalProfile = require('../models/MedicalProfile');
const VitalSample = require('../models/VitalSample');
const MorningState = require('../models/MorningState');
const baselinesService = require('../services/biosonic/baselines');
const { logBiometricAccess } = require('../utils/biometricAudit');
const {
  consolidate, REFERENCE_DAYS, RECENT_DAYS,
} = require('../agents/runtime/physiology/dailyAnalysis');
const { localDayIndex } = require('../agents/runtime/physiology/baselineEngine');
const { readNightHistory } = require('../repositories/sleepHistoryRepo');

// A6 — daily analysis, WIRING half (W4-012). Nightly per-user consolidation: refresh baselines
// (reuse, not a second decrypt-and-fuse path — the stateVector.worker precedent), page the
// VitalSample window the CUSUM detector needs, fold in this collection's OWN recent history for
// the multi-night sleep-debt accumulator (the mission's "persist nightly values into
// VitalSample-adjacent storage or MorningState later" — this is that "later"), and upsert ONE
// MorningState row for today's local day.
//
// ZERO-KNOWLEDGE BOUNDARY: all decryption happens HERE, worker-scope, on paged mongoose
// documents. The returned job summary is bookkeeping only — no vitals (§0.2.2).
//
// POPULATION: every user with a MedicalProfile — the same "has this user ever been analyzed"
// set `stateVector.worker` already assumes when it reads one. A user with no profile has never
// had a biometric reading accepted, so there is nothing here to consolidate.

const BATCH = Number(process.env.DAILY_ANALYSIS_BATCH) || 500;
const CUSUM_WINDOW_DAYS = REFERENCE_DAYS + RECENT_DAYS;
const PAGE_SIZE = 2000;
const MAX_PAGES = 10; // 20k rows — VitalSample writes at most a handful of rows/day/metric/user
const HISTORY_NIGHTS = 14; // prior MorningState rows read back for sleep-debt continuity
const DAY_MS = 86400000;

// Page this user's VitalSample window, decrypted (getters run on a non-.lean() find). Mirrors
// baselines.js `_pageDecrypted`'s shape but scoped to the wider CUSUM window that module does
// not itself need.
async function _pageVitals(userId, since) {
  const rows = [];
  let lastId = null;
  let decryptedCount = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = { userId, recordedAt: { $gte: since }, ...(lastId ? { _id: { $gt: lastId } } : {}) };
    const docs = await VitalSample.find(query).sort({ _id: 1 }).limit(PAGE_SIZE);
    if (!docs?.length) break;
    for (const doc of docs) {
      decryptedCount += 1;
      if (doc.value == null) continue; // Number(null) === 0 — reject before coercing
      const value = Number(doc.value);
      if (!Number.isFinite(value)) continue;
      rows.push({
        metric: doc.metric, value, recordedAt: doc.recordedAt, tzOffsetMinutes: doc.tzOffsetMinutes ?? null,
      });
    }
    lastId = docs[docs.length - 1]._id;
    if (docs.length < PAGE_SIZE) break;
  }
  return { rows, decryptedCount };
}

// W4-D68: delegated to the repository, which is now also the serving lane's reader — the same
// nights, read one way, rather than a private copy here and a second one there.
//
// The repository also widens the projection from `'night'` to `'userId night'`. That is a LATENT
// fix, not a live one, and the distinction is measured: this collection's rows are written by
// `findOneAndUpdate($set)` below, whose setter runs with a Query as `this`, so the stage minutes
// are encrypted UNBOUND and the narrow projection has always decrypted them fine. A row written
// through a DOCUMENT instead (a backfill, a migration, a future `.save()`) is AAD-bound, and the
// narrow projection would read every stage as null — silently zeroing this accumulator's history
// while logging a crypto alarm per field. See the repository header for the side-by-side.
async function _priorNights(userId, beforeDate) {
  return readNightHistory(userId, { before: beforeDate, limit: HISTORY_NIGHTS });
}

async function _eligibleUserIds(limit) {
  const rows = await MedicalProfile.find({}).sort({ _id: 1 }).limit(limit).select('userId');
  return rows.map((r) => r.userId);
}

async function _processUser(userId, now) {
  const baselines = await baselinesService.computeBaselines(userId);
  await baselinesService.cacheBaselines(userId, baselines);

  const tzOffsetMinutes = baselines?.tzOffsetMinutes ?? 0;
  const since = new Date(now - CUSUM_WINDOW_DAYS * DAY_MS);
  const { rows: vitalSamples, decryptedCount } = await _pageVitals(userId, since);

  const profileDoc = await MedicalProfile.findOne({ userId }); // getters decrypt here only
  const profile = profileDoc ? profileDoc.toObject() : {};

  const dayIndex = localDayIndex(now, tzOffsetMinutes);
  const date = new Date(dayIndex * DAY_MS);

  // Only treat MedicalProfile's `lastNightSleep` as TODAY's new night if its own bucket date
  // lands on yesterday (or today, for an early-morning run) — otherwise it is a night a prior
  // run already folded in, and re-pushing it would double-count one night's debt.
  const sleepAt = profile?.lastNightSleep?.date ? new Date(profile.lastNightSleep.date).getTime() : null;
  const sleepDayIndex = sleepAt != null ? localDayIndex(sleepAt, tzOffsetMinutes) : null;
  const lastNightIsNew = sleepDayIndex != null && sleepDayIndex >= dayIndex - 1 && sleepDayIndex <= dayIndex;
  const lastNight = lastNightIsNew
    ? { deep: profile.lastNightSleep.deep, light: profile.lastNightSleep.light, rem: profile.lastNightSleep.rem }
    : null;

  const priorNights = await _priorNights(userId, date);

  // ONE audit line for the whole bulk decryption (userId + purpose + count), never a reading.
  const decryptedTotal = decryptedCount + (profileDoc ? 1 : 0);
  if (decryptedTotal > 0) logBiometricAccess(userId, 'daily-analysis', { count: decryptedTotal });

  const out = consolidate({
    vitalSamples,
    priorNights,
    profile: {
      lastNightSleep: lastNight,
      sleepStages: profile?.sleepStages,
      hrv: profile?.hrv,
      bodyBattery: profile?.bodyBattery,
      dailyReadiness: profile?.dailyReadiness,
    },
    baselines,
    tzOffsetMinutes,
  });

  await MorningState.findOneAndUpdate(
    { userId, date },
    {
      $set: {
        readiness: out.readiness.value,
        readinessConfidence: out.readiness.confidence,
        sleepDebt: out.sleepDebt,
        night: lastNight,
        cosinor: out.cosinor ? {
          M: out.cosinor.M, A: out.cosinor.A, phi: out.cosinor.phi,
          confidence: out.cosinor.confidence, source: out.cosinor.source,
        } : null,
        cusum: out.cusum,
      },
    },
    { upsert: true, new: true },
  );

  return { flagged: Boolean(out.cusum.rhr.flagged || out.cusum.hrv.flagged) };
}

async function processJob(job) {
  // `now` is Date.now() by default; injectable for the replay/soak harness and for tests that
  // need to advance "tonight" without faking global timers (which would also stall the Mongo
  // driver's own connection-keepalive timers).
  const injected = Number(job?.data?.now);
  const now = Number.isFinite(injected) ? injected : Date.now();
  const limit = job?.data?.limit ?? BATCH;
  const userIds = await _eligibleUserIds(limit);

  let processed = 0;
  let flagged = 0;
  let failed = 0;
  for (const userId of userIds) {
    try {
      const result = await _processUser(userId, now);
      processed += 1;
      if (result.flagged) flagged += 1;
    } catch (e) {
      failed += 1;
      // Type only — a validation message on these fields would quote the vital it rejected.
      console.error(`[dailyAnalysis] user consolidation failed: ${e?.name || 'Error'}`);
    }
  }

  // Bookkeeping-only summary (§0.2.2, R10) — counts, never a vital or a state label.
  return { processed, flagged, failed, eligible: userIds.length };
}

module.exports = { process: processJob, BATCH, CUSUM_WINDOW_DAYS };
