'use strict';

process.env.GARMIN_CONSUMER_KEY    = 'test_key';
process.env.GARMIN_CONSUMER_SECRET = 'test_secret';

jest.mock('axios');
const axios  = require('axios');
const garmin = require('../app/services/wearable/garmin');

describe('garmin.requestSixMonthBackfill', () => {
  beforeEach(() => { jest.clearAllMocks(); axios.get.mockResolvedValue({ status: 202, data: '' }); });

  it('requests backfill for every summary type in ≤90-day windows over ~6 months', async () => {
    await garmin.requestSixMonthBackfill('access', 'secret');

    const urls = axios.get.mock.calls.map(c => c[0]);
    for (const t of ['dailies', 'sleeps', 'hrv', 'stressDetails', 'respiration', 'pulseox']) {
      expect(urls.some(u => u.includes(`/backfill/${t}?`))).toBe(true);
    }
    // every call carries the time-window params
    expect(urls.every(u => /summaryStartTimeInSeconds=\d+&summaryEndTimeInSeconds=\d+/.test(u))).toBe(true);
    // 182 days / 90-day chunks = 3 windows per type × 6 types
    expect(axios.get).toHaveBeenCalledTimes(18);
  });

  it('swallows a 409 (backfill already requested) without throwing', async () => {
    axios.get.mockRejectedValue({ response: { status: 409 }, message: 'conflict' });
    await expect(garmin.requestSixMonthBackfill('access', 'secret')).resolves.toBeUndefined();
  });
});
