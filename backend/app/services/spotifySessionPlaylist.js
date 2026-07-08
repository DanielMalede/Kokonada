'use strict';

const axios = require('axios');
const spotify = require('./spotify');

// D-1 Option A (approved 2026-07-08): the hidden per-user "Kokonada Session" playlist —
// the playback TRANSPORT for the Spotify App Remote. App Remote cannot set an ad-hoc
// queue (queue() is append-only, no clear/remove), so absolute queue parity requires a
// CONTEXT Spotify natively executes: this private playlist, rewritten in place on every
// generation, played via its context URI. It is NOT the removed user-facing Export —
// private, never surfaced in-app, one per user, reused forever.

const BASE_API = 'https://api.spotify.com/v1';
const PLAYLIST_NAME = 'Kokonada Session';
const PLAYLIST_DESCRIPTION = 'Your current Kokonada soundscape — managed automatically, updates with every generation.';
const MAX_URIS = 100; // Spotify PUT /tracks replace limit (we send 50)

// Tag whichever step failed so a fail-open in the caller is diagnosable (which Spotify
// call 403'd — profile-read vs create vs replace all surface as the same typed error).
function tagOp(op, err) {
  if (err && !err.op) err.op = op;
  throw err;
}

async function createSessionPlaylist(user) {
  return spotify.withFreshToken(user, async (token) => {
    const { data: me } = await axios
      .get(`${BASE_API}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .catch((e) => tagOp('GET /me', e));
    const { data: playlist } = await axios
      .post(
        `${BASE_API}/users/${encodeURIComponent(me.id)}/playlists`,
        { name: PLAYLIST_NAME, public: false, description: PLAYLIST_DESCRIPTION },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .catch((e) => tagOp('POST /users/{id}/playlists', e));
    return playlist.id;
  });
}

async function replaceTracks(user, playlistId, uris) {
  return spotify.withFreshToken(user, async (token) => {
    await axios
      .put(
        `${BASE_API}/playlists/${encodeURIComponent(playlistId)}/tracks`,
        { uris: uris.slice(0, MAX_URIS) },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .catch((e) => tagOp('PUT /playlists/{id}/tracks', e));
  });
}

/**
 * Rewrite the user's session playlist with this generation's URIs, creating it on first
 * use and self-healing if the user deleted it (404 → recreate once). Persists the
 * playlist id on the User doc so every later generation is a single PUT.
 * @returns {{ playlistId: string, contextUri: string }}
 */
async function writeSessionPlaylist(user, uris) {
  if (!Array.isArray(uris) || uris.length === 0) throw new Error('no uris to write');

  let playlistId = user.spotifySessionPlaylistId || null;
  if (!playlistId) {
    playlistId = await createSessionPlaylist(user);
    user.spotifySessionPlaylistId = playlistId;
    await user.save();
  }

  try {
    await replaceTracks(user, playlistId, uris);
  } catch (err) {
    // The user deleted/unfollowed the hidden playlist — recreate once and retry.
    if (err.response?.status === 404) {
      playlistId = await createSessionPlaylist(user);
      user.spotifySessionPlaylistId = playlistId;
      await user.save();
      await replaceTracks(user, playlistId, uris);
    } else {
      throw err;
    }
  }

  return { playlistId, contextUri: `spotify:playlist:${playlistId}` };
}

module.exports = { writeSessionPlaylist, PLAYLIST_NAME };
