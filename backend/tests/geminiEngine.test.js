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
  inferArtistGenres,
  _parseAndValidate,
  _buildEmotionPrompt,
  _buildBiometricPrompt,
  TEMPO_CATEGORIES,
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

// ── _parseAndValidate — tempo_category (manual mood flow, lenient) ─────────────

describe('_parseAndValidate — tempo_category', () => {
  it('preserves a valid tempo_category', () => {
    for (const cat of TEMPO_CATEGORIES) {
      const out = _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, tempo_category: cat }));
      expect(out.tempo_category).toBe(cat);
    }
  });

  it('DROPS an invalid tempo_category (lenient — never throws, never blanks a generation)', () => {
    const out = _parseAndValidate(JSON.stringify({ ...VALID_AI_PARAMS, tempo_category: 'turbo' }));
    expect(out.tempo_category).toBeUndefined();
    // ...the rest of the params survive untouched.
    expect(out.target_bpm).toBe(128);
  });

  it('does not inject tempo_category when absent (params stay exact)', () => {
    expect(_parseAndValidate(JSON.stringify(VALID_AI_PARAMS))).toEqual(VALID_AI_PARAMS);
  });
});

// ── _buildEmotionPrompt — tempo_category (free-text overrides the mode) ────────

describe('_buildEmotionPrompt — tempo_category', () => {
  const emotionTaps = [{ x: 0.45, y: -0.55 }]; // calm

  it('asks the model for a tempo_category from the resting/active/peak enum', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).toContain('tempo_category');
    TEMPO_CATEGORIES.forEach((c) => expect(prompt).toContain(c));
  });

  it('never interpolates the raw note; the movement override is applied server-side', () => {
    // The prompt carries only derived intent tags, not the raw sentence.
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, 'going for a run');
    expect(prompt).not.toContain('going for a run');
    expect(prompt).not.toMatch(/user note/i);
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

  it('draws allowed genres from the resolved MOOD allow-list, not the Spotify profile (Wave-0 T0.3)', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null); // intense mood
    expect(prompt).toContain('metal');       // intense allow-list genre
    expect(prompt).toContain('hardcore');
    // The user's Spotify-derived profile genres are NOT injected.
    expect(prompt).not.toContain('electronic');
    expect(prompt).not.toContain('indie');
  });

  it('includes emotion tap coordinates', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).toContain('0.5');
    expect(prompt).toContain('0.3');
  });

  it('NEVER embeds the raw free-text note; only closed-vocabulary derived tags (Wave-0 T0.2)', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, 'Need to focus on studying, my name is Bob');
    expect(prompt).not.toContain('Need to focus on studying');
    expect(prompt).not.toContain('Bob');
    expect(prompt).not.toMatch(/user note/i);
    // The derived intent tags DO appear (deterministic, closed-vocabulary).
    expect(prompt).toContain('Derived listener intent');
    expect(prompt).toContain('focus');
  });

  it('omits the derived-intent line entirely when there is no note', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).not.toContain('User note');
    expect(prompt).not.toContain('Derived listener intent');
  });

  it('does not expose user PII in the prompt', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).not.toMatch(/userId|email/i);
  });

  it('constrains seed_genres to the mood allow-list, never the Spotify-derived profile', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null); // intense
    expect(prompt).toContain('allowed list: metal');
    expect(prompt).not.toContain('electronic');
  });

  it('injects a strict-curator directive naming the mood exclude genres (zero-tolerance)', () => {
    const intenseTaps = [{ x: 0.1, y: 0.95 }];
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, intenseTaps, null);
    expect(prompt.toLowerCase()).toMatch(/strict curator|must avoid|never include/);
    // A specific INTENSE exclude genre that is NOT already present in the base prompt.
    expect(prompt).toContain('singer-songwriter');
  });

  it('includes the selected activity when provided', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, null, { activity: 'Running' });
    expect(prompt).toContain('Current activity: Running');
    expect(prompt.toLowerCase()).toMatch(/weigh the user's current activity/);
  });

  it('omits the activity line when no activity is selected', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).not.toContain('Current activity:');
  });

  it('NEVER renders a biometric snapshot or vitals into the prompt (Wave-0 egress containment)', () => {
    // The emotion prompt no longer accepts a biometricContext — vitals steer targets
    // deterministically AFTER the LLM (applyBiometricBands), so they never appear here.
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, null, {});
    expect(prompt).not.toContain('Last-24h biometric snapshot:');
    expect(prompt).not.toMatch(/HRV|SpO2|body battery|readiness|resting HR|physiological state/i);
    expect(prompt).not.toMatch(/last sleep|\d+m deep/);
  });
});

// ── LLM genre backfill (moods work when Spotify serves no genres) ──────────────

describe('inferArtistGenres', () => {
  it('returns a lowercased, deduped artist→genres map from the LLM JSON', async () => {
    makeGeminiResponse({ Bonobo: ['Downtempo', 'Electronic', 'electronic'], Tycho: ['Ambient'] });
    const out = await inferArtistGenres(['Bonobo', 'Tycho']);
    expect(out).toEqual({ Bonobo: ['downtempo', 'electronic'], Tycho: ['ambient'] });
  });

  it('returns {} for empty input without calling the model', async () => {
    expect(await inferArtistGenres([])).toEqual({});
  });

  it('fails open to {} when the LLM errors', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('boom'));
    expect(await inferArtistGenres(['X'])).toEqual({});
  });

  it('maps a case-mismatched LLM key back to the CALLER-supplied exact-case artist name (the model does not reliably honor "EXACT artist names" in the prompt)', async () => {
    // Real Groq responses lowercase JSON keys regardless of the prompt instruction — reproduced
    // live against prod during the Wave-1 global-seed data run (all 200 genres silently dropped).
    makeGeminiResponse({ 'the beatles': ['rock', 'pop'], u2: ['post-punk'] });
    const out = await inferArtistGenres(['The Beatles', 'U2']);
    expect(out).toEqual({ 'The Beatles': ['rock', 'pop'], U2: ['post-punk'] });
  });
});

// ── Prompt variety (deterministic per-seed variation line) ────────────────────
// Wave-0 removed the Spotify-genre micro-genre seed shifting; variety now comes from the
// deterministic per-press variation token (and the ledger/MMR downstream).

describe('prompt variety', () => {
  const emotionTaps = [{ x: 0.4, y: 0.2 }];

  it('is deterministic for a given seed', () => {
    const a = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, 'seed-X');
    const b = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, 'seed-X');
    expect(a).toEqual(b);
  });

  it('varies the prompt across presses via the variation token', () => {
    const a = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, 'seed-0');
    const b = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, 'seed-1');
    expect(a).not.toEqual(b);
  });
});

// ── _buildBiometricPrompt ──────────────────────────────────────────────────────

describe('_buildBiometricPrompt', () => {
  const biometric = { heartRate: 155, activity: 'running' };

  it('NEVER includes the numeric heart rate or resting HR (Wave-0 egress containment)', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt).not.toContain('155');                 // current HR must not leak
    expect(prompt).not.toContain('65');                  // resting HR must not leak
    expect(prompt).not.toMatch(/heart rate|resting/i);
  });

  it('carries the coarse physiological band instead of raw vitals', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt.toLowerCase()).toContain('intensity band: peak'); // 155 bpm → peak band
  });

  it('includes the current activity', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt).toContain('running');
  });

  it('does not expose user PII', () => {
    const prompt = _buildBiometricPrompt(MUSIC_PROFILE, biometric);
    expect(prompt).not.toMatch(/userId|email/i);
  });

  it('instructs the model to return BPM, energy and acoustics parameters', () => {
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

  it('calls fetchTracks with the normalized (mood-enforced) parameters', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: spotifyFetch });
    expect(spotifyFetch).toHaveBeenCalledTimes(1);
    const passed = spotifyFetch.mock.calls[0][0];
    expect(passed.target_bpm).toBe(128);                 // LLM audio targets preserved
    expect(passed.exclude_genres.length).toBeGreaterThan(0); // strict vibe attached
  });

  it('returns both params and tracks (audio targets preserved)', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    const result = await buildEmotionPlaylist({
      musicProfile: MUSIC_PROFILE,
      emotionTaps,
      fetchTracks: spotifyFetch,
    });
    expect(result.params.target_bpm).toBe(128);
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

// ── buildEmotionPlaylist — strict mood fallback (zero-tolerance vibe) ──────────

describe('buildEmotionPlaylist — strict mood fallback', () => {
  const intenseTaps = [{ x: 0.1, y: 0.95 }];
  const fetch = jest.fn().mockResolvedValue([]);

  beforeEach(() => {
    fetch.mockClear();
    mockGenerateContent.mockClear();
  });

  it('overrides an off-vibe LLM genre pick + attaches exclude_genres in the params fed to search', async () => {
    makeGeminiResponse({ ...VALID_AI_PARAMS, seed_genres: ['jazz'] });
    const res = await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps: intenseTaps, fetchTracks: fetch });
    const passed = fetch.mock.calls[0][0];
    expect(passed.seed_genres).not.toContain('jazz');
    expect(passed.exclude_genres).toEqual(expect.arrayContaining(['acoustic']));
    expect(res.params.exclude_genres).toEqual(expect.arrayContaining(['acoustic']));
  });

  it('preserves the LLM audio targets while overriding the vibe genres', async () => {
    makeGeminiResponse({ ...VALID_AI_PARAMS, target_bpm: 142 });
    const res = await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps: intenseTaps, fetchTracks: fetch });
    expect(res.params.target_bpm).toBe(142);
  });
});

// ── adjustBiometricPlaylist — empty-genre robustness ───────────────────────────

describe('adjustBiometricPlaylist — empty seed_genres robustness', () => {
  const biometric = { heartRate: 150, activity: 'running' };
  const fetch = jest.fn().mockResolvedValue([]);

  beforeEach(() => {
    fetch.mockClear();
    mockGenerateContent.mockClear();
  });

  it('backfills seed_genres from the user top genres when the LLM returns none', async () => {
    makeGeminiResponse({ ...VALID_AI_PARAMS, seed_genres: [] });
    const res = await adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric, fetchTracks: fetch });
    expect(res.params.seed_genres.length).toBeGreaterThan(0);
    res.params.seed_genres.forEach((g) => expect(MUSIC_PROFILE.topGenres).toContain(g));
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

  it('calls YouTube fetchTracks with the normalized (mood-enforced) parameters', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: youtubeFetch });
    expect(youtubeFetch).toHaveBeenCalledTimes(1);
    expect(youtubeFetch.mock.calls[0][0].target_bpm).toBe(128);
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

  it('applies the deterministic HR band to the params fed to search (no raw HR to the LLM)', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric, fetchTracks: spotifyFetch });
    const passed = spotifyFetch.mock.calls[0][0];
    // 155 bpm → peak band → target_bpm blended up from the LLM's 128 (deterministic).
    expect(passed.target_bpm).toBe(140);
    expect(passed.target_energy).toBeCloseTo(0.875, 5);
    expect(passed.seed_genres.length).toBeGreaterThan(0);
  });

  it('returns banded params and tracks', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    const result = await adjustBiometricPlaylist({
      musicProfile: MUSIC_PROFILE,
      biometric,
      fetchTracks: spotifyFetch,
    });
    expect(result.params.target_bpm).toBe(140);
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

  it('applies the deterministic HR band to the YouTube params (60 bpm → resting band)', async () => {
    makeGeminiResponse(VALID_AI_PARAMS);
    await adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric, fetchTracks: youtubeFetch });
    const passed = youtubeFetch.mock.calls[0][0];
    // 60 bpm → resting band → target_bpm blended down from the LLM's 128 (deterministic).
    expect(passed.target_bpm).toBe(108);
    expect(passed.seed_genres.length).toBeGreaterThan(0);
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
