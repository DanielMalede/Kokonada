'use strict';

// W4-010 · B1 taste profile v2.
//
// Four defects, one task (mission §3 W4-010, defect D20's taste half):
//   (a) affinity is FROZEN at profile-build time — a genre the user left behind two years ago
//       outranks this month's obsession forever, because nothing decays. `lastSeenAt` + a
//       read-time exponential decay give the profile a memory that fades.
//   (b) `_weightedMergeRanked` weights each provider by RAW library size, so one imported
//       2000-item playlist out-votes a 50-track Spotify history 40:1 — the merge stops being
//       "which provider knows this user better" and becomes "which provider has more rows".
//   (c) `recomputeFootprint` ranks by raw FREQUENCY while `buildProfile` ranks by weighted
//       affinity, so a classification purge silently re-derives a DIFFERENT taste profile
//       from the same library (dual-algorithm drift).
//   (d) score's genre term is a two-rung step: exact allow-list hit 1.0, anything else 0.3.
//       "deep house" against an allow-list of "house" scores the same as "death metal".
//
// ADR-0012 line: everything here is either static curated data (genreFamilies), a pure
// read-time projection (decay), or a per-user profile artifact that already exists. No model
// is fitted on, and no artifact persists, any Spotify- or YouTube-derived feature.

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));

const fc = require('fast-check');

const affinity = require('../app/services/selection/affinity');
const genreFamilies = require('../app/services/selection/genreFamilies');
const { scoreTrack, _resetWeights } = require('../app/services/selection/score');
const { buildPool } = require('../app/services/selection/candidatePool');
const { generateFallbackPlaylist } = require('../app/services/playlistMixer');
const {
  recomputeFootprint,
  _weightedMergeRanked,
  _analyzeSpotifyProfile,
  _analyzeYouTubeTracks,
  _accumulateTracks,
} = require('../app/services/musicProfileService');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const daysAgo = (d) => new Date(NOW - d * DAY_MS);

const ENV_KEYS = ['AFFINITY_DECAY_TAU_DAYS', 'WAVE4_AFFINITY_DECAY_DISABLED', 'WAVE4_GENRE_FAMILIES_DISABLED'];
const savedEnv = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  affinity._resetDecayConfig();
  _resetWeights();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
  affinity._resetDecayConfig();
  _resetWeights();
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Recency decay — the profile gains a memory that fades
// ─────────────────────────────────────────────────────────────────────────────

describe('W4-010 (a) · selection/affinity recency decay', () => {
  it('is exactly 1 at zero age and e^-1 at one time constant', () => {
    expect(affinity.recencyFactor(new Date(NOW), { now: NOW })).toBeCloseTo(1, 12);
    expect(affinity.recencyFactor(daysAgo(90), { now: NOW })).toBeCloseTo(Math.exp(-1), 10);
    expect(affinity.recencyFactor(daysAgo(180), { now: NOW })).toBeCloseTo(Math.exp(-2), 10);
  });

  it('is monotone NON-INCREASING in age — older is never worth more (300-round fuzz)', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 4000, noNaN: true }),
      fc.double({ min: 0, max: 4000, noNaN: true }),
      (a, b) => {
        const older = Math.max(a, b);
        const newer = Math.min(a, b);
        const fOld = affinity.recencyFactor(new Date(NOW - older * DAY_MS), { now: NOW });
        const fNew = affinity.recencyFactor(new Date(NOW - newer * DAY_MS), { now: NOW });
        return fOld <= fNew + 1e-12;
      },
    ), { numRuns: 300, seed: 4010 });
  });

  it('NEVER penalises a track for missing or unusable recency evidence (factor 1)', () => {
    // The wave's standing discipline: absent data is a prior, never a penalty (W4-007's
    // MISSING_PRIOR, W4-005's axis mass). A library entry from before `lastSeenAt` existed
    // must not silently lose half its affinity on the next generation.
    for (const bad of [null, undefined, '', 'not-a-date', NaN, Infinity, -Infinity, {}, [], new Date('x')]) {
      expect(affinity.recencyFactor(bad, { now: NOW })).toBe(1);
    }
  });

  it('clamps a FUTURE timestamp to 1 rather than amplifying it (S6 timestamp sanity)', () => {
    expect(affinity.recencyFactor(new Date(NOW + 30 * DAY_MS), { now: NOW })).toBe(1);
  });

  it('stays in [0,1] and finite for any input pair (300-round fuzz)', () => {
    fc.assert(fc.property(
      fc.oneof(fc.integer({ min: -8.64e15, max: 8.64e15 }), fc.constant(NaN), fc.constant(null)),
      fc.double({ min: -1e6, max: 1e6, noNaN: true }),
      (ts, tau) => {
        const f = affinity.recencyFactor(ts, { now: NOW, tauDays: tau });
        return Number.isFinite(f) && f >= 0 && f <= 1;
      },
    ), { numRuns: 300, seed: 4011 });
  });

  it('reads the time constant from env and rejects a garbage value rather than deleting taste', () => {
    process.env.AFFINITY_DECAY_TAU_DAYS = '30';
    affinity._resetDecayConfig();
    expect(affinity.recencyFactor(daysAgo(30), { now: NOW })).toBeCloseTo(Math.exp(-1), 10);

    // W4-D26's lesson applied pre-emptively: one typo must not turn the taste term off.
    for (const junk of ['', 'ninety', '0', '-5', 'NaN']) {
      process.env.AFFINITY_DECAY_TAU_DAYS = junk;
      affinity._resetDecayConfig();
      expect(affinity.recencyFactor(daysAgo(90), { now: NOW })).toBeCloseTo(Math.exp(-1), 10);
    }
  });

  it('S11 kill-switch: WAVE4_AFFINITY_DECAY_DISABLED restores the undecayed affinity exactly', () => {
    process.env.WAVE4_AFFINITY_DECAY_DISABLED = '1';
    affinity._resetDecayConfig();
    expect(affinity.recencyFactor(daysAgo(3650), { now: NOW })).toBe(1);
    const t = { id: 'x', affinity: 7.5, lastSeenAt: daysAgo(3650) };
    expect(affinity.decayedAffinity(t, { now: NOW })).toBe(7.5);
  });

  it('decayedAffinity never exceeds the stored affinity and never goes negative', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 1000, noNaN: true }),
      fc.double({ min: 0, max: 3000, noNaN: true }),
      (aff, ageDays) => {
        const d = affinity.decayedAffinity({ affinity: aff, lastSeenAt: new Date(NOW - ageDays * DAY_MS) }, { now: NOW });
        return Number.isFinite(d) && d >= 0 && d <= aff + 1e-9;
      },
    ), { numRuns: 300, seed: 4012 });
  });

  it('applyRecencyDecay does not mutate its input and preserves the raw value for audit', () => {
    const input = [{ id: 'a', affinity: 10, lastSeenAt: daysAgo(180) }];
    const out = affinity.applyRecencyDecay(input, { now: NOW });
    expect(input[0].affinity).toBe(10);                 // untouched
    expect(out[0].affinity).toBeCloseTo(10 * Math.exp(-2), 6);
    expect(out[0].affinityRaw).toBe(10);
  });

  it('does NOT manufacture an affinity on an entry that has none (absent ≠ zero)', () => {
    // The fallback mixer sorts on `affinity ?? listenCount ?? 0`. Writing a decayed 0 onto a
    // legacy listenCount-only row would make that `??` chain stop at 0 and flatten the whole
    // ranking — the Number(null)===0 trap W4-D15/W4-D21 already cost this repo twice.
    const legacy = [{ id: 'a', listenCount: 9 }, { id: 'b', listenCount: 3 }];
    const out = affinity.applyRecencyDecay(legacy, { now: NOW });
    expect(out[0]).not.toHaveProperty('affinity');
    expect(generateFallbackPlaylist({ library: legacy }, null, 2, { now: NOW }).map(t => t.id))
      .toEqual(['a', 'b']);
  });
});

describe('W4-010 (a) · decay reaches the two real read seams', () => {
  const entry = (id, aff, ageDays) => ({
    id, provider: 'spotify', name: id, artist: 'A', genres: ['pop'],
    uri: `spotify:track:${id}`, affinity: aff, lastSeenAt: daysAgo(ageDays),
  });

  it('candidatePool re-ranks a stale favourite BELOW a fresher, lower-raw-affinity track', () => {
    // stale: raw 10 but 2 years old → 10·e^(-730/90) ≈ 0.003. fresh: raw 4, today → 4.
    const profile = {
      lastAnalyzed: new Date(NOW),
      library: [entry('stale', 10, 730), entry('fresh', 4, 0)],
    };
    return buildPool({ userId: 'u1', musicProfile: profile, now: NOW }).then((pool) => {
      expect(pool.map(t => t.id)).toEqual(['fresh', 'stale']);
      expect(pool[0].affinity).toBeCloseTo(4, 6);
      expect(pool[1].affinity).toBeLessThan(1);
    });
  });

  it('the deterministic-fallback mixer applies the same decay (one taste truth, not two)', () => {
    const profile = { library: [entry('stale', 10, 730), entry('fresh', 4, 0)] };
    const out = generateFallbackPlaylist(profile, 'spotify', 2, { now: NOW });
    expect(out.map(t => t.id)).toEqual(['fresh', 'stale']);
  });
});

describe('W4-010 (a) · lastSeenAt is populated from REAL engagement evidence', () => {
  it('carries Spotify played_at / added_at through the accumulator as the MOST RECENT of them', () => {
    const track = (id) => ({ id, name: id, uri: `spotify:track:${id}`, artists: [{ id: 'ar1', name: 'A' }] });
    const map = _accumulateTracks([
      { tracks: [{ ...track('t1'), addedAt: daysAgo(400).toISOString() }], weight: 3 },
      { tracks: [{ ...track('t1'), playedAt: daysAgo(2).toISOString() }], weight: 2 },
      { tracks: [track('t2')], weight: 4 },
    ]);
    expect(new Date(map.get('t1').lastSeenAt).getTime()).toBe(daysAgo(2).getTime());
    expect(map.get('t2').lastSeenAt).toBeNull();          // no evidence → no claim
  });

  it('_analyzeSpotifyProfile writes lastSeenAt onto the library entry', () => {
    const { library } = _analyzeSpotifyProfile({
      trackSources: [{
        tracks: [{ id: 't1', name: 'S', uri: 'u', artists: [{ id: 'a1', name: 'A' }], playedAt: daysAgo(5).toISOString() }],
        weight: 2,
      }],
      artistLists: [],
      artistGenres: {},
    });
    expect(new Date(library[0].lastSeenAt).getTime()).toBe(daysAgo(5).getTime());
  });

  it('_analyzeYouTubeTracks uses a playlist item add-time but NEVER a liked video publish date', () => {
    // A playlistItems `snippet.publishedAt` is when the USER added the video — engagement.
    // A videos.list `snippet.publishedAt` is when the CONTENT was uploaded — a 1970s song
    // liked yesterday would decay to nothing. Only the first is admissible evidence.
    const videos = [
      { id: 'liked1',  snippet: { title: 'L', channelTitle: 'C - Topic', publishedAt: daysAgo(9000).toISOString() } },
      { id: 'plItem1', snippet: { title: 'P', channelTitle: 'C - Topic', publishedAt: daysAgo(10).toISOString(), resourceId: { videoId: 'v9' } } },
    ];
    const { library } = _analyzeYouTubeTracks(videos, { likedIds: new Set(['liked1']) });
    const byId = Object.fromEntries(library.map(e => [e.id, e]));
    expect(byId.liked1.lastSeenAt).toBeNull();
    expect(new Date(byId.v9.lastSeenAt).getTime()).toBe(daysAgo(10).getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Log-saturated provider weights
// ─────────────────────────────────────────────────────────────────────────────

describe('W4-010 (b) · _weightedMergeRanked saturates provider size', () => {
  // Measures the effective weight ratio THROUGH the real merge, not through a copied
  // formula. The big provider's item at index i contributes ((n−i)/n)·w(big); the small
  // provider's sole item contributes 1·w(small). Item i wins iff (n−i)/n > w(small)/w(big),
  // so the number of big-list items that outrank it is n·(1 − w(small)/w(big)) — invert that
  // to read the ratio back out.
  const measuredRatio = (small, big, n = 2000) => {
    const bigList = Array.from({ length: n }, (_, i) => `b${i}`);
    const merged = _weightedMergeRanked(['S'], small, bigList, big, n + 1);
    const cut = merged.indexOf('S');           // how many big-list items beat the small #1
    return cut < n ? n / (n - cut) : Infinity;
  };

  it('a 40x bigger library no longer buys 40x the vote', () => {
    // 50 vs 2000 tracks. Raw-size weighting gave YouTube 40.0x the influence; log1p
    // saturation gives it log1p(2000)/log1p(50) ≈ 1.93x — the bigger library still leads,
    // but a curated 50-track history is no longer arithmetically erased.
    const ratio = measuredRatio(50, 2000);
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(3);
    expect(ratio).toBeCloseTo(Math.log1p(2000) / Math.log1p(50), 1);
  });

  it('is still MONOTONE in library size — more data never counts for less', () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 100 }),
      fc.integer({ min: 2, max: 100 }),
      (x, y) => {
        const lo = Math.min(x, y) * 20, hi = Math.max(x, y) * 20;
        // A fixed opponent: whichever of the two sizes is larger must place its #1 at least
        // as high. Measured through the merge, at equal list shapes.
        const mLo = _weightedMergeRanked(['P'], lo, ['Q'], hi, 5);
        return mLo[0] === (hi > lo ? 'Q' : 'P') || hi === lo;
      },
    ), { numRuns: 300, seed: 4013 });
  });

  it('keeps a small curated provider\'s #1 genre inside the merged top-10 against a huge one', () => {
    // 12 YouTube genres vs 1 Spotify genre. Under raw-size weighting jazz scored 50 against
    // the 12th YouTube genre's (1/12)·2000 ≈ 167 — it fell out of the top-10 entirely.
    const spotify = ['jazz'];
    const youtube = Array.from({ length: 12 }, (_, i) => `yt${i}`);
    const merged = _weightedMergeRanked(spotify, 50, youtube, 2000, 10);
    expect(merged).toContain('jazz');
    expect(merged[0]).toBe('yt0');          // the richer provider still leads
    // …and the regression this guards: the old weighting buried it below every yt genre.
    expect(merged.indexOf('jazz')).toBeLessThan(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) recomputeFootprint parity with the build-time algorithm
// ─────────────────────────────────────────────────────────────────────────────

describe('W4-010 (c) · recomputeFootprint ranks the way buildProfile does', () => {
  const t = (artist, genres, aff, provider = 'spotify') => ({ artist, genres, affinity: aff, provider });

  it('ranks by weighted affinity, not raw row count', () => {
    // "ambient" appears on ONE track the user plays constantly (affinity 24);
    // "workout" appears on three tail playlist rows (affinity 1 each). Frequency says
    // workout; the build-time algorithm — and now the recompute — says ambient.
    const lib = [
      t('A', ['ambient'], 24),
      t('B', ['workout'], 1), t('C', ['workout'], 1), t('D', ['workout'], 1),
    ];
    expect(recomputeFootprint(lib).topGenres[0]).toBe('ambient');
    expect(recomputeFootprint(lib).topArtists[0]).toBe('A');
  });

  it('merges providers with the SAME log-saturated weighting as buildProfile', () => {
    // A 15-track curated Spotify history, all jazz, against a 400-row YouTube import spread
    // over 12 genres. Under raw row-count weighting (15 vs 400) jazz scored 15 while even the
    // YouTube list's LAST genre scored (1/12)·400 ≈ 33 — jazz came 13th of 13, outranked by
    // every single YouTube genre and cut by the top-10 cap. Log saturation (2.77 vs 5.99)
    // puts it back inside the profile, ahead of the YouTube tail.
    const lib = [
      ...Array.from({ length: 15 }, (_, i) => t(`SpArtist${i}`, ['jazz'], 6, 'spotify')),
      ...Array.from({ length: 400 }, (_, i) => t(`YtArtist${i}`, [`yt${i % 12}`], 3, 'youtube_music')),
    ];
    const fp = recomputeFootprint(lib);
    expect(fp.topGenres[0]).toBe('yt0');                  // the richer provider still leads
    expect(fp.topGenres).toContain('jazz');               // it survives the cap at all — it did not before
    for (const tail of ['yt7', 'yt8', 'yt9', 'yt10', 'yt11']) {
      expect(fp.topGenres.indexOf('jazz')).toBeLessThan(fp.topGenres.indexOf(tail) === -1 ? Infinity : fp.topGenres.indexOf(tail));
    }
  });

  it('still counts a library with no affinity data (back-compat with the old pins)', () => {
    const lib = [
      { artist: 'A', genres: ['rock', 'pop'] },
      { artist: 'A', genres: ['rock'] },
      { artist: 'B', genres: ['jazz'] },
    ];
    const fp = recomputeFootprint(lib);
    expect(fp.topArtists[0]).toBe('A');
    expect(fp.topGenres[0]).toBe('rock');
    expect(fp.genreSet.sort()).toEqual(['jazz', 'pop', 'rock']);
  });

  it('is total on hostile input — never throws, never emits NaN or undefined entries', () => {
    for (const bad of [null, undefined, 'nope', 42, [null], [{}], [{ genres: null, artist: undefined }],
      [{ artist: 'A', genres: ['g'], affinity: NaN }], [{ artist: 'A', genres: ['g'], affinity: -3 }]]) {
      const fp = recomputeFootprint(bad);
      expect(Array.isArray(fp.topGenres) && Array.isArray(fp.topArtists) && Array.isArray(fp.genreSet)).toBe(true);
      expect([...fp.topGenres, ...fp.topArtists, ...fp.genreSet].every(x => typeof x === 'string')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Genre families → partial credit in score v2
// ─────────────────────────────────────────────────────────────────────────────

describe('W4-010 (d) · genreFamilies static map', () => {
  it('covers ~150 genres across ~15 families, with no genre in two families', () => {
    const fams = Object.keys(genreFamilies.GENRE_FAMILIES);
    expect(fams.length).toBeGreaterThanOrEqual(14);
    expect(fams.length).toBeLessThanOrEqual(18);
    const all = fams.flatMap(f => genreFamilies.GENRE_FAMILIES[f]);
    expect(all.length).toBeGreaterThanOrEqual(140);
    expect(new Set(all).size).toBe(all.length);   // no genre claimed by two families
  });

  it('maps every canonical genre this repo already emits', () => {
    // TAG_TO_GENRE + WIKI_TOPIC_TO_GENRE values in musicProfileService — the genres our own
    // YouTube lane produces. A family map that cannot classify our own vocabulary is decoration.
    for (const g of ['electronic', 'pop', 'indie', 'rock', 'ambient', 'jazz', 'classical',
      'hip-hop', 'r&b', 'soul', 'funk', 'metal', 'country', 'folk', 'blues', 'reggae', 'latin']) {
      expect(genreFamilies.familyOf(g)).not.toBeNull();
    }
  });

  it('normalises case, whitespace and separators before lookup', () => {
    const base = genreFamilies.familyOf('hip-hop');
    expect(genreFamilies.familyOf('  Hip-Hop ')).toBe(base);
    expect(genreFamilies.familyOf('HIP HOP')).toBe(base);
    expect(genreFamilies.familyOf('hip_hop')).toBe(base);
  });

  it('resolves an unlisted MODIFIED genre by its head noun ("chicago house" → electronic)', () => {
    expect(genreFamilies.familyOf('chicago house')).toBe(genreFamilies.familyOf('house'));
    expect(genreFamilies.familyOf('melodic dubstep')).toBe(genreFamilies.familyOf('dubstep'));
    expect(genreFamilies.familyOf('norwegian black metal')).toBe(genreFamilies.familyOf('black metal'));
  });

  it('returns null — not a guess — for a genre it does not know', () => {
    for (const g of ['', '   ', null, undefined, 42, 'zzzqqq', 'field recordings of trams']) {
      expect(genreFamilies.familyOf(g)).toBeNull();
    }
  });

  it('sameFamilyAny is symmetric-by-family and false when either side is unknown', () => {
    expect(genreFamilies.sameFamilyAny(['deep house'], ['techno'])).toBe(true);
    expect(genreFamilies.sameFamilyAny(['deep house'], ['death metal'])).toBe(false);
    expect(genreFamilies.sameFamilyAny(['zzzqqq'], ['techno'])).toBe(false);
    expect(genreFamilies.sameFamilyAny([], ['techno'])).toBe(false);
    expect(genreFamilies.sameFamilyAny(['techno'], [])).toBe(false);
  });
});

describe('W4-010 (d) · score v2 genre term gains the same-family rung', () => {
  const TARGETS = {
    bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8,
    valenceTarget: 0.6, acousticnessBias: 0, instrumentalBias: 0, tempoBand: 'active', confidence: 1,
  };
  const fitOf = (genres, allowGenres, env) => {
    const prev = process.env.WAVE4_SCORING_V2_DISABLED;
    if (env) process.env.WAVE4_SCORING_V2_DISABLED = env;
    try {
      return scoreTrack({ id: 'x', genres, affinity: 1, features: {} },
        { targets: TARGETS, maxAffinity: 1, allowGenres }).terms.moodGenreFit;
    } finally {
      if (prev === undefined) delete process.env.WAVE4_SCORING_V2_DISABLED;
      else process.env.WAVE4_SCORING_V2_DISABLED = prev;
    }
  };

  it('scores the four rungs exactly 1.0 / 0.7 / 0.3 / 0.5', () => {
    expect(fitOf(['house'],       ['house'])).toBe(1);      // exact
    expect(fitOf(['deep house'],  ['techno'])).toBe(0.7);   // same family
    expect(fitOf(['death metal'], ['techno'])).toBe(0.3);   // real miss
    expect(fitOf([],              ['techno'])).toBe(0.5);   // unknown — no track genres
    expect(fitOf(['techno'],      [])).toBe(0.5);           // unknown — no allow-list
  });

  it('prefers an EXACT hit over a family hit over a miss (strict ordering)', () => {
    expect(fitOf(['techno'], ['techno'])).toBeGreaterThan(fitOf(['deep house'], ['techno']));
    expect(fitOf(['deep house'], ['techno'])).toBeGreaterThan(fitOf(['death metal'], ['techno']));
  });

  it('never LOWERS a track\'s genre fit relative to v1 — the rung is strictly additive', () => {
    const cases = [
      [['house'], ['house']], [['deep house'], ['techno']], [['death metal'], ['techno']],
      [[], ['techno']], [['techno'], []], [['zzzqqq'], ['techno']], [[], []],
    ];
    for (const [g, a] of cases) expect(fitOf(g, a)).toBeGreaterThanOrEqual(fitOf(g, a, '1'));
  });

  it('leaves the v1 scorer byte-identical (WAVE4_SCORING_V2_DISABLED keeps the two-rung step)', () => {
    expect(fitOf(['deep house'], ['techno'], '1')).toBe(0.3);
    expect(fitOf(['house'], ['house'], '1')).toBe(1);
  });

  it('S11 kill-switch: WAVE4_GENRE_FAMILIES_DISABLED drops back to the two-rung step in v2 too', () => {
    process.env.WAVE4_GENRE_FAMILIES_DISABLED = '1';
    _resetWeights();
    expect(fitOf(['deep house'], ['techno'])).toBe(0.3);
    expect(fitOf(['house'], ['house'])).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0012: nothing this task adds is a learned artifact over provider content
// ─────────────────────────────────────────────────────────────────────────────

describe('W4-010 · ADR-0012 containment', () => {
  it('genreFamilies is STATIC data — no provider ids, uris or feature values in the map', () => {
    const serialized = JSON.stringify(genreFamilies.GENRE_FAMILIES);
    expect(serialized).not.toMatch(/spotify|youtube|reccobeats|mbid:/i);
    expect(serialized).not.toMatch(/\d+\.\d+/);   // no fitted coefficients — it is a taxonomy
  });

  it('the decay is a READ-TIME projection: it persists nothing and fits nothing', () => {
    const src = require('fs').readFileSync(require.resolve('../app/services/selection/affinity.js'), 'utf8');
    expect(src).not.toMatch(/require\(.*models\//);          // touches no collection
    expect(src).not.toMatch(/findOneAndUpdate|save\(|insertMany/);
  });
});
