'use strict';

/**
 * SURFACE BOUNDARY GUARD — the control for the surface removals (watch/, then frontend/).
 *
 * This exists because ONE grep on the word "watch" can take down the app's live heart rate.
 * Three different things in this repo answer to that word, and only the first is being deleted:
 *
 *   1. `watch/`                     — the sideloaded Garmin CONNECT IQ app. Retired. Never returns.
 *   2. `/api/integrations/watch/*`  — the backend lane. Its live client is the MOBILE APP, not the
 *                                     watch: liveHrClient mints a whr_ device token via
 *                                     POST /watch/token and POSTs every reading to /watch/hr, for
 *                                     BOTH live-HR tiers (BLE via react-native-ble-plx, and the
 *                                     3-minute Health Connect fallback). appBootstrap.startBiometrics
 *                                     runs that chain on EVERY app start. Only the NAME is stale.
 *   3. Garmin CONNECT (cloud) API   — /garmin/connect|callback|webhook|disconnect + the wearable
 *                                     services. A completely separate integration that supplies the
 *                                     signals Health Connect does not (stress, respiration, pulse-ox,
 *                                     dailies). Nothing to do with Connect IQ.
 *
 * Deleting (2) or (3) while removing (1) is the single worst outcome available in this work, and it
 * would go GREEN on every other suite — no unit test mounts the real network lane. So the guard is a
 * text scan over the real files, the same idiom as tests/shadow.flip.test.js's purge scan and
 * tests/ciWorkflowPermissions.test.js: cheap, side-effect free, and it fails loudly on a rename.
 *
 * NOTE ON SCOPE: /watch/pair and /watch/pair/exchange are DELIBERATELY NOT pinned here. The pairing
 * seam is genuinely dead — the Connect IQ app never had a field to type a code into — but the web
 * frontend still calls /watch/pair (frontend/src/lib/api.ts), so it is removed with that surface,
 * not with this one. Pinning it now would fight the next branch.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// (3) The Garmin Connect cloud integration. Every file here must survive the surface removals.
const GARMIN_BACKEND_FILES = [
  'backend/app/services/wearable/garmin.js',
  'backend/app/services/wearable/garminIngest.js',
  'backend/app/services/wearable/garminUserLookup.js',
  'backend/app/services/wearable/adapter.js',
  'backend/app/services/wearable/healthStore.js',
  'backend/app/services/wearable/metricStore.js',
  'backend/app/services/wearable/specialCategoryMetrics.js',
  'backend/app/services/privacy/wearableErasure.js',
];

// (2) The live-HR lane, as registered in the router. Each entry is [method, path].
const LIVE_WATCH_ROUTES = [
  ["router.post('/watch/hr'", 'phone BLE + Health Connect fallback ingest'],
  ["router.post('/watch/token'", 'liveHrClient.getWatchToken mints the phone credential'],
  ["router.delete('/watch/token'", 'the ONLY revoke for a long-lived health credential'],
  ["router.get('/watch/status'", 'powers the live-HR connection badge'],
];

describe('surface boundary — the Connect IQ watch app is gone; the live-HR lane is not', () => {
  it('the watch/ Connect IQ surface does not exist', () => {
    for (const p of ['watch', 'watch/source', 'watch/manifest.xml', 'watch/monkey.jungle']) {
      expect({ path: p, present: exists(p) }).toEqual({ path: p, present: false });
    }
  });

  it('every /watch/* route the MOBILE app depends on is still registered', () => {
    const routes = read('backend/app/routes/integrations.js');
    for (const [needle, why] of LIVE_WATCH_ROUTES) {
      expect({ route: needle, why, registered: routes.includes(needle) })
        .toEqual({ route: needle, why, registered: true });
    }
  });

  it('watchHrIngest keeps its Art.9 consent gate on the ingest path', () => {
    const routes = read('backend/app/routes/integrations.js');
    expect(routes).toMatch(/watchLimiter/);
    const ctrl = read('backend/app/controllers/integrationsController.js');
    expect(ctrl).toMatch(/exports\.watchHrIngest/);
  });

  it('the mobile client still points at the live-HR endpoints (both ends of the contract)', () => {
    const client = read('mobile/KokonadaHealth/src/health/liveHrClient.ts');
    expect(client).toContain('/api/integrations/watch/token');
    expect(client).toContain('/api/integrations/watch/hr');
    // The chain that runs on every app start, per appBootstrap.startBiometrics.
    expect(read('mobile/KokonadaHealth/src/health/bleHeartRate.ts')).toContain('pushLiveHr');
    expect(read('mobile/KokonadaHealth/src/health/restFallback.ts')).toContain('pushLiveHr');
  });

  it('the revoke affordance survives — a health credential must stay revocable', () => {
    expect(exists('mobile/KokonadaHealth/src/experience/profile/LiveHeartRateCard.tsx')).toBe(true);
    const screen = read('mobile/KokonadaHealth/src/experience/profile/ProfileScreen.tsx');
    expect(screen).toContain('LiveHeartRateCard');
    expect(read('mobile/KokonadaHealth/src/health/watchPairingClient.ts'))
      .toContain('/api/integrations/watch/token');
  });

  it('the Garmin Connect cloud integration is intact — it is NOT the Connect IQ app', () => {
    for (const f of GARMIN_BACKEND_FILES) {
      const present = exists(f);
      const bytes = present ? fs.statSync(path.join(ROOT, f)).size : 0;
      expect({ file: f, present, nonEmpty: bytes > 0 }).toEqual({ file: f, present: true, nonEmpty: true });
    }
    const routes = read('backend/app/routes/integrations.js');
    for (const r of ["'/garmin/callback'", "'/garmin/webhook'", "'/garmin/connect'", "'/garmin/disconnect'"]) {
      expect({ route: r, registered: routes.includes(r) }).toEqual({ route: r, registered: true });
    }
  });
});
