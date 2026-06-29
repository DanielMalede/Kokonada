const axios = require('axios');
const { URLSearchParams } = require('url');
const { withRetry } = require('../utils/retry');

const BASE_AUTH = 'https://accounts.spotify.com';
const BASE_API  = 'https://api.spotify.com/v1';

// Least privilege: only scopes the code actually uses. playlist-modify-public/
// private are required by the "Save to library" export (createPlaylist +
// addTracksToPlaylist). NOTE: re-granting a new scope requires each user to
// reconnect Spotify once — exportSpotifyPlaylist detects the 403 and prompts it.
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  // Required to read Saved Tracks (/me/tracks) when building the taste profile
  // from listening history. Adding a scope means each user must reconnect Spotify
  // once to re-consent (buildProfile degrades gracefully on a pre-consent token).
  'user-library-read',
  'streaming',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

function getAuthHeader() {
  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');
  return `Basic ${creds}`;
}

// Step 1: Build the URL the user is redirected to
function getAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.SPOTIFY_CLIENT_ID,
    scope:         SCOPES,
    redirect_uri:  process.env.SPOTIFY_REDIRECT_URI,
    state,
    show_dialog:   'false',
  });
  return `${BASE_AUTH}/authorize?${params}`;
}

// Step 2: Exchange authorization code for access + refresh tokens
async function exchangeCode(code) {
  const { data } = await axios.post(
    `${BASE_AUTH}/api/token`,
    new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    }),
    {
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 8000,
    }
  );
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
}

// Refresh an expired access token using the stored refresh token.
// A 400/401 from Spotify's token endpoint is not a transient error: the refresh
// token has been revoked/expired, or SPOTIFY_CLIENT_ID/SECRET are wrong. There
// is no automatic recovery — the user must reconnect Spotify. We log Spotify's
// real status + error body (e.g. `invalid_grant` vs `invalid_client`) so the
// true cause is visible, and surface a typed `reconnect_required` error instead
// of an opaque 400 the frontend can't act on.
async function refreshAccessToken(refreshToken) {
  let data;
  try {
    ({ data } = await axios.post(
      `${BASE_AUTH}/api/token`,
      new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 8000,
      }
    ));
  } catch (err) {
    const status = err.response?.status;
    console.error('[spotify] token refresh failed', {
      status,
      error: err.response?.data?.error ?? err.message,
      description: err.response?.data?.error_description,
    });
    if (status === 400 || status === 401) {
      throw Object.assign(
        new Error('Spotify session expired — reconnect Spotify'),
        { statusCode: 401, code: 'reconnect_required' },
      );
    }
    throw err; // network / 5xx — surface as a server error, not a reconnect prompt
  }
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken, // Spotify may or may not rotate it
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
}

// Get a valid access token — refreshes automatically if within 5 min of expiry
async function getValidToken(user) {
  const stored = user.getToken('spotifyToken');
  if (!stored) throw Object.assign(new Error('Spotify not connected'), { statusCode: 400, code: 'spotify_not_connected' });

  const bufferMs = 5 * 60 * 1000;
  if (Date.now() < stored.expiresAt - bufferMs) {
    return stored.accessToken;
  }

  const refreshed = await refreshAccessToken(stored.refreshToken);
  user.setToken('spotifyToken', refreshed);
  await user.save();
  return refreshed.accessToken;
}

// Run a Spotify API call with the user's valid token. On a 401 (Spotify rejected
// the token despite our 5-min refresh buffer — clock skew, mid-flight expiry, or a
// revoke), force ONE refresh and retry so a save/play never silently fails on a
// stale token. A 403 means the token lacks a required scope (user authorized before
// playlist-modify-* was added) — surface a typed error so the caller can prompt a
// reconnect rather than 500-ing.
async function withFreshToken(user, fn) {
  const token = await getValidToken(user);
  try {
    return await fn(token);
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      const stored = user.getToken('spotifyToken');
      const refreshed = await refreshAccessToken(stored.refreshToken);
      user.setToken('spotifyToken', refreshed);
      await user.save();
      return await fn(refreshed.accessToken);
    }
    if (status === 403) {
      throw Object.assign(
        new Error('Spotify permission missing — reconnect Spotify to grant playlist access'),
        { statusCode: 403, code: 'insufficient_scope' },
      );
    }
    throw err;
  }
}

// Fetch the user's Spotify profile (used to verify connection)
async function getProfile(accessToken) {
  const { data } = await axios.get(`${BASE_API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 5000,
  });
  return { spotifyId: data.id, displayName: data.display_name, email: data.email };
}

// Fetch user's top tracks audio features — used to build Musical DNA in Phase 3
async function getTopTrackFeatures(accessToken, limit = 50) {
  const { data: topData } = await axios.get(`${BASE_API}/me/top/tracks`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { limit, time_range: 'medium_term' },
    timeout: 8000,
  });

  const ids = topData.items.map(t => t.id).join(',');
  if (!ids) return [];

  const { data: featData } = await axios.get(`${BASE_API}/audio-features`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { ids },
    timeout: 8000,
  });

  return featData.audio_features.filter(Boolean);
}

// ── Listening-history endpoints (post-2024 profile foundation) ──────────────────
// /audio-features and /recommendations are dead for new apps (Spotify, Nov 2024),
// so taste is now inferred from what the user actually listens to: top tracks/
// artists, saved tracks, and recently-played — all still available to every app.

/**
 * The user's top tracks for a listening window.
 * @param {'short_term'|'medium_term'|'long_term'} timeRange
 * @returns {Promise<SpotifyTrack[]>}
 */
async function getTopTracks(accessToken, timeRange = 'medium_term', limit = 50) {
  const { data } = await withRetry(() =>
    axios.get(`${BASE_API}/me/top/tracks`, {
      headers: authHeader(accessToken),
      params:  { limit, time_range: timeRange },
      timeout: 10_000,
    })
  );
  return data.items ?? [];
}

/**
 * The user's top artists for a listening window. Each artist object carries the
 * `genres` array — the accurate genre signal that replaces dead audio-features.
 * @param {'short_term'|'medium_term'|'long_term'} timeRange
 * @returns {Promise<Array<{ id: string, name: string, genres: string[] }>>}
 */
async function getTopArtists(accessToken, timeRange = 'medium_term', limit = 50) {
  const { data } = await withRetry(() =>
    axios.get(`${BASE_API}/me/top/artists`, {
      headers: authHeader(accessToken),
      params:  { limit, time_range: timeRange },
      timeout: 10_000,
    })
  );
  return data.items ?? [];
}

/**
 * The user's recently-played tracks (real-time listening signal).
 * @returns {Promise<SpotifyTrack[]>}
 */
async function getRecentlyPlayed(accessToken, limit = 50) {
  const { data } = await withRetry(() =>
    axios.get(`${BASE_API}/me/player/recently-played`, {
      headers: authHeader(accessToken),
      params:  { limit },
      timeout: 10_000,
    })
  );
  return (data.items ?? []).map(i => i.track).filter(Boolean);
}

/**
 * Resolves genres for a set of artist IDs, batching in groups of 50 (the /artists
 * per-request limit). Used to tag library + discovery tracks with their artists'
 * genres so the mixer can match/filter on taste.
 * @param {string[]} ids
 * @returns {Promise<Record<string, string[]>>} map of artistId → genres
 */
async function getArtistsGenres(accessToken, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};

  const BATCH = 50;
  const map = {};
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const { data } = await withRetry(() =>
      axios.get(`${BASE_API}/artists`, {
        headers: authHeader(accessToken),
        params:  { ids: batch.join(',') },
        timeout: 10_000,
      })
    );
    for (const a of data.artists ?? []) {
      if (a?.id) map[a.id] = a.genres ?? [];
    }
  }
  return map;
}

// ── Deep-pagination helpers ───────────────────────────────────────────────────

function authHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Fetches every Liked Song for the authenticated user, following all pages.
 * Handles HTTP 429 via withRetry.
 * @returns {Promise<SpotifyTrack[]>}
 */
async function paginateLikedSongs(accessToken) {
  const tracks = [];
  let url = `${BASE_API}/me/tracks?limit=50`;

  while (url) {
    const { data } = await withRetry(() =>
      axios.get(url, { headers: authHeader(accessToken), timeout: 10_000 })
    );
    for (const item of data.items) {
      if (item.track?.id) tracks.push(item.track);
    }
    url = data.next;
  }

  return tracks;
}

/**
 * Fetches tracks from all of the user's playlists, following all pages for
 * both the playlist list and each playlist's track list.
 * @returns {Promise<SpotifyTrack[]>}
 */
async function paginatePlaylistTracks(accessToken) {
  // Step 1 — collect all playlists
  const playlists = [];
  let plUrl = `${BASE_API}/me/playlists?limit=50`;

  while (plUrl) {
    const { data } = await withRetry(() =>
      axios.get(plUrl, { headers: authHeader(accessToken), timeout: 10_000 })
    );
    playlists.push(...data.items);
    plUrl = data.next;
  }

  // Step 2 — collect all tracks from each playlist
  const tracks = [];

  for (const pl of playlists) {
    let tUrl = `${BASE_API}/playlists/${pl.id}/tracks?limit=100`;
    while (tUrl) {
      const { data } = await withRetry(() =>
        axios.get(tUrl, { headers: authHeader(accessToken), timeout: 10_000 })
      );
      for (const item of data.items) {
        if (item.track?.id) tracks.push(item.track);
      }
      tUrl = data.next;
    }
  }

  return tracks;
}

/**
 * Fetches audio features for an arbitrary number of track IDs, batching in
 * groups of 100 (the Spotify API hard limit per request).
 * @param {string[]} ids
 * @returns {Promise<SpotifyAudioFeature[]>}
 */
async function batchAudioFeatures(accessToken, ids) {
  if (!ids.length) return [];

  const BATCH = 100;
  const results = [];

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { data } = await withRetry(() =>
      axios.get(`${BASE_API}/audio-features`, {
        headers: authHeader(accessToken),
        params:  { ids: batch.join(',') },
        timeout: 10_000,
      })
    );
    results.push(...data.audio_features.filter(Boolean));
  }

  return results;
}

/**
 * Fetches Spotify track recommendations using AI-computed audio targets.
 * seed_artists from Gemini are display names, not Spotify IDs — we rely on
 * seed_genres which are valid genre seeds for the recommendations API.
 *
 * @param {string} accessToken
 * @param {{ target_bpm, target_energy, target_valence, target_acousticness, seed_genres, limit? }} params
 * @returns {Promise<SpotifyTrack[]>}
 */
async function getRecommendations(accessToken, {
  target_bpm, target_energy, target_valence, target_acousticness, seed_genres, mood_keywords = [], limit = 10,
}) {
  const validGenres = (seed_genres || []).slice(0, 5);
  if (!validGenres.length) return [];

  try {
    const { data } = await withRetry(() =>
      axios.get(`${BASE_API}/recommendations`, {
        headers: authHeader(accessToken),
        params: {
          seed_genres:         validGenres.join(','),
          target_tempo:        target_bpm,
          target_energy,
          target_valence,
          target_acousticness,
          limit,
        },
        timeout: 8_000,
      })
    );
    return data.tracks ?? [];
  } catch (err) {
    const status = err.response?.status;
    // Spotify deprecated /recommendations (Nov 2024) — apps without prior access
    // get 404/403. Degrade to genre search so discovery still yields real,
    // playable tracks (no audio-target precision, but a working playlist). The
    // mood_keywords (from the LLM) bias the query so results actually match mood.
    if (status === 404 || status === 403) {
      console.warn(`[spotify] /recommendations unavailable (${status}) — falling back to search`);
      return searchTracksByGenres(accessToken, validGenres, limit, mood_keywords);
    }
    throw err;
  }
}

/**
 * Discovery fallback when /recommendations is unavailable: searches each seed
 * genre (optionally biased by mood keywords) and returns de-duplicated, playable
 * tracks (id + uri + name + artists), the same shape /recommendations returns, so
 * the pipeline is unchanged.
 */
async function searchTracksByGenres(accessToken, genres, limit = 10, keywords = []) {
  // Spotify's /search caps `limit` at 50 — requesting more 400s the whole call.
  const SEARCH_MAX = 50;
  const per = Math.min(SEARCH_MAX, Math.max(1, Math.ceil(limit / Math.max(genres.length, 1))));
  const collected = [];
  const kw = (keywords || []).filter(Boolean).slice(0, 2).join(' ');

  for (const genre of genres) {
    // Bias by mood keywords first (best mood fit), then plain genre as a fallback.
    // Accumulate across query forms up to `per` so a narrow mood query that
    // returns only a few tracks doesn't starve the genre's yield.
    const queries = kw
      ? [`genre:"${genre}" ${kw}`, `genre:"${genre}"`, `${genre} ${kw}`, genre]
      : [`genre:"${genre}"`, genre];
    let got = 0;
    for (const q of queries) {
      if (got >= per) break;
      try {
        const { data } = await withRetry(() =>
          axios.get(`${BASE_API}/search`, {
            headers: authHeader(accessToken),
            params:  { q, type: 'track', limit: per },
            timeout: 8_000,
          })
        );
        const items = data.tracks?.items ?? [];
        if (items.length) { collected.push(...items); got += items.length; }
      } catch { /* try the next query form / genre */ }
    }
  }

  const seen = new Set();
  const out = [];
  for (const t of collected) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Sends a play command to a Spotify device.
 * @param {string} accessToken
 * @param {string[]} uris  Spotify track URIs — e.g. ['spotify:track:abc123']
 * @param {string} [deviceId]  Device ID from the SDK 'ready' event. Omitted on
 *   mobile (no Web Playback SDK device) — Spotify then plays on the active device.
 */
async function playTracks(accessToken, uris, deviceId) {
  await axios.put(
    `${BASE_API}/me/player/play`,
    { uris },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  deviceId ? { device_id: deviceId } : {},
      timeout: 8_000,
    }
  );
}

/**
 * Returns the id of the user's active (or first available) Spotify device, or
 * null if none. Used to transfer playback on mobile, where there is no in-app
 * Web Playback SDK device.
 */
async function getActiveDevice(accessToken) {
  const { data } = await axios.get(`${BASE_API}/me/player/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 5_000,
  });
  const devices = data.devices ?? [];
  const chosen = devices.find((d) => d.is_active) ?? devices[0] ?? null;
  return chosen ? chosen.id : null;
}

/**
 * Creates a new (private) playlist in the user's account.
 * @returns {Promise<{ id: string, url: string|null }>}
 */
async function createPlaylist(accessToken, spotifyUserId, name, description = '') {
  const { data } = await axios.post(
    `${BASE_API}/users/${encodeURIComponent(spotifyUserId)}/playlists`,
    { name, description, public: false },
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 8_000,
    }
  );
  return { id: data.id, url: data.external_urls?.spotify ?? null };
}

/**
 * Adds track URIs to a playlist, batching in groups of 100 (Spotify's per-request limit).
 */
async function addTracksToPlaylist(accessToken, playlistId, uris) {
  const BATCH = 100;
  for (let i = 0; i < uris.length; i += BATCH) {
    const batch = uris.slice(i, i + BATCH);
    await axios.post(
      `${BASE_API}/playlists/${playlistId}/tracks`,
      { uris: batch },
      {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        timeout: 8_000,
      }
    );
  }
}

module.exports = {
  getAuthUrl, exchangeCode, getValidToken, withFreshToken, getProfile, getTopTrackFeatures,
  getTopTracks, getTopArtists, getRecentlyPlayed, getArtistsGenres,
  paginateLikedSongs, paginatePlaylistTracks, batchAudioFeatures, getRecommendations,
  playTracks, getActiveDevice, createPlaylist, addTracksToPlaylist,
};