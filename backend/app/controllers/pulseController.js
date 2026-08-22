'use strict';

const MedicalProfile = require('../models/MedicalProfile');
const MorningState = require('../models/MorningState');
const { decrypt } = require('../utils/encryption');
const { byId } = require('../agents/runtime/knowledge/stateTaxonomy');
const { band } = require('../agents/runtime/physiology/affectEngine');
const { disabled } = require('../utils/envFlag');

// GET /api/pulse/state — the owner's live physiological snapshot for the Pulse screen
// (A11). Product ruling 2026-07-03: the OWNER may see their own decrypted numeric
// vitals, served via an EXPLICIT whitelist DTO — never document serialization, never
// persisted on device. MedicalProfile sets toJSON:{getters:true} and holds many more
// encrypted fields (spO2, gpsVelocity, hrZones…) that must NOT leave the server.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// W4-D43 (§0.4 S14) — WHY THIS ENDPOINT GREW TWO BLOCKS, AND WHY THEY LOOK NOTHING LIKE THE
// FIRST FIVE.
//
// W4-012 shipped a nightly consolidation into `MorningState` — readiness, sleep debt, a cosinor
// fit, CUSUM change-point flags — encrypted, TTL'd, erasure-registered, and read by absolutely
// nothing. A write-only collection is not a feature, it is a liability with a retention cost.
//
// The two additions here are a STRICT SUPERSET (§0.2.5): every pre-existing key keeps its exact
// value and meaning, so a client that has never heard of `morning` cannot tell the difference.
// `WAVE4_PULSE_SUPERSET_DISABLED` (S11) removes both keys and the extra read, restoring the
// previous response byte-for-byte without a revert.
//
// THE DISCLOSURE RULE, and where it comes from. The first five keys serve the owner their own
// decrypted vitals under the 2026-07-03 product ruling. The new two deliberately do NOT inherit
// that licence, because they are derived INFERENCES rather than readings, and inference is the
// part that reads as an assessment of a person (R10). MorningState's own encryption ruling is
// the specification: it encrypts every field carrying a physiological MAGNITUDE and leaves plain
// every field describing CONFIDENCE IN or the CATEGORY of an estimate. So the rule here is
// exactly that line, enforced in one direction —
//
//     no encrypted MorningState field leaves the server except as a coarse bucket.
//
// Readiness and the sleep-debt ratio are encrypted 0..1 magnitudes, so they ship as bands from
// the house vocabulary (`affectEngine.BAND_LABELS`) and never as scalars. The cosinor's M/A/phi
// are literally bpm and a clock hour, so only the fit's confidence and provenance ship. CUSUM's
// cPlus/cMinus are z-scaled deviations, so only the flag, its direction and the reference length
// ship — which is the entire thing the detector exists to say. `tests/wave4.pulseSuperset.test.js`
// pins this against the SCHEMA rather than a copied field list, so a field added to the model
// later is covered without anyone remembering to come back here.
//
// The affect block is read from `MedicalProfile.stateVector` — the pair `upsertStateVector`
// already persists — and NOT from the Redis posterior. Two reasons, both load-bearing: a GET must
// not advance the HMM (the posterior is a read-modify-write shared with the live lane, W4-D36),
// and the peeked blob carries no confidence at all — `affect.confidence` is computed from
// evidence AND entropy at update time and is recoverable only where it was stored. The state id
// itself never ships: the user-facing vocabulary for the ~34 taxonomy states is H6's decision,
// not this file's. `domain` and `band` are the closed coarse projections the mission already
// blesses, and they are what a screen actually needs to choose a colour and a shape.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** S11 escape hatch. Read per call — a switch that needs a redeploy is not an escape hatch. */
const supersetDisabled = () => disabled(process.env.WAVE4_PULSE_SUPERSET_DISABLED);

const NULL_STATE = () => ({
  stateVector: { status: null, confidence: null, computedAt: null },
  vitals: { hrv: null, bodyBattery: null, dailyReadiness: null, restingHeartRate: null },
  sleep: { lastNight: { deep: null, light: null, rem: null, date: null }, updatedAt: null },
  lastAnalyzed: null,
  sampleCount: 0,
});

// ── coarse projections (W4-D43) ─────────────────────────────────────────────────────────────

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A confidence is a number in [0,1] or nothing. A stored 5 is not 500% sure — it is a bug. */
const conf01 = (v) => { const n = finite(v); return n == null ? null : Math.min(1, Math.max(0, n)); };

/** A count is a non-negative integer or zero. */
const count = (v) => { const n = finite(v); return n == null ? 0 : Math.max(0, Math.trunc(n)); };

/**
 * A 0..1 magnitude as a coarse band, gated on the confidence that magnitude carries.
 *
 * `affectEngine.band()` supplies the cuts so the vocabulary the wire speaks is the SAME one the
 * telemetry lines speak, rather than a second scale that drifts from it. What is added here is a
 * finite/range guard it deliberately does not have: `band()` walks the cuts with `>=`, so a null
 * or NaN value falls straight through to the bottom label — a person the engine knows nothing
 * about would be shown as maximally unready, which is the `Number(null) === 0` failure this wave
 * has now found in three separate engines. No value, or no confidence, is `n/a`: no claim.
 */
function bucket(value, confidence) {
  const v = finite(value);
  const c = conf01(confidence);
  if (v == null || v < 0 || v > 1 || c == null || !(c > 0)) return 'n/a';
  return band(v, c);
}

const NULL_AFFECT = () => ({ domain: null, band: null, confidence: null, computedAt: null });

const NULL_DRIFT = () => ({ flagged: false, direction: null, referenceDays: 0 });

const NULL_MORNING = () => ({
  date: null,
  readinessBucket: 'n/a',
  readinessConfidence: null,
  sleepDebt: { bucket: 'n/a', nights: 0, confidence: null },
  cosinor: { confidence: null, source: null },
  drift: { rhr: NULL_DRIFT(), hrv: NULL_DRIFT() },
  v: null,
});

/**
 * `MedicalProfile.stateVector` → the coarse affect the Pulse screen may render.
 *
 * `stateConfidence` is null whenever the id came from the nine-rule fallback rather than the
 * affect engine, and it stays null here: the block reports domain and band from a degraded
 * classifier happily, but it does not borrow the legacy enum confidence to look better informed
 * than it is. A label the taxonomy cannot resolve is no label — an id nothing can look up is
 * worse than a null, because a consumer would fall through while looking supplied.
 */
function toAffectDTO(sv) {
  if (!sv || typeof sv !== 'object') return NULL_AFFECT();

  let stateId = null;
  if (typeof sv.stateId === 'string' && sv.stateId) {
    try { stateId = decrypt(sv.stateId); } catch { stateId = null; }
  }
  const entry = typeof stateId === 'string' ? byId(stateId) : null;

  return {
    domain: entry?.domain ?? null,
    band: entry?.band ?? null,
    confidence: conf01(sv.stateConfidence),
    computedAt: sv.computedAt instanceof Date ? sv.computedAt : null,
  };
}

/** One CUSUM branch → the flag, its direction and how much history stands behind it. */
function toDriftDTO(branch) {
  if (!branch || typeof branch !== 'object') return NULL_DRIFT();
  const dir = branch.direction;
  return {
    flagged: Boolean(branch.flagged),
    direction: dir === 'up' || dir === 'down' ? dir : null,
    referenceDays: count(branch.referenceDays),
  };
}

/** The latest `MorningState` row → buckets, confidences and counts. Never a magnitude. */
function toMorningDTO(doc) {
  if (!doc || typeof doc !== 'object') return NULL_MORNING();

  const sd = (doc.sleepDebt && typeof doc.sleepDebt === 'object') ? doc.sleepDebt : {};
  const cos = (doc.cosinor && typeof doc.cosinor === 'object') ? doc.cosinor : {};
  const cusum = (doc.cusum && typeof doc.cusum === 'object') ? doc.cusum : {};

  return {
    // Which local day this describes. The client needs it to say "this morning" honestly rather
    // than render a three-day-old consolidation as today's.
    date: doc.date instanceof Date ? doc.date : null,
    readinessBucket: bucket(doc.readiness, doc.readinessConfidence),
    readinessConfidence: conf01(doc.readinessConfidence),
    sleepDebt: {
      bucket: bucket(sd.ratio, sd.confidence), // the RATIO — minutes owed never leave the server
      nights: count(sd.nights),
      confidence: conf01(sd.confidence),
    },
    cosinor: {
      confidence: conf01(cos.confidence),
      source: cos.source === 'fit' || cos.source === 'prior' ? cos.source : null,
    },
    drift: { rhr: toDriftDTO(cusum.rhr), hrv: toDriftDTO(cusum.hrv) },
    v: finite(doc.v),
  };
}

function toPulseStateDTO(profile, { morning = null } = {}) {
  const base = toLegacyPulseDTO(profile);
  if (supersetDisabled()) return base;
  return { ...base, affect: toAffectDTO(profile?.stateVector), morning: toMorningDTO(morning) };
}

function toLegacyPulseDTO(profile) {
  if (!profile) return NULL_STATE();

  const sv = profile.stateVector || {};
  // status is a plain String stored PRE-encrypted by medicalProfileService — decrypt
  // it here; a corrupt/rotated blob degrades to null rather than throwing.
  let status = null;
  if (sv.status) {
    try { status = decrypt(sv.status); } catch { status = null; }
  }

  const ln = profile.lastNightSleep || {};
  return {
    stateVector: {
      status,
      confidence: sv.confidence != null ? sv.confidence : null,
      computedAt: sv.computedAt || null,
    },
    // encryptedNumber getters have already decrypted these on a real (non-lean) doc.
    vitals: {
      hrv: profile.hrv != null ? profile.hrv : null,
      bodyBattery: profile.bodyBattery != null ? profile.bodyBattery : null,
      dailyReadiness: profile.dailyReadiness != null ? profile.dailyReadiness : null,
      restingHeartRate: profile.restingHeartRate != null ? profile.restingHeartRate : null,
    },
    sleep: {
      lastNight: {
        deep: ln.deep != null ? ln.deep : null,
        light: ln.light != null ? ln.light : null,
        rem: ln.rem != null ? ln.rem : null,
        date: ln.date || null,
      },
      updatedAt: profile.sleepUpdatedAt || null,
    },
    lastAnalyzed: profile.lastAnalyzed || null,
    sampleCount: profile.sampleCount || 0,
  };
}

/**
 * The caller's most recent consolidated morning, or null.
 *
 * Sorted rather than computed from a local day index on purpose: the server does not reliably
 * know this user's timezone (mobile still does not emit `tzOffsetMinutes`), and a query keyed on
 * the WRONG midnight silently returns nothing at all. The row carries its own `date`, so the
 * client is told which day it is looking at instead of being left to assume.
 *
 * Fails soft. This block is additive; a Mongo hiccup on it must never take down an endpoint that
 * served vitals perfectly well yesterday.
 */
async function latestMorningState(userId) {
  try {
    // Non-lean: the encryptedNumber getters must run to decrypt before bucketing.
    return await MorningState.findOne({ userId }).sort({ date: -1 });
  } catch (e) {
    // Type only — a driver message can quote the document that choked it (§0.2.2).
    console.error(`[pulse] morning state read failed: ${e?.name || 'Error'}`);
    return null;
  }
}

exports.getPulseState = async (req, res, next) => {
  try {
    const userId = req.user._id;
    // Non-lean: the encryptedNumber getters must run to decrypt the vitals.
    const profile = await MedicalProfile.findOne({ userId });
    // The kill switch skips the second read as well — an escape hatch that still pays the cost
    // it was added to remove is not one.
    const morning = supersetDisabled() ? null : await latestMorningState(userId);
    res.json(toPulseStateDTO(profile, { morning }));
  } catch (err) {
    next(err);
  }
};

exports.toPulseStateDTO = toPulseStateDTO;
exports.toAffectDTO = toAffectDTO;
exports.toMorningDTO = toMorningDTO;
