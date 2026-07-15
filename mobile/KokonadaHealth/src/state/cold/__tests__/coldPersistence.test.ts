// The persistence bridge: cold-lane intent → SecureStore (encrypted) and back on
// boot. Two attacks drive the design: (1) storage failures must never crash the
// store's dispatch loop; (2) a SHARED DEVICE must not leak one user's committed
// intent into another user's session — persistence is namespaced by userId and a
// login as a different user rehydrates a clean slate.

import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { addTap, setTextPrompt } from '../emotionSlice';
import { SecureStore } from '../../../storage/secureStore';
import type { KVBackend } from '../../../platform/kvBackend';
import type { Cipher } from '../../../platform/cipher';
import { ColdPersistence } from '../coldPersistence';

function makeBackend(): KVBackend & { __map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    __map: map,
    encrypted: true,
    getString: (k) => (map.has(k) ? map.get(k) : undefined),
    set: (k, v) => { map.set(k, v); },
    delete: (k) => { map.delete(k); },
    getAllKeys: () => [...map.keys()],
    clearAll: () => { map.clear(); },
  };
}
const b64: Cipher = {
  encrypt: (p) => 'e:' + Buffer.from(p, 'utf8').toString('base64'),
  decrypt: (b) => Buffer.from(b.replace(/^e:/, ''), 'base64').toString('utf8'),
};

function makeStore() {
  return configureStore({ reducer: { emotion: emotionReducer } });
}

describe('ColdPersistence — save & rehydrate', () => {
  it('persists committed intent and rehydrates it into a fresh store', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher: b64 });

    const store1 = makeStore();
    const p1 = new ColdPersistence({ store: store1, secure, getUserId: () => 'userA' });
    p1.attach();
    store1.dispatch(addTap({ x: 0.4, y: 0.6 }));
    store1.dispatch(setTextPrompt('golden hour'));
    p1.flush();

    // simulate app restart: a brand-new store, same encrypted backend
    const store2 = makeStore();
    const p2 = new ColdPersistence({ store: store2, secure, getUserId: () => 'userA' });
    p2.rehydrate();

    expect(store2.getState().emotion.taps).toEqual([{ x: 0.4, y: 0.6 }]);
    expect(store2.getState().emotion.textPrompt).toBe('golden hour');
  });

  it('nothing readable leaks to the backend — the persisted blob is ciphertext', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher: b64 });
    const store = makeStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    p.attach();
    store.dispatch(setTextPrompt('secret sad song'));
    p.flush();

    const dumped = JSON.stringify([...backend.__map.entries()]);
    expect(dumped).not.toContain('secret sad song');
    expect(dumped).not.toContain('textPrompt'); // even the key names are encrypted
  });
});

describe('ColdPersistence — shared-device cross-user isolation (autonomous finding)', () => {
  it('does NOT rehydrate user A intent into user B on the same device', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher: b64 });

    // User A commits intent and it persists.
    const storeA = makeStore();
    const pA = new ColdPersistence({ store: storeA, secure, getUserId: () => 'userA' });
    pA.attach();
    storeA.dispatch(setTextPrompt('user A private prompt'));
    pA.flush();

    // User B logs in on the same device (no full wipe) → fresh store rehydrates.
    const storeB = makeStore();
    const pB = new ColdPersistence({ store: storeB, secure, getUserId: () => 'userB' });
    pB.rehydrate();

    expect(storeB.getState().emotion.textPrompt).toBe(''); // clean slate, zero A leakage
  });

  it('persists user B under B\'s own namespace without clobbering A', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher: b64 });

    const storeA = makeStore();
    const pA = new ColdPersistence({ store: storeA, secure, getUserId: () => 'userA' });
    pA.attach();
    storeA.dispatch(setTextPrompt('A'));
    pA.flush();

    const storeB = makeStore();
    const pB = new ColdPersistence({ store: storeB, secure, getUserId: () => 'userB' });
    pB.attach();
    storeB.dispatch(setTextPrompt('B'));
    pB.flush();

    // A's namespace survives; re-reading A gives A, re-reading B gives B.
    const rA = makeStore();
    new ColdPersistence({ store: rA, secure, getUserId: () => 'userA' }).rehydrate();
    const rB = makeStore();
    new ColdPersistence({ store: rB, secure, getUserId: () => 'userB' }).rehydrate();
    expect(rA.getState().emotion.textPrompt).toBe('A');
    expect(rB.getState().emotion.textPrompt).toBe('B');
  });

  it('skips persistence entirely when no user is logged in (no global-key spill)', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher: b64 });
    const store = makeStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => null });
    p.attach();
    store.dispatch(setTextPrompt('should not persist'));
    p.flush();
    expect(backend.__map.size).toBe(0);
  });
});

describe('ColdPersistence — logout wipe', () => {
  it('wipe() clears every user\'s cold namespace AND resets in-memory intent', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher: b64 });

    // two users have committed intent on this device
    const storeA = makeStore();
    const pA = new ColdPersistence({ store: storeA, secure, getUserId: () => 'userA' });
    pA.attach();
    storeA.dispatch(setTextPrompt('A intent'));
    pA.flush();
    const storeB = makeStore();
    const pB = new ColdPersistence({ store: storeB, secure, getUserId: () => 'userB' });
    pB.attach();
    storeB.dispatch(setTextPrompt('B intent'));
    pB.flush();

    // logging out of A wipes ALL cold intent (no user's intent survives a switch)…
    pA.wipe();
    expect(secure.getItem('cold.emotion.userA')).toBeNull();
    expect(secure.getItem('cold.emotion.userB')).toBeNull();
    expect(storeA.getState().emotion).toEqual({ taps: [], activity: null, textPrompt: '' });
  });

  it('COLLATERAL-DAMAGE GUARD: a non-cold device pref (koko.onboarding.seen) SURVIVES wipe()', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher: b64 });
    // a device preference sharing the same encrypted instance
    secure.setItem('koko.onboarding.seen', '1');
    secure.setItem('koko.liveMode', '0');

    const store = makeStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    p.attach();
    store.dispatch(addTap({ x: 1, y: 1 }));
    p.flush();

    p.wipe(); // logout

    expect(secure.getItem('cold.emotion.userA')).toBeNull();   // cold intent gone
    expect(secure.getItem('koko.onboarding.seen')).toBe('1');  // device prefs untouched
    expect(secure.getItem('koko.liveMode')).toBe('0');
  });
});

describe('ColdPersistence — graceful degradation', () => {
  it('a storage-full backend never throws into the dispatch loop', () => {
    const backend = makeBackend();
    backend.set = () => { throw new Error('no space'); };
    const secure = new SecureStore({ backend, cipher: b64 });
    const store = makeStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    p.attach();
    expect(() => { store.dispatch(setTextPrompt('x')); p.flush(); }).not.toThrow();
  });
});
