'use strict';

process.env.NODE_ENV = 'test';

const fs = require('fs');
const { buildVector, cosine } = require('../app/services/vector/embedding');
const { nearestLibraryAnchor, attachLibraryAnchors } = require('../app/services/discovery/libraryAnchor');

// Vetted real vectors (see embedding.buildVector): twin→1.0, mid→~0.967, far→~0.285.
const AFRO = ['afrobeat'];
const F = { bpm: 120, energy: 0.7, valence: 0.6, acousticness: 0.2, danceability: 0.8, loudness: -6 };
const F_MID = { bpm: 100, energy: 0.5, valence: 0.5, acousticness: 0.5, danceability: 0.5, loudness: -12 };
const F_FAR = { bpm: 60, energy: 0.1, valence: 0.1, acousticness: 0.95, danceability: 0.1, loudness: -40 };

const disc = () => ({ embedding: buildVector(F, AFRO) });
const yt = (over = {}) => ({ provider: 'youtube_music', artist: 'Burna Boy', name: 'Ye', embedding: buildVector(F, AFRO), ...over });

describe('libraryAnchor.nearestLibraryAnchor', () => {
  it('returns the argmax library anchor above the floor for a genre+feature twin', () => {
    const near = yt({ artist: 'Burna Boy', name: 'Ye', embedding: buildVector(F, AFRO) });
    const far  = yt({ artist: 'Someone', name: 'Elsewhere', embedding: buildVector(F_FAR, ['ambient']) });
    const res = nearestLibraryAnchor(disc(), [far, near], { minCosine: 0.6 });
    expect(res.anchor).toEqual({ title: 'Ye', artist: 'Burna Boy' });
    expect(res.score).toBeGreaterThanOrEqual(0.6);
    expect(res.score).toBeCloseTo(1, 5); // twin
  });

  it('sources the title from name, falling back to title when name is absent', () => {
    const res = nearestLibraryAnchor(disc(), [yt({ name: undefined, title: 'Titled', artist: 'A' })], { minCosine: 0.6 });
    expect(res.anchor).toEqual({ title: 'Titled', artist: 'A' });
  });

  it('floor boundary: a candidate exactly AT the floor passes; just below is rejected', () => {
    const d = { embedding: buildVector(F, AFRO) };
    const cand = yt({ embedding: buildVector(F_MID, AFRO), artist: 'X', name: 'Y' });
    const exact = cosine(d.embedding, cand.embedding); // real, deterministic (~0.967)
    expect(exact).toBeGreaterThan(0.6);
    expect(exact).toBeLessThan(1);
    expect(nearestLibraryAnchor(d, [cand], { minCosine: exact })).not.toBeNull();        // == floor passes
    expect(nearestLibraryAnchor(d, [cand], { minCosine: exact + 1e-9 })).toBeNull();       // just below → null
  });

  describe('L1 — floor config footgun (the default must be a POSITIVE finite cosine)', () => {
    // Two genuinely orthogonal unit vectors (cosine exactly 0). A non-negative embedding
    // pair only reaches 0 when their supports are disjoint — this is the "any non-negative
    // cosine qualifies" trap a floor collapsed to 0 (or a negative floor) would open.
    const unit = (i) => { const v = new Array(70).fill(0); v[i] = 1; return v; };
    const orthDisc = { embedding: unit(0) };
    const orthYt   = yt({ embedding: unit(1) });

    it('an orthogonal (cosine 0) youtube_music neighbour yields NO anchor under the unset default (0.6)', () => {
      expect(cosine(orthDisc.embedding, orthYt.embedding)).toBe(0);
      expect(nearestLibraryAnchor(orthDisc, [orthYt], {})).toBeNull();  // minCosine unset → 0.6
      expect(nearestLibraryAnchor(orthDisc, [orthYt])).toBeNull();      // opts omitted → 0.6
    });

    it.each([
      ['',   'empty string → Number("")===0'],
      ['-1', 'negative string → always-passes'],
      [0,    'numeric zero'],
      [-1,   'numeric negative'],
      ['abc','non-numeric → NaN'],
    ])('minCosine=%p (%s) falls back to 0.6, so an orthogonal neighbour stays anchor-less', (bad) => {
      expect(nearestLibraryAnchor(orthDisc, [orthYt], { minCosine: bad })).toBeNull();
    });
  });

  describe('COMPLIANCE provider gate', () => {
    it('returns null when the genuine nearest is spotify-sourced, even with a farther above-floor youtube_music candidate', () => {
      const d = disc();
      const spot = { provider: 'spotify', artist: 'S', name: 'SN', embedding: buildVector(F, AFRO) };      // twin → nearest
      const ytFar = yt({ artist: 'Y', name: 'YN', embedding: buildVector(F_MID, AFRO) });                   // above floor, farther
      expect(cosine(d.embedding, ytFar.embedding)).toBeGreaterThan(0.6); // proves "even if above floor"
      expect(nearestLibraryAnchor(d, [spot, ytFar], { minCosine: 0.6 })).toBeNull();
    });

    it('returns the anchor when the nearest eligible candidate is youtube_music', () => {
      const res = nearestLibraryAnchor(disc(), [yt()], { minCosine: 0.6 });
      expect(res.anchor).toEqual({ title: 'Ye', artist: 'Burna Boy' });
    });
  });

  describe('M1 — a non-finite-scored candidate cannot leak past the legal gate or scramble the argmax', () => {
    const poison = (val) => buildVector(F, AFRO).map((x, i) => (i === 0 ? val : x));

    it('an Infinity-scored youtube_music candidate does NOT leak past the provider gate — the genuine finite Spotify argmax decides it → null', () => {
      const d = disc();
      const inf = yt({ artist: 'InfArtist', name: 'InfName', embedding: poison(Infinity) });
      const spotTwin = { provider: 'spotify', artist: 'S', name: 'SN', embedding: buildVector(F, AFRO) }; // genuine finite argmax
      expect(cosine(d.embedding, inf.embedding)).toBe(Infinity);         // it WOULD sort to the top of a naive rank
      expect(cosine(d.embedding, spotTwin.embedding)).toBeCloseTo(1, 5); // the true nearest is spotify → the gate must null
      expect(nearestLibraryAnchor(d, [inf, spotTwin], { minCosine: 0.6 })).toBeNull();
    });

    it('an Infinity-scored youtube_music candidate does NOT displace a genuinely-nearer FINITE youtube_music argmax', () => {
      const d = disc();
      const inf  = yt({ artist: 'InfArtist',  name: 'InfName',  embedding: poison(Infinity) });
      const twin = yt({ artist: 'RealArtist', name: 'RealName', embedding: buildVector(F, AFRO) }); // genuine finite argmax
      expect(nearestLibraryAnchor(d, [inf, twin], { minCosine: 0.6 }).anchor)
        .toEqual({ title: 'RealName', artist: 'RealArtist' });
    });

    it('an Infinity-scored youtube_music candidate alone is never named', () => {
      const inf = yt({ artist: 'InfArtist', name: 'InfName', embedding: poison(Infinity) });
      expect(nearestLibraryAnchor(disc(), [inf], { minCosine: 0.6 })).toBeNull();
    });

    it('a NaN-scored candidate is SKIPPED (not sorted) so it cannot suppress a genuine finite anchor, whatever its input position', () => {
      const d = disc();
      const nan  = yt({ artist: 'NaNArtist',  name: 'NaNName',  embedding: poison(NaN) });
      const twin = yt({ artist: 'RealArtist', name: 'RealName', embedding: buildVector(F, AFRO) });
      expect(cosine(d.embedding, nan.embedding)).toBeNaN();
      // NaN-first is exactly the order where the old full-sort scramble suppressed the valid anchor.
      expect(nearestLibraryAnchor(d, [nan, twin], { minCosine: 0.6 }).anchor)
        .toEqual({ title: 'RealName', artist: 'RealArtist' });
      expect(nearestLibraryAnchor(d, [twin, nan], { minCosine: 0.6 }).anchor)
        .toEqual({ title: 'RealName', artist: 'RealArtist' });
    });
  });

  it('returns null for an empty library', () => {
    expect(nearestLibraryAnchor(disc(), [], { minCosine: 0.6 })).toBeNull();
    expect(nearestLibraryAnchor(disc(), undefined, { minCosine: 0.6 })).toBeNull();
  });

  it('returns null (never throws) when the discovery embedding is missing, empty, or a zero vector', () => {
    expect(nearestLibraryAnchor({ embedding: null }, [yt()], { minCosine: 0.6 })).toBeNull();
    expect(nearestLibraryAnchor({}, [yt()], {})).toBeNull();
    expect(nearestLibraryAnchor({ embedding: [] }, [yt()], {})).toBeNull();
    expect(nearestLibraryAnchor({ embedding: new Array(70).fill(0) }, [yt()], { minCosine: 0.6 })).toBeNull();
    expect(nearestLibraryAnchor(null, [yt()], { minCosine: 0.6 })).toBeNull();
  });

  it('falls through an un-nameable nearest to the next above-floor nameable candidate; else null', () => {
    const d = disc();
    const unnamed = yt({ artist: '   ', name: 'NoName', embedding: buildVector(F, AFRO) });      // twin, nearest, blank artist
    const named   = yt({ artist: 'Wizkid', name: 'Essence', embedding: buildVector(F_MID, AFRO) }); // farther, nameable
    expect(cosine(d.embedding, named.embedding)).toBeGreaterThan(0.6);
    expect(nearestLibraryAnchor(d, [unnamed, named], { minCosine: 0.6 }).anchor)
      .toEqual({ title: 'Essence', artist: 'Wizkid' });
    // Only an un-nameable candidate above floor → omit.
    expect(nearestLibraryAnchor(d, [unnamed], { minCosine: 0.6 })).toBeNull();
  });

  it('never mutates the candidate objects', () => {
    const cand = yt();
    const snapshot = JSON.stringify(cand);
    nearestLibraryAnchor(disc(), [cand], { minCosine: 0.6 });
    expect(JSON.stringify(cand)).toBe(snapshot);
    expect(cand.anchor).toBeUndefined();
  });

  it('does not import any repository / model / vector-index / cache module (pure)', () => {
    const src = fs.readFileSync(require.resolve('../app/services/discovery/libraryAnchor'), 'utf8');
    expect(src).not.toMatch(/require\(['"][^'"]*(repositories|repository)/);
    expect(src).not.toMatch(/require\(['"][^'"]*(\/models\/|models['"])/);
    expect(src).not.toMatch(/require\(['"][^'"]*(vectorIndex|mongoAtlas|config\/redis|mongoose)/);
  });
});

describe('libraryAnchor.attachLibraryAnchors', () => {
  it('mutates each qualifying discovery pick with { title, artist }', () => {
    const picks = [
      { isDiscovery: true, embedding: buildVector(F, AFRO) },
      { isDiscovery: true, embedding: buildVector(F_FAR, ['ambient']) }, // below floor vs the AFRO library
    ];
    const library = [yt()];
    attachLibraryAnchors(picks, library, { minCosine: 0.6 });
    expect(picks[0].anchor).toEqual({ title: 'Ye', artist: 'Burna Boy' });
    expect(picks[1].anchor).toBeUndefined();
  });

  it('never throws on malformed input and never sets an anchor from a spotify nearest', () => {
    const picks = [
      { isDiscovery: true, embedding: buildVector(F, AFRO) },
      { isDiscovery: true }, // no embedding
    ];
    const spotLibrary = [{ provider: 'spotify', artist: 'S', name: 'SN', embedding: buildVector(F, AFRO) }];
    expect(() => attachLibraryAnchors(picks, spotLibrary, { minCosine: 0.6 })).not.toThrow();
    expect(picks[0].anchor).toBeUndefined(); // gate: spotify nearest → no claim
    expect(picks[1].anchor).toBeUndefined();
    expect(() => attachLibraryAnchors(null, spotLibrary, {})).not.toThrow();
  });
});
