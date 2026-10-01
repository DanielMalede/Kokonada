'use strict';

// HX-3 T1 (DEC-122, DEC-040) — YouTube is sealed in CODE, not in configuration.
//
// `config/youtubeSeal.js` holds the two switches every YouTube path reads:
//   YOUTUBE_CONNECT_ENABLED — may a user link YouTube at all (DEC-122)
//   YOUTUBE_EGRESS_ENABLED  — may YouTube data reach Spotify or an LLM (DEC-040; never)
// Both are frozen `false` literals. No env var, header or request can turn either on, because the
// module reads none: lifting a seal is a reviewed PR with a signed reversal, never a Railway flip.

const fs = require('fs');
const path = require('path');

const SEAL_PATH = path.join(__dirname, '../app/config/youtubeSeal.js');

// Every env name a future reader might reach for to "turn YouTube back on". Setting all of them
// to 'true' must change nothing.
const PLAUSIBLE_LEVERS = [
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'YOUTUBE_REDIRECT_URI',
  'YOUTUBE_ENABLED',
  'YOUTUBE_CONNECT_ENABLED',
  'YOUTUBE_EGRESS_ENABLED',
  'YOUTUBE_SPOTIFY_TRANSLATION_ENABLED',
];

// The compliance-auditor's exact header (hx3-rescope-compliance.md §2, DT-B1). Pinned so the
// conditions for lifting either seal cannot be softened by an edit to a comment.
const DT_B1_HEADER = [
  '// DEC-122: YouTube connect is sealed in code. YOUTUBE_CONNECT_ENABLED may become true only through a',
  "// reviewed PR that first ships ARCH-012's prerequisites (revoke on disconnect and on account deletion,",
  '// deletion within 7 days, a hosted privacy policy meeting YouTube Developer Policies III.A.1 and III.A.2,',
  '// sensitive-scope verification, BE-060, BE-056), with a signed reversal.',
  '// DEC-040: YOUTUBE_EGRESS_ENABLED must stay false. Spotify Developer Policy III.5 forbids the',
  "// YouTube-to-Spotify translation in every state, and YouTube Developer Policies III.E.3.b forbid passing a",
  "// user's YouTube data to anyone the user has not expressly approved. The path is deleted at P3.",
].join('\n');

const source = () => fs.readFileSync(SEAL_PATH, 'utf8');

describe('youtubeSeal — both YouTube switches are sealed false in code (DEC-122, DEC-040)', () => {
  it('exports exactly the two constants, both strictly false', () => {
    const seal = require('../app/config/youtubeSeal');
    expect(Object.keys(seal).sort()).toEqual(['YOUTUBE_CONNECT_ENABLED', 'YOUTUBE_EGRESS_ENABLED']);
    expect(seal.YOUTUBE_CONNECT_ENABLED).toBe(false);
    expect(seal.YOUTUBE_EGRESS_ENABLED).toBe(false);
  });

  it('is frozen: an assignment at runtime throws and changes nothing', () => {
    const seal = require('../app/config/youtubeSeal');
    expect(Object.isFrozen(seal)).toBe(true);
    // This file is strict mode, so writing a frozen property throws instead of failing silently.
    expect(() => { seal.YOUTUBE_CONNECT_ENABLED = true; }).toThrow(TypeError);
    expect(() => { seal.YOUTUBE_EGRESS_ENABLED = true; }).toThrow(TypeError);
    expect(() => Object.defineProperty(seal, 'YOUTUBE_EGRESS_ENABLED', { value: true })).toThrow(TypeError);
    expect(seal.YOUTUBE_CONNECT_ENABLED).toBe(false);
    expect(seal.YOUTUBE_EGRESS_ENABLED).toBe(false);
  });

  it('exports no function — there is no setter, getter or factory that could compute another value', () => {
    const seal = require('../app/config/youtubeSeal');
    for (const [key, value] of Object.entries(seal)) {
      expect([key, typeof value]).toEqual([key, 'boolean']);
      const desc = Object.getOwnPropertyDescriptor(seal, key);
      expect(desc.get).toBeUndefined();
      expect(desc.set).toBeUndefined();
    }
    // Source-level: no function of any spelling is declared in the module.
    expect(source()).not.toMatch(/\bfunction\b|=>|\bget\s+\w+\s*\(|\bclass\b/);
  });

  it('reads no environment variable at all', () => {
    expect(source()).not.toMatch(/process\s*\.\s*env|process\s*\[\s*['"`]env/);
  });

  it('stays false after a fresh load with every plausible YouTube lever set to "true"', () => {
    const saved = Object.fromEntries(PLAUSIBLE_LEVERS.map((k) => [k, process.env[k]]));
    try {
      for (const k of PLAUSIBLE_LEVERS) process.env[k] = 'true';
      jest.resetModules();
      const fresh = require('../app/config/youtubeSeal');
      expect(fresh.YOUTUBE_CONNECT_ENABLED).toBe(false);
      expect(fresh.YOUTUBE_EGRESS_ENABLED).toBe(false);
    } finally {
      for (const k of PLAUSIBLE_LEVERS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      jest.resetModules();
    }
  });

  it('carries the DT-B1 header verbatim: the conditions for lifting each seal', () => {
    expect(source()).toContain(DT_B1_HEADER);
  });
});
