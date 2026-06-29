'use strict';

// Exercises the OpenAI-compatible provider path (e.g. Groq) used when LLM_API_KEY
// is set instead of a Gemini key. Env is isolated per test file by Jest.
process.env.NODE_ENV   = 'test';
process.env.LLM_API_KEY = 'test-llm-key';
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

jest.mock('axios');
const axios = require('axios');

// The Gemini SDK must still be importable even though this path never calls it.
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: jest.fn() })),
}));

const { buildEmotionPlaylist } = require('../app/services/geminiEngine');

const MUSIC_PROFILE = {
  topGenres: ['electronic', 'indie'], tempoBaseline: 120,
  energy: 0.7, valence: 0.6, acousticness: 0.2, restingHeartRate: 65,
};
const VALID = {
  target_bpm: 120, target_energy: 0.8, target_valence: 0.7,
  target_acousticness: 0.1, seed_artists: [], seed_genres: ['electronic'],
};
const emotionTaps = [{ x: 0.5, y: 0.5 }];

describe('OpenAI-compatible LLM provider (e.g. Groq)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs to the configured base URL with a Bearer key and parses choices[0].message.content', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(VALID) } }] } });
    const fetchTracks = jest.fn().mockResolvedValue([{ id: 'x', uri: 'spotify:track:7ouMYWpwJ422jRcDASZB7P' }]);

    const result = await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({ messages: [{ role: 'user', content: expect.any(String) }] }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-llm-key' }) }),
    );
    expect(result.params).toEqual(VALID);
    expect(fetchTracks).toHaveBeenCalledWith(VALID);
  });

  it('throws (so the caller can fall back) when the provider returns invalid JSON', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'sorry, here is a playlist' } }] } });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn() }),
    ).rejects.toThrow('invalid JSON');
  });

  it('throws on an empty completion (e.g. provider rate-limit body)', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '' } }] } });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn() }),
    ).rejects.toThrow('empty response');
  });

  it('surfaces the provider error message on a model 404 (not axios\'s opaque text)', async () => {
    axios.post.mockRejectedValue({
      response: { status: 404, data: { error: { message: 'The model `foo` does not exist or you do not have access to it.' } } },
    });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn() }),
    ).rejects.toThrow('does not exist');
  });
});
