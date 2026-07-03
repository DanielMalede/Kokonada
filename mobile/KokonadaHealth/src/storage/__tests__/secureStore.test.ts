// secureStore is the ONLY sanctioned persistence path on the device. It wraps an
// encrypted MMKV backend and enforces three invariants the Shadow Agent will attack:
//   1. Nothing is ever written in plaintext — every value goes through the cipher.
//   2. Biometric namespaces (bio:/hr:/biometric:) can NEVER reach disk, even by mistake.
//   3. A failing backend (storage full, interrupted write) degrades gracefully — the
//      store returns false / the prior value, and never throws into the UI thread.
//
// Ports are injected so this pure logic runs under jest with zero native modules.

import { SecureStore } from '../secureStore';
import type { KVBackend } from '../../platform/kvBackend';
import type { Cipher } from '../../platform/cipher';

// A stateful fake of an ENCRYPTED MMKV instance: a real Map with the same surface.
function makeBackend(overrides: Partial<KVBackend> = {}): KVBackend & { __map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    __map: map,
    encrypted: true,
    getString: (k) => (map.has(k) ? map.get(k) : undefined),
    set: (k, v) => { map.set(k, v); },
    delete: (k) => { map.delete(k); },
    getAllKeys: () => [...map.keys()],
    clearAll: () => { map.clear(); },
    ...overrides,
  };
}

// Reversible test cipher (base64) — proves round-trip AND that stored bytes != plaintext.
const b64Cipher: Cipher = {
  encrypt: (plain) => 'enc:' + Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (blob) => Buffer.from(blob.replace(/^enc:/, ''), 'base64').toString('utf8'),
};

describe('SecureStore — encrypted-only persistence', () => {
  it('round-trips a value through get/set', () => {
    const store = new SecureStore({ backend: makeBackend(), cipher: b64Cipher });
    expect(store.setItem('session.jwt', 'header.payload.sig')).toBe(true);
    expect(store.getItem('session.jwt')).toBe('header.payload.sig');
  });

  it('never writes plaintext to the backend — raw bytes are ciphertext', () => {
    const backend = makeBackend();
    const store = new SecureStore({ backend, cipher: b64Cipher });
    store.setItem('cold.textPrompt', 'late night melancholy jazz');

    const raw = backend.__map.get('cold.textPrompt')!;
    expect(raw).not.toContain('melancholy');       // the secret string never appears
    expect(raw.startsWith('enc:')).toBe(true);      // it went through the cipher
  });

  it('refuses a backend that is not flagged encrypted (no plaintext MMKV fallback)', () => {
    const plainBackend = makeBackend({ encrypted: false });
    expect(() => new SecureStore({ backend: plainBackend, cipher: b64Cipher }))
      .toThrow(/encrypted/i);
  });

  it('returns null for a missing key', () => {
    const store = new SecureStore({ backend: makeBackend(), cipher: b64Cipher });
    expect(store.getItem('nope')).toBeNull();
  });
});

describe('SecureStore — biometric denylist (Deferred MMKV Attack)', () => {
  const forbidden = ['bio:baseline', 'hr:live', 'biometric:snapshot', 'HR:current'];

  it('rejects every biometric namespace and writes nothing', () => {
    const backend = makeBackend();
    const store = new SecureStore({ backend, cipher: b64Cipher });
    for (const key of forbidden) {
      expect(store.setItem(key, '72')).toBe(false);
    }
    expect(backend.__map.size).toBe(0); // zero biometric bytes reached disk
  });

  it('getItem on a forbidden key is always null — never served from disk', () => {
    const backend = makeBackend();
    backend.__map.set('hr:live', b64Cipher.encrypt('88')); // even if planted somehow
    const store = new SecureStore({ backend, cipher: b64Cipher });
    expect(store.getItem('hr:live')).toBeNull();
  });
});

describe('SecureStore — graceful degradation (Zero Bytes Left / interrupted write)', () => {
  it('setItem returns false instead of throwing when the backend is full', () => {
    const backend = makeBackend({
      set: () => { throw new Error('MMKV: no space left on device'); },
    });
    const store = new SecureStore({ backend, cipher: b64Cipher });
    expect(() => store.setItem('session.jwt', 'x')).not.toThrow();
    expect(store.setItem('session.jwt', 'x')).toBe(false);
  });

  it('an interrupted write leaves the PRIOR value intact and readable', () => {
    const backend = makeBackend();
    const store = new SecureStore({ backend, cipher: b64Cipher });
    store.setItem('cold.activity', 'running');

    // storage fills up on the next write
    backend.set = () => { throw new Error('interrupted'); };
    expect(store.setItem('cold.activity', 'resting')).toBe(false);

    // old value survives — no half-written corruption, no crash on read
    expect(store.getItem('cold.activity')).toBe('running');
  });

  it('getItem returns null (not a throw) when stored bytes are corrupt', () => {
    const backend = makeBackend();
    backend.__map.set('cold.taps', '%%%not-base64%%%');
    const brittleCipher: Cipher = {
      encrypt: b64Cipher.encrypt,
      decrypt: () => { throw new Error('bad ciphertext'); },
    };
    const store = new SecureStore({ backend, cipher: brittleCipher });
    expect(store.getItem('cold.taps')).toBeNull();
  });
});

describe('SecureStore — logout wipe (Zero Bytes Left after logout)', () => {
  it('clearAll removes every persisted key', () => {
    const backend = makeBackend();
    const store = new SecureStore({ backend, cipher: b64Cipher });
    store.setItem('session.jwt', 'j');
    store.setItem('cold.activity', 'running');
    store.clearAll();
    expect(backend.__map.size).toBe(0);
    expect(store.getItem('session.jwt')).toBeNull();
  });
});
