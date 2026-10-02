'use strict';

// HX-3 T4 (CMP-038) — no "YouTube Music" anywhere in the backend's code or its example env.
//
// There is no YouTube Music API; Kokonada's integration is the YouTube Data API, and the YouTube
// Branding Guidelines give the product no claim to the "YouTube Music" name. User-reachable strings
// came from here: the disconnect's success message, and the "not connected" error that reaches the
// app through biometricHandler's `Token refresh failed: …`. The scan covers every file under
// backend/app plus backend/.env.example, comments included, so the name cannot drift back in.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const BRAND = /YouTube Music/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

describe('no "YouTube Music" in backend/app or backend/.env.example (HX-3 T4, CMP-038)', () => {
  const files = [...walk(path.join(BACKEND, 'app')), path.join(BACKEND, '.env.example')];

  it('scans a real tree (the guard is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => path.basename(f))).toEqual(expect.arrayContaining(['youtube.js', 'integrations.js', '.env.example']));
  });

  it('no file carries the name', () => {
    const hits = [];
    for (const file of files) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
        if (BRAND.test(text)) hits.push(`${path.relative(BACKEND, file).split(path.sep).join('/')}:${i + 1}: ${text.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the error a YouTube-less account gets is 'YouTube not connected' (it reaches the app as Token refresh failed: …)", async () => {
    const youtube = require('../app/services/youtube');
    const user = { getToken: () => null };
    await expect(youtube.getValidToken(user)).rejects.toThrow(/^YouTube not connected$/);
    await expect(youtube.getValidToken(user)).rejects.toMatchObject({ statusCode: 400 });
  });
});
