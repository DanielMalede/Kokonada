'use strict';

// BE-016 (DEC-111, DEC-118): what withdrawing health-data consent removes from each session and each
// serve event, and which rows it reaches. ONE rule, read by three callers that must agree:
//   • the withdrawal itself (sessionHealthErasure.js), before the withdrawal answers;
//   • the daily sweep (sessionTrim, `healthErasures=`), which finishes a failed erasure and the
//     withdrawals made before this rule existed;
//   • the read-only count (scripts/sessionHealthCount.js), which is the sweep's dry run.
//
// MODEL-FREE and import-free on purpose: the count script loads this file against production, and a
// loaded model builds its indexes on connect (the HX-2 M1 lesson). Pinned by
// tests/sessionHealthPolicy.test.js.

// M1 (DEC-118): the moodKey a heart-rate session keeps after the erasure. It names no band and no
// activity; it only says the session was Live, so History stays truthful (sessionsController shows
// it as "A moment" / Live). Nothing else writes it: syntheticBioMoodKey always includes a band.
const ERASED_LIVE_MARK = 'bio:';

// A heart-rate moodKey that still names a band (`bio:<band>:<activity>`). It never matches the mark,
// so a session already erased is never matched again.
const BIO_KEY_WITH_BAND = /^bio:[a-z]/;

// A bio moodKey on a serve row. The erasure sets these to null, never to the mark.
const SERVE_BIO_KEY = /^bio:/;

// DT-1b′ O1 (DEC-118). A mood session older than the trim has lost its heart rate (sessionTrim nulls
// it at 30 days and keeps the activity), so nothing shows whether it carried one, and its activity may
// be the watch's: with no chip chosen, a mood generation stores the watch's value. Such an activity is
// kept only when it is provably a chip: one the app offers or once offered as a chip, which no watch
// lane can write. The watch lanes write only the adapter's vocabulary (resting, walking, running,
// cycling, swimming, strength, unknown; the BiometricLog enum), so running, resting and walking, which
// are both a chip and a watch value, are not proof and are removed.
// The serve rows cannot prove it either (the brief's O3): a serve row names its session only by the
// client's request id, which is neither unique nor the session's id, and serve rows are deleted at 29
// days, before the trim reaches the session at 30.
const CHIP_ONLY_ACTIVITIES = Object.freeze(['commuting', 'workout', 'winding down', 'working', 'focus']);

// ConsentRecord.latestFor reads at most this many newest rows to decide a same-millisecond tie; a tie
// group that fills the window is answered by "is any of it a withdrawal". Mirrored here (the model
// cannot be loaded) and held equal by the policy test.
const TIE_SCAN_LIMIT = 16;

const TARGETS_CLEARED = Object.freeze({ targetBpm: null, targetEnergy: null, targetValence: null });

// What each kind of row loses. A heart session keeps its time, the Live mark, its placeholder taps,
// its provider, its skip count, its flags and its tracks (T1: HX-2's 29-day clock governs them).
const HEART_SESSION_SET = Object.freeze({
  moodKey: ERASED_LIVE_MARK,
  'biometricSnapshot.heartRate': null,
  'biometricSnapshot.activity': null,
  ...TARGETS_CLEARED,
  targetGenres: [],
});
// Any other session that carried a heart rate (A2): its activity goes with it. Its moodKey, genres
// and free text stay (C1: the free text keeps its own 30-day clock).
const HEART_RATE_SET = Object.freeze({
  'biometricSnapshot.heartRate': null,
  'biometricSnapshot.activity': null,
  ...TARGETS_CLEARED,
});
const ACTIVITY_SET = Object.freeze({ 'biometricSnapshot.activity': null });
const SERVE_BIO_SET = Object.freeze({ moodKey: null, 'bioState.tempoBand': null, 'bioState.activity': null });
const SERVE_BAND_SET = Object.freeze({ 'bioState.tempoBand': null, 'bioState.activity': null });

// Fresh objects on every call: Mongoose casts a filter (and an update) in place, so a shared object
// would be mutated by one query and read by the next.
const fresh = (set) => Object.fromEntries(Object.entries(set).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
const hasTarget = () => ({
  $or: [{ targetBpm: { $ne: null } }, { targetEnergy: { $ne: null } }, { targetValence: { $ne: null } }],
});

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const idHex = (r) => {
  const id = r?._id;
  if (id && typeof id.toHexString === 'function') return id.toHexString();
  return String(id ?? '').toLowerCase();
};
const isHexId = (s) => /^[0-9a-f]{24}$/.test(s);
// One generator wrote both rows (the ObjectId's per-process field), so the counter orders them.
// Anything that is not an ObjectId reads as a different writer: the fail-closed direction.
const sameWriter = (a, b) => {
  const x = idHex(a);
  const y = idHex(b);
  return isHexId(x) && isHexId(y) && x.slice(8, 18) === y.slice(8, 18);
};
const isStatus = (r, status) => r?.status === status;

// The history in ConsentRecord.latestFor's order: by createdAt, then _id. Rows with no usable time or
// status are dropped.
function _ordered(history) {
  return (Array.isArray(history) ? history : [])
    .filter((r) => (isStatus(r, 'granted') || isStatus(r, 'withdrawn')) && Number.isFinite(ms(r.createdAt)))
    .sort((a, b) => (ms(a.createdAt) - ms(b.createdAt)) || (idHex(a) < idHex(b) ? -1 : idHex(a) > idHex(b) ? 1 : 0));
}

// Is `r` ordered after `w`? A same-millisecond pair is ordered only when one writer made both.
const _after = (r, w) => ms(r.createdAt) > ms(w.createdAt)
  || (ms(r.createdAt) === ms(w.createdAt) && sameWriter(r, w) && idHex(r) > idHex(w));

/**
 * The user's current status from the full history, with ConsentRecord.latestFor's tie rule: a tie from
 * one writer is ordered by the id counter; a tie across writers, or one that fills the scan window,
 * reads as withdrawn when any of it is a withdrawal.
 */
function latestIsWithdrawn(history) {
  const rows = _ordered(history);
  if (!rows.length) return false;
  const newest = rows[rows.length - 1];
  const tied = rows.filter((r) => ms(r.createdAt) === ms(newest.createdAt));
  if (tied.length === 1) return isStatus(newest, 'withdrawn');
  if (tied.length >= TIE_SCAN_LIMIT) return tied.some((r) => isStatus(r, 'withdrawn'));
  if (tied.every((r) => sameWriter(r, newest))) return isStatus(newest, 'withdrawn');
  return tied.some((r) => isStatus(r, 'withdrawn'));
}

/**
 * The windows one account's erasure covers, or null when none is owed.
 *   • G3 (DEC-118): owed only when a grant is on file before the latest withdrawal. A user who never
 *     granted is never erased here (DAN-016 and counsel decide those rows).
 *   • heart-rate data: every row created before `heartRateBefore`, which is `now` while the latest
 *     status is withdrawn, or the first grant after the latest withdrawal once the user re-granted.
 *   • targets (P1), and the activity on a session past the trim (DT-1b′ O1): every row created before
 *     the latest withdrawal.
 * Both cutoffs are strict and never later than `now` (the moment the history was read), so a grant
 * that lands during an erasure can never lose a lawful row.
 */
function eraseWindows({ history, latestIsWithdrawn: withdrawnNow, now }) {
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : NaN);
  if (!Number.isFinite(nowMs)) throw new TypeError('eraseWindows needs the time the history was read');
  const rows = _ordered(history);
  const withdrawals = rows.filter((r) => isStatus(r, 'withdrawn'));
  if (!withdrawals.length) return null;
  const lastW = withdrawals[withdrawals.length - 1];
  const grantedBefore = rows.some((r) => isStatus(r, 'granted') && !_after(r, lastW));
  if (!grantedBefore) return null;

  const targetsBefore = new Date(Math.min(ms(lastW.createdAt), nowMs));
  const regrant = withdrawnNow ? null : rows.find((r) => isStatus(r, 'granted') && _after(r, lastW));
  const heartRateBefore = new Date(regrant ? Math.min(ms(regrant.createdAt), nowMs) : nowMs);
  return { heartRateBefore, targetsBefore };
}

/** eraseWindows with the status read from the same history. */
function windowsFor(history, now) {
  return eraseWindows({ history, latestIsWithdrawn: latestIsWithdrawn(history), now });
}

/**
 * The steps, in the order they run. Session steps first, serve steps second; the user-scoped Redis
 * purge runs after all of them (sessionHealthErasure.js), because a cache rebuilt from serve rows
 * must read rows already cleared. The three heart-rate steps match disjoint rows, so each changed row
 * is counted once. Every filter matches only rows that still hold a value, so a second run changes
 * nothing.
 */
function erasureSteps(userId, { heartRateBefore, targetsBefore }) {
  const beforeHr = { $lt: heartRateBefore };
  return [
    {
      name: 'heartSessions', model: 'PlaylistSession', count: 'sessions',
      filter: { userId, createdAt: beforeHr, moodKey: BIO_KEY_WITH_BAND },
      set: fresh(HEART_SESSION_SET),
    },
    {
      name: 'heartRates', model: 'PlaylistSession', count: 'sessions',
      filter: { userId, createdAt: beforeHr, moodKey: { $not: BIO_KEY_WITH_BAND }, 'biometricSnapshot.heartRate': { $ne: null } },
      set: fresh(HEART_RATE_SET),
    },
    {
      // DT-1b′ O1: a mood session the trim has reached. `contextPrompt: null` is the trim's own
      // fingerprint: a generation always writes it (an empty note is still encrypted), and only
      // sessionTrim sets it to null.
      name: 'trimmedActivities', model: 'PlaylistSession', count: 'sessions',
      filter: {
        userId,
        createdAt: { $lt: targetsBefore }, // only sessions made before the latest withdrawal: after it the server holds no new watch activity (_withholdBiometrics), except the residual BE-016 declares (a run that stops before its re-check)
        moodKey: { $not: BIO_KEY_WITH_BAND },
        'biometricSnapshot.heartRate': null,
        contextPrompt: null,
        'biometricSnapshot.activity': { $ne: null, $nin: [...CHIP_ONLY_ACTIVITIES] },
      },
      set: fresh(ACTIVITY_SET),
    },
    {
      // P1: where a target came from is not stored, so every target made before the withdrawal goes.
      name: 'targets', model: 'PlaylistSession', count: 'sessionTargets',
      filter: { userId, createdAt: { $lt: targetsBefore }, ...hasTarget() },
      set: fresh(TARGETS_CLEARED),
    },
    {
      name: 'serveBioKeys', model: 'ServeEvent', count: 'serveEvents',
      filter: { userId, servedAt: { $lt: heartRateBefore }, moodKey: SERVE_BIO_KEY },
      set: fresh(SERVE_BIO_SET),
    },
    {
      name: 'serveBands', model: 'ServeEvent', count: 'serveEvents',
      filter: {
        userId,
        servedAt: { $lt: heartRateBefore },
        $or: [{ 'bioState.tempoBand': { $ne: null } }, { 'bioState.activity': { $ne: null } }],
      },
      set: fresh(SERVE_BAND_SET),
    },
  ];
}

/** Every field any step clears, per model, in first-seen order. tests/sessionHealthDeclarations reads it. */
function erasedFields() {
  const out = {};
  for (const step of erasureSteps(null, { heartRateBefore: new Date(0), targetsBefore: new Date(0) })) {
    out[step.model] = out[step.model] || [];
    for (const field of Object.keys(step.set)) if (!out[step.model].includes(field)) out[step.model].push(field);
  }
  return out;
}

module.exports = {
  ERASED_LIVE_MARK,
  BIO_KEY_WITH_BAND,
  SERVE_BIO_KEY,
  CHIP_ONLY_ACTIVITIES,
  TIE_SCAN_LIMIT,
  TARGETS_CLEARED,
  HEART_SESSION_SET,
  HEART_RATE_SET,
  SERVE_BIO_SET,
  SERVE_BAND_SET,
  latestIsWithdrawn,
  eraseWindows,
  windowsFor,
  erasureSteps,
  erasedFields,
  fresh,
};
