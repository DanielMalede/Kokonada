'use strict';

// T3.3: encrypt provider account-ids + push tokens at rest on the User doc, and add a
// deterministic blind-index (keyed HMAC) of garminUserId so the Garmin webhook can look up a
// user WITHOUT decrypting every row. Legacy plaintext still reads via the tolerant getter.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const crypto = require('crypto');
const { decrypt, blindIndex, blindIndexAll } = require('../app/utils/encryption');
const User = require('../app/models/User');

const base = { ssoProvider: 'google', ssoId: 'sso-1', email: 'a@b.c' };
const hmacWith = (keyHex, v) => crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(v).digest('hex');

describe('blindIndex (deterministic keyed HMAC for encrypted-field lookup)', () => {
  it('is deterministic for the same input', () => {
    expect(blindIndex('garmin-abc')).toBe(blindIndex('garmin-abc'));
  });

  it('is keyed — not a bare sha256 an attacker could precompute', () => {
    expect(blindIndex('a')).not.toBe(blindIndex('b'));
    expect(blindIndex('garmin-abc'))
      .not.toBe(crypto.createHash('sha256').update('garmin-abc').digest('hex'));
  });

  it('returns null for null/empty input', () => {
    expect(blindIndex(null)).toBeNull();
    expect(blindIndex('')).toBeNull();
  });
});

describe('blindIndexAll (rotation-safe lookup — H2)', () => {
  const OLD = 'a'.repeat(64);
  const NEW = 'b'.repeat(64);
  afterEach(() => { process.env.ENCRYPTION_KEY = 'a'.repeat(64); delete process.env.ENCRYPTION_KEY_PREVIOUS; });

  it('returns the primary-key index first, then every rotation (previous) key index', () => {
    process.env.ENCRYPTION_KEY = NEW;
    process.env.ENCRYPTION_KEY_PREVIOUS = OLD;
    const all = blindIndexAll('garmin-abc');
    expect(all[0]).toBe(blindIndex('garmin-abc'));      // current key first (write path)
    expect(all).toContain(hmacWith(OLD, 'garmin-abc')); // previous key still resolvable
    expect(all).toHaveLength(2);
  });

  it('lets a value indexed under the OLD key still be found after rotation (no reindex outage)', () => {
    process.env.ENCRYPTION_KEY = OLD;
    const oldIdx = blindIndex('garmin-abc'); // written under the old key
    process.env.ENCRYPTION_KEY = NEW;
    process.env.ENCRYPTION_KEY_PREVIOUS = OLD;
    expect(blindIndexAll('garmin-abc')).toContain(oldIdx);
  });

  it('returns [] for null/empty input', () => {
    expect(blindIndexAll(null)).toEqual([]);
    expect(blindIndexAll('')).toEqual([]);
  });
});

describe('User field encryption at rest (T3.3)', () => {
  it('encrypts garminUserId at rest but reads it back in plaintext', () => {
    const u = new User({ ...base, garminUserId: 'garmin-abc' });
    expect(u.garminUserId).toBe('garmin-abc'); // getter decrypts
    const raw = u.toObject({ getters: false }).garminUserId;
    expect(raw).not.toBe('garmin-abc');
    expect(decrypt(raw)).toBe('garmin-abc');
  });

  it('encrypts push-notification tokens at rest but reads/compares them transparently', () => {
    const u = new User({ ...base, pushTokens: [{ token: 'fcm-xyz', platform: 'android' }] });
    expect(u.pushTokens[0].token).toBe('fcm-xyz'); // getter decrypts
    // Transparent equality-compare (authController dedups by t.token === deviceToken)
    expect(u.pushTokens.some((t) => t.token === 'fcm-xyz')).toBe(true);
    const raw = u.toObject({ getters: false }).pushTokens[0].token;
    expect(raw).not.toBe('fcm-xyz');
    expect(decrypt(raw)).toBe('fcm-xyz');
  });

  it('backfills a deterministic HMAC index of garminUserId (queryable without decryption)', () => {
    const u = new User({ ...base, garminUserId: 'garmin-abc' });
    u.syncGarminIndex();
    expect(u.garminUserIdHmac).toBe(blindIndex('garmin-abc'));
  });

  it('clears the HMAC index when garminUserId is removed', () => {
    const u = new User({ ...base, garminUserId: 'garmin-abc' });
    u.syncGarminIndex();
    u.garminUserId = null;
    u.syncGarminIndex();
    expect(u.garminUserIdHmac).toBeNull();
  });

  it('indexes garminUserIdHmac for the webhook lookup path', () => {
    const idx = User.schema.indexes().find(([keys]) => keys.garminUserIdHmac != null);
    expect(idx).toBeDefined();
  });
});
