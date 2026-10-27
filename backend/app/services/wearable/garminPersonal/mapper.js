'use strict';

/**
 * Garmin Connect Personal API responses → Garmin Health API summaries (T3).
 *
 * The personal lane feeds the same seam the Health API webhook feeds (garminIngest.ingestSummaries,
 * then adapter.js normalizeGarminSummaries), so each response becomes the Health API summary that
 * normaliser reads: startTimeInSeconds (UTC epoch seconds), startTimeOffsetInSeconds (local minus
 * UTC, in seconds), durationInSeconds, and offset maps keyed by whole seconds from the start. Every
 * summary carries a durationInSeconds: a night ENDS at start + duration, and the normaliser files a
 * night by its end.
 *
 * Each summary is BUILT field by field from an allowlist; nothing in a response is copied whole. A
 * user id, a free-text note, SpO2, respiration, scores, statuses, "abnormal" thresholds, naps,
 * activity events and any location never come out, and stripLocationKeys runs over every summary
 * as well, so a field added here later cannot carry a coordinate out either.
 *
 * SOURCES, read on 2026-10-26
 *   Garmin's Personal API Swagger: OpenAPI 3.0.1, "Garmin Connect Personal API" 1.0.0, served at
 *   developer.garmin.com/gc-developer-program/personal/swagger-docs/. Garmin's own client:
 *   github.com/garmin/connect-personal-api-python at commit ac111a0 (Apache-2.0).
 *
 * VERIFIED in those sources
 *   · /sleep-service/sleep/dailySleep?date= and …/dailySleepSummariesByDate?startDate=&endDate=
 *     (31 days at most) answer DailySleepDTO (the range: a list of them): calendarDate,
 *     sleepStartTimestampGMT / sleepEndTimestampGMT and their Local twins, deepSleepSeconds,
 *     lightSleepSeconds, remSleepSeconds, awakeSleepSeconds. There is no stage timeline, so no
 *     sleepLevelsMap is made.
 *   · /hrv-service/hrv/{date} answers HrvChartDTO: hrvSummary.lastNightAvg; the HRV window
 *     (startTimestampGMT / endTimestampGMT) and the sleep window (sleepStart… / sleepEnd…), each with
 *     a Local twin; every timestamp "iso 8601 timestamp without GMT offset or 'Z'", for example
 *     2022-08-10T09:47:59.031. 204 means no data. /hrv-service/hrv/daily/{from}/{to} carries
 *     summaries with no window to place them in, so it is not used.
 *   · /wellness-service/wellness/dailyHeartRate?date= answers DailyHeartRateDTO: restingHeartRate;
 *     startTimestampGMT / endTimestampGMT and their Local twins as ConnectTimestamp {date, localDate};
 *     heartRateValues rows whose columns heartRateValueDescriptors names ({index, key}, the keys
 *     "timestamp" and "heartrate").
 *   · /wellness-service/wellness/bodyBattery/reports/daily?startDate=&endDate= (31 days at most)
 *     answers a list of BodyBatteryDailyReportDTO: date; start and end, GMT and Local;
 *     bodyBatteryValuesArray rows whose columns bodyBatteryValueDescriptorDTOList names
 *     (timestamp, bodyBatteryLevel, bodyBatteryStatus, bodyBatteryVersion).
 *   · Stress has daily aggregates only (/usersummary-service/stats/stress/daily: overallStressLevel
 *     and durations), no series. A daily average cannot be placed at a moment without inventing a
 *     reading, so stress is not mapped, and the client does not allowlist that endpoint.
 *
 * ASSUMED, to be confirmed on the owner's real data in the local proof (T6)
 *   · A numeric timestamp is epoch milliseconds. The Swagger types DailySleepDTO's timestamps as
 *     date-time strings but describes them "in UTC, in ms", and Garmin Connect writes epoch ms, so a
 *     number, an ISO string (no zone read as UTC) and a ConnectTimestamp's `date` are all accepted.
 *     An instant before 2000 or after 2099 is refused, which also catches seconds sent as ms.
 *   · A Local timestamp is the local wall clock written as if it were UTC, so Local − GMT is the
 *     UTC offset (Garmin Connect's convention; the Swagger describes ConnectTimestamp's `date` as a
 *     "UTC timestamp" for both). An offset that is not whole minutes within ±14 h is left out.
 *   · A heart-rate or Body Battery row's timestamp column is epoch milliseconds.
 *   · Body Battery is mapped to a stressDetails summary for Phase 1c. Until its consent gate (T10,
 *     T11), the personal-lane envelope admits dailies, sleeps and hrv only and refuses an unknown type
 *     for the whole batch, so the caller drops stressDetails items before the envelope.
 */

// A night, or a night's HRV window, is at most the normaliser's own bound, imported rather than copied
// so the mapper, the envelope and the normaliser can never disagree on the longest night (RA-11). A
// calendar day is at most 25 hours (a DST day): a bound of the day series, not of a night.
const { MAX_WINDOW_SECONDS } = require('../adapter');

const MAX_DAY_SECONDS = 25 * 60 * 60;
const MAX_OFFSET_SECONDS = 14 * 60 * 60;
const MIN_INSTANT_MS = Date.UTC(2000, 0, 1);
const MAX_INSTANT_MS = Date.UTC(2100, 0, 1);

const UNMAPPED_CODE = 'garmin_personal_unmapped_endpoint';

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const isReading = (value) => typeof value === 'number' && Number.isFinite(value);
const isDuration = (value) => isReading(value) && value >= 0;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isCalendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

// ── Timestamps ───────────────────────────────────────────────────────────────────────────────────

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

// Built from the digits with Date.UTC, never Date.parse: Date.parse reads a string without a zone in
// the server's own zone, and every instant would move with the server.
function parseIso(text, honourZone) {
  const m = ISO_DATE_TIME.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', fraction = '', zone] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, fraction ? Math.floor(Number(`0.${fraction}`) * 1000) : 0);
  const check = new Date(ms);
  const sameDigits = check.getUTCFullYear() === +y && check.getUTCMonth() === +mo - 1 && check.getUTCDate() === +d
    && check.getUTCHours() === +h && check.getUTCMinutes() === +mi && check.getUTCSeconds() === +s;
  if (!sameDigits) return null; // 2026-02-30, 25:00 and the like
  if (!honourZone || !zone || zone === 'Z') return ms;
  const digits = zone.slice(1).replace(':', '');
  const sign = zone[0] === '-' ? -1 : 1;
  return ms - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60 * 1000;
}

// honourZone: an INSTANT (a GMT field) honours a zone designator; a WALL CLOCK (a Local field)
// ignores it, because its digits are the clock.
function toMs(value, honourZone) {
  let ms = null;
  if (typeof value === 'number') ms = Number.isFinite(value) ? value : null;
  else if (typeof value === 'string') ms = parseIso(value.trim(), honourZone);
  else if (isPlainObject(value) && (typeof value.date === 'string' || typeof value.date === 'number')) ms = toMs(value.date, honourZone);
  return ms !== null && ms >= MIN_INSTANT_MS && ms < MAX_INSTANT_MS ? ms : null;
}
const instantMs = (value) => toMs(value, true);
const wallClockMs = (value) => toMs(value, false);

function timeWindow(startValue, endValue, maxSeconds) {
  const start = instantMs(startValue);
  const end = instantMs(endValue);
  if (start === null || end === null) return null;
  const startSec = Math.floor(start / 1000);
  const duration = Math.floor(end / 1000) - startSec;
  return duration > 0 && duration <= maxSeconds ? { startSec, duration } : null;
}

function utcOffsetSeconds(localValue, gmtValue) {
  const local = wallClockMs(localValue);
  const gmt = instantMs(gmtValue);
  if (local === null || gmt === null) return undefined;
  const seconds = Math.round((local - gmt) / 1000);
  return Math.abs(seconds) <= MAX_OFFSET_SECONDS && seconds % 60 === 0 ? seconds + 0 : undefined;
}

// ── Series ───────────────────────────────────────────────────────────────────────────────────────

// { offsetSeconds: value } from rows whose columns the descriptors name. With no descriptor for a
// column there is no series: a column is never guessed. A reading outside the window, without a
// value, or on an offset already taken is left out; the first reading of an offset stays.
function offsetSeries(rows, descriptors, layout, valueName, window) {
  if (!Array.isArray(rows) || !Array.isArray(descriptors)) return undefined;
  const column = (name) => {
    const descriptor = descriptors.find((d) => isPlainObject(d) && typeof d[layout.nameKey] === 'string'
      && d[layout.nameKey].toLowerCase() === name.toLowerCase());
    const index = descriptor ? descriptor[layout.indexKey] : undefined;
    return Number.isInteger(index) && index >= 0 ? index : undefined;
  };
  const timeAt = column('timestamp');
  const valueAt = column(valueName);
  if (timeAt === undefined || valueAt === undefined) return undefined;
  const series = {};
  let count = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const at = instantMs(row[timeAt]);
    const value = row[valueAt];
    if (at === null || !isReading(value)) continue;
    const offset = Math.floor(at / 1000) - window.startSec;
    if (offset < 0 || offset >= window.duration) continue;
    const key = String(offset);
    if (Object.hasOwn(series, key)) continue;
    series[key] = value;
    count += 1;
  }
  return count > 0 ? series : undefined;
}

const HEART_RATE_LAYOUT = Object.freeze({ indexKey: 'index', nameKey: 'key' });
const BODY_BATTERY_LAYOUT = Object.freeze({ indexKey: 'bodyBatteryValueDescriptorIndex', nameKey: 'bodyBatteryValueDescriptorKey' });

// ── One summary per record ───────────────────────────────────────────────────────────────────────

function setIfDefined(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function mapSleep(dto) {
  if (!isPlainObject(dto)) return null;
  const window = timeWindow(dto.sleepStartTimestampGMT, dto.sleepEndTimestampGMT, MAX_WINDOW_SECONDS);
  if (!window) return null;
  const stages = [
    ['deepSleepDurationInSeconds', dto.deepSleepSeconds],
    ['lightSleepDurationInSeconds', dto.lightSleepSeconds],
    ['remSleepInSeconds', dto.remSleepSeconds],
  ];
  if (!stages.some(([, seconds]) => isDuration(seconds))) return null;
  const summary = {};
  if (isCalendarDate(dto.calendarDate)) summary.calendarDate = dto.calendarDate;
  summary.startTimeInSeconds = window.startSec;
  setIfDefined(summary, 'startTimeOffsetInSeconds', utcOffsetSeconds(dto.sleepStartTimestampLocal, dto.sleepStartTimestampGMT));
  summary.durationInSeconds = window.duration;
  for (const [key, seconds] of stages) if (isDuration(seconds)) summary[key] = seconds;
  if (isDuration(dto.awakeSleepSeconds)) summary.awakeDurationInSeconds = dto.awakeSleepSeconds;
  return { type: 'sleeps', summary };
}

function mapHrv(chart) {
  if (!isPlainObject(chart) || !isPlainObject(chart.hrvSummary)) return null;
  const average = chart.hrvSummary.lastNightAvg;
  if (!isReading(average)) return null;
  // The HRV window when Garmin gives one, the sleep window when it does not.
  let window = timeWindow(chart.startTimestampGMT, chart.endTimestampGMT, MAX_WINDOW_SECONDS);
  let [local, gmt] = [chart.startTimestampLocal, chart.startTimestampGMT];
  if (!window) {
    window = timeWindow(chart.sleepStartTimestampGMT, chart.sleepEndTimestampGMT, MAX_WINDOW_SECONDS);
    [local, gmt] = [chart.sleepStartTimestampLocal, chart.sleepStartTimestampGMT];
  }
  if (!window) return null;
  const summary = { startTimeInSeconds: window.startSec };
  setIfDefined(summary, 'startTimeOffsetInSeconds', utcOffsetSeconds(local, gmt));
  summary.durationInSeconds = window.duration;
  summary.lastNightAvg = average;
  return { type: 'hrv', summary };
}

function mapDailyHeartRate(dto) {
  if (!isPlainObject(dto)) return null;
  const window = timeWindow(dto.startTimestampGMT, dto.endTimestampGMT, MAX_DAY_SECONDS);
  if (!window) return null;
  const resting = isReading(dto.restingHeartRate) ? dto.restingHeartRate : undefined;
  const samples = offsetSeries(dto.heartRateValues, dto.heartRateValueDescriptors, HEART_RATE_LAYOUT, 'heartrate', window);
  if (resting === undefined && samples === undefined) return null;
  const summary = { startTimeInSeconds: window.startSec };
  setIfDefined(summary, 'startTimeOffsetInSeconds', utcOffsetSeconds(dto.startTimestampLocal, dto.startTimestampGMT));
  summary.durationInSeconds = window.duration;
  setIfDefined(summary, 'restingHeartRateInBeatsPerMinute', resting);
  setIfDefined(summary, 'timeOffsetHeartRateSamples', samples);
  return { type: 'dailies', summary };
}

function mapBodyBatteryReport(report) {
  if (!isPlainObject(report)) return null;
  const window = timeWindow(report.startTimestampGMT, report.endTimestampGMT, MAX_DAY_SECONDS);
  if (!window) return null;
  const levels = offsetSeries(report.bodyBatteryValuesArray, report.bodyBatteryValueDescriptorDTOList, BODY_BATTERY_LAYOUT, 'bodyBatteryLevel', window);
  if (levels === undefined) return null;
  const summary = {};
  if (isCalendarDate(report.date)) summary.calendarDate = report.date;
  summary.startTimeInSeconds = window.startSec;
  setIfDefined(summary, 'startTimeOffsetInSeconds', utcOffsetSeconds(report.startTimestampLocal, report.startTimestampGMT));
  summary.durationInSeconds = window.duration;
  summary.timeOffsetBodyBatteryValues = levels;
  return { type: 'stressDetails', summary };
}

// ── Location, at any depth ───────────────────────────────────────────────────────────────────────

// A coordinate pair written as one word ("latlng") is ONE word to keyWords, so the pairs, the geohash
// and the singular coordinate are listed as words of their own (RA-6).
const LOCATION_WORDS = new Set([
  'lat', 'lon', 'lng', 'latitude', 'longitude', 'latlng', 'latlon', 'lnglat',
  'polyline', 'gps', 'route', 'location', 'coordinate', 'coordinates', 'geo', 'geohash',
]);

// A key's words, from camelCase, PascalCase, snake_case or kebab-case: "startLatitude" holds
// "latitude", "latestValue" does not hold "lat".
function keyWords(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

const isLocationKey = (key) => keyWords(key).some((word) => LOCATION_WORDS.has(word));

/** A copy of `value` with every key that names a location removed, at any depth. */
function stripLocationKeys(value) {
  if (Array.isArray(value)) return value.map(stripLocationKeys);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!isLocationKey(key)) out[key] = stripLocationKeys(inner);
  }
  return out;
}

// ── Per endpoint ─────────────────────────────────────────────────────────────────────────────────

const one = (map) => (body) => [map(body)];
const each = (map) => (body) => (Array.isArray(body) ? body.map(map) : [null]);

// One entry per endpoint the client allowlists (client.js GARMIN_PERSONAL_ENDPOINT_IDS).
const MAPPERS = Object.freeze({
  dailySleep: one(mapSleep),
  dailySleepSummaries: each(mapSleep),
  hrv: one(mapHrv),
  dailyHeartRate: one(mapDailyHeartRate),
  bodyBattery: each(mapBodyBatteryReport),
});

const GARMIN_PERSONAL_MAPPED_ENDPOINTS = Object.freeze(Object.keys(MAPPERS));

/**
 * @param {string} endpointId  the client endpoint the body came from
 * @param {unknown} body  its decoded JSON; null or undefined (a 204) is no data
 * @returns {{items: Array<{type: 'sleeps'|'hrv'|'dailies'|'stressDetails', summary: object}>, skipped: number}}
 *   `skipped` counts the records that could not be placed in time or carried nothing
 * @throws {Error} code garmin_personal_unmapped_endpoint for an endpoint with no mapper
 */
function mapPersonalResponse(endpointId, body) {
  if (typeof endpointId !== 'string' || !Object.hasOwn(MAPPERS, endpointId)) {
    throw Object.assign(new Error(UNMAPPED_CODE), { code: UNMAPPED_CODE });
  }
  if (body === null || body === undefined) return { items: [], skipped: 0 };
  const mapped = MAPPERS[endpointId](body);
  const items = mapped.filter(Boolean).map(({ type, summary }) => ({ type, summary: stripLocationKeys(summary) }));
  return { items, skipped: mapped.length - items.length };
}

module.exports = { mapPersonalResponse, stripLocationKeys, GARMIN_PERSONAL_MAPPED_ENDPOINTS };
