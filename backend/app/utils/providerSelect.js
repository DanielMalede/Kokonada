'use strict';

/**
 * Resolves the music provider the app should actually drive for a user, based
 * on which provider has a stored (connected) token — never a stale
 * `user.musicProvider` string on its own.
 *
 * Why: the frontend keys the Spotify Web Playback SDK and the POST /spotify/play
 * call off the provider reported by GET /integrations/status. If that string
 * says 'spotify' but no Spotify token is stored (the user disconnected, or only
 * YouTube is linked), the SDK token fetch and the play call both 400. Selecting
 * by token presence keeps the UI, playlist generation, and playback on the same,
 * usable provider.
 *
 * Precedence when both are connected: honor the user's explicit `musicProvider`
 * choice when that provider has a token; otherwise prefer Spotify (richer
 * playback + audio features), then YouTube.
 *
 * @param {{
 *   musicProvider?: string|null,
 *   spotifyToken?: { blob?: string }|null,
 *   youtubeMusicToken?: { blob?: string }|null,
 * }} user
 * @returns {'spotify'|'youtube'|null}
 */
function resolveMusicProvider(user) {
  if (!user) return null;

  const hasSpotify = !!user.spotifyToken?.blob;
  const hasYoutube = !!user.youtubeMusicToken?.blob;

  // Honor an explicit choice only if its token is actually present.
  if (user.musicProvider === 'spotify' && hasSpotify) return 'spotify';
  if (user.musicProvider === 'youtube' && hasYoutube) return 'youtube';

  // Otherwise fall back to whichever token exists (Spotify preferred).
  if (hasSpotify) return 'spotify';
  if (hasYoutube) return 'youtube';
  return null;
}

module.exports = { resolveMusicProvider };
