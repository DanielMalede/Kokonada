'use strict';

// HX-1 production survivor count: the regulatory brief's §5.1, Q0–Q3. The owner runs it once,
// after the HX-1 fix is deployed. STRICTLY READ-ONLY: it never writes, deletes, creates an index or a
// collection, and it loads no Mongoose model (a model builds its indexes on connect). Erasing any
// survivor is a separate step the owner takes after reading the counts.
//
// OUTPUT IS COUNTS ONLY: never a value, a time or an id (owner ruling, 2026-09-30). Accounts are
// numbered in a stable order; the only thing said about each is whether the operator controls it.
//
// Run from backend/, with the ids of the accounts YOU control (comma-separated) in the environment:
//   HX1_OPERATOR_USER_IDS=<id>[,<id>...] railway run node scripts/hx1SurvivorCount.js
// Exit 0: counted (see the RESULT line). Exit 2: STOP — an account with a withdrawal is not the
// operator's, so nothing in Q1–Q3 is counted (the ruling covers the owner's own data only). Exit 1:
// an error.
//
// What each question counts (§5.1):
//   Q0  accounts with any `withdrawn` row for the health purpose, each with its full ordered history.
//   Q1  per account, BiometricLog and VitalSample rows by INSERTION time — the time inside the row's
//       `_id` — never `recordedAt`: a race survivor's `recordedAt` precedes the withdrawal, so a
//       `recordedAt` filter misses exactly the rows in question.
//         survivors         inserted before (latest withdrawnAt + 5 min): the erasure should have
//                           removed every one. The 5 minutes cover the `_id`'s one-second resolution.
//         after-withdrawal  inserted at or after that point, for accounts whose latest status is
//                           `withdrawn`: gate bypasses, a different defect. n/a after a re-grant.
//   Q2  for accounts whose latest status is `withdrawn`: MedicalProfile split into default-only — ones
//       with no encrypted vital field set; these include the BE-019 artefact but can still hold an
//       inferred state (`stateVector`) — and with-vitals (any encrypted vital field set). Fields are
//       read as present/absent, never decrypted. And MorningState.
//   Q3  PlaylistSession rows holding a heart-rate snapshot:
//         hr-in-no-grant-interval          created after a withdrawal and before the next grant —
//                                          heart rate used after withdrawal (pre-#193 behaviour).
//         hr-before-withdrawal-within-30d  created before the latest withdrawal, outside any
//                                          no-grant interval, and less than 30 days ago: kept by the
//                                          declared 30-day retention (BE-016). Reported separately
//                                          and left out of RESULT.
//   RESULT  non-zero if any Q1, Q2 or hr-in-no-grant-interval count is above zero.
//
// Ordering follows ConsentRecord.latestFor: by createdAt, then _id. On a same-millisecond tie at the
// newest row, a withdrawal counts as the latest status (the conservative reading: more is counted).

const mongoose = require('mongoose');
const { assertDbName } = require('../app/config/db');

const OPERATOR_ENV = 'HX1_OPERATOR_USER_IDS';
const PURPOSE = 'health_biometric_processing';
const SLACK_MS = 5 * 60 * 1000;
const DECLARED_SNAPSHOT_MS = 30 * 24 * 3600 * 1000;

// The collections the models write to (pinned against the models in the test).
const COLLECTIONS = Object.freeze({
  consent: 'consentrecords',
  biometricLogs: 'biometriclogs',
  vitalSamples: 'vitalsamples',
  medicalProfiles: 'medicalprofiles',
  morningStates: 'morningstates',
  playlistSessions: 'playlistsessions',
});

// MedicalProfile's encrypted vital fields (pinned against the schema in the test).
const MEDICAL_PROFILE_VITAL_PATHS = Object.freeze([
  'restingHeartRate', 'maxHeartRate', 'hrv', 'respirationRate', 'spO2',
  'stepsPerMinute', 'accelerometerVariance', 'gpsVelocityKmh',
  'sleepStages.rem', 'sleepStages.deep', 'sleepStages.light',
  'dailyReadiness', 'bodyBattery',
  'lastNightSleep.deep', 'lastNightSleep.light', 'lastNightSleep.rem',
]);

const HEADER = 'hx1-survivor-count read-only counts-only';
const STOP = "STOP an account with a withdrawal is not the operator's: nothing in Q1–Q3 was counted and nothing was erased. Take this result to counsel.";

class UsageError extends Error {}

/** The operator's own account ids, from the owner-set variable. Never echoes what it was given. */
function parseOperatorIds(raw) {
  const ids = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new UsageError(`${OPERATOR_ENV} is not set: pass the ids of the accounts you control, comma-separated`);
  }
  if (!ids.every((id) => /^[0-9a-f]{24}$/i.test(id))) {
    throw new UsageError(`${OPERATOR_ENV} must hold 24-character hex user ids, comma-separated`);
  }
  return ids.map((id) => id.toLowerCase());
}

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const byCreatedThenId = (a, b) => (ms(a.createdAt) - ms(b.createdAt)) || String(a._id).localeCompare(String(b._id));

/** One account's consent history, read into the facts Q1–Q3 need. */
function readHistory(rows) {
  const ordered = [...rows].sort(byCreatedThenId);
  const newestMs = ms(ordered[ordered.length - 1].createdAt);
  const newest = ordered.filter((r) => ms(r.createdAt) === newestMs);
  const latestWithdrawn = newest.some((r) => r.status === 'withdrawn');

  const withdrawals = ordered.filter((r) => r.status === 'withdrawn');
  const latestWithdrawnAtMs = Math.max(...withdrawals.map((r) => ms(r.withdrawnAt ?? r.createdAt)));
  const latestWithdrawalCreatedMs = Math.max(...withdrawals.map((r) => ms(r.createdAt)));

  // No-grant intervals: from a withdrawal to the next grant (open-ended if none followed).
  const intervals = [];
  let openAt = null;
  for (const r of ordered) {
    if (r.status === 'withdrawn' && openAt === null) openAt = new Date(ms(r.createdAt));
    else if (r.status === 'granted' && openAt !== null) {
      intervals.push([openAt, new Date(ms(r.createdAt))]);
      openAt = null;
    }
  }
  if (openAt !== null) intervals.push([openAt, null]);

  return { latestWithdrawn, latestWithdrawnAtMs, latestWithdrawalCreatedMs, intervals };
}

/**
 * Q0–Q3 against a connected database. Read-only. Returns the lines to print and the exit code:
 * 0 when counted, 2 on STOP.
 */
async function countSurvivors(db, { operatorIds, now = new Date() }) {
  const operators = new Set(operatorIds.map((id) => String(id).toLowerCase()));
  const col = (name) => db.collection(COLLECTIONS[name]);
  const lines = [HEADER];

  const withdrawnUserIds = await col('consent').distinct('userId', { purpose: PURPOSE, status: 'withdrawn' });
  const accounts = withdrawnUserIds.map((id) => ({ id, hex: String(id).toLowerCase() }))
    .sort((a, b) => a.hex.localeCompare(b.hex));

  lines.push(`Q0 withdrawn-accounts=${accounts.length}`);
  accounts.forEach((a, i) => lines.push(`Q0 account-${i + 1} operator=${operators.has(a.hex) ? 'yes' : 'no'}`));
  if (accounts.some((a) => !operators.has(a.hex))) {
    lines.push(STOP);
    return { lines, exitCode: 2 };
  }

  const q1 = [];
  const q2 = [];
  const q3 = [];
  let nonZero = false;
  const note = (n) => { if (typeof n === 'number' && n > 0) nonZero = true; return n; };

  for (const [i, { id: userId }] of accounts.entries()) {
    const n = i + 1;
    const history = readHistory(await col('consent').find({ userId, purpose: PURPOSE }).toArray());

    // Q1 — insertion time from the `_id`, never `recordedAt`.
    const cutoff = mongoose.Types.ObjectId.createFromTime(Math.floor((history.latestWithdrawnAtMs + SLACK_MS) / 1000));
    for (const name of ['biometricLogs', 'vitalSamples']) {
      const survivors = note(await col(name).countDocuments({ userId, _id: { $lt: cutoff } }));
      const after = history.latestWithdrawn
        ? note(await col(name).countDocuments({ userId, _id: { $gte: cutoff } }))
        : 'n/a';
      q1.push(`Q1 account-${n} ${COLLECTIONS[name]} survivors=${survivors} after-withdrawal=${after}`);
    }

    // Q2 — only while the latest status is a withdrawal.
    if (history.latestWithdrawn) {
      const profiles = await col('medicalProfiles').countDocuments({ userId });
      const withVitals = await col('medicalProfiles').countDocuments({
        userId, $or: MEDICAL_PROFILE_VITAL_PATHS.map((p) => ({ [p]: { $ne: null } })),
      });
      const morning = await col('morningStates').countDocuments({ userId });
      note(profiles);
      note(morning);
      q2.push(`Q2 account-${n} medicalprofiles default-only=${profiles - withVitals} with-vitals=${withVitals} morningstates=${morning}`);
    } else {
      q2.push(`Q2 account-${n} medicalprofiles=n/a morningstates=n/a`);
    }

    // Q3 — heart-rate snapshots against the no-grant intervals.
    const withHr = { userId, 'biometricSnapshot.heartRate': { $ne: null } };
    const ranges = history.intervals.map(([from, to]) => ({ createdAt: to ? { $gte: from, $lt: to } : { $gte: from } }));
    const inNoGrant = ranges.length
      ? note(await col('playlistSessions').countDocuments({ ...withHr, $or: ranges }))
      : 0;
    const declared = await col('playlistSessions').countDocuments({
      ...withHr,
      createdAt: { $gte: new Date(ms(now) - DECLARED_SNAPSHOT_MS), $lt: new Date(history.latestWithdrawalCreatedMs) },
      ...(ranges.length ? { $nor: ranges } : {}),
    });
    q3.push(`Q3 account-${n} playlistsessions hr-in-no-grant-interval=${inNoGrant} hr-before-withdrawal-within-30d=${declared}`);
  }

  lines.push(...q1, ...q2, ...q3, `RESULT ${nonZero ? 'non-zero' : 'all-zero'}`);
  return { lines, exitCode: 0 };
}

// An error's class name only — a driver message can name hosts, and nothing but closed lines is printed.
const errorType = (e) => (typeof e?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(e.name) ? e.name : 'Error');

async function main({ env = process.env, out = (line) => console.log(line) } = {}) {
  let operatorIds;
  try {
    operatorIds = parseOperatorIds(env[OPERATOR_ENV]);
  } catch (e) {
    out(`ERROR ${e instanceof UsageError ? e.message : errorType(e)}`);
    return 1;
  }
  if (!env.MONGO_URI) {
    out('ERROR MONGO_URI is not set: run it through railway run');
    return 1;
  }

  let conn;
  try {
    conn = await mongoose.createConnection(env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      autoIndex: false,
      autoCreate: false,
      readPreference: 'primary',
    }).asPromise();
  } catch (e) {
    out(`ERROR could not connect (${errorType(e)})`);
    return 1;
  }
  try {
    try {
      assertDbName(conn.name);
    } catch {
      out('ERROR the connected database is not the expected one (MONGO_DB_NAME check)');
      return 1;
    }
    const { lines, exitCode } = await countSurvivors(conn.db, { operatorIds, now: new Date() });
    lines.forEach((line) => out(line));
    return exitCode;
  } catch (e) {
    out(`ERROR the count failed (${errorType(e)})`);
    return 1;
  } finally {
    await conn.close().catch(() => {});
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => {
    console.log(`ERROR ${errorType(e)}`);
    process.exit(1);
  });
}

module.exports = {
  OPERATOR_ENV, COLLECTIONS, MEDICAL_PROFILE_VITAL_PATHS, SLACK_MS,
  parseOperatorIds, readHistory, countSurvivors, main,
};
