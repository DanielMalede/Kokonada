'use strict';

// Unit test for the YouTube service's OAuth client resolution. Production hit
// `Error 401: invalid_client` ("OAuth client was not found") because
// YOUTUBE_CLIENT_ID was unset and an empty client_id reached Google. The service
// now falls back to the GOOGLE_* OAuth client the login flow already uses.

const KEYS = [
  'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
];
const saved = {};
beforeEach(() => KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; }));
afterEach(() => KEYS.forEach(k => {
  if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
}));

jest.mock('axios');
const axios = require('axios');

// Helpers read process.env at call time, so a single require is fine.
const youtube = require('../app/services/youtube');

describe('youtube service — OAuth client resolution', () => {
  it('getAuthUrl falls back to GOOGLE_CLIENT_ID when YOUTUBE_CLIENT_ID is unset', () => {
    process.env.GOOGLE_CLIENT_ID = 'google-login-client-123';
    process.env.YOUTUBE_REDIRECT_URI = 'https://backend/api/integrations/youtube/callback';
    expect(youtube.getAuthUrl('state-abc')).toContain('client_id=google-login-client-123');
  });

  it('getAuthUrl prefers a dedicated YOUTUBE_CLIENT_ID over the Google fallback', () => {
    process.env.YOUTUBE_CLIENT_ID = 'dedicated-yt-client';
    process.env.GOOGLE_CLIENT_ID = 'google-login-client-123';
    process.env.YOUTUBE_REDIRECT_URI = 'https://backend/cb';
    expect(youtube.getAuthUrl('s')).toContain('client_id=dedicated-yt-client');
  });

  it('isConfigured() is false when no client id / redirect uri is available', () => {
    expect(youtube.isConfigured()).toBe(false);
  });

  it('isConfigured() is true once a client (via GOOGLE_*) and redirect uri are set', () => {
    process.env.GOOGLE_CLIENT_ID = 'g';
    process.env.GOOGLE_CLIENT_SECRET = 'gs';
    process.env.YOUTUBE_REDIRECT_URI = 'https://b/cb';
    expect(youtube.isConfigured()).toBe(true);
  });
});

describe('youtube service — exchangeCodeFromGIS error surfacing', () => {
  afterEach(() => jest.resetAllMocks());

  it('surfaces Google\'s error code (not axios\'s opaque message) and a 400 status', async () => {
    axios.post.mockRejectedValueOnce({
      message: 'Request failed with status code 401',
      response: { status: 401, data: { error: 'invalid_client', error_description: 'Unauthorized' } },
    });
    await expect(youtube.exchangeCodeFromGIS('any-code')).rejects.toMatchObject({
      message: 'youtube_exchange_invalid_client',
      statusCode: 400,
    });
  });

  it('rethrows the original error when Google returns no { error } body', async () => {
    const original = new Error('socket hang up');
    axios.post.mockRejectedValueOnce(original);
    await expect(youtube.exchangeCodeFromGIS('any-code')).rejects.toBe(original);
  });
});
