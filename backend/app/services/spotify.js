const axios = require('axios');
const { URLSearchParams } = require('url');

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

module.exports = { getAuthUrl, exchangeCode, getValidToken, getProfile, getTopTrackFeatures };