'use strict';

// Garmin Health API user deregistration (Wave 6 T4). On a Garmin disconnect we not only
// erase the local data (Wave 3) but ALSO tell Garmin to drop our registration so it stops
// pushing summaries and revokes our access to the user. Garmin's Health API exposes this as
// DELETE /wellness-api/rest/user/registration authenticated by the user's Bearer token.

jest.mock('axios');
const axios  = require('axios');
const garmin = require('../app/services/wearable/garmin');

describe('garmin.deregisterUser', () => {
  beforeEach(() => { jest.clearAllMocks(); axios.delete.mockResolvedValue({ status: 204, data: '' }); });

  it('DELETEs the Health API user-registration endpoint with the user Bearer token', async () => {
    await garmin.deregisterUser('acc-token-123');

    expect(axios.delete).toHaveBeenCalledTimes(1);
    const [url, opts] = axios.delete.mock.calls[0];
    expect(url).toBe('https://apis.garmin.com/wellness-api/rest/user/registration');
    expect(opts.headers.Authorization).toBe('Bearer acc-token-123');
  });

  it('propagates a Garmin API error so the caller can decide (best-effort at the call site)', async () => {
    axios.delete.mockRejectedValue(Object.assign(new Error('unauthorized'), { response: { status: 401 } }));
    await expect(garmin.deregisterUser('stale')).rejects.toThrow('unauthorized');
  });
});
