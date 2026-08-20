'use strict';

/**
 * The runtime agents' telemetry contract (W4-003).
 *
 * Every runtime agent under `app/agents/runtime/` speaks this shape, so a signal that has
 * been through the ingestion filter can cross an agent boundary without each consumer
 * re-deriving what a "reading" is. Two schemas, one asymmetry that is deliberate:
 *
 *   · TelemetryRaw   — what arrives. `z.object`, so UNKNOWN KEYS ARE DROPPED. The socket
 *                      payload is attacker-controlled and every shipped client predates
 *                      this contract, so a forward-compatible strip is the hygienic answer:
 *                      unknown data never reaches an engine, and a client that grows a
 *                      field does not take ingestion down.
 *   · TelemetryClean — what we emit. `z.strictObject`, so an unexpected key is a HARD
 *                      ERROR. This one is our own output: an extra field here is a bug in
 *                      our code, and the field most likely to appear by accident is a raw
 *                      vital (§0.2.2). Failing loudly is the whole point.
 *
 * ZERO-KNOWLEDGE. `value` on the clean DTO is a FILTERED estimate that stays inside the
 * worker/socket scope; nothing in this module authorises putting it in a log line, an LLM
 * prompt or a Redis key. The DTO exists so the coarse projections downstream (bands,
 * targets, state labels) have one honest source, not so the number can travel.
 *
 * NO MONGOOSE. A pure contract must not drag a database driver into the agent runtime, so
 * the activity/source vocabularies are declared here rather than imported from
 * BiometricLog. `tests/anomalyFilter.test.js` pins the two lists equal, so the duplication
 * is guarded rather than hoped about (the W4-D11 rule: a control, not a footnote).
 */

const { z } = require('zod');

// Bumped when a persisted/queued telemetry blob changes shape (S15).
const TELEMETRY_DTO_VERSION = 1;

// Every metric the runtime handles. `heartRate` is the only one live in W4-003; the rest
// are the VitalSample metric set W4-004 writes, declared now so the contract does not need
// a v2 one task later.
const METRICS = Object.freeze([
  'heartRate',
  'hrv',
  'restingHeartRate',
  'respirationRate',
  'spO2',
  'bodyBattery',
  'stressLevel',
]);

// Kept byte-identical to BiometricLog's enums (see the drift guard in the test suite).
const ACTIVITIES = Object.freeze([
  'resting', 'walking', 'running', 'cycling', 'swimming', 'strength', 'unknown',
]);
const SOURCES = Object.freeze(['garmin', 'apple_health', 'health_connect', 'suunto']);

// §0.4 S6: UTC-14:00 (Line Islands) to UTC-14:00 the other way round — the real world's
// offsets live in [-12:00, +14:00], i.e. [-720, +840] minutes WEST-negative. We store the
// JS convention (Date#getTimezoneOffset is inverted), so the admissible band is
// [-840, +720]. Anything outside is a client bug or a spoof, never a place.
const TZ_OFFSET_MIN = -840;
const TZ_OFFSET_MAX = 720;

const userId = z.string().min(1);
const metric = z.enum(METRICS);
const source = z.enum(SOURCES);
// Nullable, not optional: an unlabelled reading is honest, and D2 is the story of what
// happens when `unknown` is silently treated as a real label.
const activity = z.enum(ACTIVITIES).nullable();
// z.number() in zod 4 already rejects NaN and +/-Infinity; .finite() states the intent.
const finite = z.number().finite();
const recordedAt = z.date();
const tzOffsetMinutes = z.number().int().min(TZ_OFFSET_MIN).max(TZ_OFFSET_MAX);

const TelemetryRawSchema = z.object({
  v: z.literal(TELEMETRY_DTO_VERSION),
  userId,
  metric,
  value: finite,
  source,
  recordedAt,
  activity: activity.optional(),
  tzOffsetMinutes: tzOffsetMinutes.optional(),
});

const TelemetryCleanSchema = z.strictObject({
  v: z.literal(TELEMETRY_DTO_VERSION),
  userId,
  metric,
  /** Filtered level in the metric's own unit (bpm for heartRate). */
  value: finite,
  /** Filtered slope in units PER SECOND — the Kalman trend state, not a per-minute figure. */
  trend: finite,
  /** [0, 1]. How much of this reading the downstream engines are entitled to believe. */
  confidence: z.number().min(0).max(1),
  activity,
  source,
  recordedAt,
});

/**
 * Assemble an anomalyFilter result into a validated TelemetryClean.
 *
 * THROWS on an invalid DTO rather than returning a partial one: a telemetry record that
 * cannot be validated is a record that must not enter the pipeline, and the alternative
 * (a silently-dropped field) is exactly the class of failure W4-D08 was.
 *
 * @param {{userId:string, metric:string, source:string, activity?:string|null, recordedAt:Date}} parts
 * @param {{level:number, trend:number, confidence:number}} filtered
 */
function toTelemetryClean(parts, filtered) {
  return TelemetryCleanSchema.parse({
    v: TELEMETRY_DTO_VERSION,
    userId: parts?.userId,
    metric: parts?.metric,
    value: filtered?.level,
    trend: filtered?.trend,
    confidence: filtered?.confidence,
    activity: parts?.activity ?? null,
    source: parts?.source,
    recordedAt: parts?.recordedAt,
  });
}

module.exports = {
  TELEMETRY_DTO_VERSION,
  METRICS,
  ACTIVITIES,
  SOURCES,
  TZ_OFFSET_MIN,
  TZ_OFFSET_MAX,
  TelemetryRawSchema,
  TelemetryCleanSchema,
  toTelemetryClean,
};
