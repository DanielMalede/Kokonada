// BLOCKER regression (shared-backend integration). The FTUE-seen flag and the cold
// intent store share ONE encrypted MMKV instance in production (prodBootstrap binds both
// the onboarding KV and ColdPersistence to the same SecureStore). Logout runs
// ColdPersistence.wipe(); if that wipe erases the WHOLE instance it also deletes
// koko.onboarding.seen, and the next cold start resurrects Onboarding for a returning,
// logged-out user. This suite wires the REAL teardown against a shared encrypted fake —
// the exact seam the profileController / AppFlow "regression" tests never exercise (they
// use no-op stubs / in-memory-only clears).

import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { setTextPrompt } from '../../state/cold/emotionSlice';
import { SecureStore } from '../../storage/secureStore';
import type { KVBackend } from '../../platform/kvBackend';
import type { Cipher } from '../../platform/cipher';
import { ColdPersistence } from '../../state/cold/coldPersistence';
import { setColdPersistence, wipeColdPersistence } from '../../state/cold/coldPersistenceHolder';
import { createOnboardingStore, ONBOARDING_SEEN_KEY } from '../onboardingStore';

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
const kvOver = (s: SecureStore) => ({ getString: (k: string) => s.getItem(k) ?? undefined, set: (k: string, v: string) => { s.setItem(k, v); } });

describe('onboarding survives logout teardown (shared encrypted instance)', () => {
  it('a REAL cold-persistence wipe on logout does NOT erase koko.onboarding.seen', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher: b64 });

    // 1) The device finishes the FTUE — markSeen persists through the shared store.
    const onboarding = createOnboardingStore(kvOver(secure));
    onboarding.getState().markSeen();
    expect(secure.getItem(ONBOARDING_SEEN_KEY)).toBe('1');

    // 2) The (now logged-in) user commits cold intent into the SAME encrypted instance.
    const store = configureStore({ reducer: { emotion: emotionReducer } });
    const cp = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    cp.attach();
    store.dispatch(setTextPrompt('late night jazz'));
    cp.flush();

    // 3) Logout runs the REAL teardown path (profileServices → wipeColdPersistence → wipe()).
    setColdPersistence(cp);
    wipeColdPersistence();

    // 4) Next cold start: a fresh onboarding store reads the SAME backend.
    const rebound = createOnboardingStore(kvOver(secure));
    rebound.getState().hydrate();

    expect(rebound.getState().seen).toBe(true);          // FTUE flag SURVIVES logout
    expect(secure.getItem(ONBOARDING_SEEN_KEY)).toBe('1');
    // and the cold intent is still gone — the wipe kept its real security posture
    expect(secure.getItem('cold.emotion.userA')).toBeNull();
  });
});
