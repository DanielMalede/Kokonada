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

/**
 * The PLAYBACK engine. Playback always happens on the Spotify Web Playback SDK, so this
 * is 'spotify' whenever a Spotify token is connected — independent of `musicProvider` or
 * which provider built the taste profile. Returns null when Spotify isn't connected (a
 * YouTube-only user still gets a profile + generated tracks, but no in-app playback until
 * they connect Spotify).
 *
 * @param {{ spotifyToken?: { blob?: string }|null }} user
 * @returns {'spotify'|null}
 */
function resolvePlaybackProvider(user) {
  return user && user.spotifyToken?.blob ? 'spotify' : null;
}

/**
 * The DATA-engine providers currently connected. Spotify and YouTube can BOTH be active
 * at once (their tokens are stored in separate fields and never overwrite each other), so
 * the taste profile can be built from either or both.
 *
 * @returns {Array<'spotify'|'youtube'>}
 */
function resolveDataProviders(user) {
  if (!user) return [];
  const providers = [];
  if (user.spotifyToken?.blob) providers.push('spotify');
  if (user.youtubeMusicToken?.blob) providers.push('youtube');
  return providers;
}

module.exports = { resolveMusicProvider, resolvePlaybackProvider, resolveDataProviders };
