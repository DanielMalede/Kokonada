'use strict';

const { getRedis } = require('../../../config/redis');
const { resolveAffect } = require('../../../services/biosonic/affectService');
const { bandOf, policyOf } = require('../knowledge/stateTaxonomy');

/**
 * W4-009 — the live socket lane's O(1) per-reading state update.
 *
 * `handleBiometricReading` gets one FILTERED reading at a time and needs to know, right now,
 * whether the listener's taxonomy state just changed enough to matter for what is playing. The
 * whole temporal layer that answers that — sticky transitions, dwell priors, the four-gate
 * hysteresis — already exists in `affectEngine`, and the ONE composition that peeks the carried
 * posterior, advances it and saves it back already exists in `affectService.resolveAffect`. This
 * module adds nothing to that math; it exists to (a) shape a bare `{level, confidence}` reading
 * into the evidence shape the engine expects, and (b) decide whether the resulting transition is
 * a REGIME CHANGE — a different musical `band` or `musicPolicy` — which is the only kind of
 * transition worth interrupting a listener for (D11's full fix).
 *
 * BOUNDARY WITH W4-006 (`affectCache`'s own note): this shares the SAME `bio:affect:<userId>`
 * key as the serving path. One user has one posterior, not two that quietly disagree — this
 * module owns the update CADENCE (one call per filtered reading), not the storage.
 *
 * FAIL-SOFT BY CONSTRUCTION. Redis down means no carried posterior, and a stateless one-shot
 * classification on every reading is not a degraded version of this mechanism, it is a DIFFERENT
 * and much noisier one: with no `alpha` to carry, every reading looks like a fresh cold start,
 * so `transitioned` would flip on nearly every call — the exact churn the dwell gate exists to
 * prevent. So a missing Redis client short-circuits to `ok: false` before any engine work runs,
 * and the caller degrades to its own HR-band trigger instead (§0.4 S11's named fallback).
 */

const EMPTY_RESULT = Object.freeze({
  ok: false, transitioned: false, from: null, to: null, band: null, regimeChanged: false,
});

/**
 * Do two states disagree about what the mix should sound like? Compared field-by-field rather
 * than by object identity: `textureBias` is a fresh frozen object PER STATE, so two different
 * states' policies are never `===` even when (coincidentally) every field matches.
 */
function policyDiffers(a, b) {
  if (a === b) return false;
  if (!a || !b) return true;
  return a.energyBias !== b.energyBias
    || a.valenceApproach !== b.valenceApproach
    || a.trajectoryArchetype !== b.trajectoryArchetype
    || a.textureBias?.acousticness !== b.textureBias?.acousticness
    || a.textureBias?.instrumentalness !== b.textureBias?.instrumentalness;
}

/**
 * Advance this user's carried posterior with one filtered reading and report whether it just
 * crossed into a different regime. NEVER THROWS — `resolveAffect` already guarantees that, and
 * this module adds no new failure surface on top of it.
 *
 * @param {string} userId
 * @param {{level: number|null, confidence?: number, degraded?: string|null}} filteredReading —
 *   the A0 filter's own output shape (`anomalyFilter.filterReading`'s `result`).
 * @param {{activity?: string|null, now: number, baselines?: object|null}} opts — S9: `now` is
 *   required (epoch ms). `baselines` (W4-015) is the caller's best-effort `peekBaselines(userId)`
 *   read: without it, every axis keyed to a personal hour-of-day baseline (arousal, exertion's
 *   measured term, stress, recovery, fatigue) has nothing to compare the reading against and
 *   abstains — the soak that found this ran every persona through a whole simulated day and
 *   watched them all settle into the SAME low-confidence default state, because nothing had ever
 *   passed a baseline through this seam. Omitted → forwarded as `null`, exactly today's shape.
 */
async function onlineUpdate(userId, filteredReading = {}, opts = {}) {
  if (!getRedis()) return EMPTY_RESULT;

  const { activity = null, now, baselines = null } = opts;
  const affect = await resolveAffect({
    userId,
    live: {
      heartRate: filteredReading?.level ?? null,
      confidence: filteredReading?.confidence,
      degraded: filteredReading?.degraded ?? null,
      activity,
    },
    baselines,
    now,
  });
  if (!affect) return EMPTY_RESULT;

  const { transitioned, from, to } = affect;
  const regimeChanged = Boolean(
    transitioned && to
    && (bandOf(to) !== bandOf(from) || policyDiffers(policyOf(to), policyOf(from))),
  );

  return {
    ok: true, transitioned, from, to, band: bandOf(to), regimeChanged,
  };
}

module.exports = { onlineUpdate, policyDiffers };
