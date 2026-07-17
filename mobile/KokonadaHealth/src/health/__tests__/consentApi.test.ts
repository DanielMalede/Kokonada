import {
  fetchConsentStatus,
  grantConsent,
  withdrawConsent,
  CONSENT_PURPOSE,
  CONSENT_DATA_CATEGORIES,
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

  it('locks the canonical special-category data categories (no drift from the backend contract)', () => {
    expect(CONSENT_PURPOSE).toBe('health_biometric_processing');
    expect(CONSENT_DATA_CATEGORIES).toEqual([
      'heart_rate',
      'hrv',
      'sleep',
      'resting_heart_rate',
      'spo2',
      'respiratory_rate',
      'historical_access_182d',
      'background_access',
    ]);
  });

  it('fetchConsentStatus GETs /api/consent/status with the purpose query', async () => {
    await fetchConsentStatus();
    const path = (apiGet as jest.Mock).mock.calls[0][0];
    expect(path).toContain('/api/consent/status?');
    expect(path).toContain('purpose=health_biometric_processing');
  });

  it('grantConsent POSTs /api/consent with the purpose AND the exact data categories being shown', async () => {
    await grantConsent();
    const [path, body] = (apiPost as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/consent');
    expect(body).toEqual({
      purpose: 'health_biometric_processing',
      dataCategories: [...CONSENT_DATA_CATEGORIES],
    });
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
