// App configuration. Point BACKEND_URL at your own backend (must be https://).
// The tracked value is a placeholder under the reserved `.invalid` TLD (RFC 2606), so a build that
// still carries it fails at name resolution and never sends a stored token anywhere (RA-9, MB-184).
export const BACKEND_URL = 'https://your-backend.invalid';

// OAuth 2.0 *Web* client ID from Google Cloud Console. MUST equal the backend's
// GOOGLE_CLIENT_ID (it is the token audience the backend verifies). Not the Android
// client ID — the Android OAuth client is matched separately by package + SHA-1.
export const GOOGLE_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

// ~6 months. Health Connect only returns what Garmin has actually synced into the
// store — for a new connection that is typically ~2 weeks–90 days (forward-accrue),
// not a guaranteed 6 months. The window is still requested at 6 months so depth is
// captured as it accrues.
export const HISTORY_DAYS = 182;

export const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';
