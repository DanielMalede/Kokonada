'use strict';

// Structural guards for the secret-scan gates.
//
// THE IGNORE LIST (OPS-107). The weekly full-history scan (.github/workflows/secret-scan-history.yml)
// has been red on every scheduled run, from the first on 2026-07-20, on one false positive:
// gitleaks 8.24.3's `generic-api-key` rule matches a public 22-character Spotify track ID, a test
// fixture in the since-deleted web frontend (frontend/src/__tests__/SpotifyAttribution.test.tsx:33,
// commit 3459263). A scan that is always red cannot report a real leak.
//
// `.gitleaksignore` skips that one finding by its fingerprint, `commit:file:rule:line`, so it can
// match nothing else: not another commit, file, line or rule. Allow-listing by rule or by path
// would blind the scan to every future match of the same kind, so neither is used. The pin keeps
// the file to that one line: any new entry has to be a reviewed change to this test, never a
// quiet edit to the ignore file.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GITLEAKSIGNORE = path.join(REPO_ROOT, '.gitleaksignore');

const OPS_107_FINGERPRINT =
  '3459263a3431e29accccf3d674774be43d1f608f:frontend/src/__tests__/SpotifyAttribution.test.tsx:generic-api-key:33';

describe('.gitleaksignore (OPS-107)', () => {
  it('exists at the repository root, where gitleaks reads it', () => {
    expect(fs.existsSync(GITLEAKSIGNORE)).toBe(true);
  });

  it('holds only the one OPS-107 fingerprint, plus comment lines', () => {
    // gitleaks trims each line and skips blank ones and those starting with `#`; every other line
    // is an entry. Read the same way here, so what the pin counts is what gitleaks ignores.
    const entries = fs.readFileSync(GITLEAKSIGNORE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(entries).toEqual([OPS_107_FINGERPRINT]);
  });
});
