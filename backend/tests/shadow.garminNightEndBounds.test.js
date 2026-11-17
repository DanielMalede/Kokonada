// backend/tests/shadow.garminNightEndBounds.test.js
'use strict';

// RA-1 of the resilience audit of #280. The Garmin webhook lane files a night where it ENDS: by its
// duration (within a day), else by its sleep timeline, the latest segment end strictly after the start and
// at most a day after it (adapter.js lastSleepLevelEndSec), else at its start (BE-217's fallback). The
// personal-lane envelope tests that also pinned those two segment bounds were deleted with the lane, so
// they are pinned here on the normaliser itself, the webhook's real door. Pure: no database, no network.

const fc = require('fast-check');
const { normalizeGarminSummaries, garminNightEndSec } = require('../app/services/wearable/adapter');

const START = 1700000000;
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const at = (sec) => new Date(sec * 1000);

function stampOf(extra) {
  const out = normalizeGarminSummaries('sleeps', { startTimeInSeconds: START, deepSleepDurationInSeconds: 3600, ...extra });
  expect(out).toHaveLength(1);
  return out[0].recordedAt;
}

describe('where a webhook night ends, at its bounds', () => {
  it('a segment that ends before the start is not an end: the night falls back to its start', () => {
    expect(stampOf({ sleepLevelsMap: { deep: [{ startTimeInSeconds: START - 2 * HOUR, endTimeInSeconds: START - HOUR }] } }))
      .toEqual(at(START));
  });

  it('a segment that ends more than a day after the start is not an end', () => {
    expect(stampOf({ sleepLevelsMap: { deep: [{ startTimeInSeconds: START, endTimeInSeconds: START + DAY + 1 }] } }))
      .toEqual(at(START));
  });

  it('a segment that ends exactly a day after the start is the end', () => {
    expect(stampOf({ sleepLevelsMap: { deep: [{ startTimeInSeconds: START, endTimeInSeconds: START + DAY }] } }))
      .toEqual(at(START + DAY));
  });

  it('an out-of-bounds segment never beats an in-bounds one', () => {
    expect(stampOf({
      sleepLevelsMap: {
        deep: [{ startTimeInSeconds: START, endTimeInSeconds: START + 7 * HOUR }],
        awake: [{ startTimeInSeconds: START + 2 * DAY, endTimeInSeconds: START + 2 * DAY + 60 }],
      },
    })).toEqual(at(START + 7 * HOUR));
  });

  it.each([
    [DAY, START + DAY],
    [DAY + 1, START],
    [0, START],
    [-60, START],
  ])('a sleeps duration of %p s ends the night at %p', (durationInSeconds, endSec) => {
    expect(stampOf({ durationInSeconds })).toEqual(at(endSec));
  });

  it('garminNightEndSec, the exported definition, returns the duration-based end', () => {
    expect(garminNightEndSec('sleeps', { startTimeInSeconds: START, durationInSeconds: 7 * HOUR })).toBe(START + 7 * HOUR);
  });
});

describe('the property: a night lands at its start or within (start, start + a day]', () => {
  it('for any duration and any sleep timeline, sleeps and hrv alike', () => {
    const duration = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.integer({ min: -DAY, max: 3 * DAY }),
      fc.double({ min: -DAY, max: 3 * DAY, noNaN: true }),
    );
    const levels = fc.option(
      fc.dictionary(
        fc.constantFrom('deep', 'light', 'rem', 'awake'),
        fc.array(
          fc.record({ from: fc.integer({ min: -2 * DAY, max: 2 * DAY }), len: fc.integer({ min: 0, max: 2 * DAY }) })
            .map(({ from, len }) => ({ startTimeInSeconds: START + from, endTimeInSeconds: START + from + len })),
          { maxLength: 4 },
        ),
      ),
      { nil: undefined },
    );
    let ended = 0;
    let fellBack = 0;
    fc.assert(fc.property(fc.constantFrom('sleeps', 'hrv'), duration, levels, (type, d, l) => {
      const summary = { startTimeInSeconds: START, deepSleepDurationInSeconds: 3600, lastNightAvg: 48 };
      if (d !== undefined) summary.durationInSeconds = d;
      if (l !== undefined) summary.sleepLevelsMap = l;
      const out = normalizeGarminSummaries(type, summary);
      if (out.length === 0) return false;
      return out.every((r) => {
        const sec = r.recordedAt.getTime() / 1000;
        if (sec === START) { fellBack += 1; return true; }
        ended += 1;
        return sec > START && sec <= START + DAY;
      });
    }), { numRuns: 2000 });

    // Non-vacuous: the generator reaches both the end rule and the fallback.
    expect(ended).toBeGreaterThan(100);
    expect(fellBack).toBeGreaterThan(100);
  });
});
