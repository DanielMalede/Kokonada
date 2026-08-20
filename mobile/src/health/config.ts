// App configuration. Point BACKEND_URL at your Railway backend (must be https://).
export const BACKEND_URL = 'https://kokonada-backend-production.up.railway.app';

// OAuth 2.0 *Web* client ID from Google Cloud Console. MUST equal the backend's
// GOOGLE_CLIENT_ID (it is the token audience the backend verifies). Not the Android
// client ID — the Android OAuth client is matched separately by package + SHA-1.
export const GOOGLE_WEB_CLIENT_ID = '225621926146-grk3ob6kjkbeq3adi3f42m4nas6mha0d.apps.googleusercontent.com';

// ~6 months. Health Connect only returns what Garmin has actually synced into the
// store — for a new connection that is typically ~2 weeks–90 days (forward-accrue),
// not a guaranteed 6 months. The window is still requested at 6 months so depth is
// captured as it accrues.
export const HISTORY_DAYS = 182;

export const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';

// Spotify App Remote identity. MUST match the values registered in the Spotify
// Developer Dashboard (package com.kokonadahealth + signing SHA-1). App Remote
// authorizes on-device (installed Spotify app + showAuthView), so redirectUri is a
// registration match key, not a browser redirect target.
export const SPOTIFY_CLIENT_ID = '2ae959377ce1439da4fbe779b406c9bb'; // public Spotify dashboard client id (== backend SPOTIFY_CLIENT_ID); not the secret.
export const SPOTIFY_REDIRECT_URI = 'kokonadahealth://spotify-callback';
