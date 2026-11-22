'use strict';

// BE-231 — the DiscoveryQuery is the only thing a music provider's discovery request may be built
// from (the owner's ruling of 2026-10-28: Spotify receives no value derived from medical
// information, the sleep note's effect included; health filtering happens here, after the results
// come back). toDiscoveryQuery is an allow-list: it copies three own keys of string arrays and drops
// everything else, so a target, a band, a tempo category or a key nobody listed cannot ride along.

const { toDiscoveryQuery, bioDiscoveryQuery, DISCOVERY_QUERY_LIMITS } = require('../app/services/discovery/discoveryQuery');

const EMPTY = { seed_genres: [], mood_keywords: [], playlist_queries: [] };

describe('toDiscoveryQuery — the allow-list', () => {
  it('keeps seed_genres, mood_keywords and playlist_queries, and nothing else', () => {
    const q = toDiscoveryQuery({
      seed_genres: ['pop', 'indie'], mood_keywords: ['calm'], playlist_queries: ['peaceful piano'],
      target_bpm: 88, target_energy: 0.2, target_valence: 0.5, target_acousticness: 0.8,
      tempo_category: 'resting', exclude_genres: ['metal'], allow_genres: ['ambient'], seed_artists: ['A'],
      heartRate: 52, stateLabel: 'Resting / Meditative', band: 'resting', limit: 60,
    });
    expect(q).toEqual({ seed_genres: ['pop', 'indie'], mood_keywords: ['calm'], playlist_queries: ['peaceful piano'] });
    expect(Object.keys(q).sort()).toEqual(['mood_keywords', 'playlist_queries', 'seed_genres']);
  });

  it('always has the three keys, as arrays', () => {
    expect(toDiscoveryQuery({})).toEqual(EMPTY);
    expect(toDiscoveryQuery({ seed_genres: ['pop'] })).toEqual({ ...EMPTY, seed_genres: ['pop'] });
  });

  it.each([undefined, null, 'pop', 42, true, ['pop'], () => ({ seed_genres: ['pop'] })])('input %p gives the empty query', (input) => {
    expect(toDiscoveryQuery(input)).toEqual(EMPTY);
  });

  it('keeps only non-empty strings: numbers, objects, null and blanks are dropped', () => {
    const q = toDiscoveryQuery({
      seed_genres: ['pop', 120, null, '', '   ', { g: 'x' }, ['rock'], 'rock', NaN],
      mood_keywords: [0.2, 'calm', undefined],
      playlist_queries: 'not an array',
    });
    expect(q).toEqual({ seed_genres: ['pop', 'rock'], mood_keywords: ['calm'], playlist_queries: [] });
  });

  it('caps each list: seed_genres at 5, mood_keywords at 4, playlist_queries at 4', () => {
    expect(DISCOVERY_QUERY_LIMITS).toEqual({ seed_genres: 5, mood_keywords: 4, playlist_queries: 4 });
    const many = (p) => Array.from({ length: 9 }, (_, i) => `${p}${i}`);
    const q = toDiscoveryQuery({ seed_genres: many('g'), mood_keywords: many('k'), playlist_queries: many('p') });
    expect(q.seed_genres).toEqual(['g0', 'g1', 'g2', 'g3', 'g4']);
    expect(q.mood_keywords).toEqual(['k0', 'k1', 'k2', 'k3']);
    expect(q.playlist_queries).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('caps after dropping, so a junk entry does not cost a real one its place', () => {
    const q = toDiscoveryQuery({ seed_genres: [1, 2, 3, 4, 5, 'a', 'b'] });
    expect(q.seed_genres).toEqual(['a', 'b']);
  });

  it('reads own keys only: an inherited list is not a query', () => {
    const inherited = Object.create({ seed_genres: ['pop'], mood_keywords: ['calm'], playlist_queries: ['x'] });
    expect(toDiscoveryQuery(inherited)).toEqual(EMPTY);
    const viaProto = JSON.parse('{"__proto__": {"seed_genres": ["pop"]}}');
    expect(toDiscoveryQuery(viaProto)).toEqual(EMPTY);
  });

  it('is frozen, its lists too, and never aliases or mutates the input', () => {
    const input = { seed_genres: ['pop'], mood_keywords: ['calm'], playlist_queries: ['q'], target_bpm: 90 };
    const snapshot = JSON.parse(JSON.stringify(input));
    const q = toDiscoveryQuery(input);
    expect(Object.isFrozen(q)).toBe(true);
    for (const k of Object.keys(q)) expect(Object.isFrozen(q[k])).toBe(true);
    expect(q.seed_genres).not.toBe(input.seed_genres);
    expect(input).toEqual(snapshot);
  });

  it('is idempotent', () => {
    const q = toDiscoveryQuery({ seed_genres: ['pop', 'rock'], mood_keywords: ['calm'], target_bpm: 1 });
    expect(toDiscoveryQuery(q)).toEqual(q);
  });
});

describe('bioDiscoveryQuery — the heart branch sends the same query whatever the body does', () => {
  it('is the first two top genres and nothing else', () => {
    expect(bioDiscoveryQuery({ topGenres: ['electronic', 'indie', 'ambient'] }))
      .toEqual({ seed_genres: ['electronic', 'indie'], mood_keywords: [], playlist_queries: [] });
  });

  it('carries no band keyword and no target, and takes no biometric argument', () => {
    expect(bioDiscoveryQuery.length).toBe(1);
    const q = bioDiscoveryQuery({ topGenres: ['pop'], heartRate: 180, band: 'peak', target_bpm: 151 });
    expect(q).toEqual({ seed_genres: ['pop'], mood_keywords: [], playlist_queries: [] });
  });

  it.each([undefined, null, {}, { topGenres: null }, { topGenres: 'pop' }])('profile %p gives the empty query', (profile) => {
    expect(bioDiscoveryQuery(profile)).toEqual(EMPTY);
  });

  it('reads topGenres through a getter, the way a Mongoose document exposes it', () => {
    const doc = Object.create({ get topGenres() { return ['house', 'techno', 'trance']; } });
    expect(bioDiscoveryQuery(doc).seed_genres).toEqual(['house', 'techno']);
  });

  it('is frozen', () => {
    const q = bioDiscoveryQuery({ topGenres: ['pop'] });
    expect(Object.isFrozen(q)).toBe(true);
    expect(Object.isFrozen(q.seed_genres)).toBe(true);
  });
});
