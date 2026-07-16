'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Wave-0 egress containment — outbound-body snapshot guards.
//
// These are the PERMANENT regression guards for the LLM egress boundary. They snapshot
// the ACTUAL serialized outbound request body (the Groq chat/completions `messages`
// content) and assert it carries NO special-category vitals, NO raw free-text, NO Spotify
// Content (artist names / Spotify-derived genres). Sentinel values are planted in every
// input so a future re-introduction of any leak fails loudly here.
// ─────────────────────────────────────────────────────────────────────────────

process.env.NODE_ENV    = 'test';
process.env.LLM_API_KEY = 'test-llm-key';
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

jest.mock('axios');
const axios = require('axios');

const {
  buildEmotionPlaylist,
  adjustBiometricPlaylist,
  inferArtistGenres,
} = require('../app/services/geminiEngine');

const VALID = {
  target_bpm: 120, target_energy: 0.8, target_valence: 0.7,
  target_acousticness: 0.1, seed_artists: [], seed_genres: ['ambient'],
};

// A profile whose Spotify-derived genre footprint + artist names are all SENTINELS.
const SENTINEL_PROFILE = {
  topGenres: ['SENTINEL_GENRE_TOP'],
  genreSet:  ['SENTINEL_GENRE_SETX', 'SENTINEL_GENRE_SETY'],
  topArtists: ['SENTINEL_ARTIST_NAME'],
  tempoBaseline: 120, energy: 0.6, valence: 0.5, acousticness: 0.3, restingHeartRate: 471,
};

function mockLLM(obj = VALID) {
  axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
}
function outboundBody() {
  return axios.post.mock.calls[0][1].messages[0].content;
}

beforeEach(() => jest.clearAllMocks());

// ── T0.1: numeric vitals + inferred-state label never leave the server ─────────

describe('outbound body — no special-category vitals (T0.1)', () => {
  // Sentinel vitals: distinctive numbers that could only appear if a vital leaked.
  const SENTINEL_BIO = {
    stateLabel: 'SENTINEL_STATE_LABEL',
    heartRate: 913, restingHeartRate: 471, hrRatio: 1.53,
    hrv: 917, bodyBattery: 771, dailyReadiness: 733, spO2: 883,
    sleep: { deep: 425, light: 611, rem: 522 },
  };

  it('the EMOTION request carries no vital value and no state label', async () => {
    mockLLM();
    await buildEmotionPlaylist({
      musicProfile: SENTINEL_PROFILE, emotionTaps: [{ x: 0.45, y: -0.55 }],
      biometricContext: SENTINEL_BIO, fetchTracks: jest.fn().mockResolvedValue([]),
    });
    const body = outboundBody();
    for (const n of [913, 471, 917, 771, 733, 883, 425, 611, 522]) {
      expect(body).not.toContain(String(n));
    }
    expect(body).not.toContain('SENTINEL_STATE_LABEL');
    expect(body).not.toMatch(/HRV|SpO2|body battery|readiness|resting HR|physiological state/i);
  });

  it('the BIOMETRIC request carries no numeric heart rate / resting HR', async () => {
    mockLLM();
    await adjustBiometricPlaylist({
      musicProfile: SENTINEL_PROFILE, biometric: { heartRate: 913, activity: 'running' },
      fetchTracks: jest.fn().mockResolvedValue([]),
    });
    const body = outboundBody();
    expect(body).not.toContain('913'); // current HR
    expect(body).not.toContain('471'); // resting HR (from the profile)
    expect(body).not.toMatch(/heart rate|resting/i);
  });

  it('still applies the vitals as deterministic target bands AFTER the LLM returns', async () => {
    mockLLM({ ...VALID, target_bpm: 128, target_energy: 0.85 });
    const fetchTracks = jest.fn().mockResolvedValue([]);
    await buildEmotionPlaylist({
      musicProfile: SENTINEL_PROFILE, emotionTaps: [{ x: 0.45, y: -0.55 }],
      biometricContext: { stateLabel: 'Resting / Meditative' }, fetchTracks,
    });
    // Resting band pulls BPM/energy down from the LLM's raw picks — deterministically.
    const passed = fetchTracks.mock.calls[0][0];
    expect(passed.target_bpm).toBeLessThan(128);
    expect(passed.target_energy).toBeLessThan(0.85);
  });
});

// ── T0.2: raw free-text never leaves the process ──────────────────────────────

describe('outbound body — no raw free-text (T0.2)', () => {
  const NOTE = 'my name is Daniel Malede and my SSN is 123-45-6789, I want to go for a run';

  it('the EMOTION request contains no substring of the raw note', async () => {
    mockLLM();
    await buildEmotionPlaylist({
      musicProfile: SENTINEL_PROFILE, emotionTaps: [{ x: 0.45, y: -0.55 }], // calm
      textPrompt: NOTE, fetchTracks: jest.fn().mockResolvedValue([]),
    });
    const body = outboundBody();
    expect(body).not.toContain('Daniel');
    expect(body).not.toContain('Malede');
    expect(body).not.toContain('123-45-6789');
    expect(body).not.toContain('SSN');
    expect(body).not.toMatch(/user note/i);
  });

  it('still applies the derived movement cue deterministically (run → peak) server-side', async () => {
    mockLLM();
    const fetchTracks = jest.fn().mockResolvedValue([]);
    const { params } = await buildEmotionPlaylist({
      musicProfile: SENTINEL_PROFILE, emotionTaps: [{ x: 0.45, y: -0.55 }], // calm mood
      textPrompt: 'going for a run', fetchTracks,
    });
    expect(params.tempo_category).toBe('peak');
  });
});

// ── T0.3: Spotify Content (artist names / Spotify-derived genres) out of prompts ─

describe('outbound body — no Spotify Content (T0.3)', () => {
  it('the EMOTION request carries no Spotify-derived genre strings and no artist names', async () => {
    mockLLM();
    await buildEmotionPlaylist({
      musicProfile: SENTINEL_PROFILE, emotionTaps: [{ x: 0.1, y: 0.95 }], // intense
      fetchTracks: jest.fn().mockResolvedValue([]),
    });
    const body = outboundBody();
    // The profile's Spotify-derived footprint sentinels never appear…
    expect(body).not.toContain('SENTINEL_GENRE_TOP');
    expect(body).not.toContain('SENTINEL_GENRE_SETX');
    expect(body).not.toContain('SENTINEL_GENRE_SETY');
    expect(body).not.toContain('SENTINEL_ARTIST_NAME');
    // …but the mood descriptor allow-list genres DO (deterministic, first-party vocabulary).
    expect(body).toContain('metal');
  });
});

// ── Hardening H1: client activity is validated to the preset enum ─────────────

describe('outbound body — client activity is preset-validated (H1)', () => {
  it('an arbitrary client activity chip never reaches the outbound request', async () => {
    mockLLM();
    await buildEmotionPlaylist({
      musicProfile: SENTINEL_PROFILE, emotionTaps: [{ x: 0.1, y: 0.95 }],
      activity: 'SENTINEL_ACTIVITY_INJECTION <script>', fetchTracks: jest.fn().mockResolvedValue([]),
    });
    const body = outboundBody();
    expect(body).not.toContain('SENTINEL_ACTIVITY_INJECTION');
    expect(body).not.toContain('<script>');
  });
});

// ── Hardening M1: emotionTaps are reduced to {x,y} only ───────────────────────

describe('outbound body — emotionTaps carry only x/y (M1)', () => {
  it('extra client-supplied keys on a tap object never reach the outbound request', async () => {
    mockLLM();
    await buildEmotionPlaylist({
      musicProfile: SENTINEL_PROFILE,
      emotionTaps: [{ x: 0.1, y: 0.95, pii: 'SENTINEL_TAP_PII', note: '<injected>' }],
      fetchTracks: jest.fn().mockResolvedValue([]),
    });
    const body = outboundBody();
    expect(body).not.toContain('SENTINEL_TAP_PII');
    expect(body).not.toContain('<injected>');
    expect(body).not.toContain('pii');
    // The coordinates themselves are still present.
    expect(body).toContain('0.1');
    expect(body).toContain('0.95');
  });
});

// ── T0.4: fail closed — no vetted provider means NO LLM call at all ────────────

describe('no vetted provider → fail closed (T0.4)', () => {
  it('throws instead of ever calling an unvetted endpoint', async () => {
    const saved = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      await expect(buildEmotionPlaylist({
        musicProfile: SENTINEL_PROFILE, emotionTaps: [{ x: 0.1, y: 0.95 }], fetchTracks: jest.fn(),
      })).rejects.toThrow(/vetted LLM provider/i);
      expect(axios.post).not.toHaveBeenCalled(); // no HTTP request to ANY endpoint
    } finally {
      process.env.LLM_API_KEY = saved;
    }
  });
});

// ── byLower case-map guard (inferArtistGenres must NOT be modified) ────────────

describe('inferArtistGenres — byLower case-map guard', () => {
  it('restores the caller-supplied original-case artist names from lowercased model keys', async () => {
    axios.post.mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({ 'the beatles': ['rock', 'pop'], u2: ['post-punk'] }) } }] },
    });
    const out = await inferArtistGenres(['The Beatles', 'U2']);
    expect(out).toEqual({ 'The Beatles': ['rock', 'pop'], U2: ['post-punk'] });
  });
});
