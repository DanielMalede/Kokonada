// Pure mappers — Health Connect record shapes → the canonical sample shape the
// backend expects at POST /api/integrations/health/batch:
//   { platform: 'health_connect', samples: [{ type, value, startDate, endDate? }] }
// Backend-recognised types: heart_rate | resting_heart_rate | hrv | respiratory_rate | spo2.
//
// No react-native imports here on purpose, so this is unit-testable in plain Jest.

export interface BackendSample {
  type: string;
  value: number;
  startDate: string;
  endDate?: string;
}

// HeartRate records hold an array of instantaneous samples.
export function mapHeartRate(records: any[]): BackendSample[] {
  const out: BackendSample[] = [];
  for (const r of records ?? []) {
    for (const s of r.samples ?? []) {
      out.push({ type: 'heart_rate', value: s.beatsPerMinute, startDate: s.time });
    }
  }
  return out;
}

// HeartRateVariabilityRmssd records carry a single millis value at a time.
export function mapHrv(records: any[]): BackendSample[] {
  return (records ?? []).map((r) => ({
    type: 'hrv',
    value: r.heartRateVariabilityMillis,
    startDate: r.time,
  }));
}

// Sleep → per-session, per-stage duration samples the backend aggregates into
// MedicalProfile.sleepStages.{deep,light,rem}. Health Connect stage codes:
// 4 LIGHT, 5 DEEP, 6 REM (awake stages are not part of the profile).
const SLEEP_STAGE_TO_TYPE: Record<number, 'sleep_deep' | 'sleep_light' | 'sleep_rem'> = {
  4: 'sleep_light',
  5: 'sleep_deep',
  6: 'sleep_rem',
};

export function mapSleep(records: any[]): BackendSample[] {
  const out: BackendSample[] = [];
  for (const r of records ?? []) {
    const minutes: Record<string, number> = {};
    for (const st of r.stages ?? []) {
      const type = SLEEP_STAGE_TO_TYPE[st.stage];
      if (!type) continue;
      const mins = (new Date(st.endTime).getTime() - new Date(st.startTime).getTime()) / 60000;
      if (Number.isFinite(mins) && mins > 0) minutes[type] = (minutes[type] ?? 0) + mins;
    }
    for (const [type, mins] of Object.entries(minutes)) {
      out.push({ type, value: Math.round(mins), startDate: r.startTime, endDate: r.endTime });
    }
  }
  return out;
}

// RestingHeartRate records carry a single bpm value at a time (D-4a). The backend
// normalizer maps 'resting_heart_rate' → MedicalProfile.restingHeartRate, which is the
// input every stateVector classifier rule keys on.
export function mapRestingHeartRate(records: any[]): BackendSample[] {
  return (records ?? []).map((r) => ({
    type: 'resting_heart_rate',
    value: r.beatsPerMinute,
    startDate: r.time,
  }));
}

// Everything the backend ingests (HR time-series + HRV + resting HR + per-night sleep
// stages), de-noised of non-numeric values.
export function toBackendSamples(history: { heartRate?: any[]; hrv?: any[]; sleep?: any[]; restingHeartRate?: any[] }): BackendSample[] {
  return [
    ...mapHeartRate(history.heartRate ?? []),
    ...mapHrv(history.hrv ?? []),
    ...mapSleep(history.sleep ?? []),
    ...mapRestingHeartRate(history.restingHeartRate ?? []),
  ].filter((s) => Number.isFinite(s.value));
}

// ── Sleep: LOCAL summary (display) ────────────────────────────────────────────────
// NOTE: the backend DOES ingest the per-stage sleep samples sent above (mapSleep →
// sleepStages median baseline + lastNightSleep totals). This summary is a separate,
// on-device aggregate purely for the UI.
// Health Connect SleepSession stage codes: 1 AWAKE, 4 LIGHT, 5 DEEP, 6 REM, 7 AWAKE_IN_BED.
const STAGE = { 1: 'awake', 4: 'light', 5: 'deep', 6: 'rem', 7: 'awake' } as const;

export function summarizeSleep(records: any[]) {
  const byStage = { deep: 0, light: 0, rem: 0, awake: 0 };
  let sessions = 0;
  for (const r of records ?? []) {
    sessions += 1;
    for (const st of r.stages ?? []) {
      const key = (STAGE as any)[st.stage];
      if (!key) continue;
      const mins = (new Date(st.endTime).getTime() - new Date(st.startTime).getTime()) / 60000;
      if (Number.isFinite(mins) && mins > 0) byStage[key as keyof typeof byStage] += mins;
    }
  }
  const round = (n: number) => Math.round(n);
  return {
    sessions,
    deepMinutes: round(byStage.deep),
    lightMinutes: round(byStage.light),
    remMinutes: round(byStage.rem),
    awakeMinutes: round(byStage.awake),
  };
}
