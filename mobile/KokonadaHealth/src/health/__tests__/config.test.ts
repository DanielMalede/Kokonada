// Contract test for the committed config template. The Spotify App Remote identity
// (client id + redirect uri) is consumed at import time by spotifyRemoteAdapter's
// top-level SpotifyRemote.configure(...) call; if either export silently drops from
// this template again, the native @NonNull check red-boxes the app at launch. Pinning
// both as non-empty strings keeps that contract from regressing.
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from '../config';

test('config exports SPOTIFY_CLIENT_ID as a non-empty string', () => {
  expect(typeof SPOTIFY_CLIENT_ID).toBe('string');
  expect(SPOTIFY_CLIENT_ID.length).toBeGreaterThan(0);
});

test('config exports SPOTIFY_REDIRECT_URI as a non-empty string', () => {
  expect(typeof SPOTIFY_REDIRECT_URI).toBe('string');
  expect(SPOTIFY_REDIRECT_URI.length).toBeGreaterThan(0);
});
