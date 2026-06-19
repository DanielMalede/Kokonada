'use strict';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 20_000))
      ),
    }),
  })),
}));

process.env.GEMINI_API_KEY = 'a'.repeat(39);
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { buildEmotionPlaylist } = require('../app/services/geminiEngine');

describe('geminiEngine timeout', () => {
  it('rejects with a timeout error when Gemini takes longer than 5s', async () => {
    const profile = {
      topGenres: ['pop'],
      tempoBaseline: 120,
      energy: 0.6,
      valence: 0.7,
      acousticness: 0.3,
      library: [],
    };
    await expect(
      buildEmotionPlaylist({
        musicProfile: profile,
        emotionTaps: [{ x: 0.5, y: 0.5 }],
        fetchTracks: async () => [],
      })
    ).rejects.toThrow(/timeout/i);
  }, 8_000);
});
