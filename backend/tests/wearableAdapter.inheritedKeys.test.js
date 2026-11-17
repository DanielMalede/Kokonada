'use strict';

// BE-070 (LOW) — the wearable adapter resolved a device's activity type with a plain property read
// (`ACTIVITY_MAP[source]?.[rawType]`), which also finds the keys every object INHERITS. A hand-built
// biometric_push whose activity type is 'constructor' resolved to the Object function and '__proto__'
// to Object.prototype, and the socket handler stored that as the listener's activity
// (`state.latestActivity`), from where it reaches the bio mood key, the session snapshot and the
// live BiometricLog row. The lookup now reads own keys only; anything the maps do not declare is
// 'unknown', as an unrecognised type always was.
//
// Driven through `normalize`, the adapter's only door, for each of the three sources it maps.

const { normalize } = require('../app/services/wearable/adapter');

const AT = '2026-10-20T10:00:00.000Z';
const SOURCES = [
  ['garmin', (type) => ({ heartRate: 72, activityType: type, startTimeLocal: AT })],
  ['apple_health', (type) => ({ value: 72, workoutType: type, startDate: AT })],
  ['suunto', (type) => ({ hr: 72, sport: type, timestamp: AT })],
];

// Every name Object.prototype carries, so no inherited member is missed.
const INHERITED = Object.getOwnPropertyNames(Object.prototype);

describe.each(SOURCES)('wearable adapter, %s: an activity type the map does not own is "unknown"', (source, reading) => {
  it.each(['constructor', '__proto__'])('%j resolves to "unknown", not a member of Object.prototype', (type) => {
    expect(normalize(source, reading(type)).activity).toBe('unknown');
  });

  it('every other inherited name resolves to "unknown" too', () => {
    const leaked = INHERITED.filter((type) => normalize(source, reading(type)).activity !== 'unknown');
    expect(leaked).toEqual([]);
  });

  it('control: an absent or null type is "unknown"', () => {
    expect(normalize(source, reading(undefined)).activity).toBe('unknown');
    expect(normalize(source, reading(null)).activity).toBe('unknown');
  });
});

describe('wearable adapter: the types each map does declare still resolve (control)', () => {
  it.each([
    ['garmin', 0, 'resting'], // 0 is falsy: an own-key check must not read it as absent
    ['garmin', 1, 'running'],
    ['garmin', '13', 'strength'], // the same own key, sent as a string
    ['apple_health', 'HKWorkoutActivityTypeRunning', 'running'],
    ['apple_health', 'HKWorkoutActivityTypeTraditionalStrengthTraining', 'strength'],
    ['suunto', 'GYM', 'strength'],
    ['suunto', 'WALKING', 'walking'],
  ])('%s %j resolves to %j', (source, type, activity) => {
    const reading = SOURCES.find(([s]) => s === source)[1];
    expect(normalize(source, reading(type)).activity).toBe(activity);
  });
});
