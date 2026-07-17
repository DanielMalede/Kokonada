import { apiGet, apiPost, type ApiResult } from '../net/apiClient';

// GDPR Art.9 consent client (audit H-9). The mobile half of the versioned consent record
// whose backend contract lives in backend/app/services/privacy/consent.js. Explicit, informed
// consent — the OS Health Connect read grant is NOT lawful Art.9 consent on its own — so this
// gate is checked (and granted) BEFORE the OS permission sheet is ever shown. Delegates auth +
// 401-refresh-retry to the shared apiClient; never throws (typed ApiResult).

// CROSS-PACKAGE CONTRACT — must stay in lockstep with the backend enum:
//   purpose      ← ConsentRecord.purpose enum ('health_biometric_processing')
//   currentVersion ← services/privacy/consent.js CURRENT_CONSENT_VERSION
export const CONSENT_PURPOSE = 'health_biometric_processing' as const;

// The special-category categories the user is agreeing to. LOCKED to the backend's canonical
// list — the consent-document copy (ConsentSheet) MUST enumerate exactly these, so the record
// reflects precisely what was shown. Do not invent alternatives; a change here is a versioned,
// reviewed change that bumps CURRENT_CONSENT_VERSION server-side.
export const CONSENT_DATA_CATEGORIES = [
  'heart_rate',
  'hrv',
  'sleep',
  'resting_heart_rate',
  'spo2',
  'respiratory_rate',
  'historical_access_182d',
  'background_access',
] as const;

// The status the server gate and the client both consume. staleVersion = granted, but at an
// older contract version → the client must re-prompt before the OS health sheet.
export interface ConsentStatus {
  granted: boolean;
  currentVersion: number;
  staleVersion: boolean;
}

// GET /api/consent/status?purpose=health_biometric_processing
export function fetchConsentStatus(): Promise<ApiResult<ConsentStatus>> {
  const params = new URLSearchParams({ purpose: CONSENT_PURPOSE });
  return apiGet<ConsentStatus>(`/api/consent/status?${params.toString()}`);
}

// POST /api/consent — records a granted consent at the current version. Sends the exact
// dataCategories the ConsentSheet displayed. The 201 echoes the fresh canonical status, so the
// caller confirms the new state in ONE round trip (no follow-up GET needed).
export function grantConsent(): Promise<ApiResult<ConsentStatus>> {
  return apiPost<ConsentStatus>('/api/consent', {
    purpose: CONSENT_PURPOSE,
    dataCategories: [...CONSENT_DATA_CATEGORIES],
  });
}

// POST /api/consent/withdraw — withdraws consent AND (server-side) erases the wearable footprint.
// Echoes the fresh status (granted:false) so the UI reflects the ungranted state immediately.
export function withdrawConsent(): Promise<ApiResult<ConsentStatus>> {
  return apiPost<ConsentStatus>('/api/consent/withdraw', { purpose: CONSENT_PURPOSE });
}
