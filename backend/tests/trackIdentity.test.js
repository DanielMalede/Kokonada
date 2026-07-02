'use strict';

process.env.NODE_ENV = 'test';

const {
  canonicalKey,
  normalizeArtist,
  normalizeTitle,
  attachCanonicalKeys,
} = require('../app/services/identity/trackIdentity');

describe('canonicalKey — ISRC precedence', () => {
  it('uses the ISRC when present, normalized to uppercase without separators', () => {
    expect(canonicalKey({ title: 'Song', artist: 'Artist', isrc: 'us-um7-12-34567' }))
      .toBe('isrc:USUM71234567');
  });

  it('two providers with the same ISRC collapse to the same key regardless of metadata', () => {
    const spotify = canonicalKey({ title: 'Song (Remastered 2011)', artist: 'Artist', isrc: 'USUM71234567', provider: 'spotify' });
    const other   = canonicalKey({ title: 'Totally Different Title', artist: 'Whoever', isrc: 'USUM71234567', provider: 'youtube' });
    expect(spotify).toBe(other);
  });
});

describe('canonicalKey — artist|title fingerprint', () => {
  it('builds at:<artist>|<title> when no ISRC exists', () => {
    expect(canonicalKey({ title: 'Halo', artist: 'Beyoncé' })).toBe('at:beyonce|halo');
  });

  it('is case- and diacritic-insensitive', () => {
    expect(canonicalKey({ title: 'HALO', artist: 'BEYONCÉ' }))
      .toBe(canonicalKey({ title: 'halo', artist: 'beyonce' }));
  });

  it('ignores featured-artist decorations in the title', () => {
    expect(canonicalKey({ title: 'Best Song (feat. Drake)', artist: 'Artist' }))
      .toBe(canonicalKey({ title: 'Best Song', artist: 'Artist' }));
  });

  it('ignores featured-artist decorations in the artist', () => {
    expect(canonicalKey({ title: 'Best Song', artist: 'Artist feat. Other Guy' }))
      .toBe(canonicalKey({ title: 'Best Song', artist: 'Artist' }));
  });

  it('ignores parenthetical/bracketed noise (remaster, live, lyric video)', () => {
    const base = canonicalKey({ title: 'Song', artist: 'Artist' });
    expect(canonicalKey({ title: 'Song (Remastered 2011)', artist: 'Artist' })).toBe(base);
    expect(canonicalKey({ title: 'Song [Official Video]', artist: 'Artist' })).toBe(base);
    expect(canonicalKey({ title: 'Song (Live)', artist: 'Artist' })).toBe(base);
  });

  it('ignores Spotify-style dash-suffixed version descriptors', () => {
    const base = canonicalKey({ title: 'Song', artist: 'Artist' });
    expect(canonicalKey({ title: 'Song - Remastered 2011', artist: 'Artist' })).toBe(base);
    expect(canonicalKey({ title: 'Song - Radio Edit', artist: 'Artist' })).toBe(base);
  });

  it('does NOT strip remix markers — a remix is a different song', () => {
    expect(canonicalKey({ title: 'Song (Club Remix)', artist: 'Artist' }))
      .not.toBe(canonicalKey({ title: 'Song', artist: 'Artist' }));
  });

  it('is punctuation-insensitive across providers', () => {
    expect(canonicalKey({ title: "Don't Stop Me Now", artist: 'Queen' }))
      .toBe(canonicalKey({ title: 'Dont Stop Me Now', artist: 'Queen' }));
  });
});

describe('canonicalKey — YouTube-shaped inputs', () => {
  it('parses "Artist - Song (Official Video)" uploads to match the Spotify copy', () => {
    const youtube = canonicalKey({
      provider: 'youtube',
      title: 'Artist - Song (Official Video)',
      artist: 'ArtistVEVO',
    });
    expect(youtube).toBe(canonicalKey({ provider: 'spotify', title: 'Song', artist: 'Artist' }));
  });

  it('uses the cleaned "- Topic" channel as the artist for auto-generated uploads', () => {
    const youtube = canonicalKey({
      provider: 'youtube_music',
      title: 'Song',
      artist: 'Artist - Topic',
    });
    expect(youtube).toBe('at:artist|song');
  });
});

describe('canonicalKey — degenerate inputs', () => {
  it('falls back to provider:id when title and artist are empty', () => {
    expect(canonicalKey({ title: '', artist: '', provider: 'spotify', id: 'abc123' }))
      .toBe('spotify:abc123');
  });

  it('returns null when there is nothing to key on', () => {
    expect(canonicalKey({ title: '', artist: '' })).toBeNull();
    expect(canonicalKey(null)).toBeNull();
  });
});

describe('normalizeArtist / normalizeTitle', () => {
  it('normalizeArtist folds case, diacritics, and feat decorations', () => {
    expect(normalizeArtist('Beyoncé ft. JAY-Z')).toBe('beyonce');
  });

  it('normalizeTitle collapses whitespace', () => {
    expect(normalizeTitle('  Some    Song  ')).toBe('some song');
  });
});

// ── Shadow audit: adversarial edge cases ──────────────────────────────────────

describe('shadow audit — canonicalKey attacks', () => {
  it('non-Latin scripts survive normalization (Cyrillic cross-provider dedup)', () => {
    const spotify = canonicalKey({ title: 'Судно', artist: 'Молчат Дома', provider: 'spotify' });
    const noisy   = canonicalKey({ title: 'Судно (Official Audio)', artist: 'Молчат Дома', provider: 'spotify' });

    expect(spotify).toBe('at:молчат дома|судно');
    expect(noisy).toBe(spotify);
  });

  it('CJK titles produce a real fingerprint, not the provider:id fallback', () => {
    expect(canonicalKey({ title: '残酷な天使のテーゼ', artist: '高橋洋子', provider: 'spotify', id: 'x1' }))
      .toBe('at:高橋洋子|残酷な天使のテーゼ');
  });

  it('junk ISRC values are ignored, never keyed on (collision guard)', () => {
    // 'n/a' would normalize to isrc:NA and collide every junk-tagged track.
    expect(canonicalKey({ title: 'Song', artist: 'Artist', isrc: 'n/a' })).toBe('at:artist|song');
    expect(canonicalKey({ title: 'Song', artist: 'Artist', isrc: 'TBD' })).toBe('at:artist|song');
    expect(canonicalKey({ title: 'Song', artist: 'Artist', isrc: {} })).toBe('at:artist|song');
  });

  it('live vs studio recordings with distinct ISRCs keep distinct keys (feature-store safety)', () => {
    const studio = canonicalKey({ title: 'Song', artist: 'Artist', isrc: 'USUM71234567' });
    const live   = canonicalKey({ title: 'Song - Live at Wembley', artist: 'Artist', isrc: 'USUM79876543' });
    expect(studio).not.toBe(live);
  });

  it('an artist literally named "Live" is not treated as version noise', () => {
    expect(canonicalKey({ title: 'Lightning Crashes', artist: 'Live' }))
      .toBe('at:live|lightning crashes');
  });
});

describe('attachCanonicalKeys', () => {
  it('adds canonicalKey to each track in place, using name when title is absent', () => {
    const tracks = [
      { id: '1', name: 'Halo', artist: 'Beyoncé', provider: 'spotify' },
      { id: '2', title: 'Song', artist: 'Artist - Topic', provider: 'youtube' },
    ];

    const result = attachCanonicalKeys(tracks);

    expect(result).toBe(tracks);
    expect(tracks[0].canonicalKey).toBe('at:beyonce|halo');
    expect(tracks[1].canonicalKey).toBe('at:artist|song');
  });

  it('tolerates null/undefined entries and empty input', () => {
    expect(attachCanonicalKeys([null, undefined])).toEqual([null, undefined]);
    expect(attachCanonicalKeys()).toEqual([]);
  });
});
