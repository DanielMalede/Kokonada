const axios = require('axios');
const { URLSearchParams } = require('url');

const BASE_AUTH = 'https://accounts.google.com/o/oauth2';
const BASE_API  = 'https://www.googleapis.com/youtube/v3';

// Scopes required for playlist management and playback history
const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
].join(' ');

function getAuthUrl(state) {
  const params = new URLSearchParams({
    response_type:   'code',
    client_id:       process.env.YOUTUBE_CLIENT_ID,
    redirect_uri:    process.env.YOUTUBE_REDIRECT_URI,
    scope:           SCOPES,
    state,
    access_type:     'offline',  // required to receive a refresh token
    prompt:          'consent',  // forces refresh token even if already granted
  });
  return `${BASE_AUTH}/auth?${params}`;
}

async function exchangeCode(code) {
  const { data } = await axios.post(
    `${BASE_AUTH}/token`,
    new URLSearchParams({
      code,
      client_id:     process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      redirect_uri:  process.env.YOUTUBE_REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
  );
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
}

async function refreshAccessToken(refreshToken) {
  const { data } = await axios.post(
    `${BASE_AUTH}/token`,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
  );
  return {
    accessToken:  data.access_token,
    refreshToken, // Google does not rotate refresh tokens
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
}

async function getValidToken(user) {
  const stored = user.getToken('youtubeMusicToken');
  if (!stored) throw Object.assign(new Error('YouTube Music not connected'), { statusCode: 400 });

  const bufferMs = 5 * 60 * 1000;
  if (Date.now() < stored.expiresAt - bufferMs) return stored.accessToken;

  const refreshed = await refreshAccessToken(stored.refreshToken);
  user.setToken('youtubeMusicToken', refreshed);
  await user.save();
  return refreshed.accessToken;
}

async function getChannel(accessToken) {
  const { data } = await axios.get(`${BASE_API}/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params:  { part: 'snippet', mine: true },
    timeout: 5000,
  });
  const ch = data.items?.[0]?.snippet;
  return { channelId: data.items?.[0]?.id, displayName: ch?.title, avatarUrl: ch?.thumbnails?.default?.url };
}

// Fetch liked videos to build Musical DNA (Phase 3)
async function getLikedVideos(accessToken, maxResults = 50) {
  const { data } = await axios.get(`${BASE_API}/videos`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params:  { part: 'snippet,contentDetails', myRating: 'like', maxResults },
    timeout: 8000,
  });
  return data.items || [];
}

module.exports = { getAuthUrl, exchangeCode, getValidToken, getChannel, getLikedVideos };