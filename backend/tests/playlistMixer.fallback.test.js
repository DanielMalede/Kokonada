'use strict';

const { generateFallbackPlaylist } = require('../app/services/playlistMixer');

describe('generateFallbackPlaylist', () => {
  const library = Array.from({ length: 15 }, (_, i) => ({
    id: `track-${i}`,
    title: `Track ${i}`,
    artist: `Artist ${i}`,
    uri: `spotify:track:${i}`,
    tempo: 120 + i,
    energy: 0.5,
    listenCount: i,
  }));

  it('returns up to 10 tracks sorted by listenCount desc', () => {
    const result = generateFallbackPlaylist({ library });
    expect(result).toHaveLength(10);
    expect(result[0].id).toBe('track-14');
    expect(result[9].id).toBe('track-5');
  });

  it('returns all tracks when library has fewer than 10', () => {
    const result = generateFallbackPlaylist({ library: library.slice(0, 3) });
    expect(result).toHaveLength(3);
  });

  it('returns empty array for empty library', () => {
    expect(generateFallbackPlaylist({ library: [] })).toEqual([]);
  });

  it('handles tracks without listenCount (treats as 0)', () => {
    const noCount = [{ id: 'a', title: 'A', artist: 'B', uri: 'spotify:track:a', tempo: 120, energy: 0.5 }];
    expect(generateFallbackPlaylist({ library: noCount })).toHaveLength(1);
  });

  it('returns empty array when musicProfile is empty object', () => {
    expect(generateFallbackPlaylist({})).toEqual([]);
  });
});
