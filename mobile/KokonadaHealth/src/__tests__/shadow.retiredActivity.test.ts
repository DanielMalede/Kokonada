// DEC-062 (HX-7): the "Working" and "Focus" chips are retired. An installed build persisted and sent
// them, so removing the chips is not enough: a choice already on the device must be cleared when the
// new build loads it, and must never cross the wire again. Driven through the REAL chain an upgrade in
// place runs: an encrypted blob written by the old build → ColdPersistence.rehydrate → the emotion
// slice → the write-back → KokonadaSocket's emotion_update, over the stateful in-memory KV backend.

import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { setActivity, deserializeForPersist } from '../state/cold/emotionSlice';
import { ColdPersistence } from '../state/cold/coldPersistence';
import { sanitizeActivity } from '../experience/generate/promptSanitizer';
import { SecureStore } from '../storage/secureStore';
import type { KVBackend } from '../platform/kvBackend';
import type { Cipher } from '../platform/cipher';
import { KokonadaSocket, type SocketLike } from '../net/socketClient';

const RETIRED = ['working', 'focus', 'Working', ' FOCUS ', 'focus\n'];

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
const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });

class FakeSocket implements SocketLike {
  handlers = new Map<string, Array<(p?: any) => void>>();
  emitted: Array<{ event: string; payload?: any }> = [];
  on(e: string, cb: any) { const l = this.handlers.get(e) ?? []; l.push(cb); this.handlers.set(e, l); }
  off(e: string, cb: any) { this.handlers.set(e, (this.handlers.get(e) ?? []).filter((h) => h !== cb)); }
  emit(e: string, p?: any) { this.emitted.push({ event: e, payload: p }); }
  connect() { this.fire('connect'); } disconnect() {}
  fire(e: string, p?: any) { (this.handlers.get(e) ?? []).slice().forEach((c) => c(p)); }
}

// What the OLD build left on the device: its own serialization of a committed Working/Focus choice.
function oldBuildDevice(activity: string) {
  const backend = makeBackend();
  const secure = new SecureStore({ backend, cipher: b64 });
  secure.setItem('cold.emotion.userA', JSON.stringify({ taps: [{ x: 0.3, y: 0.4 }], activity, textPrompt: 'late' }));
  return { backend, secure };
}

// The NEW build booting on that device, then connecting (connect re-emits the cached intent).
function upgradeInPlace(activity: string) {
  const { secure } = oldBuildDevice(activity);
  const store = makeStore();
  const cold = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
  cold.rehydrate();
  cold.attach();
  cold.flush();
  const sock = new FakeSocket();
  const client = new KokonadaSocket({
    createSocket: () => sock,
    getAccessToken: () => 'a', refreshToken: async () => 'b',
    getEmotionIntent: () => {
      const e = store.getState().emotion;
      return { taps: e.taps, textPrompt: e.textPrompt, activity: e.activity };
    },
    onPlaylist: jest.fn(), onLoggedOut: jest.fn(),
  });
  client.connect();
  const persisted = JSON.parse(secure.getItem('cold.emotion.userA') ?? '{}');
  const wire = sock.emitted.filter((x) => x.event === 'emotion_update').map((x) => x.payload);
  cold.detach();
  return { store, persisted, wire };
}

describe('retired chips are cleared wherever a stored or dispatched choice enters (DEC-062)', () => {
  it.each(RETIRED)('sanitizeActivity clears %j to null', (key) => {
    expect(sanitizeActivity(key)).toBeNull();
  });

  it('sanitizeActivity keeps every chip still offered', () => {
    for (const key of ['running', 'resting', 'walking', 'commuting', 'workout', 'winding down']) expect(sanitizeActivity(key)).toBe(key);
  });

  it.each(RETIRED)('a persisted %j hydrates to null', (key) => {
    expect(deserializeForPersist(JSON.stringify({ activity: key })).activity).toBeNull();
  });

  it.each(RETIRED)('setActivity(%j) commits null, never the retired key', (key) => {
    const store = makeStore();
    store.dispatch(setActivity('running'));
    store.dispatch(setActivity(key));
    expect(store.getState().emotion.activity).toBeNull();
  });
});

describe('upgrade in place from a build with Working or Focus selected', () => {
  it.each(['working', 'focus'])('%s: cleared on load, rewritten as null, and sent as activity:null', (key) => {
    const { store, persisted, wire } = upgradeInPlace(key);
    expect(store.getState().emotion).toEqual({ taps: [{ x: 0.3, y: 0.4 }], activity: null, textPrompt: 'late' });
    expect(persisted.activity).toBeNull();
    expect(wire).toEqual([{ taps: [{ x: 0.3, y: 0.4 }], textPrompt: 'late', activity: null }]);
  });

  it('control: a chip still offered survives the same upgrade and reaches the wire (the chain is live)', () => {
    const { store, persisted, wire } = upgradeInPlace('running');
    expect(store.getState().emotion.activity).toBe('running');
    expect(persisted.activity).toBe('running');
    expect(wire).toEqual([{ taps: [{ x: 0.3, y: 0.4 }], textPrompt: 'late', activity: 'running' }]);
  });
});
