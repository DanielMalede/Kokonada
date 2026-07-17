import type { Permission } from 'react-native-health-connect';

// Health Connect record types we read for the medical profile. SCOPE-MINIMIZED (Wave 6 T3):
// only record types with a real reader are requested. HeartRate / HRV / SleepSession /
// RestingHeartRate are all read by fetchHistory (+ HeartRate by the live restFallback).
// OxygenSaturation and RespiratoryRate were requested but never read anywhere — dropped.
export const READ_RECORD_TYPES = [
  'HeartRate',
  'HeartRateVariabilityRmssd',
  'SleepSession',
  'RestingHeartRate',
] as const;

// The single one-tap permission set. Requesting these together produces ONE
// Health Connect permission sheet.
//
// Note the special pseudo-record-type (mapped natively by the library):
//   'ReadHealthDataHistory' -> PERMISSION_READ_HEALTH_DATA_HISTORY  (read > 30 days)
// There is no per-duration ("6-month") permission — ReadHealthDataHistory simply lifts the
// default 30-day read cap; the ~6-month window needs it. The matching manifest entry is
// READ_HEALTH_DATA_HISTORY.
//
// The background-read scope (BackgroundAccessPermission / READ_HEALTH_DATA_IN_BACKGROUND) is
// intentionally NOT requested: every read happens while the app is in the foreground (the
// on-demand backfill and the live restFallback poll only while a screen is mounted), so no
// feature reads in the background. Requesting it would be an unused, review-flagging scope.
export const HEALTH_PERMISSIONS: Permission[] = [
  ...READ_RECORD_TYPES.map(
    (recordType) => ({ accessType: 'read', recordType }) as Permission,
  ),
  { accessType: 'read', recordType: 'ReadHealthDataHistory' } as unknown as Permission,
];

export function hasGrantedRecord(
  granted: Permission[],
  recordType: string,
): boolean {
  return granted.some(
    (p: any) => p.accessType === 'read' && p.recordType === recordType,
  );
}
