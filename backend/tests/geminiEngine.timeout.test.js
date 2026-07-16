'use strict';

// Wave-0: the vetted Groq provider is the only path. The request timeout is enforced by
// the HTTP client (axios `timeout` option); a timed-out request rejects and surfaces to
// the caller, which then degrades to the deterministic fallback.

process.env.NODE_ENV       = 'test';
process.env.LLM_API_KEY    = 'test-llm-key';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.GEMINI_API_KEY;

jest.mock('axios');
const axios = require('axios');

const { buildEmotionPlaylist } = require('../app/services/geminiEngine');

describe('LLM request timeout', () => {
  it('surfaces a timeout error to the caller and set a bounded request timeout', async () => {
    // axios enforces the per-request timeout; a timed-out request rejects (ECONNABORTED).
    axios.post.mockRejectedValue(Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }));
    const profile = {
      topGenres: ['pop'], tempoBaseline: 120, energy: 0.6, valence: 0.7, acousticness: 0.3, library: [],
    };
    await expect(
      buildEmotionPlaylist({
        musicProfile: profile,
        emotionTaps: [{ x: 0.5, y: 0.5 }],
        fetchTracks: async () => [],
      })
    ).rejects.toThrow(/timeout/i);
    // The outbound call carried a bounded per-request timeout.
    expect(axios.post.mock.calls[0][2]).toEqual(expect.objectContaining({ timeout: expect.any(Number) }));
  });
});
