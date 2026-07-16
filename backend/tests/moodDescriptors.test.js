'use strict';

process.env.NODE_ENV = 'test';

const {
  MOODS,
  MOOD_DESCRIPTORS,
  TEMPO_CATEGORIES,
  resolveMoodKey,
  applyMoodFallback,
  buildMoodParams,
  biometricBand,
  applyBiometricBands,
  extractIntent,
} = require('../app/services/moodDescriptors');

// ── resolveMoodKey ─────────────────────────────────────────────────────────────

describe('resolveMoodKey', () => {
  it('returns null for empty taps', () => {
    expect(resolveMoodKey([])).toBeNull();
  });

  it('returns null for missing / malformed taps', () => {
    expect(resolveMoodKey(undefined)).toBeNull();
    expect(resolveMoodKey([{ x: 'nope', y: null }])).toBeNull();
  });

  it('maps every preset coordinate to its own key', () => {
    for (const m of MOODS) {
      expect(resolveMoodKey([{ x: m.x, y: m.y }])).toBe(m.key);
    }
  });

  it('nearest-neighbours a noisy tap to the closest mood (intense)', () => {
    // Near the intense preset (0.1, 0.95) but not exact.
    expect(resolveMoodKey([{ x: 0.12, y: 0.9 }])).toBe('intense');
  });

  it('uses the LAST tap when several are present', () => {
    expect(resolveMoodKey([{ x: 0.45, y: -0.55 }, { x: 0.1, y: 0.95 }])).toBe('intense');
  });
});

// ── MOOD_DESCRIPTORS shape ─────────────────────────────────────────────────────

describe('MOOD_DESCRIPTORS', () => {
  it('defines extreme, specific descriptors for all six moods', () => {
    for (const m of MOODS) {
      const d = MOOD_DESCRIPTORS[m.key];
      expect(d).toBeDefined();
      expect(d.allow_genres.length).toBeGreaterThan(0);
      expect(d.exclude_genres.length).toBeGreaterThan(0);
      expect(d.mood_keywords.length).toBeGreaterThan(0);
      expect(typeof d.energy_floor).toBe('number');
    }
  });

  it('keeps intense and calm sonically opposite (no genre overlap)', () => {
    const intense = MOOD_DESCRIPTORS.intense.allow_genres;
    const calm = MOOD_DESCRIPTORS.calm.allow_genres;
    expect(intense.some((g) => calm.includes(g))).toBe(false);
    // And each hard-excludes the other's signature genres.
    expect(MOOD_DESCRIPTORS.intense.exclude_genres).toEqual(expect.arrayContaining(['acoustic']));
    expect(MOOD_DESCRIPTORS.calm.exclude_genres).toEqual(expect.arrayContaining(['metal']));
  });

  it('defines non-empty vibe playlist_queries for all six moods (Layer-1 sourcing)', () => {
    for (const m of MOODS) {
      const d = MOOD_DESCRIPTORS[m.key];
      expect(Array.isArray(d.playlist_queries)).toBe(true);
      expect(d.playlist_queries.length).toBeGreaterThan(0);
      d.playlist_queries.forEach((q) => expect(typeof q).toBe('string'));
    }
  });
});

// ── applyMoodFallback ──────────────────────────────────────────────────────────

const LLM_PARAMS = {
  target_bpm: 120,
  target_energy: 0.5,
  target_valence: 0.5,
  target_acousticness: 0.5,
  seed_artists: [],
  seed_genres: ['jazz'],          // an off-vibe LLM pick we expect to be overridden
  mood_keywords: ['noodly'],
};

const INTENSE_TAPS = [{ x: 0.1, y: 0.95 }];

describe('applyMoodFallback', () => {
  it('returns params untouched when there is no mood (empty taps = HR branch)', () => {
    const out = applyMoodFallback(LLM_PARAMS, [], null, { topGenres: ['rock'] });
    expect(out).toEqual(LLM_PARAMS);
  });

  it('with empty text, overrides seed_genres with the strict on-vibe allow-list', () => {
    const out = applyMoodFallback(LLM_PARAMS, INTENSE_TAPS, '', { topGenres: ['pop'] });
    expect(out.seed_genres).not.toContain('jazz');
    out.seed_genres.forEach((g) => expect(MOOD_DESCRIPTORS.intense.allow_genres).toContain(g));
  });

  it('with empty text, replaces mood_keywords with the extreme mood descriptors', () => {
    const out = applyMoodFallback(LLM_PARAMS, INTENSE_TAPS, '', {});
    expect(out.mood_keywords).not.toContain('noodly');
    expect(out.mood_keywords).toEqual(expect.arrayContaining(['high-energy']));
    expect(out.mood_keywords.length).toBeLessThanOrEqual(4);
  });

  it('prefers genres that intersect the user top genres', () => {
    // energize allow-list contains "electronic", which the user listens to.
    const ENERGIZE_TAPS = [{ x: 0.6, y: 0.85 }];
    const out = applyMoodFallback(LLM_PARAMS, ENERGIZE_TAPS, '', { topGenres: ['electronic', 'indie'] });
    expect(out.seed_genres).toContain('electronic');
  });

  it('always attaches the mood exclude_genres for the mixer hard filter', () => {
    const out = applyMoodFallback(LLM_PARAMS, INTENSE_TAPS, '', {});
    expect(out.exclude_genres).toEqual(expect.arrayContaining(['acoustic', 'ambient']));
  });

  it('attaches the FULL allow_genres list so the mixer can judge familiar eligibility', () => {
    const out = applyMoodFallback(LLM_PARAMS, INTENSE_TAPS, '', { topGenres: ['pop'] });
    // seed_genres is capped at 3; allow_genres must carry the complete on-vibe set.
    expect(out.allow_genres).toEqual(expect.arrayContaining(MOOD_DESCRIPTORS.intense.allow_genres));
  });

  it('attaches the mood playlist_queries so Layer-1 can source vibe playlists', () => {
    const out = applyMoodFallback(LLM_PARAMS, INTENSE_TAPS, '', {});
    expect(out.playlist_queries).toEqual(
      expect.arrayContaining(MOOD_DESCRIPTORS.intense.playlist_queries.map((q) => q.toLowerCase())),
    );
  });

  it('never emits empty seed_genres (would empty Spotify discovery)', () => {
    const out = applyMoodFallback({ ...LLM_PARAMS, seed_genres: [] }, INTENSE_TAPS, '', {});
    expect(out.seed_genres.length).toBeGreaterThan(0);
  });

  it('with custom text present, MERGES the mood vibe instead of discarding the LLM picks', () => {
    const out = applyMoodFallback(LLM_PARAMS, INTENSE_TAPS, 'songs about the ocean', { topGenres: [] });
    // Mood keywords still injected so the strict vibe constrains the free text...
    expect(out.mood_keywords).toEqual(expect.arrayContaining(['high-energy']));
    // ...and the exclusions still apply.
    expect(out.exclude_genres).toEqual(expect.arrayContaining(['acoustic']));
  });

  it('does not mutate the input params object', () => {
    const input = { ...LLM_PARAMS, seed_genres: ['jazz'] };
    applyMoodFallback(input, INTENSE_TAPS, '', {});
    expect(input.seed_genres).toEqual(['jazz']);
  });
});

// ── tempo_category (manual mood flow — LLM pick wins, else energy_floor fallback) ─

const CALM_TAPS = [{ x: 0.45, y: -0.55 }];

describe('applyMoodFallback — tempo_category', () => {
  it('keeps the LLM tempo_category when it is valid (it factored the free-text override)', () => {
    const out = applyMoodFallback({ ...LLM_PARAMS, tempo_category: 'peak' }, CALM_TAPS, 'time to run', {});
    expect(out.tempo_category).toBe('peak'); // overrides the calm default
  });

  it('derives the band from the mood energy_floor when the LLM gave none', () => {
    expect(applyMoodFallback(LLM_PARAMS, INTENSE_TAPS, '', {}).tempo_category).toBe('peak');   // energy 0.9
    expect(applyMoodFallback(LLM_PARAMS, CALM_TAPS, '', {}).tempo_category).toBe('resting');   // energy 0.1
  });

  it('derives the band when the LLM gave an invalid category', () => {
    const out = applyMoodFallback({ ...LLM_PARAMS, tempo_category: 'turbo' }, INTENSE_TAPS, '', {});
    expect(out.tempo_category).toBe('peak');
  });

  it('always emits a value from the canonical enum', () => {
    const out = applyMoodFallback(LLM_PARAMS, CALM_TAPS, '', {});
    expect(TEMPO_CATEGORIES).toContain(out.tempo_category);
  });
});

// ── buildMoodParams (no-LLM deterministic fallback) ────────────────────────────

describe('buildMoodParams', () => {
  it('returns null when there is no resolvable mood', () => {
    expect(buildMoodParams([], {})).toBeNull();
  });

  it('produces a complete, in-range, on-vibe param set with no LLM', () => {
    const p = buildMoodParams(INTENSE_TAPS, { topGenres: [] });
    expect(p.target_bpm).toBeGreaterThanOrEqual(30);
    expect(p.target_bpm).toBeLessThanOrEqual(250);
    [p.target_energy, p.target_valence, p.target_acousticness].forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
    expect(p.seed_genres.length).toBeGreaterThan(0);
    expect(p.exclude_genres).toEqual(expect.arrayContaining(['acoustic']));
  });

  it('gives an intense mood a high energy target and calm a low one', () => {
    const intense = buildMoodParams(INTENSE_TAPS, {});
    const calm = buildMoodParams([{ x: 0.45, y: -0.55 }], {});
    expect(intense.target_energy).toBeGreaterThan(calm.target_energy);
  });

  it('carries a deterministic tempo_category even with no LLM (peak for intense, resting for calm)', () => {
    expect(buildMoodParams(INTENSE_TAPS, {}).tempo_category).toBe('peak');
    expect(buildMoodParams([{ x: 0.45, y: -0.55 }], {}).tempo_category).toBe('resting');
  });
});

// ── biometricBand — deterministic vitals → coarse band (Wave-0 T0.1) ──────────
// Vitals are decrypted server-side and mapped to a coarse resting/active/peak band
// WITHOUT ever crossing the LLM boundary. Reuses computeStateVector's label (already
// on the ctx) with an HR-ratio / absolute-HR fallback.

describe('biometricBand (vitals → resting/active/peak)', () => {
  it('returns null for a missing context', () => {
    expect(biometricBand(null)).toBeNull();
    expect(biometricBand(undefined)).toBeNull();
  });

  it('maps a high-stress state to resting (de-escalate)', () => {
    expect(biometricBand({ stateLabel: 'High-Stress / Pre-Panic', hrv: 15 })).toBe('resting');
  });

  it('maps exertion states to peak', () => {
    expect(biometricBand({ stateLabel: 'Intense Workout' })).toBe('peak');
    expect(biometricBand({ stateLabel: 'Peak Athletic Performance' })).toBe('peak');
  });

  it('maps recovery/exhaustion states to resting', () => {
    expect(biometricBand({ stateLabel: 'Exhausted Commute' })).toBe('resting');
    expect(biometricBand({ stateLabel: 'Resting / Meditative' })).toBe('resting');
  });

  it('falls back to the HR ratio for a Neutral label', () => {
    expect(biometricBand({ stateLabel: 'Neutral', hrRatio: 1.5 })).toBe('peak');
    expect(biometricBand({ stateLabel: 'Neutral', hrRatio: 1.05 })).toBe('resting');
    expect(biometricBand({ stateLabel: 'Neutral', hrRatio: 1.2 })).toBe('active');
  });

  it('falls back to absolute HR when there is no label or ratio', () => {
    expect(biometricBand({ heartRate: 150 })).toBe('peak');
    expect(biometricBand({ heartRate: 70 })).toBe('resting');
    expect(biometricBand({ heartRate: 100 })).toBe('active');
  });

  it('returns null when there is no usable signal at all', () => {
    expect(biometricBand({ stateLabel: 'Neutral' })).toBeNull();
  });
});

// ── applyBiometricBands — post-LLM deterministic target modulation (T0.1) ──────

describe('applyBiometricBands (post-LLM, deterministic)', () => {
  const BASE = { target_bpm: 128, target_energy: 0.8, target_valence: 0.7, target_acousticness: 0.2 };

  it('returns params untouched when there is no biometric context', () => {
    expect(applyBiometricBands(BASE, null)).toEqual(BASE);
  });

  it('a resting band lowers target BPM and energy and raises acousticness', () => {
    const out = applyBiometricBands(BASE, { stateLabel: 'Resting / Meditative' });
    expect(out.target_bpm).toBeLessThan(BASE.target_bpm);
    expect(out.target_energy).toBeLessThan(BASE.target_energy);
    expect(out.target_acousticness).toBeGreaterThan(BASE.target_acousticness);
  });

  it('a peak band raises target energy (higher intensity)', () => {
    const low = { target_bpm: 90, target_energy: 0.3, target_valence: 0.5, target_acousticness: 0.6 };
    const out = applyBiometricBands(low, { stateLabel: 'Intense Workout' });
    expect(out.target_energy).toBeGreaterThan(low.target_energy);
    expect(out.target_bpm).toBeGreaterThan(low.target_bpm);
  });

  it('keeps every target within its valid range', () => {
    for (const label of ['Resting / Meditative', 'Intense Workout', 'Neutral']) {
      const out = applyBiometricBands({ target_bpm: 5, target_energy: 2, target_valence: -1, target_acousticness: 9 },
        { stateLabel: label, hrRatio: 1.5 });
      expect(out.target_bpm).toBeGreaterThanOrEqual(30);
      expect(out.target_bpm).toBeLessThanOrEqual(250);
      for (const f of ['target_energy', 'target_valence', 'target_acousticness']) {
        expect(out[f]).toBeGreaterThanOrEqual(0);
        expect(out[f]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never mutates the input params object', () => {
    const input = { ...BASE };
    applyBiometricBands(input, { stateLabel: 'Intense Workout' });
    expect(input).toEqual(BASE);
  });
});

// ── extractIntent — closed-vocabulary free-text → structured tokens (T0.2) ─────
// The RAW note never leaves the process; only canonical tags from a CLOSED lexicon
// are emitted, so arbitrary user text / PII can never leak through these tokens.

describe('extractIntent (deterministic, zero-LLM)', () => {
  it('returns empty signals for empty / non-string input', () => {
    expect(extractIntent('')).toEqual({ keywords: [], activity: null, tempoCategory: null });
    expect(extractIntent(null)).toEqual({ keywords: [], activity: null, tempoCategory: null });
    expect(extractIntent(undefined)).toEqual({ keywords: [], activity: null, tempoCategory: null });
  });

  it('maps a running note to the running activity + peak tempo', () => {
    const out = extractIntent('going for a run');
    expect(out.activity).toBe('running');
    expect(out.tempoCategory).toBe('peak');
  });

  it('maps a wind-down note to a resting tempo', () => {
    expect(extractIntent('getting ready for bed').tempoCategory).toBe('resting');
    expect(extractIntent('time to meditate').tempoCategory).toBe('resting');
  });

  it('derives canonical mood keywords from free-text synonyms', () => {
    const out = extractIntent('feeling sad and want something calm');
    expect(out.keywords).toEqual(expect.arrayContaining(['calm']));
    expect(out.keywords).toContain('melancholy');
  });

  it('emits ONLY closed-vocabulary tokens — never the raw user words / PII', () => {
    const out = extractIntent('my name is Daniel Malede, play some energetic music');
    const joined = JSON.stringify(out).toLowerCase();
    expect(joined).not.toContain('daniel');
    expect(joined).not.toContain('malede');
    expect(out.keywords).toContain('energetic');
  });

  it('is deterministic for a given input', () => {
    expect(extractIntent('calm focus work')).toEqual(extractIntent('calm focus work'));
  });
});
