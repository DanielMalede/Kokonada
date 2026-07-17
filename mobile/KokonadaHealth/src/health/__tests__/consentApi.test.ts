import {
  fetchConsentStatus,
  grantConsent,
  withdrawConsent,
  CONSENT_PURPOSE,
  CONSENT_DATA_CATEGORIES,
  HEALTH_CONNECT_DATA_CATEGORIES,
  GARMIN_ONLY_DATA_CATEGORIES,
  CONSENT_SCREEN_VERSION,
} from '../consentApi';

jest.mock('../../net/apiClient', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
import { apiGet, apiPost } from '../../net/apiClient';

const okStatus = { ok: true as const, data: { granted: false, currentVersion: 1, staleVersion: false } };

describe('consentApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiGet as jest.Mock).mockResolvedValue(okStatus);
    (apiPost as jest.Mock).mockResolvedValue(okStatus);
  });

  // The disclosed categories are the UNION across every wearable lane, kept provider-specific so
  // the umbrella consent is honest about BOTH lanes:
  //   • Health Connect on this client is scope-minimized (PR #152 T3): SpO2 / respiratory / background
  //     were removed for having zero readers — the mobile OS ask must never be broader than this.
  //   • The Garmin server-to-server lane (backend adapter.js normalizeGarminSummaries) additionally
  //     reports SpO2, respiration and Body Battery; these are disclosed here — labelled as Garmin-
  //     sourced in the ConsentSheet — so the consent covers them before that (backend-gated) lane
  //     goes live. background_access stays dropped (no lane reads it).
  it('discloses the union of special-category types across wearable lanes (HC scope-min + Garmin shape)', () => {
    expect(CONSENT_PURPOSE).toBe('health_biometric_processing');
    expect(HEALTH_CONNECT_DATA_CATEGORIES).toEqual([
      'heart_rate',
      'hrv',
      'sleep',
      'resting_heart_rate',
      'historical_access_182d',
    ]);
    expect(GARMIN_ONLY_DATA_CATEGORIES).toEqual(['spo2', 'respiratory_rate', 'body_battery']);
    expect(CONSENT_DATA_CATEGORIES).toEqual([
      ...HEALTH_CONNECT_DATA_CATEGORIES,
      ...GARMIN_ONLY_DATA_CATEGORIES,
    ]);
    // background_access is still NOT disclosed — no lane reads it.
    expect(CONSENT_DATA_CATEGORIES).not.toContain('background_access');
  });

  it('fetchConsentStatus GETs /api/consent/status with the purpose query', async () => {
    await fetchConsentStatus();
    const path = (apiGet as jest.Mock).mock.calls[0][0];
    expect(path).toContain('/api/consent/status?');
    expect(path).toContain('purpose=health_biometric_processing');
  });

  it('grantConsent POSTs /api/consent with the purpose, the exact data categories being shown, and the client contract version', async () => {
    await grantConsent();
    const [path, body] = (apiPost as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/consent');
    expect(body).toEqual({
      purpose: 'health_biometric_processing',
      dataCategories: [...CONSENT_DATA_CATEGORIES],
      clientVersion: CONSENT_SCREEN_VERSION,
    });
  });

  // resilience-audit finding: without a client contract version, a server-only version bump lets
  // an un-updated app's grant silently record as "current" though it showed the OLD terms. The
  // backend rejects a mismatch (409); the store's existing !ok → submit_error path already fails
  // closed on that response, so no store change was needed — only sending the version was missing.
  it('CONSENT_SCREEN_VERSION is a positive integer (the client half of the cross-package version contract)', () => {
    expect(Number.isInteger(CONSENT_SCREEN_VERSION)).toBe(true);
    expect(CONSENT_SCREEN_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('withdrawConsent POSTs /api/consent/withdraw with only the purpose', async () => {
    await withdrawConsent();
    const [path, body] = (apiPost as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/consent/withdraw');
    expect(body).toEqual({ purpose: 'health_biometric_processing' });
  });

  it('passes the typed ApiResult straight through (never throws)', async () => {
    (apiGet as jest.Mock).mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    await expect(fetchConsentStatus()).resolves.toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  // resilience-audit finding: apiClient's res.json() as T cast has no runtime shape check, so a
  // malformed 200 (e.g. missing staleVersion) would otherwise read as `granted && !undefined ===
  // true` — a false "current grant" that could open the OS sheet. Fail closed instead.
  describe('malformed-response guard (fail closed, never trust an unshaped 200)', () => {
    it('fetchConsentStatus: an ok:true body missing staleVersion is rejected, not trusted as granted', async () => {
      (apiGet as jest.Mock).mockResolvedValue({ ok: true, data: { granted: true, currentVersion: 1 } });
      const res = await fetchConsentStatus();
      expect(res.ok).toBe(false);
    });

    it('fetchConsentStatus: granted as a non-boolean is rejected', async () => {
      (apiGet as jest.Mock).mockResolvedValue({ ok: true, data: { granted: 'yes', currentVersion: 1, staleVersion: false } });
      const res = await fetchConsentStatus();
      expect(res.ok).toBe(false);
    });

    it('grantConsent: a malformed 201 echo is rejected, never treated as granted_ack', async () => {
      (apiPost as jest.Mock).mockResolvedValue({ ok: true, data: { granted: true } });
      const res = await grantConsent();
      expect(res.ok).toBe(false);
    });

    it('a well-shaped response still passes through unchanged', async () => {
      const good = { ok: true as const, data: { granted: true, currentVersion: 1, staleVersion: false } };
      (apiGet as jest.Mock).mockResolvedValue(good);
      await expect(fetchConsentStatus()).resolves.toEqual(good);
    });
  });
});
