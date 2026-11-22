'use strict';

/**
 * The Garmin music fence (BE-245, DEC-047, ADR-0018). CLOSED.
 *
 * Garmin's Health API data may not shape the music until Garmin permits it in writing. While this switch is
 * closed, the Garmin Health API lane (the server-to-server webhook, garminIngest.js) writes nothing a
 * generation reads: no BiometricLog row, no VitalSample row, no MedicalProfile field, no state-vector recompute
 * queued. As a second layer, the generation readers of VitalSample (biosonic/baselines.js, the daily-analysis
 * worker) exclude the fenced sources from their queries, so a row that reached the store some other way
 * still never moves a baseline, a state or a target.
 *
 * The fence is by LANE, not by the 'garmin' label alone (DT-4 L1): the phone's live heart rate (a BLE strap
 * or the Health Connect fallback, through watchHrIngest) is also stored in BiometricLog as source 'garmin'
 * (BE-031), so BiometricLog readers do NOT apply this fence. BE-031 must land before the switch is turned on.
 *
 * How it may be turned on, and only so: a reviewed PR that changes the one literal below from `false` to
 * `true`, which carries (1) Garmin's written permission for its data to shape music selection, filed as
 * OPS-331 says; (2) compliance-auditor's reading of that permission; and (3) the owner's own approval quoted
 * on the PR at its head SHA (a security switch, trigger T12; owner class (c)). It is a code constant on
 * purpose: not an env var, a flag or a database setting (no T8 wire contract, nothing a run can flip).
 * Only the literal `true` opens it; any other value, truthy or not, keeps it closed.
 */

const GARMIN_MAY_SHAPE_MUSIC = false;

const FENCED_SOURCES = Object.freeze(['garmin']);

/** True only when the literal above is exactly `true`. */
function garminMayShapeMusic() {
  return GARMIN_MAY_SHAPE_MUSIC === true;
}

/** The sources whose Health API values may not reach a generation store or reader. A fresh array each call. */
function fencedSources() {
  return garminMayShapeMusic() ? [] : [...FENCED_SOURCES];
}

/**
 * The filter a generation reader of VitalSample merges into its query. Permitted: the empty object, so a
 * permitted query is byte-identical to the unfenced one. Fenced: the fenced sources excluded. A fresh object
 * each call.
 */
function generationVitalQuery() {
  const fenced = fencedSources();
  return fenced.length ? { source: { $nin: fenced } } : {};
}

module.exports = Object.freeze({
  GARMIN_MAY_SHAPE_MUSIC,
  garminMayShapeMusic,
  fencedSources,
  generationVitalQuery,
});
