'use strict';

// Set a valid 64-hex-char key before requiring the module
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { encrypt, decrypt } = require('../app/utils/encryption');

describe('encryption utility', () => {
  describe('encrypt()', () => {
    it('returns a non-empty base64 string', () => {
      const blob = encrypt('hello');
      expect(typeof blob).toBe('string');
      expect(blob.length).toBeGreaterThan(0);
      // Valid base64 — no characters outside alphabet
      expect(blob).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const a = encrypt('same value');
      const b = encrypt('same value');
      expect(a).not.toBe(b);
    });

    it('serialises objects to JSON before encrypting', () => {
      const obj = { accessToken: 'tok_123', scope: 'read' };
      const blob = encrypt(obj);
      const result = decrypt(blob, true);
      expect(result).toEqual(obj);
    });

    it('never embeds the plaintext in the output', () => {
      const secret = 'super-secret-password';
      const blob = encrypt(secret);
      const raw = Buffer.from(blob, 'base64').toString('utf8');
      expect(raw).not.toContain(secret);
    });

    it('throws when ENCRYPTION_KEY is missing', () => {
      const saved = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      // Must clear require cache so getKey() re-reads env
      jest.resetModules();
      const { encrypt: freshEncrypt } = require('../app/utils/encryption');
      expect(() => freshEncrypt('x')).toThrow('ENCRYPTION_KEY');
      process.env.ENCRYPTION_KEY = saved;
      jest.resetModules();
    });

    it('throws when ENCRYPTION_KEY is the wrong length', () => {
      const saved = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'tooshort';
      jest.resetModules();
      const { encrypt: freshEncrypt } = require('../app/utils/encryption');
      expect(() => freshEncrypt('x')).toThrow('ENCRYPTION_KEY');
      process.env.ENCRYPTION_KEY = saved;
      jest.resetModules();
    });
  });

  describe('decrypt()', () => {
    it('round-trips a plain string', () => {
      const original = 'my plaintext value';
      expect(decrypt(encrypt(original))).toBe(original);
    });

    it('round-trips a JSON object when parseJson=true', () => {
      const obj = { userId: 'u1', token: 'abc', refreshToken: 'xyz' };
      expect(decrypt(encrypt(obj), true)).toEqual(obj);
    });

    it('returns a string (not parsed) when parseJson=false', () => {
      const obj = { key: 'val' };
      const result = decrypt(encrypt(obj), false);
      expect(typeof result).toBe('string');
      expect(JSON.parse(result)).toEqual(obj);
    });

    it('throws on a tampered auth tag (GCM integrity failure)', () => {
      const blob = encrypt('sensitive data');
      const buf = Buffer.from(blob, 'base64');
      // Flip a byte inside the auth tag region (bytes 12-27)
      buf[15] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws on a completely invalid blob', () => {
      expect(() => decrypt('not-valid-base64!!!')).toThrow();
    });

    it('throws when the blob is too short to contain IV + authTag', () => {
      // 27 bytes is IV(12) + authTag(16) - 1
      const tooShort = Buffer.alloc(27).toString('base64');
      expect(() => decrypt(tooShort)).toThrow();
    });
  });
});
