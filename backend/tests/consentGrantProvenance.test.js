'use strict';

// Provenance guard for Art.9 consent (audit H-9). A GRANTED ConsentRecord is lawful ONLY when it
// originates from the user's own explicit action: POST /api/consent → consentController.grantConsent
// → services/privacy/consent.recordConsent, driven by the mobile ConsentSheet's "Agree" tap. The
// OS/OAuth read grants are NOT lawful Art.9 consent, so fabricating a granted row for a user who
// never saw the consent wall (the deleted backfillGrandfatherConsent.js "grandfather" migration) is
// the exact violation the gate exists to close — a grandfathered user must hit the SAME just-in-time
// wall (requireConsent → 403 consent_required) as a new user. This source guard fails if any
// operational script or non-controller module re-introduces an auto-grant.

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '../app');
const SCRIPTS_DIR = path.join(__dirname, '../scripts');

function jsFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesRecursive(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// The ONLY files permitted to reference recordConsent: the service that DEFINES it and the
// controller that INVOKES it on a real request. Anything else minting a grant is a defect.
const ALLOWED = new Set([
  path.join(APP_DIR, 'services', 'privacy', 'consent.js'),
  path.join(APP_DIR, 'controllers', 'consentController.js'),
]);

describe('consent grant provenance — no code path silently mints a granted consent', () => {
  it('no operational script calls recordConsent or writes a granted ConsentRecord', () => {
    for (const file of jsFilesRecursive(SCRIPTS_DIR)) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toMatch(/recordConsent\s*\(/);
      expect(src).not.toMatch(/status:\s*['"]granted['"]/);
    }
  });

  it('recordConsent is referenced ONLY by the request-driven consent service + controller', () => {
    const refs = jsFilesRecursive(APP_DIR).filter((file) =>
      /recordConsent\s*\(/.test(fs.readFileSync(file, 'utf8')),
    );
    for (const file of refs) expect(ALLOWED.has(file)).toBe(true);
    // Guard against the regex silently matching nothing: the controller MUST be a caller.
    expect(refs).toContain(path.join(APP_DIR, 'controllers', 'consentController.js'));
  });
});
