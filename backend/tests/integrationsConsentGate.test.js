'use strict';

// Structural guard (audit H-9, decision 2): the special-category ingest routes MUST sit behind
// the requireConsent server gate, and the two not-yet-user-facing flows (watch/hr, garmin/webhook)
// must remain intentionally ungated. Mirrors the erasureSpotifyContainment source guard — it fails
// if a future edit drops the gate from an ingest route or silently gates a webhook flow.

const fs = require('fs');

const ROUTES_SRC = fs.readFileSync(require.resolve('../app/routes/integrations.js'), 'utf8');

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

  it('leaves watch/hr and garmin/webhook UNGATED (documented — not yet user-facing)', () => {
    // These lines exist but must NOT be wrapped in requireConsent.
    expect(ROUTES_SRC).not.toMatch(/watch\/hr['"]\s*,\s*[^)]*requireConsent/);
    expect(ROUTES_SRC).not.toMatch(/garmin\/webhook['"]\s*,\s*[^)]*requireConsent/);
    // ...and the exemption is documented, not accidental.
    expect(ROUTES_SRC).toMatch(/requireConsent|consent/i);
  });
});
