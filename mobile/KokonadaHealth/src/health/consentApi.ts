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

// The special-category categories the user is agreeing to, kept PROVIDER-SPECIFIC so the umbrella
// consent (one purpose: health_biometric_processing) is honest about BOTH wearable lanes. The
// consent-document copy (ConsentSheet) enumerates exactly the union, so the record reflects
// precisely what was shown. Do not invent alternatives; a change here is a versioned, reviewed
// change that bumps CURRENT_CONSENT_VERSION server-side (see CONSENT_SCREEN_VERSION note below).

// Health Connect lane — scope-minimized to the REAL OS request set (permissions.ts /
// AndroidManifest.xml, PR #152 T3): spo2, respiratory_rate and background_access were dropped
// because those scopes had zero readers on this client. The mobile OS ask must never be broader
// than this list.
export const HEALTH_CONNECT_DATA_CATEGORIES = [
  'heart_rate',
  'hrv',
  'sleep',
  'resting_heart_rate',
  'historical_access_182d',
] as const;

// Garmin server-to-server lane — Garmin's Health API additionally reports these special-category
// types (backend services/wearable/adapter.js normalizeGarminSummaries). Health Connect on this
// client does NOT read them, so they are disclosed here as provider-specific (labelled as
// Garmin-sourced in the ConsentSheet) — the umbrella consent must cover them before that lane goes
// live. This is now ENFORCED, not just documented: the backend DROPS these three special-category
// metrics at ingest (services/wearable/garminIngest.js) unless the user's granted consent version
// is >= consent.js GARMIN_CONSENT_MIN_VERSION (guard: backend tests/garminConsentVersionGate.test.js).
// Go-live (GARMIN_WEBHOOK_SECRET + Garmin production approval) = bump the server's
// CURRENT_CONSENT_VERSION to GARMIN_CONSENT_MIN_VERSION and CONSENT_SCREEN_VERSION here in lockstep;
// the gate then admits these only for users who re-consented at that version.
export const GARMIN_ONLY_DATA_CATEGORIES = ['spo2', 'respiratory_rate', 'body_battery'] as const;

// Full disclosure = the union across every wearable lane. grantConsent sends exactly this.
export const CONSENT_DATA_CATEGORIES = [
  ...HEALTH_CONNECT_DATA_CATEGORIES,
  ...GARMIN_ONLY_DATA_CATEGORIES,
] as const;

// The contract version THIS BUILD's consent copy/CONSENT_DATA_CATEGORIES represent — sent on
// every grant so the server can reject a mismatch (resilience-audit finding). Without this, a
// server-only CURRENT_CONSENT_VERSION bump would let an un-updated app's grant silently record
// as "current" even though the user was shown the OLD terms. Bump this — in lockstep with a real
// copy/category change here — whenever the backend's CURRENT_CONSENT_VERSION bumps; keeping the
// two in sync is a manual, reviewed step (there is no single shared source across the repo split).
export const CONSENT_SCREEN_VERSION = 1;

// The status the server gate and the client both consume. staleVersion = granted, but at an
// older contract version → the client must re-prompt before the OS health sheet.
export interface ConsentStatus {
  granted: boolean;
  currentVersion: number;
  staleVersion: boolean;
}

// resilience-audit finding: apiClient's `res.json() as T` cast has no runtime shape check. A
// malformed 200 missing `staleVersion` would otherwise evaluate `granted && !undefined === true`
// — a false "current grant" that could open the OS Health Connect sheet. This gate is the ONE
// place a ConsentStatus enters the app, so validate the shape here rather than in every caller;
// an unshaped payload fails closed (ok:false), which the store already treats as submit_error.
function isConsentStatus(v: unknown): v is ConsentStatus {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.granted === 'boolean' && typeof s.currentVersion === 'number' && typeof s.staleVersion === 'boolean';
}

function guardShape(res: ApiResult<ConsentStatus>): ApiResult<ConsentStatus> {
  if (res.ok && !isConsentStatus(res.data)) {
    return { ok: false, error: 'malformed_consent_status' };
  }
  return res;
}

// GET /api/consent/status?purpose=health_biometric_processing
export async function fetchConsentStatus(): Promise<ApiResult<ConsentStatus>> {
  const params = new URLSearchParams({ purpose: CONSENT_PURPOSE });
  return guardShape(await apiGet<ConsentStatus>(`/api/consent/status?${params.toString()}`));
}

// POST /api/consent — records a granted consent at the current version. Sends the exact
// dataCategories the ConsentSheet displayed. The 201 echoes the fresh canonical status, so the
// caller confirms the new state in ONE round trip (no follow-up GET needed).
export async function grantConsent(): Promise<ApiResult<ConsentStatus>> {
  return guardShape(await apiPost<ConsentStatus>('/api/consent', {
    purpose: CONSENT_PURPOSE,
    dataCategories: [...CONSENT_DATA_CATEGORIES],
    clientVersion: CONSENT_SCREEN_VERSION,
  }));
}

// POST /api/consent/withdraw — withdraws consent AND (server-side) erases the wearable footprint.
// Echoes the fresh status (granted:false) so the UI reflects the ungranted state immediately.
export async function withdrawConsent(): Promise<ApiResult<ConsentStatus>> {
  return guardShape(await apiPost<ConsentStatus>('/api/consent/withdraw', { purpose: CONSENT_PURPOSE }));
}
