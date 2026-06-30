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
  _buildCriticPrompt,
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

  it('tells the model the user note OVERRIDES the mood for tempo', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, 'going for a run');
    expect(prompt.toLowerCase()).toMatch(/override|takes precedence|overrides/);
  });
});

// ── _buildCriticPrompt — tempo band ───────────────────────────────────────────

describe('_buildCriticPrompt — tempo band', () => {
  const tracks = [{ name: 'Song A', artists: [{ name: 'Artist A' }] }];

  it('states the target tempo band when a category is supplied', () => {
    const prompt = _buildCriticPrompt(tracks, 'calm', ['mellow'], 'resting');
    expect(prompt).toContain('RESTING');
    expect(prompt.toLowerCase()).toContain('target tempo band');
  });

  it('omits the band line when no category is supplied (back-compat)', () => {
    const prompt = _buildCriticPrompt(tracks, 'calm', ['mellow']);
    expect(prompt.toLowerCase()).not.toContain('target tempo band');
  });

  it('ignores an invalid category (no band line)', () => {
    const prompt = _buildCriticPrompt(tracks, 'calm', ['mellow'], 'turbo');
    expect(prompt.toLowerCase()).not.toContain('target tempo band');
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

  it('includes a last-24h biometric snapshot when provided', () => {
    const biometricContext = {
      stateLabel: 'High-Stress / Pre-Panic',
      heartRate: 92, restingHeartRate: 60, hrRatio: 1.53,
      hrv: 18, bodyBattery: 30, dailyReadiness: 40, spO2: 97,
      sleep: { deep: 40, light: 200, rem: 60 },
    };
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, null, { biometricContext });
    expect(prompt).toContain('Last-24h biometric snapshot:');
    expect(prompt).toContain('High-Stress / Pre-Panic');
    expect(prompt).toContain('HRV 18 ms');
    expect(prompt).toContain('body battery 30/100');
    expect(prompt).toContain('40m deep');
  });

  it('omits the biometric snapshot when no context is provided', () => {
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null);
    expect(prompt).not.toContain('Last-24h biometric snapshot:');
  });

  it('only lists biometric fields that are present (sparse profile)', () => {
    const biometricContext = {
      stateLabel: 'Neutral', heartRate: null, restingHeartRate: 58, hrRatio: null,
      hrv: null, bodyBattery: 72, dailyReadiness: null, spO2: null, sleep: null,
    };
    const prompt = _buildEmotionPrompt(MUSIC_PROFILE, emotionTaps, null, null, { biometricContext });
    expect(prompt).toContain('resting HR 58 bpm');
    expect(prompt).toContain('body battery 72/100');
    // The snapshot must omit the absent fields — match the formatted "HRV <n> ms"
    // token, not the directive sentence which mentions "low HRV" as an example.
    expect(prompt).not.toMatch(/HRV \d/);
    expect(prompt).not.toContain('last sleep');
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
});

// ── Micro-genre seed shifting (drive Spotify into distinct catalog sectors) ────

describe('micro-genre seed shifting', () => {
  const emotionTaps = [{ x: 0.4, y: 0.2 }];
  // A rich granular footprint (hyper-specific sub-genres) the rotation samples from.
  const RICH_PROFILE = {
    topGenres: ['pop'],
    genreSet: [
      'indie pop', 'post-punk', 'dream pop', 'shoegaze', 'synthwave', 'darkwave',
      'art punk', 'noise pop', 'jangle pop', 'coldwave', 'minimal synth', 'dark jazz',
      'neo-psychedelia', 'slowcore', 'chamber pop', 'baroque pop',
    ],
    tempoBaseline: 120, energy: 0.6, valence: 0.5, acousticness: 0.3, restingHeartRate: 60,
  };
  const subset = (prompt) => RICH_PROFILE.genreSet.filter((g) => prompt.includes(g));

  it('narrows the allowed genres to a SUBSET of the granular footprint (not all of it)', () => {
    const picked = subset(_buildEmotionPrompt(RICH_PROFILE, emotionTaps, null, 'seed-A'));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThan(RICH_PROFILE.genreSet.length);
  });

  it('is deterministic for a given seed', () => {
    const a = _buildEmotionPrompt(RICH_PROFILE, emotionTaps, null, 'seed-X');
    const b = _buildEmotionPrompt(RICH_PROFILE, emotionTaps, null, 'seed-X');
    expect(a).toEqual(b);
  });

  it('rotates which sub-genres are surfaced across presses (distinct catalog sectors)', () => {
    const seen = new Set();
    const onePress = subset(_buildEmotionPrompt(RICH_PROFILE, emotionTaps, null, 'seed-0')).length;
    for (let i = 0; i < 12; i++) {
      subset(_buildEmotionPrompt(RICH_PROFILE, emotionTaps, null, `seed-${i}`)).forEach((g) => seen.add(g));
    }
    // A fixed subset would only ever expose `onePress` sub-genres; rotation exceeds it.
    expect(seen.size).toBeGreaterThan(onePress);
  });

  it('the biometric (HR) prompt also rotates the micro-genre subset', () => {
    const picked = subset(_buildBiometricPrompt(RICH_PROFILE, { heartRate: 150, activity: 'running' }, 'seed-A'));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThan(RICH_PROFILE.genreSet.length);
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
