'use strict';

const { cleanYouTubeArtist, parseYouTubeTitle, translateToSpotify } = require('../app/services/crossPlatform');

describe('cleanYouTubeArtist', () => {
  it('strips "- Topic", VEVO, and Official Artist Channel', () => {
    expect(cleanYouTubeArtist('Tame Impala - Topic')).toBe('Tame Impala');
    expect(cleanYouTubeArtist('ColdplayVEVO')).toBe('Coldplay');
    expect(cleanYouTubeArtist('Radiohead - Official Artist Channel')).toBe('Radiohead');
    expect(cleanYouTubeArtist('')).toBe('');
  });
});

describe('parseYouTubeTitle', () => {
  it('splits "Artist - Song (Official Video)" and drops the noise', () => {
    expect(parseYouTubeTitle('Daft Punk - Get Lucky (Official Video)', 'DaftPunkVEVO'))
      .toEqual({ title: 'Get Lucky', artist: 'Daft Punk' });
  });
  it('uses the cleaned channel as the artist for "- Topic" uploads', () => {
    expect(parseYouTubeTitle('Redbone', 'Childish Gambino - Topic'))
      .toEqual({ title: 'Redbone', artist: 'Childish Gambino' });
  });
  it('strips bracketed/lyric noise', () => {
    expect(parseYouTubeTitle('Bohemian Rhapsody [Lyrics]', 'Queen - Topic'))
      .toEqual({ title: 'Bohemian Rhapsody', artist: 'Queen' });
  });
});

describe('translateToSpotify', () => {
  const yt = (name, artist) => ({ name, artist, uri: null, provider: 'youtube_music' });

  it('passes through tracks that already have a spotify URI (no search)', async () => {
    const searchFn = jest.fn();
    const spot = { uri: 'spotify:track:abc', name: 'X', artist: 'Y', provider: 'spotify' };
    const { tracks, translated } = await translateToSpotify([spot], 'tok', { searchFn });
    expect(tracks).toEqual([spot]);
    expect(translated).toBe(0);
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('translates a YouTube track to a playable Spotify URI', async () => {
    const searchFn = jest.fn().mockResolvedValue({ id: 's1', uri: 'spotify:track:s1', name: 'Get Lucky', artist: 'Daft Punk' });
    const { tracks, translated, missed } = await translateToSpotify(
      [yt('Daft Punk - Get Lucky (Official Video)', 'DaftPunkVEVO')], 'tok', { searchFn },
    );
    expect(translated).toBe(1);
    expect(missed).toBe(0);
    expect(tracks[0]).toMatchObject({ uri: 'spotify:track:s1', provider: 'spotify', translatedFrom: 'youtube' });
    expect(searchFn).toHaveBeenCalledWith('tok', { title: 'Get Lucky', artist: 'Daft Punk' });
  });

  it('drops unmatched tracks but keeps the rest, and caches repeat lookups', async () => {
    const searchFn = jest.fn()
      .mockResolvedValueOnce(null)                                                   // miss
      .mockResolvedValue({ id: 's2', uri: 'spotify:track:s2', name: 'A', artist: 'B' });
    const input = [yt('Unknown Thing', 'Nobody'), yt('A', 'B'), yt('A', 'B')];
    const { tracks, translated, missed } = await translateToSpotify(input, 'tok', { searchFn });
    expect(missed).toBe(1);
    expect(translated).toBe(2);         // second + third both resolve
    expect(tracks).toHaveLength(2);
    expect(searchFn).toHaveBeenCalledTimes(2); // third is served from cache
  });
});
