const router = require('express').Router();
const auth = require('../middleware/auth');
const { watchLimiter, watchPairingLimiter } = require('../middleware/rateLimiter');
const {
  getIntegrationsStatus,
  connectToken,
  hydrateLibrary,
  spotifyConnect, spotifyCallback, spotifyDisconnect, spotifyStatus,
  getSpotifyToken, playSpotifyTracks,
  saveSpotifyTracks, removeSpotifyTracks, getSpotifyTracksSaved,
  youtubeConnect, youtubeCallback, youtubeExchange, youtubeConnectGIS, youtubeDisconnect, youtubeStatus,
  garminConnect, garminCallback, garminDisconnect, garminWebhook,
  appleHealthPush,
  healthBatchIngest,
  suuntoWebhook,
  wearableStatus,
  issueWatchToken, revokeWatchToken, watchHrIngest, watchStatus,
  createWatchPairing, exchangeWatchPairing,
} = require('../controllers/integrationsController');
// Per-provider wearable erasure lives in a SEPARATE controller (ownership ruling). (T3.2)
const { deleteWearableProvider } = require('../controllers/wearableErasureController');
// Server-side Art.9 consent hard gate for special-category ingestion (audit H-9). (WS5)
const requireConsent = require('../middleware/requireConsent');
// Shared literal (services/privacy/consent.js) — watchHrIngest's inline gate uses the SAME
// constant so the purpose string can never drift between the session-authed and device-token-
// authed ingestion paths.
const { HEALTH_CONSENT_PURPOSE: HEALTH_CONSENT } = require('../services/privacy/consent');

// Public OAuth callbacks. The browser arrives here from the provider as a
// top-level navigation carrying NO cookie/Bearer/ct, so these MUST sit ABOVE
// router.use(auth) — otherwise auth 401s before the handler runs (the
// "Authentication required" connect bug). Identity is recovered from the signed
// `state` (Spotify/YouTube) or the request cookie + Redis fallback (Garmin).
router.get('/spotify/callback',  spotifyCallback);
router.get('/youtube/callback',  youtubeCallback);
router.post('/youtube/exchange', youtubeExchange);
router.get('/garmin/callback',   garminCallback);
router.post('/garmin/webhook',   garminWebhook); // Garmin Health API server-to-server push

// Watch HR stream (PUBLIC — authenticated by the opaque device token, not the
// session cookie; same placement rationale as the webhooks above). NOT gated by the
// requireConsent MIDDLEWARE here (it needs a session req.user, which this route has none of) —
// instead, watchHrIngest itself checks Art.9 consent inline on the already-resolved
// token→user._id, BEFORE any body validation or socket delivery (resilience-audit follow-up,
// 2026-07-17). H-9 is fully closed: see integrationsController.js watchHrIngest + the "Art.9
// consent gate" tests in backend/tests/watchIntegration.test.js. garmin/webhook remains a
// genuinely separate case: it needs Garmin Health API production approval before it is
// reachable at all, so it carries no live gap today.
router.post('/watch/hr', watchLimiter, watchHrIngest);

// Watch pairing-code exchange (PUBLIC — the watch has no session; it presents the
// short-lived one-time code the user just saw in the browser instead). (T5)
router.post('/watch/pair/exchange', watchPairingLimiter, exchangeWatchPairing);

// All remaining integration routes require a logged-in user
router.use(auth);

// Unified integrations status (music + biometric)
router.get('/status', getIntegrationsStatus);

// Mint a single-use connect token for top-level OAuth navigations (audit F1)
router.post('/connect-token', connectToken);

// Force-hydrate the caller's library into the AudioFeature store synchronously and return
// the provider breakdown — diagnose + fix an empty feature store (the "same playlist" cause).
router.post('/hydrate-library', hydrateLibrary);

// Spotify (callback registered publicly above)
router.get('/spotify/connect',       spotifyConnect);
router.delete('/spotify/disconnect', spotifyDisconnect);
router.get('/spotify/status',        spotifyStatus);
router.get('/spotify/token',         getSpotifyToken);
router.post('/spotify/play',         playSpotifyTracks);
router.get('/spotify/saved-tracks',     getSpotifyTracksSaved);  // ?ids=a,b → heart state
router.put('/spotify/saved-tracks',     saveSpotifyTracks);      // Like  (Bug 7)
router.delete('/spotify/saved-tracks',  removeSpotifyTracks);    // Unlike

// YouTube Music (callback registered publicly above)
router.get('/youtube/connect',        youtubeConnect);
router.post('/youtube/connect-gis',   youtubeConnectGIS);
router.delete('/youtube/disconnect',  youtubeDisconnect);
router.get('/youtube/status',         youtubeStatus);

// Garmin (OAuth 1.0a — two-legged flow; callback registered publicly above)
router.get('/garmin/connect',        garminConnect);
router.delete('/garmin/disconnect',  garminDisconnect);

// Apple HealthKit (mobile push — no server-side OAuth needed). Special-category ingestion →
// gated behind a current-version Art.9 consent record (audit H-9). (WS5)
router.post('/apple/push',           requireConsent(HEALTH_CONSENT), appleHealthPush);

// Health store batch (HealthKit / Health Connect medical-profile backfill + delta sync).
// Special-category ingestion → same consent hard gate. (WS5)
router.post('/health/batch',         requireConsent(HEALTH_CONSENT), healthBatchIngest);

// Suunto (webhook — raw body needed for HMAC)
router.post('/suunto/webhook',       suuntoWebhook);

// Unified wearable status
router.get('/wearable/status',       wearableStatus);

// Per-provider disconnect + GDPR erasure (clears the credential AND purges that provider's
// biometric/medical data). DELETE-only, so it never shadows GET /wearable/status. (T3.2)
router.delete('/wearable/:provider', deleteWearableProvider);

// Garmin watch endpoints
router.post('/watch/token',   issueWatchToken);
router.delete('/watch/token', revokeWatchToken);
router.get('/watch/status',   watchStatus);
router.post('/watch/pair',    createWatchPairing); // mints the short-lived pairing code (T5)

module.exports = router;
