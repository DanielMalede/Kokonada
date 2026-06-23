const axios = require('axios');
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const { withRetry } = require('../utils/retry');

const BASE_AUTH     = 'https://accounts.google.com/o/oauth2/v2';
const BASE_AUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const BASE_API      = 'https://www.googleapis.com/youtube/v3';

// Least privilege: the code only reads (channel, liked videos, playlists, search).
// The broad `youtube` (manage) and `youtube.force-ssl` (write) scopes were requested
// but never exercised — drop them so a stolen token can't modify the user's account.
// Re-add when write features land. (audit F12 / least-privilege)
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

// One Google OAuth client can serve BOTH the GSI login flow and this server-side
// YouTube code exchange, so the YouTube creds fall back to the GOOGLE_* the login
// already uses. Without this, an unset YOUTUBE_CLIENT_ID sends an empty client_id
// to Google → "Access blocked: invalid_client (OAuth client was not found)". Set a
// dedicated YOUTUBE_CLIENT_ID/SECRET only if you want a distinct client.
const clientId     = () => process.env.YOUTUBE_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID     || '';
const clientSecret = () => process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const redirectUri  = () => process.env.YOUTUBE_REDIRECT_URI || '';

// True only when the connect flow can actually succeed. Lets the controller fail
// with a clear in-app message instead of bouncing the user to Google's error page.
function isConfigured() {
  return Boolean(clientId() && clientSecret() && redirectUri());
}

// Generates a PKCE code_verifier + code_challenge pair (S256 method).
// Satisfies Google's "secure response handling" policy for sensitive scopes
// on unverified apps / shared-hosting redirect URIs.
function generatePKCE() {
  const codeVerifier  = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function getAuthUrl(state, codeChallenge) {
  const params = new URLSearchParams({
    response_type:          'code',
    client_id:              clientId(),
    redirect_uri:           redirectUri(),
    scope:                  SCOPES,
    state,
    access_type:            'offline',
    prompt:                 'consent',
    code_challenge:         codeChallenge,
    code_challenge_method:  'S256',
  });
  return `${BASE_AUTH}/auth?${params}`;
}

async function exchangeCode(code, codeVerifier) {
  const body = new URLSearchParams({
    code,
    client_id:     clientId(),
    client_secret: clientSecret(),
    redirect_uri:  redirectUri(),
    grant_type:    'authorization_code',
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);
  const { data } = await axios.post(BASE_AUTH_TOKEN, body,
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
    BASE_AUTH_TOKEN,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId(),
      client_secret: clientSecret(),
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

// ── Deep-pagination helpers ───────────────────────────────────────────────────

function authHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Fetches every liked (music) video for the authenticated user, following all
 * pages via nextPageToken. Handles HTTP 429 via withRetry.
 * @returns {Promise<YouTubeVideo[]>}
 */
async function paginateLikedVideos(accessToken) {
  const videos = [];
  let pageToken = null;

  do {
    const params = { part: 'snippet', myRating: 'like', maxResults: 50, videoCategoryId: '10' };
    if (pageToken) params.pageToken = pageToken;

    const { data } = await withRetry(() =>
      axios.get(`${BASE_API}/videos`, {
        headers: authHeader(accessToken),
        params,
        timeout: 10_000,
      })
    );

    videos.push(...data.items);
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);

  return videos;
}

/**
 * Fetches all items from every playlist the user owns, following pagination on
 * both the playlist list and each playlist's item list.
 * @returns {Promise<YouTubePlaylistItem[]>}
 */
async function paginatePlaylistItems(accessToken) {
  // Step 1 — collect all user playlists
  const playlists = [];
  let plToken = null;

  do {
    const params = { part: 'snippet', mine: true, maxResults: 50 };
    if (plToken) params.pageToken = plToken;

    const { data } = await withRetry(() =>
      axios.get(`${BASE_API}/playlists`, {
        headers: authHeader(accessToken),
        params,
        timeout: 10_000,
      })
    );

    playlists.push(...data.items);
    plToken = data.nextPageToken ?? null;
  } while (plToken);

  // Step 2 — collect all items from each playlist
  const items = [];

  for (const pl of playlists) {
    let itemToken = null;

    do {
      const params = { part: 'snippet', playlistId: pl.id, maxResults: 50 };
      if (itemToken) params.pageToken = itemToken;

      const { data } = await withRetry(() =>
        axios.get(`${BASE_API}/playlistItems`, {
          headers: authHeader(accessToken),
          params,
          timeout: 10_000,
        })
      );

      items.push(...data.items);
      itemToken = data.nextPageToken ?? null;
    } while (itemToken);
  }

  return items;
}

/**
 * Searches YouTube Music for tracks matching AI-computed targets.
 * YouTube has no audio-features API so we build a keyword query from
 * genre + energy mood descriptor.
 *
 * @param {string} accessToken
 * @param {{ seed_genres, target_energy, limit? }} params
 * @returns {Promise<YouTubeVideo[]>}
 */
async function searchRecommendations(accessToken, { seed_genres, target_energy, limit = 10 }) {
  const energy   = target_energy ?? 0.5;
  const moodWord = energy > 0.7 ? 'energetic' : energy < 0.35 ? 'calm' : '';
  const genres   = (seed_genres || []).slice(0, 3).join(' ');
  const query    = [moodWord, genres, 'music'].filter(Boolean).join(' ');

  const { data } = await withRetry(() =>
    axios.get(`${BASE_API}/search`, {
      headers: authHeader(accessToken),
      params:  { part: 'snippet', q: query, type: 'video', videoCategoryId: '10', maxResults: limit },
      timeout: 8_000,
    })
  );
  return data.items ?? [];
}

// Exchange a code obtained via the GIS popup flow (client-side initCodeClient).
// Google requires redirect_uri='postmessage' for codes issued through the popup
// UX mode — this value is recognised internally and never needs to be registered.
async function exchangeCodeFromGIS(code) {
  try {
    const { data } = await axios.post(BASE_AUTH_TOKEN,
      new URLSearchParams({
        code,
        client_id:     clientId(),
        client_secret: clientSecret(),
        redirect_uri:  'postmessage',
        grant_type:    'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
    );
    return {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    Date.now() + data.expires_in * 1000,
    };
  } catch (err) {
    // Google rejects the exchange with 4xx + { error, error_description }, e.g.
    // invalid_client (client_id/secret pair is wrong or from a different OAuth
    // client than the one the frontend used), invalid_grant (code expired/reused),
    // or redirect_uri_mismatch. Surface that code instead of axios's opaque
    // "Request failed with status code 401" so the failure is diagnosable. The
    // error code is non-sensitive; the secret and auth code are never logged.
    const g = err.response?.data;
    if (g?.error) {
      console.error('[youtube/exchangeCodeFromGIS] Google rejected token exchange:', g.error, '—', g.error_description);
      const e = new Error(`youtube_exchange_${g.error}`);
      e.statusCode = 400;
      throw e;
    }
    throw err;
  }
}

module.exports = {
  getAuthUrl, generatePKCE, isConfigured,
  exchangeCode, exchangeCodeFromGIS,
  getValidToken, getChannel, getLikedVideos,
  paginateLikedVideos, paginatePlaylistItems, searchRecommendations,
};