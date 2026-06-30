'use strict';

process.env.NODE_ENV = 'test';

const {
  MOODS,
  MOOD_DESCRIPTORS,
  TEMPO_CATEGORIES,
  resolveMoodKey,
  applyMoodFallback,
  buildMoodParams,
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
