'use strict';

process.env.NODE_ENV = 'test';

// ── Selection I/O is mocked; the REAL selection core (pool → band → score → MMR) runs ──
// The module's whole point is emotion-honoring, deterministic, library-only selection. To
// prove that HONESTLY we exercise the real generateV2 → pipeline → biosonicBand → score → mmr
// with only the leaf I/O stubbed (redis absent, ledger empty, features supplied by fixture).
// No mock of generateV2 itself — that would be stub theatre for invariants (a)/(b)/(c)/(e).
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn(),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure:  jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../app/services/vector/vectorIndex', () => ({
  getMany:   jest.fn().mockResolvedValue(new Map()),
  upsertMany: jest.fn(),
  queryNear: jest.fn(),
  use:       jest.fn(),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany:     jest.fn().mockResolvedValue(new Map()),
  upsertMany:  jest.fn(),
  missingKeys: jest.fn(),
}));
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn().mockResolvedValue({}) }));

const featureRepo = require('../app/repositories/audioFeatureRepo');
const { buildDeterministicFallback } = require('../app/services/generation/deterministicFallback');

// Fixed clock so translate()'s hour-of-day wind-down term never makes a run flaky.
const NOW = new Date('2026-07-15T15:00:00').getTime();

const CALM_TAPS    = [{ x: 0.45, y: -0.55 }]; // nearest MOODS preset = calm
const INTENSE_TAPS = [{ x: 0.10, y:  0.95 }]; // nearest MOODS preset = intense

// A feature-rich fixture: equal affinity + distinct artists/genres so ONLY the biosonic
// feature-fit + band can decide ordering (the emotion signal), not taste or genre overlap.
// Energies/BPMs are spread so calm and intense resolve to DIFFERENT in-band sets.
const FEATURE_ROWS = [
  ['spotify:t0', { bpm: 55,  energy: 0.10, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
  ['spotify:t1', { bpm: 90,  energy: 0.30, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
  ['spotify:t2', { bpm: 110, energy: 0.50, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
  ['spotify:t3', { bpm: 130, energy: 0.68, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
  ['spotify:t4', { bpm: 150, energy: 0.80, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
  ['spotify:t5', { bpm: 165, energy: 0.85, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
];
const FEATURE_MAP = new Map(FEATURE_ROWS);

function featureRichProfile() {
  return {
    lastAnalyzed: new Date('2026-07-01'),
    topGenres: [],
    library: FEATURE_ROWS.map(([rk], i) => ({
      id: `t${i}`, provider: 'spotify', uri: `spotify:track:t${i}`,
      canonicalKey: `at:artist${i}|song ${i}`, name: `Song ${i}`,
      artist: `Artist${i}`, genres: [`g${i}`], affinity: 10,
    })),
  };
}

// Faithful re-implementation of the toClientTrack provider guard (the injected port in
// production IS the real toClientTracks). Reconstructs a spotify: URI ONLY from a bare id on
// a genuine Spotify track; a cross-provider (youtube_music, uri-less) entry drops to null —
// never minting spotify:track:<youtube-id>. Carries energy/canonicalKey through for assertions.
function guardedResolve(rawTracks) {
  return (rawTracks || []).map((t) => {
    let uri = t.uri ?? null;
    if (!uri && t.id && !String(t.id).includes(':') && (!t.provider || t.provider === 'spotify')) {
      uri = `spotify:track:${t.id}`;
    }
    if (!uri) return null;
    return { id: t.id, uri, canonicalKey: t.canonicalKey ?? null, energy: t.features?.energy ?? null };
  }).filter(Boolean);
}

const meanEnergy = (tracks) => tracks.reduce((s, t) => s + (t.energy ?? 0), 0) / (tracks.length || 1);

beforeEach(() => {
  jest.clearAllMocks();
  featureRepo.getMany.mockResolvedValue(FEATURE_MAP);
  delete process.env.PLAYLIST_SIZE;
});

describe('buildDeterministicFallback — pure emotion-honoring library fallback', () => {
  // (a) emotion honored: the SAME feature-rich library ranks LOWER arousal for calm taps than
  // for intense taps. This is the core "responds accurately to the emotion tap" invariant.
  it('(a) honors the emotion tap: calm taps yield lower mean-arousal than intense taps', async () => {
    const musicProfile = featureRichProfile();
    const calm = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: CALM_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: guardedResolve,
    });
    const intense = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: INTENSE_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: guardedResolve,
    });

    expect(calm.tracks.length).toBeGreaterThan(0);
    expect(intense.tracks.length).toBeGreaterThan(0);
    expect(meanEnergy(calm.tracks)).toBeLessThan(meanEnergy(intense.tracks));
  });

  // (b) never random: identical inputs → byte-identical output. The whole path is RNG-free.
  it('(b) is deterministic: identical (taps, library, ledger, now) return identical tracks', async () => {
    const musicProfile = featureRichProfile();
    const args = {
      userId: 'u1', musicProfile, taps: INTENSE_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: guardedResolve,
    };
    const a = await buildDeterministicFallback(args);
    const b = await buildDeterministicFallback(args);
    expect(a.tracks).toEqual(b.tracks);
    expect(a.fallbackTier).toBe(b.fallbackTier);
  });

  // (c) never empty: a library with ≥1 playable track always yields ≥1 track.
  it('(c) never returns empty when the library has a playable track', async () => {
    const musicProfile = {
      lastAnalyzed: new Date('2026-07-01'), topGenres: [],
      library: [{ id: 'solo', provider: 'spotify', uri: 'spotify:track:solo', canonicalKey: 'at:a|solo', artist: 'A', genres: ['x'], affinity: 3 }],
    };
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: CALM_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: guardedResolve,
    });
    expect(res.tracks.length).toBeGreaterThanOrEqual(1);
    expect(res.reason).toBeNull();
  });

  // (d) empty on empty: no personal history → empty result + a reason (never the global corpus).
  it('(d) returns empty tracks and a reason when the library is empty', async () => {
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile: { library: [] }, taps: CALM_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: guardedResolve,
    });
    expect(res.tracks).toEqual([]);
    expect(res.reason).toBeTruthy();
  });

  // (e) library-only: every selected raw track is a member of the input library; zero discovery.
  it('(e) selects ONLY from the input library (zero discovery, no corpus)', async () => {
    const musicProfile = featureRichProfile();
    const libKeys = new Set(musicProfile.library.map((t) => t.canonicalKey));
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: INTENSE_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: guardedResolve,
    });
    expect(res.built.merged.length).toBeGreaterThan(0);
    for (const t of res.built.merged) {
      expect(libKeys.has(t.canonicalKey)).toBe(true);
      expect(t.isDiscovery).toBeFalsy();
    }
  });

  // (f) bounded widening: when the on-vibe band cannot surface the only PLAYABLE track, the
  // ladder progressively widens and still returns — reporting the reached tier, never past 3.
  it('(f) widens through the bounded ladder and reports the reached tier (never exceeds 3)', async () => {
    const musicProfile = featureRichProfile(); // t5 = highest energy/BPM; calm band excludes it
    // Only the band-excluded high-energy track (t5) is resolvable in this scenario, so the
    // on-vibe (T0) and band-widened (T1) tiers resolve to EMPTY and the affinity tier surfaces it.
    const onlyT5 = (raw) => guardedResolve(raw).filter((t) => t.id === 't5');
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: CALM_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: onlyT5,
    });
    expect(res.tracks.length).toBeGreaterThan(0);
    expect(res.tracks.every((t) => t.id === 't5')).toBe(true);
    expect(res.fallbackTier).toBeGreaterThan(0);
    expect(res.fallbackTier).toBeLessThanOrEqual(2);
  });

  // (g) provider-safe: a cross-provider (YouTube) library entry is NEVER minted into a
  // spotify:track:<youtube-id> URI — the module delegates all URI construction to the port.
  it('(g) never mints a cross-provider URI (delegates the toClientTrack guard to the port)', async () => {
    const musicProfile = {
      lastAnalyzed: new Date('2026-07-01'), topGenres: [],
      library: [
        { id: 'yt-vid-1', provider: 'youtube_music', canonicalKey: 'at:a|yt', artist: 'A', genres: ['x'], affinity: 9 },
        { id: 'sp-1', provider: 'spotify', uri: 'spotify:track:sp-1', canonicalKey: 'at:b|sp', artist: 'B', genres: ['y'], affinity: 8 },
      ],
    };
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: CALM_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: guardedResolve,
    });
    // The playable set never carries a spotify URI reconstructed from the YouTube video id.
    expect(res.tracks.some((t) => t.uri === 'spotify:track:yt-vid-1')).toBe(false);
    for (const t of res.tracks) expect(t.uri.startsWith('spotify:')).toBe(true);
  });

  // (LOW-1) serve-ledger parity: `built` carries the ACTUALLY-SERVED (post-resolveToPlayable) set —
  // never a raw candidate the port dropped — so anti-repetition marks exactly what the user heard,
  // not a track that vanished at translation/client-contract resolution.
  it('(LOW-1) built reflects the SERVED playable set, not a merged candidate dropped at resolution', async () => {
    const musicProfile = {
      lastAnalyzed: new Date('2026-07-01'), topGenres: [],
      library: [
        { id: 'keep', provider: 'spotify', uri: 'spotify:track:keep', canonicalKey: 'at:k|keep', name: 'Keep', artist: 'K', genres: ['g'], affinity: 5 },
        { id: 'drop', provider: 'spotify', uri: 'spotify:track:drop', canonicalKey: 'at:d|drop', name: 'Drop', artist: 'D', genres: ['g'], affinity: 5 },
      ],
    };
    // Both tracks are featureless (no fixture row) → both pass the band and appear in `merged`; the
    // port then DROPS 'drop' at resolution (the exact translation/toClientTrack loss LOW-1 targets).
    const dropOne = (raw) => guardedResolve(raw).filter((t) => t.id !== 'drop');
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: CALM_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: dropOne,
    });
    expect(res.tracks.map((t) => t.id)).toEqual(['keep']);
    // The recorded set == the served set: 'drop' is absent from BOTH merged and familiar.
    expect(res.built.merged.map((t) => t.id)).toEqual(['keep']);
    expect(res.built.familiar.map((t) => t.id)).toEqual(['keep']);
    expect(res.built.merged.some((t) => t.id === 'drop')).toBe(false);
  });

  // (LOW-2) the band-drop tier genuinely WIDENS past T0: a track the confident (T0) band excludes
  // but the zero-confidence (T1) band admits is delivered AT TIER 1 — pinning that T1 ≠ T0 (the
  // existing widening test lands on the T2 affinity terminal, leaving this seam uncovered).
  it('(LOW-2) T1 band-drop widens beyond T0: a track only the widened band surfaces returns fallbackTier===1', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([
      ['spotify:in-a', { bpm: 120, energy: 0.50, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
      ['spotify:in-b', { bpm: 120, energy: 0.50, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
      ['spotify:wide', { bpm: 120, energy: 0.70, valence: 0.5, acousticness: 0.5, danceability: 0.5 }],
    ]));
    const musicProfile = {
      lastAnalyzed: new Date('2026-07-01'), topGenres: [],
      library: [
        { id: 'in-a', provider: 'spotify', uri: 'spotify:track:in-a', canonicalKey: 'at:a|in a', name: 'In A', artist: 'A', genres: ['g'], affinity: 5 },
        { id: 'in-b', provider: 'spotify', uri: 'spotify:track:in-b', canonicalKey: 'at:b|in b', name: 'In B', artist: 'B', genres: ['g'], affinity: 5 },
        { id: 'wide', provider: 'spotify', uri: 'spotify:track:wide', canonicalKey: 'at:w|wide', name: 'Wide', artist: 'W', genres: ['g'], affinity: 5 },
      ],
    };
    // A narrow, CONFIDENT band (T0, confidence:1) around energy 0.5 excludes 'wide' (energy 0.70);
    // T1 zeroes the confidence → the logistic tolerance widens the energy window enough to admit it.
    const t0targets = { bpmCenter: 120, bpmWidth: 8, energyFloor: 0.45, energyCeiling: 0.55, valenceTarget: 0.5, confidence: 1 };
    // Only 'wide' is client-playable, so T0 (which surfaces only in-a/in-b) resolves EMPTY; the FIRST
    // tier to deliver 'wide' is whichever band first admits it — T1 iff the band-drop truly widens.
    const onlyWide = (raw) => guardedResolve(raw).filter((t) => t.id === 'wide');
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: CALM_TAPS, provider: 'spotify',
      targets: t0targets, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: onlyWide,
    });
    expect(res.tracks.map((t) => t.id)).toEqual(['wide']);
    expect(res.fallbackTier).toBe(1); // delivered by the band-DROP tier — not T0, not the T2 affinity terminal
  });

  // (LOW-3a) throw-safety on the injected port: a resolveToPlayable that THROWS on one tier degrades
  // the ladder to the next tier instead of rejecting generation with an unhandled error.
  it('(LOW-3a) a resolveToPlayable throw on a tier degrades to the next tier (no unhandled rejection)', async () => {
    const musicProfile = featureRichProfile();
    const throwOnFirst = (raw, meta) => {
      if (meta.tier === 0) throw new Error('translate boom on T0');
      return guardedResolve(raw);
    };
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: INTENSE_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: throwOnFirst,
    });
    expect(res.tracks.length).toBeGreaterThan(0);
    expect(res.reason).toBeNull();
    expect(res.fallbackTier).toBeGreaterThanOrEqual(1); // T0 threw → the ladder carried on
  });

  // (LOW-3b) throw-safety terminal: a resolveToPlayable that throws on EVERY tier (including the T2
  // affinity call) returns an honest empty + reason — never an unhandled rejection.
  it('(LOW-3b) a resolveToPlayable that throws on every tier returns an honest empty (no_playable)', async () => {
    const musicProfile = featureRichProfile();
    const alwaysThrow = () => { throw new Error('sink down'); };
    const res = await buildDeterministicFallback({
      userId: 'u1', musicProfile, taps: INTENSE_TAPS, provider: 'spotify',
      targets: null, crossPlatform: false, live: {}, now: NOW, resolveToPlayable: alwaysThrow,
    });
    expect(res.tracks).toEqual([]);
    expect(res.reason).toBe('no_playable');
  });
});
