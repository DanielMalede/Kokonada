'use strict';

// RA-11 (the resilience audit of #274 at d8428ec). The personal lane is three hops: the mapper builds
// Health API summaries (garminPersonal/mapper.js), the envelope admits them (garminPersonalEnvelope.js,
// #273), and the shared normaliser turns them into metrics (adapter.js normalizeGarminSummaries). Each
// hop was tested alone. This file runs the real three together on every fixture, so a summary the
// mapper builds and the envelope refuses, a field the envelope drops that the normaliser reads, or a
// bound one hop enforces and another does not, fails here. And the longest night is ONE number,
// adapter.js MAX_WINDOW_SECONDS, which the mapper imports instead of keeping a copy.

const path = require('path');

const { mapPersonalResponse } = require('../app/services/wearable/garminPersonal/mapper');
const { parseGarminPersonalEnvelope, GARMIN_PERSONAL_ENVELOPE_VERSION } = require('../app/services/wearable/garminPersonalEnvelope');
const { normalizeGarminSummaries, MAX_WINDOW_SECONDS } = require('../app/services/wearable/adapter');

const FIXTURES = path.join(__dirname, 'fixtures', 'garminPersonal');
const fixture = (name) => JSON.parse(JSON.stringify(require(path.join(FIXTURES, `${name}.json`))));
// After the newest fixture day ends (2026-10-26 22:00 UTC), so the envelope's future cap never trips.
const NOW = new Date('2026-10-27T00:00:00.000Z');

const envelopeOf = (items) => ({ schemaVersion: GARMIN_PERSONAL_ENVELOPE_VERSION, items });
const admit = (items) => parseGarminPersonalEnvelope(envelopeOf(items), { now: NOW });
const metrics = (items) => items.flatMap(({ type, summary }) => normalizeGarminSummaries(type, summary));

describe('every mapped fixture passes the envelope and reaches the normaliser unchanged', () => {
  it.each(['dailySleep', 'dailySleepSummaries', 'hrv', 'dailyHeartRate'])('%s', (endpoint) => {
    const { items } = mapPersonalResponse(endpoint, fixture(endpoint));
    expect(items.length).toBeGreaterThan(0);

    const admitted = admit(items);

    expect(admitted.items.map((item) => item.type)).toEqual(items.map((item) => item.type));
    // The envelope keeps every field the normaliser reads: the metrics are the same either side of it.
    expect(metrics(admitted.items).length).toBeGreaterThan(0);
    expect(metrics(admitted.items)).toEqual(metrics(items));
  });

  it('Body Battery maps to stressDetails, which the envelope refuses for the whole batch, so the caller drops it first (BE-211)', () => {
    const { items } = mapPersonalResponse('bodyBattery', fixture('bodyBattery'));
    expect(items.map((item) => item.type)).toEqual(['stressDetails']);

    expect(() => admit(items)).toThrow(expect.objectContaining({ code: 'unknown_garmin_summary_type' }));
  });
});

describe('the three hops agree on the longest night, adapter.js MAX_WINDOW_SECONDS', () => {
  const SLEEP_START_MS = 1792872720000; // the dailySleep fixture's start, 2026-10-24T20:12:00Z
  const sleepOf = (seconds) => ({ ...fixture('dailySleep'), sleepEndTimestampGMT: SLEEP_START_MS + seconds * 1000 });
  const iso = (ms) => new Date(ms).toISOString().replace('Z', '');
  // An HRV chart whose own window and sleep window both last `seconds` (the mapper falls back from one to the other).
  const hrvOf = (seconds) => ({
    ...fixture('hrv'),
    startTimestampGMT: iso(SLEEP_START_MS),
    endTimestampGMT: iso(SLEEP_START_MS + seconds * 1000),
    sleepStartTimestampGMT: iso(SLEEP_START_MS),
    sleepEndTimestampGMT: iso(SLEEP_START_MS + seconds * 1000),
  });

  it('is a day', () => {
    expect(MAX_WINDOW_SECONDS).toBe(24 * 60 * 60);
  });

  it('a night of exactly MAX_WINDOW_SECONDS is mapped, admitted, and stamped by the normaliser at its end', () => {
    const { items } = mapPersonalResponse('dailySleep', sleepOf(MAX_WINDOW_SECONDS));
    expect(items).toHaveLength(1);
    expect(items[0].summary.durationInSeconds).toBe(MAX_WINDOW_SECONDS);

    const records = metrics(admit(items).items);

    expect(records.map((r) => r.metric)).toEqual(['sleepDeep', 'sleepLight', 'sleepRem']);
    for (const record of records) expect(record.recordedAt.getTime()).toBe(SLEEP_START_MS + MAX_WINDOW_SECONDS * 1000);
  });

  it('a night of MAX_WINDOW_SECONDS + 1 s is skipped by the mapper', () => {
    expect(mapPersonalResponse('dailySleep', sleepOf(MAX_WINDOW_SECONDS + 1))).toEqual({ items: [], skipped: 1 });
  });

  it('and the envelope refuses one too, were it built past the mapper', () => {
    const { items } = mapPersonalResponse('dailySleep', sleepOf(MAX_WINDOW_SECONDS));
    items[0].summary.durationInSeconds = MAX_WINDOW_SECONDS + 1;

    expect(() => admit(items)).toThrow(expect.objectContaining({ code: 'invalid_garmin_summary' }));
  });

  it('an HRV night of exactly MAX_WINDOW_SECONDS is mapped and admitted; one second longer is skipped', () => {
    const { items } = mapPersonalResponse('hrv', hrvOf(MAX_WINDOW_SECONDS));
    expect(items.map((item) => item.summary.durationInSeconds)).toEqual([MAX_WINDOW_SECONDS]);
    expect(admit(items).items).toHaveLength(1);

    expect(mapPersonalResponse('hrv', hrvOf(MAX_WINDOW_SECONDS + 1))).toEqual({ items: [], skipped: 1 });
  });

  // The bound is imported, not copied: under a registry where the normaliser's bound is one hour, the
  // mapper skips the fixtures' eight-and-a-half-hour nights, while a calendar day (its own 25 h bound,
  // not a night's) still maps.
  it('the mapper follows a change to adapter.js MAX_WINDOW_SECONDS: its night bound IS the normaliser\'s', () => {
    const adapterPath = '../app/services/wearable/adapter';
    try {
      jest.isolateModules(() => {
        jest.doMock(adapterPath, () => ({ ...jest.requireActual(adapterPath), MAX_WINDOW_SECONDS: 60 * 60 }));
        const { mapPersonalResponse: mapWithOneHourNights } = require('../app/services/wearable/garminPersonal/mapper');

        expect(mapWithOneHourNights('dailySleep', fixture('dailySleep'))).toEqual({ items: [], skipped: 1 });
        expect(mapWithOneHourNights('hrv', fixture('hrv'))).toEqual({ items: [], skipped: 1 });
        expect(mapWithOneHourNights('dailyHeartRate', fixture('dailyHeartRate')).items).toHaveLength(1);
      });
    } finally {
      jest.dontMock(adapterPath);
    }
  });
});
