'use strict';

/**
 * The Garmin personal lane's input contract (T2).
 *
 * The personal lane maps Garmin's Connect Personal API onto the Health API's summary shapes and hands
 * them to the ingest seam the webhook already uses (garminIngest.ingestSummaries), so nothing behind
 * the seam depends on which lane fed it. This module is the gate in front of that seam:
 *
 *   · ALLOWLIST. Each summary type keeps only the fields the normaliser reads. Every other key is
 *     stripped: location first of all (starting coordinates, polylines, positioned samples, place
 *     names; R3, no GPS) and anything Garmin adds later, so none of it reaches a log, a store or an
 *     engine. Steps are stripped too, because nothing reads them yet (R4).
 *   · CAPS. At most MAX_ITEMS items; at most MAX_ENTRIES entries in any offset map or sleep-level
 *     list (a whole day of 15-second heart rate is 5760); nothing stamped more than five minutes past
 *     the server's clock.
 *   · ZERO-KNOWLEDGE ERRORS. A rejection is an Error whose message and `code` are one entry of
 *     ENVELOPE_ERROR_CODES, and it carries nothing else. zod's own issues quote paths, keys and
 *     expected values, and an offset map's keys are payload, so no issue ever leaves this module.
 *
 * The wrapper is ours and strict: an envelope has exactly `schemaVersion` and `items`, an item has
 * exactly `type` and `summary`, and an extra key there is a bug upstream, so it is refused. A
 * summary's extra keys are Garmin's, and they are dropped, and a field Garmin sends as null is absent
 * (BE-189). A night, or a night's HRV, must say where it ends (BE-190).
 *
 * ALL OR NOTHING. One refused item refuses the whole envelope. A caller that must keep a good item when
 * its sibling is bad (the personal pull job, T4) wraps ONE item per envelope and reports a refusal by the
 * item's index (BE-189; pinned in tests/shadow.garminEnvelope.boundaries.test.js).
 */

const { z } = require('zod');
// A night, or a night's HRV window, longer than a day is not a night: the normaliser's own bound, so
// the envelope admits exactly the windows the normaliser can end a night on, and where a night ends is
// the normaliser's own definition (BE-190). The future allowance is the one the Health Connect batch
// contract and the store's future cap use (BE-206).
const {
  MAX_WINDOW_SECONDS, MAX_FUTURE_SKEW_MS, GARMIN_NIGHT_TYPES, garminNightEndSec,
} = require('./adapter');

const GARMIN_PERSONAL_ENVELOPE_VERSION = 1;
// Stress and Body Battery join behind their consent gate (T11); nothing else is in Phase 1's scope.
const GARMIN_PERSONAL_TYPES = Object.freeze(['dailies', 'sleeps', 'hrv']);
const MAX_ITEMS = 50;
const MAX_ENTRIES = 6000;

const ENVELOPE_ERROR_CODES = Object.freeze([
  'invalid_garmin_envelope',
  'unsupported_garmin_envelope_version',
  'garmin_envelope_too_large',
  'unknown_garmin_summary_type',
  'garmin_summary_too_large',
  'invalid_garmin_summary',
  'garmin_summary_in_future',
]);

const SLEEP_LEVELS = Object.freeze(['deep', 'light', 'rem', 'awake']);

// zod 4's number already refuses NaN and ±Infinity. Ranges stay the normaliser's job, so a reading
// Garmin marks invalid (-1) passes here and is dropped, and counted, there.
const reading = z.number();
const epochSeconds = z.number().int().nonnegative();
const windowSeconds = z.number().int().positive().max(MAX_WINDOW_SECONDS);
// { offsetSeconds: reading }. A key that is not a whole number of seconds cannot be placed in time.
const offsetMap = z.record(z.string().regex(/^\d+$/), reading);
const segment = z.object({ startTimeInSeconds: epochSeconds, endTimeInSeconds: epochSeconds })
  .refine((s) => s.endTimeInSeconds >= s.startTimeInSeconds);
const sleepLevelsMap = z.object(Object.fromEntries(SLEEP_LEVELS.map((level) => [level, z.array(segment).optional()])));

const common = {
  startTimeInSeconds: epochSeconds,
  startTimeOffsetInSeconds: z.number().int().optional(),
};

// z.object strips every key it does not name, at every depth it describes.
const SUMMARY_SCHEMAS = Object.freeze({
  dailies: z.object({
    ...common,
    restingHeartRateInBeatsPerMinute: reading.optional(),
    timeOffsetHeartRateSamples: offsetMap.optional(),
  }),
  sleeps: z.object({
    ...common,
    durationInSeconds: windowSeconds.optional(),
    deepSleepDurationInSeconds: reading.optional(),
    lightSleepDurationInSeconds: reading.optional(),
    remSleepInSeconds: reading.optional(),
    remSleepDurationInSeconds: reading.optional(), // the name variant the normaliser also reads
    sleepLevelsMap: sleepLevelsMap.optional(),
  }),
  hrv: z.object({
    ...common,
    durationInSeconds: windowSeconds.optional(),
    lastNightAvg: reading.optional(),
  }),
});

const GARMIN_PERSONAL_FIELDS = Object.freeze(Object.fromEntries(
  GARMIN_PERSONAL_TYPES.map((type) => [type, Object.freeze(Object.keys(SUMMARY_SCHEMAS[type].shape))]),
));

const EnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(GARMIN_PERSONAL_ENVELOPE_VERSION),
  items: z.array(z.unknown()),
});

const ItemSchema = z.strictObject({
  type: z.string(),
  summary: z.record(z.string(), z.unknown()),
});

function envelopeError(code) {
  return Object.assign(new Error(code), { code });
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The size of each collection a type carries, counted on the raw summary BEFORE zod walks it.
function entryCounts(type, summary) {
  const size = (v) => {
    if (Array.isArray(v)) return v.length;
    return isPlainObject(v) ? Object.keys(v).length : 0;
  };
  if (type === 'dailies') return [size(summary.timeOffsetHeartRateSamples)];
  if (type === 'sleeps' && isPlainObject(summary.sleepLevelsMap)) {
    return SLEEP_LEVELS.map((level) => size(summary.sleepLevelsMap[level]));
  }
  return [];
}

// The latest moment a parsed summary vouches for: its start, the end of its window, its last reading
// and its last sleep segment (a segment never ends before it starts).
function latestSecond(summary) {
  let latest = summary.startTimeInSeconds;
  const see = (sec) => { if (sec > latest) latest = sec; };
  if (summary.durationInSeconds !== undefined) see(summary.startTimeInSeconds + summary.durationInSeconds);
  for (const offset of Object.keys(summary.timeOffsetHeartRateSamples || {})) {
    see(summary.startTimeInSeconds + Number(offset));
  }
  for (const segments of Object.values(summary.sleepLevelsMap || {})) {
    for (const s of segments || []) see(s.endTimeInSeconds);
  }
  return latest;
}

// BE-189 (RA-1): Garmin sends an optional field it has no value for as null, and zod's .optional() admits
// only a missing key, so one null refused the item and, with it, the envelope. A null FIELD is an absent
// one: dropped from the summary and from its sleep-level map, the two places whose keys are optional
// fields. A null inside an offset map or a segment is a value, and stays refused. Builds a copy.
function withoutNulls(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null));
}

function withoutNullFields(summary) {
  const out = withoutNulls(summary);
  if (isPlainObject(out.sleepLevelsMap)) out.sleepLevelsMap = withoutNulls(out.sleepLevelsMap);
  return out;
}

function parseItem(raw, nowMs) {
  const item = ItemSchema.safeParse(raw);
  if (!item.success) throw envelopeError('invalid_garmin_envelope');
  const { type, summary } = item.data;
  if (!GARMIN_PERSONAL_TYPES.includes(type)) throw envelopeError('unknown_garmin_summary_type');
  if (entryCounts(type, summary).some((n) => n > MAX_ENTRIES)) throw envelopeError('garmin_summary_too_large');
  const parsed = SUMMARY_SCHEMAS[type].safeParse(withoutNullFields(summary));
  if (!parsed.success) throw envelopeError('invalid_garmin_summary');
  if (latestSecond(parsed.data) * 1000 > nowMs + MAX_FUTURE_SKEW_MS) throw envelopeError('garmin_summary_in_future');
  // BE-190 (RA-2): a night is filed where it ENDS. One that cannot say where it ends would be stamped at
  // its start by the normaliser's fallback, the mis-dating #273 fixed, so this lane refuses it.
  if (GARMIN_NIGHT_TYPES.includes(type) && garminNightEndSec(type, parsed.data) === null) {
    throw envelopeError('invalid_garmin_summary');
  }
  return { type, summary: parsed.data };
}

/**
 * @param {unknown} input  the envelope the personal-API mapper built
 * @param {{now?: Date}} [options]  the clock the future cap is measured against
 * @returns {{schemaVersion: number, items: Array<{type: string, summary: object}>}}  a copy that
 *   holds only allowlisted fields, ready for garminIngest.ingestSummaries
 * @throws {Error} whose `code` and message are one entry of ENVELOPE_ERROR_CODES, and nothing else
 */
function parseGarminPersonalEnvelope(input, { now = new Date() } = {}) {
  if (!isPlainObject(input)) throw envelopeError('invalid_garmin_envelope');
  if (input.schemaVersion !== GARMIN_PERSONAL_ENVELOPE_VERSION) {
    throw envelopeError('unsupported_garmin_envelope_version');
  }
  const envelope = EnvelopeSchema.safeParse(input);
  if (!envelope.success) throw envelopeError('invalid_garmin_envelope');
  if (envelope.data.items.length > MAX_ITEMS) throw envelopeError('garmin_envelope_too_large');
  const nowMs = now.getTime();
  return {
    schemaVersion: GARMIN_PERSONAL_ENVELOPE_VERSION,
    items: envelope.data.items.map((item) => parseItem(item, nowMs)),
  };
}

module.exports = {
  parseGarminPersonalEnvelope,
  GARMIN_PERSONAL_ENVELOPE_VERSION,
  GARMIN_PERSONAL_TYPES,
  GARMIN_PERSONAL_FIELDS,
  ENVELOPE_ERROR_CODES,
  MAX_ITEMS,
  MAX_ENTRIES,
  MAX_FUTURE_SKEW_MS,
};
