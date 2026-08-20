'use strict';

const MedicalProfile = require('../../models/MedicalProfile');
const { peekBaselines } = require('../biosonic/baselines');
const { translate } = require('../biosonic/translate');
const { resolveAffect, resolveHourContext } = require('../biosonic/affectService');
const wellbeingRegulator = require('../../agents/runtime/translation/wellbeingRegulator');
const { explainFor } = require('../../agents/runtime/knowledge/explain');

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

/**
 * S11 escape hatch for the DECORATION only. `WAVE4_AFFECT_DISABLED` is honoured one level down,
 * inside `resolveAffect`, so the whole layer cannot be half-wired; this flag stops the listener
 * hearing the regulation while the posterior keeps advancing for W4-009 and the soak.
 * Read per call — a switch that needs a redeploy is not an escape hatch.
 */
const trajectoryDisabled = () => Boolean(process.env[wellbeingRegulator.DISABLE_ENV_VAR]);

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

  const affect = await resolveAffect({
    userId, live, baselines, state, sleep, taps, tzOffsetMinutes, now,
  });

  // No `if (!affect) return targets` guard here on purpose. It was written, and the stub-out
  // battery proved it unfalsifiable: `apply` already returns the SAME object for a null affect,
  // an unknown label or a sub-threshold confidence, and does so as a documented contract with its
  // own pins behind it. A second guard that can never fire is not defence in depth, it is a line
  // nobody can test — so the guarantee is pinned at THIS seam (object identity on a failed affect)
  // rather than duplicated in code.
  const decorated = wellbeingRegulator.apply(targets, affect, { disabled: trajectoryDisabled() });

  // S13: the "why this mix" line is resolved HERE, where the axes are, and travels onward as a
  // vetted string. `explainFor` withholds it whenever the sentence would claim an axis that
  // abstained, so the socket layer cannot render something the evidence does not support — it has
  // no evidence to check against, which is exactly why the decision does not belong there.
  //
  // Only on a target the regulator actually decorated: if it declined (no state, or a confidence
  // too low to act on), the mix was not shaped by a state and a line explaining one would be
  // describing something that never happened.
  if (decorated === targets) return targets;
  const explain = explainFor(affect);
  return explain ? { ...decorated, explain } : decorated;
}

// `resolveHourContext` is re-exported (it lives in affectService, next to the engine that
// shares its clock rule) so callers and tests have one import for the generation seam.
module.exports = { buildTargets, resolveHourContext };
