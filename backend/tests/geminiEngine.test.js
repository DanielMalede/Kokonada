'use strict';

process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.NODE_ENV = 'test';

// Mock must be declared before require() calls — Jest hoists these
const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({
    getGenerativeModel: jest.fn(() => ({
      generateContent: mockGenerateContent,
    })),
  })),
}));

const {
  buildEmotionPlaylist,
  adjustBiometricPlaylist,
  _parseAndValidate,
  _buildEmotionPrompt,
  _buildBiometricPrompt,
} = require('../app/services/geminiEngine');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MUSIC_PROFILE = {
  topGenres: ['electronic', 'indie', 'ambient'],
  tempoBaseline: 120,
  energy: 0.7,
  valence: 0.6,
  acousticness: 0.2,
  restingHeartRate: 65,
};

const VALID_AI_PARAMS = {
  target_bpm: 128,
  target_energy: 0.85,
  target_valence: 0.75,
  target_acousticness: 0.1,
  seed_artists: ['Bonobo', 'Tycho'],
  seed_genres: ['electronic', 'ambient'],
};

function makeGeminiResponse(obj) {
  mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => JSON.stringify(obj) },
  });
}

// ── _parseAndValidate ──────────────────────────────────────────────────────────

describe('_parseAndValidate', () => {
  it('throws on non-JSON string', () => {
    expect(() => _parseAndValidate('not json at all')).toThrow('invalid JSON');
  });

  it('throws when target_bpm is missing', () => {
    const { target_bpm: _omit, ...rest } = VALID_AI_PARAMS;
    expect(() => _parseAndValidate(JSON.stringify(rest))).toThrow('target_bpm');
  });

  it('throws when target_energy is above 1', () => {
    expect(() =>
      _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, target_energy: 1.5 }))
    ).toThrow('target_energy');
  });

  it('throws when target_valence is below 0', () => {
    expect(() =>
      _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, target_valence: -0.1 }))
    ).toThrow('target_valence');
  });

  it('throws when target_acousticness is above 1', () => {
    expect(() =>
      _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, target_acousticness: 2 }))
    ).toThrow('target_acousticness');
  });

  it('throws when seed_artists is not an array', () => {
    expect(() =>
      _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, seed_artists: 'Bonobo' }))
    ).toThrow('seed_artists');
  });

  it('throws when seed_genres is not an array', () => {
    expect(() =>
      _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, seed_genres: 'electronic' }))
    ).toThrow('seed_genres');
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n' + JSON.stringify(VALID_AI_PARAMS) + '\n```';
    expect(_parseAndValidate(raw)).toMatchObject({ target_bpm: 128 });
  });

  it('returns the parsed object on valid input', () => {
    expect(_parseAndValidate(JSON.stringify(VALID_AI_PARAMS))).toEqual(VALID_AI_PARAMS);
  });

  // ── Hardening: empty / non-finite / out-of-range ─────────────────────────────

  it('throws on an empty string response', () => {
    expect(() => _parseAndValidate('')).toThrow('empty response');
  });

  it('throws on a whitespace-only response', () => {
    expect(() => _parseAndValidate('   \n  ')).toThrow('empty response');
  });

  it('throws on undefined / non-string (no crash in the catch)', () => {
    expect(() => _parseAndValidate(undefined)).toThrow('empty response');
    expect(() => _parseAndValidate(null)).toThrow('empty response');
  });

  it('throws when target_bpm is NaN (typeof NaN === "number" must not slip through)', () => {
    // NaN cannot survive JSON, so build the object and re-stringify a sentinel.
    expect(() => _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, target_bpm: 'x' }).replace('"x"', 'NaN')))
      .toThrow(/JSON|target_bpm/);
  });

  it('throws when target_bpm is below the sane floor', () => {
    expect(() => _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, target_bpm: -5 })))
      .toThrow('target_bpm');
  });

  it('throws when target_bpm is an absurdly high tempo', () => {
    expect(() => _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, target_bpm: 9999 })))
      .toThrow('target_bpm');
  });

  it('accepts a finite in-range target_bpm', () => {
    expect(_parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, target_bpm: 90 })).target_bpm).toBe(90);
  });
});

// ── _parseAndValidate — mood_keywords (post-audio-features mood signal) ────────

describe('_parseAndValidate — mood_keywords', () => {
  it('preserves a mood_keywords array when the model returns one', () => {
    const out = _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, mood_keywords: ['calm', 'acoustic'] }));
    expect(out.mood_keywords).toEqual(['calm', 'acoustic']);
  });

  it('throws when mood_keywords is present but not an array', () => {
    expect(() => _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, mood_keywords: 'calm' })))
      .toThrow('mood_keywords');
  });

  it('does not inject mood_keywords when absent (params stay exact)', () => {
    expect(_parseAndValidate(JSON.stringify(VALID_AI_PARAMS))).toEqual(VALID_AI_PARAMS);
  });
});

// ── _buildEmotionPrompt ────────────────────────────────────────────────────────

describe('_buildEmotionPrompt', () => {
  const emotionTaps = [{ x: 0.5, y: 0.3 }, { x: -0.2, y: 0.8 }];

  it('asks the model for mood_keywords (mood signal that replaces audio targets)', () => {
    expect(_buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null)).toContain('mood_keywords');
  });

  it('embeds a variety seed so identical taps yield a different prompt each press', () => {
    const a = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, 'seed-A');
    const b = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, 'seed-B');
    expect(a).toContain('seed-A');
    expect(a).not.toEqual(b);
  });

  it('omits the variation line when no seed is given (back-compat)', () => {
    expect(_buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null)).not.toMatch(/variation/i);
  });

  it('includes every top genre from the music profile', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    MUSIC_PROFILE.topGenres.forEach(g => expect(prompt).toContain(g));
  });

  it('includes emotion tap coordinates', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).toContain('0.5');
    expect(prompt).toContain('0.3');
  });

  it('includes optional text prompt when provided', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, 'Need to focus on studying');
    expect(prompt).toContain('Need to focus on studying');
  });

  it('omits user note section when textPrompt is null', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).not.toContain('User note: ""');
  });

  it('does not expose user PII in the prompt', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).not.toMatch(/userId|email/i);
  });

  it('explicitly constrains seed_genres to the user top genres list', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).toContain('electronic');
    expect(prompt).toContain('indie');
    expect(prompt).toContain('ambient');
  });
});

// ── _buildBiometricPrompt ──────────────────────────────────────────────────────

describe('_buildBiometricPrompt', () => {
  const biometric = { heartRate: 155, activity: 'running' };

  it('includes the current heart rate', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt).toContain('155');
  });

  it('includes the current activity', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt).toContain('running');
  });

  it('includes resting heart rate for physiological context', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt).toContain('65');
  });

  it('does not expose user PII', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt).not.toMatch(/userId|email/i);
  });

  it('instructs Gemini to focus on BPM, energy and acoustics adjustments', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt.toLowerCase()).toMatch(/bpm|tempo|energy/);
  });
});

// ── buildEmotionPlaylist — Spotify provider ────────────────────────────────────

describe('buildEmotionPlaylist (Spotify provider)', () => {
  const emotionTaps = [{ x: 0.5, y: 0.3 }];
  const spotifyTracks = [{ id: 'spotify-track-1', name: 'Test Track', provider: 'spotify' }];
  const spotifyFetch = jest.fn().mockResolvedValue(spotifyTracks);

  beforeEach(() => {
    spotifyFetch.mockClear();
    mockGenerateContent.mockClear();
  });

  it('calls fetchTracks with the AI-generated parameters', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: spotifyFetch });
    expect(spotifyFetch).toHaveBeenCalledWith(VALID_AI_PARAMS);
  });

  it('returns both params and tracks', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    const result = await buildEmotionPlaylist({
      musicProfile: MUSIC_PROFILE,
      emotionTaps,
      fetchTracks: spotifyFetch,
    });
    expect(result.params).toEqual(VALID_AI_PARAMS);
    expect(result.tracks).toEqual(spotifyTracks);
  });

  it('includes optional textPrompt without breaking the pipeline', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await expect(
      buildEmotionPlaylist({
        musicProfile: MUSIC_PROFILE,
        emotionTaps,
        textPrompt: 'Focus music for deep work',
        fetchTracks: spotifyFetch,
      })
    ).resolves.toMatchObject({ params: VALID_AI_PARAMS });
  });

  it('propagates Gemini API errors', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Gemini API quota exceeded'));
    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: spotifyFetch })
    ).rejects.toThrow('Gemini API quota exceeded');
  });

  it('throws a clear error when Gemini returns prose instead of JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'Sure! Here is a great playlist for you...' },
    });
    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: spotifyFetch })
    ).rejects.toThrow('invalid JSON');
  });

  it('throws when Gemini JSON is missing required fields', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({ target_bpm: 120 }) },
    });
    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: spotifyFetch })
    ).rejects.toThrow('missing required field');
  });

  it('throws a clear error when Gemini returns an empty body (caller falls back)', async () => {
    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => '' } });
    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: spotifyFetch })
    ).rejects.toThrow('empty response');
    // A failed parse must NOT reach the recommendations call.
    expect(spotifyFetch).not.toHaveBeenCalled();
  });
});

// ── buildEmotionPlaylist — YouTube Music provider ──────────────────────────────

describe('buildEmotionPlaylist (YouTube Music provider)', () => {
  const emotionTaps = [{ x: -0.3, y: 0.6 }];
  const youtubeTracks = [{ videoId: 'yt-abc123', title: 'Chill Vibes', provider: 'youtube_music' }];
  const youtubeFetch = jest.fn().mockResolvedValue(youtubeTracks);

  beforeEach(() => {
    youtubeFetch.mockClear();
    mockGenerateContent.mockClear();
  });

  it('calls YouTube fetchTracks with the same AI parameters', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: youtubeFetch });
    expect(youtubeFetch).toHaveBeenCalledWith(VALID_AI_PARAMS);
  });

  it('returns YouTube tracks in the result', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    const result = await buildEmotionPlaylist({
      musicProfile: MUSIC_PROFILE,
      emotionTaps,
      fetchTracks: youtubeFetch,
    });
    expect(result.tracks).toEqual(youtubeTracks);
  });
});

// ── adjustBiometricPlaylist — Spotify provider ─────────────────────────────────

describe('adjustBiometricPlaylist (Spotify provider)', () => {
  const biometric = { heartRate: 155, activity: 'running' };
  const spotifyTracks = [{ id: 'spotify-track-2', name: 'High Energy Track' }];
  const spotifyFetch = jest.fn().mockResolvedValue(spotifyTracks);

  beforeEach(() => {
    spotifyFetch.mockClear();
    mockGenerateContent.mockClear();
  });

  it('calls fetchTracks with biometric-adjusted parameters', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric, fetchTracks: spotifyFetch });
    expect(spotifyFetch).toHaveBeenCalledWith(VALID_AI_PARAMS);
  });

  it('returns both params and tracks', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    const result = await adjustBiometricPlaylist({
      musicProfile: MUSIC_PROFILE,
      biometric,
      fetchTracks: spotifyFetch,
    });
    expect(result.params).toEqual(VALID_AI_PARAMS);
    expect(result.tracks).toEqual(spotifyTracks);
  });

  it('propagates Gemini errors', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('network timeout'));
    await expect(
      adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric, fetchTracks: spotifyFetch })
    ).rejects.toThrow('network timeout');
  });

  it('throws when Gemini response is missing required fields', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({ target_bpm: 128, target_energy: 0.9 }) },
    });
    await expect(
      adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric, fetchTracks: spotifyFetch })
    ).rejects.toThrow('missing required field');
  });

  it('throws when Gemini returns out-of-range energy', async () => {
    makeGeminiResponse({ ...VALID_AI_PARAMS, target_energy: 1.5 });
    await expect(
      adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric, fetchTracks: spotifyFetch })
    ).rejects.toThrow('target_energy');
  });
});

// ── adjustBiometricPlaylist — YouTube Music provider ──────────────────────────

describe('adjustBiometricPlaylist (YouTube Music provider)', () => {
  const biometric = { heartRate: 60, activity: 'resting' };
  const youtubeTracks = [{ videoId: 'yt-xyz789', title: 'Lo-fi Chill', provider: 'youtube_music' }];
  const youtubeFetch = jest.fn().mockResolvedValue(youtubeTracks);

  beforeEach(() => {
    youtubeFetch.mockClear();
    mockGenerateContent.mockClear();
  });

  it('calls YouTube fetchTracks with biometric-adjusted parameters', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric, fetchTracks: youtubeFetch });
    expect(youtubeFetch).toHaveBeenCalledWith(VALID_AI_PARAMS);
  });

  it('returns YouTube tracks in the result', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    const result = await adjustBiometricPlaylist({
      musicProfile: MUSIC_PROFILE,
      biometric,
      fetchTracks: youtubeFetch,
    });
    expect(result.tracks).toEqual(youtubeTracks);
  });
});
