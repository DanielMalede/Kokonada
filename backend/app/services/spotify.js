const axios = require('axios');
const { URLSearchParams } = require('url');
const { withRetry } = require('../utils/retry');

const BASE_AUTH = 'https://accounts.spotify.com';
const BASE_API  = 'https://api.spotify.com/v1';

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'playlist-modify-public',
  'playlist-modify-private',
  'streaming',
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

// Refresh an expired access token using the stored refresh token
async function refreshAccessToken(refreshToken) {
  const { data } = await axios.post(
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
  );
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken, // Spotify may or may not rotate it
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
}

// Get a valid access token — refreshes automatically if within 5 min of expiry
async function getValidToken(user) {
  const stored = user.getToken('spotifyToken');
  if (!stored) throw Object.assign(new Error('Spotify not connected'), { statusCode: 400 });

  const bufferMs = 5 * 60 * 1000;
  if (Date.now() < stored.expiresAt - bufferMs) {
    return stored.accessToken;
  }

  const refreshed = await refreshAccessToken(stored.refreshToken);
  user.setToken('spotifyToken', refreshed);
  await user.save();
  return refreshed.accessToken;
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
  target_bpm, target_energy, target_valence, target_acousticness, seed_genres, limit = 10,
}) {
  const validGenres = (seed_genres || []).slice(0, 5);
  if (!validGenres.length) return [];

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
}

/**
 * Sends a play command to the Spotify Web Playback SDK device.
 * @param {string} accessToken
 * @param {string[]} uris  Spotify track URIs — e.g. ['spotify:track:abc123']
 * @param {string} deviceId  Device ID from the SDK 'ready' event
 */
async function playTracks(accessToken, uris, deviceId) {
  await axios.put(
    `${BASE_API}/me/player/play`,
    { uris },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { device_id: deviceId },
      timeout: 8_000,
    }
  );
}

module.exports = {
  getAuthUrl, exchangeCode, getValidToken, getProfile, getTopTrackFeatures,
  paginateLikedSongs, paginatePlaylistTracks, batchAudioFeatures, getRecommendations,
  playTracks,
};