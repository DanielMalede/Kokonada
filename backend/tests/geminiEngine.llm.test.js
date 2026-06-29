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

const { buildEmotionPlaylist, critiqueTrackVibe } = require('../app/services/geminiEngine');

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
    // Params are mood-normalized (strict vibe enforced) but the LLM's audio targets survive.
    expect(result.params.target_bpm).toBe(120);
    expect(result.params.exclude_genres.length).toBeGreaterThan(0);
    expect(fetchTracks).toHaveBeenCalledWith(result.params);
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

  it('threads a variety seed into the prompt so repeated presses differ', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(VALID) } }] } });
    const fetchTracks = jest.fn().mockResolvedValue([]);

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks, seed: 'press-1' });
    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks, seed: 'press-2' });

    const content1 = axios.post.mock.calls[0][1].messages[0].content;
    const content2 = axios.post.mock.calls[1][1].messages[0].content;
    expect(content1).toContain('press-1');
    expect(content1).not.toEqual(content2); // different seed → different prompt → different cache key
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

// ── Layer 2: Groq critic re-rank (vibe energy filter) ─────────────────────────

describe('critiqueTrackVibe', () => {
  beforeEach(() => jest.clearAllMocks());

  const TRACKS = [
    { id: 'a', name: 'Soft Ballad', artists: [{ name: 'Calm Artist' }] },
    { id: 'b', name: 'Banger',      artists: [{ name: 'Loud Artist' }] },
    { id: 'c', name: 'Mid Tempo',   artists: [{ name: 'Some Artist' }] },
  ];

  it('keeps only the indices the critic returns, mapped back to track objects', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify({ keep: [1, 2] }) } }] } });
    const out = await critiqueTrackVibe({ tracks: TRACKS, moodKey: 'intense', moodKeywords: ['heavy'] });
    expect(out.map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('fails open (returns the pool unchanged) on invalid JSON', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'not json at all' } }] } });
    const out = await critiqueTrackVibe({ tracks: TRACKS, moodKey: 'intense' });
    expect(out).toEqual(TRACKS);
  });

  it('treats an empty keep array as "no signal" and passes the pool through (never blanks)', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify({ keep: [] }) } }] } });
    const out = await critiqueTrackVibe({ tracks: TRACKS, moodKey: 'intense' });
    expect(out).toEqual(TRACKS);
  });

  it('ignores out-of-range and non-integer indices from a hallucinating model', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify({ keep: [0, 99, 'x', 2.5, 2] }) } }] } });
    const out = await critiqueTrackVibe({ tracks: TRACKS, moodKey: 'calm' });
    expect(out.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('does not call the LLM for an empty pool', async () => {
    const out = await critiqueTrackVibe({ tracks: [], moodKey: 'intense' });
    expect(out).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('passes through without an LLM call when there is no mood (HR branch safety)', async () => {
    const out = await critiqueTrackVibe({ tracks: TRACKS, moodKey: null });
    expect(out).toEqual(TRACKS);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
