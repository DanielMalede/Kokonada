'use strict';

const { peekAffectState, saveAffectState } = require('./affectCache');
const { localHour } = require('../../agents/runtime/physiology/baselineEngine');
const { updateAffect } = require('../../agents/runtime/physiology/affectEngine');
const { STATES } = require('../../agents/runtime/knowledge/stateTaxonomy');
const { disabled } = require('../../utils/envFlag');

/**
 * W4-006 (seam half) — THE ONE WAY AFFECT IS COMPUTED, ON EVERY LANE.
 *
 * Two callers need the affect layer and they arrive from opposite directions: the serving path
 * (`targetsBuilder.buildTargets`) has a live reading and needs an answer in milliseconds, and the
 * nightly refresh (`stateVector.worker`) has no reading at all and needs the posterior kept alive
 * for a user who has not generated anything today. Giving each its own composition would let the
 * stored state and the served state disagree about the same person within the same minute, which
 * is the drift the pure core's injected-state-set port was designed to prevent — undone at the
 * wiring layer, where nobody would look for it.
 *
 * So the peek → update → save cycle lives here once. The callers differ only in what evidence
 * they can honestly supply.
 *
 * S9: `now` is a required parameter. S11: `WAVE4_AFFECT_DISABLED` is honoured HERE rather than at
 * each call site, so the switch cannot be half-wired.
 */

/** S11 escape hatch. Read per call — a switch that needs a redeploy is not an escape hatch. */
const affectDisabled = () => disabled(process.env.WAVE4_AFFECT_DISABLED);

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * WHICH HOUR IS IT FOR THIS LISTENER? (D13's serving-path half)
 *
 * `translate()`'s wind-down and the affect engine's circadian axis both key off hour-of-day, and
 * until now that hour was the SERVER's — a user in Auckland got Frankfurt's evening. W4-004 made
 * the habitual offset available on the baseline blob (the modal non-null `tzOffsetMinutes` across
 * the user's own samples), so when it is known it is used.
 *
 * When it is NOT known — which is every shipped client today, since mobile does not yet emit the
 * offset — the fallback is the SERVER's own offset, not zero. Zero is UTC, which is a different
 * hour from the server's for most of the world, so defaulting to it would silently move every
 * existing user's wind-down window while looking like a no-op. Returning the server offset makes
 * `localHour` reproduce `new Date(now).getHours()` exactly, which is what today does.
 *
 * Both values are returned because translate and the affect engine must agree about what time it
 * is, and they take the answer in different units.
 */
function resolveHourContext(now, baselines) {
  const declared = finite(baselines?.tzOffsetMinutes);
  const tzOffsetMinutes = declared != null ? declared : -new Date(now).getTimezoneOffset();
  return { tzOffsetMinutes, hourOfDay: Math.floor(localHour(now, tzOffsetMinutes)) };
}

/**
 * Advance this user's affect posterior with whatever evidence the caller has, and return the
 * `AffectState` projection. Returns null when there is nothing honest to say — the kill switch,
 * or any failure at all.
 *
 * NEVER THROWS. Both callers have something better to do than fail: the serving path owes a
 * playlist, the worker owes a baseline refresh.
 */
async function resolveAffect({
  userId, live = {}, baselines = null, state = {}, sleep = {}, taps = null,
  tzOffsetMinutes = 0, now,
} = {}) {
  if (affectDisabled()) return null;

  try {
    const carried = await peekAffectState(userId, { now });
    const step = updateAffect(
      carried,
      { live, baselines: baselines ?? {}, state, sleep, taps, tzOffsetMinutes },
      { now, states: STATES },
    );
    // Fire-and-forget: the posterior is a convenience for the NEXT update, and blocking a
    // response on a cache write trades a real latency budget for a speculative benefit.
    Promise.resolve(saveAffectState(userId, step.state)).catch(() => {});
    return step.affect;
  } catch (e) {
    // Type only — an engine validation message can quote the evidence that failed it, and on this
    // path that evidence is a vital (§0.2.2).
    console.error(`[affect] update failed: ${e?.name || 'Error'}`);
    return null;
  }
}

module.exports = { resolveAffect, resolveHourContext };
