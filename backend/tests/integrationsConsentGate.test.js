'use strict';

// Structural guard (audit H-9, decision 2): every special-category ingest path MUST enforce the
// Art.9 consent gate. Session-authed routes use the requireConsent MIDDLEWARE; the device-token /
// server-to-server flows (watch/hr, garmin/webhook) have no req.user for the middleware to key on,
// so they enforce the SAME consent service INLINE in the controller. Mirrors the
// erasureSpotifyContainment source guard — it fails if a future edit drops the gate from an ingest
// path (route middleware OR the inline handler check).

const fs = require('fs');

const ROUTES_SRC = fs.readFileSync(require.resolve('../app/routes/integrations.js'), 'utf8');
const CONTROLLER_SRC = fs.readFileSync(require.resolve('../app/controllers/integrationsController.js'), 'utf8');

// The body of a single exported controller (from `exports.<name>` to the next `exports.`), so an
// inline-gate assertion targets THAT handler and not another in the same file.
const controllerBody = (name) => {
  const start = CONTROLLER_SRC.indexOf(`exports.${name}`);
  const rest = CONTROLLER_SRC.slice(start + 1);
  const next = rest.indexOf('\nexports.');
  return next === -1 ? rest : rest.slice(0, next);
};

// A route line applying requireConsent before the given handler, e.g.
//   router.post('/health/batch', requireConsent('...'), healthBatchIngest);
const gated = (path, handler) =>
  new RegExp(`router\\.post\\(\\s*['"]${path.replace('/', '\\/')}['"]\\s*,\\s*requireConsent\\([^)]*\\)\\s*,\\s*${handler}`);

describe('integrations routes — consent hard gate', () => {
  it('imports the requireConsent middleware', () => {
    expect(ROUTES_SRC).toMatch(/require\(\s*['"]\.\.\/middleware\/requireConsent['"]\s*\)/);
  });

  it('gates POST /health/batch with requireConsent', () => {
    expect(ROUTES_SRC).toMatch(gated('/health/batch', 'healthBatchIngest'));
  });

  it('gates POST /apple/push with requireConsent', () => {
    expect(ROUTES_SRC).toMatch(gated('/apple/push', 'appleHealthPush'));
  });

  it('watch/hr is gated INLINE in the controller, not via route middleware (device-token auth, no req.user)', () => {
    // The earlier "must remain intentionally UNGATED" claim was stale: watch/hr IS gated — it just
    // cannot use the session-authed middleware, so watchHrIngest enforces the SAME consent service
    // inline (proven live in watchIntegration.test.js "Art.9 consent gate"). Asserting BOTH — the
    // middleware is absent AND the handler checks consent — keeps the reality unambiguous.
    expect(ROUTES_SRC).not.toMatch(/watch\/hr['"]\s*,\s*[^)]*requireConsent/); // not the middleware…
    const body = controllerBody('watchHrIngest');
    expect(body).toMatch(/getConsentStatus\s*\(/);   // …enforced inline instead
    expect(body).toMatch(/consent_required/);
  });

  it('garmin/webhook is not wrapped in the requireConsent route middleware (public push, no req.user)', () => {
    // A public server-to-server push carries no req.user to key the middleware on; its Art.9 gate is
    // enforced inline in garminWebhook (proven in garminWebhook.integration.test.js).
    expect(ROUTES_SRC).not.toMatch(/garmin\/webhook['"]\s*,\s*[^)]*requireConsent/);
  });
});
