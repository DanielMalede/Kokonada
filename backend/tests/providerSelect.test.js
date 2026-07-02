'use strict';

const {
  resolveMusicProvider,
  resolvePlaybackProvider,
  resolveDataProviders,
} = require('../app/utils/providerSelect');

const spToken = { blob: 'enc-sp' };
const ytToken = { blob: 'enc-yt' };

describe('resolvePlaybackProvider (Spotify is the only playback engine)', () => {
  it('is spotify whenever a Spotify token exists — even if musicProvider says youtube', () => {
    expect(resolvePlaybackProvider({ spotifyToken: spToken, youtubeMusicToken: ytToken, musicProvider: 'youtube' })).toBe('spotify');
  });
  it('is null for a YouTube-only user (no in-app playback)', () => {
    expect(resolvePlaybackProvider({ spotifyToken: null, youtubeMusicToken: ytToken })).toBeNull();
  });
  it('is null for no user', () => {
    expect(resolvePlaybackProvider(null)).toBeNull();
  });
});

describe('resolveDataProviders (both can be active simultaneously)', () => {
  it('lists both when both tokens are present', () => {
    expect(resolveDataProviders({ spotifyToken: spToken, youtubeMusicToken: ytToken })).toEqual(['spotify', 'youtube']);
  });
  it('lists only the connected one', () => {
    expect(resolveDataProviders({ spotifyToken: null, youtubeMusicToken: ytToken })).toEqual(['youtube']);
    expect(resolveDataProviders({ spotifyToken: spToken, youtubeMusicToken: null })).toEqual(['spotify']);
  });
  it('is empty for no connections', () => {
    expect(resolveDataProviders({})).toEqual([]);
    expect(resolveDataProviders(null)).toEqual([]);
  });
});

describe('resolveMusicProvider', () => {
  it('returns null when neither provider has a token', () => {
    expect(resolveMusicProvider({ spotifyToken: null, youtubeMusicToken: null })).toBeNull();
  });

  it('returns null for a null/undefined user', () => {
    expect(resolveMusicProvider(null)).toBeNull();
    expect(resolveMusicProvider(undefined)).toBeNull();
  });

  it('returns spotify when only Spotify has a token', () => {
    expect(resolveMusicProvider({ spotifyToken: spToken, youtubeMusicToken: null })).toBe('spotify');
  });

  it('returns youtube when only YouTube has a token', () => {
    expect(resolveMusicProvider({ spotifyToken: null, youtubeMusicToken: ytToken })).toBe('youtube');
  });

  it('prefers Spotify when both are connected and there is no explicit choice', () => {
    expect(resolveMusicProvider({ spotifyToken: spToken, youtubeMusicToken: ytToken })).toBe('spotify');
  });

  it('honors an explicit youtube choice when its token exists', () => {
    expect(resolveMusicProvider({
      musicProvider: 'youtube', spotifyToken: spToken, youtubeMusicToken: ytToken,
    })).toBe('youtube');
  });

  it('ignores a stale spotify choice when no Spotify token is stored (heals the desync)', () => {
    // The exact failing prod state: musicProvider says spotify, but the only
    // stored token is YouTube — driving the Spotify SDK here is what 400s.
    expect(resolveMusicProvider({
      musicProvider: 'spotify', spotifyToken: null, youtubeMusicToken: ytToken,
    })).toBe('youtube');
  });

  it('treats a token object without a blob as not connected', () => {
    expect(resolveMusicProvider({ spotifyToken: {}, youtubeMusicToken: null })).toBeNull();
  });
});
