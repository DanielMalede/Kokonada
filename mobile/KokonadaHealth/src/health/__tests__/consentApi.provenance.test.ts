import { grantConsent, CONSENT_DATA_CATEGORIES, CONSENT_SCREEN_VERSION } from '../consentApi';
import type { GrantProvenance } from '../grantProvenance';

jest.mock('../../net/apiClient', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
import { apiPost } from '../../net/apiClient';

// MB-062 (REG-034; DEC-117, the O2 condition): a grant carries the build and the device's language
// setting, which the server stores on the ConsentRecord. The provenance is handed in by the screen
// that offers the grant (grantProvenance(), read on the device at that moment), so this client
// stays a plain HTTP call. The consent version and categories are sent exactly as before.

const okStatus = { ok: true as const, data: { granted: true, currentVersion: 1, staleVersion: false } };

describe('grantConsent with the grant’s provenance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiPost as jest.Mock).mockResolvedValue(okStatus);
  });

  it('POSTs the purpose, the categories shown, the screen version — and the build and locale', async () => {
    await grantConsent({ appVersion: '1.0 (1)', locale: 'he' });
    const [route, body] = (apiPost as jest.Mock).mock.calls[0];
    expect(route).toBe('/api/consent');
    expect(body).toEqual({
      purpose: 'health_biometric_processing',
      dataCategories: [...CONSENT_DATA_CATEGORIES],
      clientVersion: CONSENT_SCREEN_VERSION,
      appVersion: '1.0 (1)',
      locale: 'he',
    });
  });

  // Resilience N11: the provenance travels with the consent, never over it. Spread first, so a
  // provenance object that carries consent fields (by a cast or a future type change) cannot replace
  // the purpose, the categories shown or the screen version.
  it('the provenance can never override the consent fields it travels with', async () => {
    await grantConsent({ appVersion: '1.0 (1)', locale: 'he', purpose: 'other', dataCategories: [], clientVersion: 99 } as unknown as GrantProvenance);
    const body = (apiPost as jest.Mock).mock.calls[0][1];
    expect(body.purpose).toBe('health_biometric_processing');
    expect(body.dataCategories).toEqual([...CONSENT_DATA_CATEGORIES]);
    expect(body.clientVersion).toBe(CONSENT_SCREEN_VERSION);
  });

  it('a device with no known locale sends the build and no locale key', async () => {
    await grantConsent({ appVersion: '1.0 (1)' });
    const body = (apiPost as jest.Mock).mock.calls[0][1];
    expect(body.appVersion).toBe('1.0 (1)');
    expect('locale' in body).toBe(false);
  });
});
