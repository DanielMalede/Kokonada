'use strict';

// ── Garmin Connect unofficial PULL client (EXPERIMENT — flag-gated) ──────────────
//
// This is a *test* alternative to the official Garmin Health API path in
// ./garmin.js (OAuth2 + PKCE + server-to-server webhook push, which needs Garmin
// partner approval) and to the sideloaded Monkey C watch app. Here we log into
// Garmin Connect with the user's email/password via the unofficial `garmin-connect`
// wrapper and PULL a comprehensive biometric snapshot in one request.
//
// It deliberately emits the SAME canonical metric records the rest of the app
// already consumes ({metric, value, unit, recordedAt, source}), so the snapshot
// flows straight through persistMetrics() → BiometricLog + MedicalProfile and into
// the playlist prompt (resolveBiometricContext) with zero downstream changes.
//
// Caveats (acceptable for a time-boxed data-sufficiency test): the wrapper is
// unofficial (against Garmin's ToS, can break without notice) and cannot pass an
// MFA/CAPTCHA challenge. Gate the whole experiment behind GARMIN_CONNECT_PULL.

const { GarminConnect } = require('garmin-connect');

const GC_API = 'https://connectapi.garmin.com';
const SOURCE = 'garmin';

// Off unless explicitly enabled, so a stray credential POST can never reach Garmin
// in an environment that hasn't opted into the experiment.
function isEnabled() {
  const v = process.env.GARMIN_CONNECT_PULL;
  return v === '1' || v === 'true';
}

// 'YYYY-MM-DD' in UTC — the calendar key Garmin's daily endpoints expect.
function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Authenticate against Garmin Connect with email/password.
 * @returns {Promise<{ client: GarminConnect, sessionTokens: {oauth1,oauth2} }>}
 *   sessionTokens are the wrapper's OAuth1/OAuth2 session — persist THESE (never
 *   the password) so future pulls can restoreSession() without re-prompting.
 */
async function login({ email, password }) {
  const client = new GarminConnect({ username: email, password });
  await client.login(email, password);
  return { client, sessionTokens: client.exportToken() };
}

/** Rebuild an authenticated client from previously stored session tokens. */
function restoreSession(sessionTokens) {
  const client = new GarminConnect();
  client.loadToken(sessionTokens.oauth1, sessionTokens.oauth2);
  return client;
}

// Run one sub-fetch in isolation: a metric Garmin doesn't have for this user (or a
// shifted endpoint) records a warning and yields null instead of failing the pull.
async function safe(warnings, label, fn) {
  try {
    return await fn();
  } catch (err) {
    warnings.push(`${label}: ${err && err.message ? err.message : 'failed'}`);
    return null;
  }
}

// Most recent non-null intraday HR sample → a "current"-ish live value.
function latestHr(heart) {
  const series = heart && Array.isArray(heart.heartRateValues) ? heart.heartRateValues : [];
  for (let i = series.length - 1; i >= 0; i--) {
    const e = series[i];
    if (Array.isArray(e) && e[1] != null) return e[1];
  }
  return null;
}

/**
 * Pull every biometric signal Garmin exposes for the given day and return one
 * comprehensive, structured snapshot. Each section is best-effort; `warnings[]`
 * lists anything that couldn't be fetched.
 *
 * @param {GarminConnect} client  an authenticated client (from login/restoreSession)
 * @param {{date?: Date|string}} [opts]
 */
async function fetchAllBiometrics(client, opts = {}) {
  const date = opts.date ? new Date(opts.date) : new Date();
  const dateStr = isoDate(date);
  const warnings = [];

  // Typed wrapper helpers where they exist…
  const profile = await safe(warnings, 'profile', () => client.getUserProfile());
  const displayName = profile && profile.displayName;
  const garminUserId = profile ? String(profile.profileId ?? profile.displayName ?? '') : null;

  const heart = await safe(warnings, 'heartRate', () => client.getHeartRate(date));
  const sleep = await safe(warnings, 'sleep', () => client.getSleepData(date));
  const steps = await safe(warnings, 'steps', () => client.getSteps(date));
  const activities = await safe(warnings, 'activities', () => client.getActivities(0, 5));

  // …and raw modern endpoints via the authenticated client for the rest.
  const daily = displayName
    ? await safe(warnings, 'dailySummary', () =>
        client.get(`${GC_API}/usersummary-service/usersummary/daily/${displayName}`, {
          params: { calendarDate: dateStr },
        }))
    : null;
  const hrv = await safe(warnings, 'hrv', () => client.get(`${GC_API}/hrv-service/hrv/${dateStr}`));
  const readiness = await safe(warnings, 'trainingReadiness', () =>
    client.get(`${GC_API}/metrics-service/metrics/trainingreadiness/${dateStr}`));

  const sd = sleep && sleep.dailySleepDTO ? sleep.dailySleepDTO : null;
  const scores = sd && sd.sleepScores ? sd.sleepScores : null;
  const tr = Array.isArray(readiness) ? readiness[0] : readiness;

  return {
    fetchedAt: new Date().toISOString(),
    calendarDate: dateStr,
    garminUserId,
    displayName,

    heartRate: heart ? {
      current: latestHr(heart),
      resting: heart.restingHeartRate ?? null,
      min: heart.minHeartRate ?? null,
      max: heart.maxHeartRate ?? null,
      lastSevenDayAvgResting: heart.lastSevenDaysAvgRestingHeartRate ?? null,
      sampleCount: Array.isArray(heart.heartRateValues) ? heart.heartRateValues.length : 0,
    } : null,

    hrv: (hrv && hrv.hrvSummary) ? {
      lastNightAvg: hrv.hrvSummary.lastNightAvg ?? null,
      lastNight5MinHigh: hrv.hrvSummary.lastNight5MinHigh ?? null,
      weeklyAvg: hrv.hrvSummary.weeklyAvg ?? null,
      status: hrv.hrvSummary.status ?? null,
      baseline: hrv.hrvSummary.baseline ?? null,
    } : (sleep ? {
      lastNightAvg: sleep.avgOvernightHrv ?? null,
      status: sleep.hrvStatus ?? null,
    } : null),

    sleep: sd ? {
      score: scores && scores.overall ? (scores.overall.value ?? null) : null,
      qualifier: scores && scores.overall ? (scores.overall.qualifierKey ?? null) : null,
      durationSeconds: sd.sleepTimeSeconds ?? null,
      deepSeconds: sd.deepSleepSeconds ?? null,
      lightSeconds: sd.lightSleepSeconds ?? null,
      remSeconds: sd.remSleepSeconds ?? null,
      awakeSeconds: sd.awakeSleepSeconds ?? null,
      avgSleepStress: sd.avgSleepStress ?? null,
    } : null,

    respiration: sd ? {
      avg: sd.averageRespirationValue ?? null,
      lowest: sd.lowestRespirationValue ?? null,
      highest: sd.highestRespirationValue ?? null,
    } : (daily ? {
      avg: daily.avgWakingRespirationValue ?? null,
      lowest: daily.lowestRespirationValue ?? null,
      highest: daily.highestRespirationValue ?? null,
    } : null),

    bodyBattery: daily ? {
      mostRecent: daily.bodyBatteryMostRecentValue ?? null,
      highest: daily.bodyBatteryHighestValue ?? null,
      lowest: daily.bodyBatteryLowestValue ?? null,
      charged: daily.bodyBatteryChargedValue ?? null,
      drained: daily.bodyBatteryDrainedValue ?? null,
    } : null,

    stress: daily ? {
      avg: daily.averageStressLevel ?? null,
      max: daily.maxStressLevel ?? null,
    } : null,

    spo2: daily ? {
      avg: daily.averageSpo2 ?? null,
      lowest: daily.lowestSpo2 ?? null,
    } : null,

    trainingReadiness: tr ? {
      score: tr.score ?? null,
      level: tr.level ?? null,
      feedback: tr.feedbackShort ?? null,
    } : null,

    steps: {
      total: typeof steps === 'number' ? steps : (daily ? (daily.totalSteps ?? null) : null),
      goal: daily ? (daily.dailyStepGoal ?? null) : null,
    },

    intensityMinutes: daily ? {
      moderate: daily.moderateIntensityMinutes ?? null,
      vigorous: daily.vigorousIntensityMinutes ?? null,
    } : null,

    recentActivities: Array.isArray(activities) ? activities.slice(0, 5).map((a) => ({
      activityId: a.activityId ?? null,
      name: a.activityName ?? null,
      type: a.activityType ? (a.activityType.typeKey ?? null) : null,
      startLocal: a.startTimeLocal ?? null,
      durationSeconds: a.duration ?? null,
      avgHr: a.averageHR ?? null,
      maxHr: a.maxHR ?? null,
      trainingLoad: a.activityTrainingLoad ?? null,
    })) : [],

    warnings,
  };
}

/**
 * Map a snapshot to the app's canonical metric records for persistMetrics().
 * Scalars (restingHeartRate, hrv, respirationRate, spO2, sleep stages, bodyBattery,
 * dailyReadiness) feed MedicalProfile; the current HR feeds BiometricLog as a live
 * reading so the realtime algorithm has a value to react to.
 *
 * @returns {Array<{metric:string, value:number, unit:string, recordedAt:Date, source:string}>}
 */
function toCanonicalMetrics(snapshot, source = SOURCE) {
  const out = [];
  if (!snapshot) return out;
  const at = snapshot.fetchedAt ? new Date(snapshot.fetchedAt) : new Date();

  const scalar = (metric, value, unit) => {
    const n = Number(value);
    if (value == null || !Number.isFinite(n)) return;
    out.push({ metric, value: n, unit, recordedAt: at, source });
  };

  if (snapshot.heartRate) scalar('restingHeartRate', snapshot.heartRate.resting, 'bpm');
  if (snapshot.hrv) scalar('hrv', snapshot.hrv.lastNightAvg, 'ms');
  if (snapshot.respiration) scalar('respirationRate', snapshot.respiration.avg, 'brpm');
  if (snapshot.spo2) scalar('spO2', snapshot.spo2.avg, '%');
  if (snapshot.sleep) {
    if (snapshot.sleep.deepSeconds != null) scalar('sleepDeep', snapshot.sleep.deepSeconds / 60, 'min');
    if (snapshot.sleep.lightSeconds != null) scalar('sleepLight', snapshot.sleep.lightSeconds / 60, 'min');
    if (snapshot.sleep.remSeconds != null) scalar('sleepRem', snapshot.sleep.remSeconds / 60, 'min');
  }
  if (snapshot.bodyBattery) scalar('bodyBattery', snapshot.bodyBattery.mostRecent, 'score');
  if (snapshot.trainingReadiness) scalar('dailyReadiness', snapshot.trainingReadiness.score, 'score');

  if (snapshot.heartRate && snapshot.heartRate.current != null) {
    const hr = Number(snapshot.heartRate.current);
    if (Number.isFinite(hr)) out.push({ metric: 'heartRate', value: hr, unit: 'bpm', recordedAt: at, source });
  }

  return out;
}

module.exports = { isEnabled, login, restoreSession, fetchAllBiometrics, toCanonicalMetrics };
