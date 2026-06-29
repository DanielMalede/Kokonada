'use strict';

const { isSpotifyTrackUri, sanitizeSpotifyTrackUris } = require('../app/utils/spotifyUri');

// Real-shaped 22-char base-62 track ids.
const A = 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh';
const B = 'spotify:track:1301WleyT98MSxVHPZCA6M';

describe('isSpotifyTrackUri', () => {
  it('accepts a well-formed 22-char track URI', () => {
    expect(isSpotifyTrackUri(A)).toBe(true);
  });

  it('rejects a YouTube video id reconstructed as a Spotify URI (the prod bug)', () => {
    // YouTube ids are 11 chars and often contain - or _ — never a valid Spotify id.
    expect(isSpotifyTrackUri('spotify:track:dQw4w9WgXcQ')).toBe(false);
    expect(isSpotifyTrackUri('spotify:track:a-b_c1234567')).toBe(false);
  });

  it('rejects a half-built URI with an empty id', () => {
    expect(isSpotifyTrackUri('spotify:track:')).toBe(false);
  });

  it('rejects non-track Spotify URIs', () => {
    expect(isSpotifyTrackUri('spotify:album:4iV5W9uYEdYUVa79Axb7Rh')).toBe(false);
    expect(isSpotifyTrackUri('spotify:episode:4iV5W9uYEdYUVa79Axb7Rh')).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 42, {}, []]) expect(isSpotifyTrackUri(v)).toBe(false);
  });
});

describe('sanitizeSpotifyTrackUris', () => {
  it('keeps only valid URIs, preserving order', () => {
    expect(sanitizeSpotifyTrackUris([A, 'spotify:track:tooShort', B])).toEqual([A, B]);
  });

  it('drops undefined / null / empty and a malformed cross-provider URI', () => {
    expect(sanitizeSpotifyTrackUris([undefined, null, '', 'spotify:track:dQw4w9WgXcQ', A])).toEqual([A]);
  });

  it('de-duplicates while preserving first-seen order', () => {
    expect(sanitizeSpotifyTrackUris([A, A, B, A])).toEqual([A, B]);
  });

  it('returns [] for a non-array', () => {
    expect(sanitizeSpotifyTrackUris('nope')).toEqual([]);
    expect(sanitizeSpotifyTrackUris(undefined)).toEqual([]);
  });

  it('returns [] when every URI is invalid (caller should 422, not forward)', () => {
    expect(sanitizeSpotifyTrackUris(['spotify:track:dQw4w9WgXcQ', 'https://x', null])).toEqual([]);
  });
});
