'use strict';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

// ─────────────────────────────────────────────────────────────────────────────
// QA4 — AGENT Q3: CRYPTOGRAPHY & STATE (forensic locksmith)
// Backend surface: GDPR erasure completeness (a permanent guard so A11+ can never
// add a user-owned collection that orphans on deletion), Redis purge isolation,
// AES-GCM AAD binding + key rotation.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('../app/utils/encryption');
const { purgeUserKeys } = require('../app/utils/userRedisPurge');

const MODELS_DIR = path.join(__dirname, '../app/models');
const ERASURE_SRC = fs.readFileSync(path.join(__dirname, '../app/services/privacy/erasure.js'), 'utf8');
const GDPR_SCRIPT_SRC = fs.readFileSync(path.join(__dirname, '../scripts/gdpr-delete.js'), 'utf8');

function userOwnedModels() {
  return fs.readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'User.js' && f !== 'encryptedField.js')
    .filter((f) => /userId\s*:/.test(fs.readFileSync(path.join(MODELS_DIR, f), 'utf8')))
    .map((f) => f.replace('.js', ''));
}

describe('Q3 — GDPR erasure completeness (guards every future sprint incl. A11)', () => {
  const models = userOwnedModels();

  it('discovers the known user-owned collections', () => {
    // Sanity: the discovery itself works (would be vacuous otherwise).
    expect(models).toEqual(expect.arrayContaining([
      'BiometricLog', 'MedicalProfile', 'MusicProfile', 'PlaylistSession',
      'ServeEvent', 'Identity', 'RefreshToken',
    ]));
  });

  it('EVERY model with a userId field is deleted by the erasure cascade', () => {
    for (const m of models) {
      expect(ERASURE_SRC).toMatch(new RegExp(`models/${m}'\\)`));
      expect(ERASURE_SRC).toContain(`${m}.deleteMany`);
    }
  });

  it('scripts/gdpr-delete.js mirrors the same collection set (lockstep)', () => {
    for (const m of models) {
      expect(GDPR_SCRIPT_SRC).toMatch(new RegExp(`models/${m}'\\)`));
    }
  });

  it('the Redis purge covers every user-scoped key family', () => {
    const purgeSrc = fs.readFileSync(path.join(__dirname, '../app/utils/userRedisPurge.js'), 'utf8');
    for (const family of ['ledger:', 'pool:', 'bio:baseline:']) {
      expect(purgeSrc).toContain(family);
    }
  });
});

describe('Q3 — Redis purge isolation (user A can never erase user B)', () => {
  class FakeRedis {
    constructor(keys) { this.store = new Map(keys.map((k) => [k, '1'])); }
    async scan(cursor, _m, pattern, _c, _n) {
      const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const keys = [...this.store.keys()].filter((k) => re.test(k));
      return ['0', keys];
    }
    async del(...keys) { let n = 0; for (const k of keys) if (this.store.delete(k)) n++; return n; }
  }

  it('only deletes keys in the target user namespace', async () => {
    const fake = new FakeRedis([
      'ledger:userA:served', 'pool:userA:focus', 'bio:baseline:userA',
      'ledger:userB:served', 'pool:userB:calm', 'bio:baseline:userB', 'unrelated:key',
    ]);
    jest.resetModules();
    jest.doMock('../app/config/redis', () => ({ getRedis: () => fake }));
    const { purgeUserKeys: purge } = require('../app/utils/userRedisPurge');
    const deleted = await purge('userA');
    expect(deleted).toBe(3);
    expect([...fake.store.keys()].sort()).toEqual([
      'bio:baseline:userB', 'ledger:userB:served', 'pool:userB:calm', 'unrelated:key',
    ]);
    jest.dontMock('../app/config/redis');
    jest.resetModules();
  });

  it('is a no-op (never throws) when Redis is unavailable', async () => {
    await expect(purgeUserKeys('anything')).resolves.toBe(0); // getRedis() → null in test env
    await expect(purgeUserKeys('')).resolves.toBe(0);
  });
});

describe('Q3 — AES-256-GCM AAD binding + key rotation', () => {
  it('an AAD-bound blob (baseline cache) cannot be replayed under another userId', () => {
    const blob = encrypt(JSON.stringify({ rhrMedian: 55 }), 'user-A');
    expect(decrypt(blob, false, 'user-A')).toBe(JSON.stringify({ rhrMedian: 55 }));
    expect(() => decrypt(blob, false, 'user-B')).toThrow(); // GCM auth fails cross-user
    expect(() => decrypt(blob, false, null)).toThrow();     // and without the AAD
  });

  it('a value encrypted under an old key still decrypts after rotation', () => {
    const OLD = 'b'.repeat(64);
    const NEW = 'c'.repeat(64);
    const savedKey = process.env.ENCRYPTION_KEY;
    const savedPrev = process.env.ENCRYPTION_KEY_PREVIOUS;
    try {
      process.env.ENCRYPTION_KEY = OLD;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
      const blob = encrypt('secret-vital');
      // rotate: new primary, old demoted to previous
      process.env.ENCRYPTION_KEY = NEW;
      process.env.ENCRYPTION_KEY_PREVIOUS = OLD;
      expect(decrypt(blob)).toBe('secret-vital');
    } finally {
      process.env.ENCRYPTION_KEY = savedKey;
      if (savedPrev === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
      else process.env.ENCRYPTION_KEY_PREVIOUS = savedPrev;
    }
  });

  it('corrupt / truncated ciphertext throws rather than returning garbage', () => {
    expect(() => decrypt('not-base64-!!!')).toThrow();
    const blob = encrypt('x');
    expect(() => decrypt(blob.slice(0, 8))).toThrow();
  });
});
