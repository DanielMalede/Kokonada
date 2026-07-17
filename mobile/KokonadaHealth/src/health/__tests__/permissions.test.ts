import fs from 'fs';
import path from 'path';
import { HEALTH_PERMISSIONS } from '../permissions';

// Wave 6 T3 — Health Connect scope minimization. Compliance rule: request ONLY the
// permissions a shipped feature actually reads. The medical-profile pipeline reads
// HeartRate / HRV / SleepSession / RestingHeartRate (fetchHistory + live restFallback),
// spanning >30 days (needs ReadHealthDataHistory). OxygenSaturation, RespiratoryRate and
// the READ_HEALTH_DATA_IN_BACKGROUND scope have ZERO readers anywhere in the app — they
// must not be requested.
const recordTypes = HEALTH_PERMISSIONS.map((p: any) => p.recordType);

const manifest = fs.readFileSync(
  path.join(__dirname, '../../../android/app/src/main/AndroidManifest.xml'),
  'utf8',
);

describe('HEALTH_PERMISSIONS — scope minimization', () => {
  it('requests every record type that has a real reader', () => {
    expect(recordTypes).toEqual(expect.arrayContaining([
      'HeartRate', 'HeartRateVariabilityRmssd', 'SleepSession', 'RestingHeartRate', 'ReadHealthDataHistory',
    ]));
  });

  it('does NOT request scopes with zero readers (SpO2 / respiratory / background)', () => {
    expect(recordTypes).not.toContain('OxygenSaturation');
    expect(recordTypes).not.toContain('RespiratoryRate');
    expect(recordTypes).not.toContain('BackgroundAccessPermission');
  });
});

describe('AndroidManifest health permissions mirror the minimized set', () => {
  // Assert on the qualified `permission.health.*` declaration (not bare prose) so an
  // explanatory comment mentioning a dropped scope can't mask a real declaration.
  const declares = (perm: string) =>
    manifest.includes(`android.permission.health.${perm}`);

  it('declares no permission without a reader', () => {
    expect(declares('READ_OXYGEN_SATURATION')).toBe(false);
    expect(declares('READ_RESPIRATORY_RATE')).toBe(false);
    expect(declares('READ_HEALTH_DATA_IN_BACKGROUND')).toBe(false);
  });

  it('still declares the consumed scopes', () => {
    expect(declares('READ_HEART_RATE')).toBe(true);
    expect(declares('READ_HEART_RATE_VARIABILITY')).toBe(true);
    expect(declares('READ_SLEEP')).toBe(true);
    expect(declares('READ_RESTING_HEART_RATE')).toBe(true);
    expect(declares('READ_HEALTH_DATA_HISTORY')).toBe(true);
  });
});
