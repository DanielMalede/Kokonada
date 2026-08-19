'use strict';

const MedicalProfile = require('../../models/MedicalProfile');
const { peekBaselines } = require('../biosonic/baselines');
const { translate } = require('../biosonic/translate');
const { peekAffectState, saveAffectState } = require('../biosonic/affectCache');
const { localHour } = require('../../agents/runtime/physiology/baselineEngine');
const { updateAffect } = require('../../agents/runtime/physiology/affectEngine');
const { STATES } = require('../../agents/runtime/knowledge/stateTaxonomy');
const wellbeingRegulator = require('../../agents/runtime/translation/wellbeingRegulator');

// Assemble the biosonic targets from everything the system knows: cached personal
// baselines (never the heavy compute — request path), the profile's encrypted
// scalars (getters decrypt), last-night sleep, and the live reading. Every source is
// best-effort: translate() degrades confidence, never throws. This is the ONE place
// biosonic model I/O happens — translate()/biosonic/ stay PURE. Extracted from the
// orchestrator so the same band can be computed ONCE and shared by discovery + the
// selection pipeline (no double translate, no drift).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// W4-006 (seam half) — THE AFFECT LAYER JOINS HERE, AND ONLY HERE.
//
// Because this is the single place biosonic I/O happens, it is the only place the affect layer
// can join without creating a second source of truth. The shape is:
//
//     peek carried posterior → updateAffect(live evidence) → translate() → regulator → save
//
// READ-UPDATE-WRITE, not read-only. The mission's wording also permits a pure peek of an affect
// blob written by the nightly worker, and that was rejected on measurement: the worker holds no
// live heart rate, so arousal, stress and exertion all abstain, overall confidence lands below
// the regulator's MIN_REGULATION_CONFIDENCE floor, and the entire seam would be a no-op that
// reports success. What IS cached is the one quantity a single reading cannot reconstruct — the
// HMM posterior — which is exactly the `(state, input, opts) → {state, result}` contract
// `updateAffect` was written against.
//
// EVERY new dependency is best-effort, which is this file's standing contract rather than a new
// concession: a Redis outage, a corrupt posterior or a throw anywhere in the affect layer costs
// the listener their regulation for one generation, never their playlist.
//
// TWO SEPARATE KILL SWITCHES (§0.4 S11), deliberately not one:
//   · WAVE4_AFFECT_DISABLED     — the whole layer is skipped. No peek, no compute, no write.
//   · WAVE4_TRAJECTORY_DISABLED — the posterior still advances, but the target is not decorated.
// The second exists because turning off what a listener HEARS should not also blind W4-009's
// transition detector or force every user back to a cold prior when the flag is lifted.

/** S11 escape hatches. Read per call — a switch needing a redeploy is not an escape hatch. */
const affectDisabled = () => Boolean(process.env.WAVE4_AFFECT_DISABLED);
const trajectoryDisabled = () => Boolean(process.env[wellbeingRegulator.DISABLE_ENV_VAR]);

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * WHICH HOUR IS IT FOR THIS LISTENER? (D13's serving-path half)
 *
 * `translate()`'s wind-down and the affect engine's circadian axis both key off hour-of-day, and
 * until now that hour was the SERVER's — a user in Auckland got Frankfurt's evening. W4-004 made
 * the habitual offset available on the baseline blob (the modal non-null `tzOffsetMinutes` across
 * their samples), so when it is known it is used.
 *
 * When it is NOT known — which is every shipped client today, since mobile does not yet emit the
 * offset — the fallback is the SERVER's own offset, not zero. Zero is UTC, which is a different
 * hour from the server's for most of the world, so defaulting to it would silently move every
 * existing user's wind-down window while looking like a no-op. Returning the server offset makes
 * `localHour` reproduce `new Date(now).getHours()` exactly, which is what today does.
 *
 * Returning BOTH values matters: translate and the affect engine must agree about what time it is,
 * and they take the answer in different units.
 */
function resolveHourContext(now, baselines) {
  const declared = finite(baselines?.tzOffsetMinutes);
  const tzOffsetMinutes = declared != null ? declared : -new Date(now).getTimezoneOffset();
  return { tzOffsetMinutes, hourOfDay: Math.floor(localHour(now, tzOffsetMinutes)) };
}

/**
 * Run the affect layer for this generation. Returns the AffectState the regulator consumes, or
 * null when there is nothing honest to say. Never throws — the caller has a playlist to serve.
 */
async function _resolveAffect({ userId, live, baselines, state, sleep, taps, tzOffsetMinutes, now }) {
  try {
    const carried = await peekAffectState(userId, { now });
    const step = updateAffect(
      carried,
      { live, baselines: baselines ?? {}, state, sleep, taps, tzOffsetMinutes },
      { now, states: STATES },
    );
    // Fire-and-forget: the posterior is a convenience for the NEXT generation, and waiting on a
    // cache write to serve this one would trade a real latency budget for a speculative benefit.
    Promise.resolve(saveAffectState(userId, step.state)).catch(() => {});
    return step.affect;
  } catch (e) {
    // Type only — an engine validation message can quote the evidence that failed it, and on this
    // path that evidence is a vital (§0.2.2).
    console.error(`[affect] serving-path update failed: ${e?.name || 'Error'}`);
    return null;
  }
}

async function buildTargets({ userId, live = {}, moodKey = null, taps = null, now = Date.now() } = {}) {
  let baselines = null;
  try { baselines = await peekBaselines(userId); } catch { /* degrade */ }

  let sleep = {};
  let state = {};
  try {
    const profile = await MedicalProfile.findOne({ userId });
    if (profile) {
      if (profile.lastNightSleep && (profile.lastNightSleep.deep != null || profile.lastNightSleep.light != null)) {
        sleep = {
          lastNight: {
            deep:  profile.lastNightSleep.deep,
            light: profile.lastNightSleep.light,
            rem:   profile.lastNightSleep.rem,
          },
        };
      }
      state = {
        hrv:            profile.hrv,
        bodyBattery:    profile.bodyBattery,
        dailyReadiness: profile.dailyReadiness,
      };
    }
  } catch { /* degrade */ }

  const { hourOfDay, tzOffsetMinutes } = resolveHourContext(now, baselines);

  const targets = translate({
    live,
    baselines: baselines ?? {},
    sleep,
    state,
    hourOfDay,
    moodKey,
  });

  if (affectDisabled()) return targets;

  const affect = await _resolveAffect({
    userId, live, baselines, state, sleep, taps, tzOffsetMinutes, now,
  });

  // No `if (!affect) return targets` guard here on purpose. It was written, and the stub-out
  // battery proved it unfalsifiable: `apply` already returns the SAME object for a null affect,
  // an unknown label or a sub-threshold confidence, and does so as a documented contract with its
  // own pins behind it. A second guard that can never fire is not defence in depth, it is a line
  // nobody can test — so the guarantee is pinned at THIS seam (object identity on a failed affect)
  // rather than duplicated in code.
  return wellbeingRegulator.apply(targets, affect, { disabled: trajectoryDisabled() });
}

module.exports = { buildTargets, resolveHourContext };
