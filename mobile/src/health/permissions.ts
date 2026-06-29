import type { Permission } from 'react-native-health-connect';

// Health Connect record types we read for the medical profile.
export const READ_RECORD_TYPES = [
  'HeartRate',
  'HeartRateVariabilityRmssd',
  'SleepSession',
  // bonus scalars the backend already aggregates onto MedicalProfile:
  'RestingHeartRate',
  'OxygenSaturation',
  'RespiratoryRate',
] as const;

// The single one-tap permission set. Requesting these together produces ONE
// Health Connect permission sheet.
//
// Note the two special pseudo-record-types (mapped natively by the library):
//   'ReadHealthDataHistory'      -> PERMISSION_READ_HEALTH_DATA_HISTORY  (read > 30 days)
//   'BackgroundAccessPermission' -> PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
// There is no per-duration ("6-month") permission — ReadHealthDataHistory simply
// lifts the default 30-day read cap. The matching manifest entries are
// READ_HEALTH_DATA_HISTORY and READ_HEALTH_DATA_IN_BACKGROUND.
export const HEALTH_PERMISSIONS: Permission[] = [
  ...READ_RECORD_TYPES.map(
    (recordType) => ({ accessType: 'read', recordType }) as Permission,
  ),
  { accessType: 'read', recordType: 'ReadHealthDataHistory' } as unknown as Permission,
  { accessType: 'read', recordType: 'BackgroundAccessPermission' } as unknown as Permission,
];

export function hasGrantedRecord(
  granted: Permission[],
  recordType: string,
): boolean {
  return granted.some(
    (p: any) => p.accessType === 'read' && p.recordType === recordType,
  );
}
