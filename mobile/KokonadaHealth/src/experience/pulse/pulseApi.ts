import { apiGet, type ApiResult } from '../../net/apiClient';

// Typed client for GET /api/pulse/state (A11). Mirrors the backend PulseStateDTO —
// the owner's decrypted physiological snapshot for the Pulse screen. Never throws;
// delegates auth + 401-refresh to apiClient.

export interface PulseStateVector { status: string | null; confidence: number | null; computedAt: string | null; }
export interface PulseVitals { hrv: number | null; bodyBattery: number | null; dailyReadiness: number | null; restingHeartRate: number | null; }
export interface PulseSleepNight { deep: number | null; light: number | null; rem: number | null; date: string | null; }
export interface PulseSleep { lastNight: PulseSleepNight; updatedAt: string | null; }

export interface PulseState {
  stateVector: PulseStateVector;
  vitals: PulseVitals;
  sleep: PulseSleep;
  lastAnalyzed: string | null;
  sampleCount: number;
}

export function fetchPulseState(): Promise<ApiResult<PulseState>> {
  return apiGet<PulseState>('/api/pulse/state');
}
