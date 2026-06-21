'use strict';

// Prevent the script from auto-running when required in tests
// (require.main !== module, so run() is never called)
const { SCENARIOS, parseDurationMs } = require('../scripts/biometric-mock');

describe('SCENARIOS', () => {
  it.each([
    ['resting',  60,  0],
    ['walking',  90,  6],
    ['running',  145, 1],
    ['spike',    165, 1],
    ['cooldown', 100, 6],
  ])('%s has heartRate %i and activityType %i', (name, hr, type) => {
    expect(SCENARIOS[name]).toMatchObject({ heartRate: hr, activityType: type });
  });

  it('all scenarios have a label string', () => {
    for (const key of Object.keys(SCENARIOS)) {
      expect(typeof SCENARIOS[key].label).toBe('string');
    }
  });
});

describe('parseDurationMs', () => {
  it('parses seconds', () => expect(parseDurationMs('30s')).toBe(30_000));
  it('parses minutes', () => expect(parseDurationMs('5m')).toBe(300_000));
  it('parses hours',   () => expect(parseDurationMs('2h')).toBe(7_200_000));
  it('throws on invalid format', () => {
    expect(() => parseDurationMs('5min')).toThrow('Invalid duration');
    expect(() => parseDurationMs('abc')).toThrow('Invalid duration');
    expect(() => parseDurationMs('5')).toThrow('Invalid duration');
  });
});
