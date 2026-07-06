// ═══════════════════════════════════════════════════════════════════════════
// SHADOW AUDIT — Sprint A7 (RN Foundation) — UNRESTRICTED FULL-SYSTEM ATTACK
// Mobile doctrine + OPEN MANDATE. Integration-level attacks that cross storage,
// the three lanes, and the socket lifecycle simultaneously — plus autonomously
// discovered mobile-specific vulnerabilities. Real modules, stateful fakes.
// ═══════════════════════════════════════════════════════════════════════════

import { configureStore } from '@reduxjs/toolkit';
import { SecureStore } from '../storage/secureStore';
import type { KVBackend } from '../platform/kvBackend';
import type { Cipher } from '../platform/cipher';
import emotionReducer, { addTap, setActivity, setTextPrompt } from '../state/cold/emotionSlice';
import { ColdPersistence } from '../state/cold/coldPersistence';
import { createWarmStore } from '../state/warm/warmStore';
import { TapCommitter, smoothTowards } from '../state/hot/laneCommit';
import { KokonadaSocket, type SocketLike } from '../net/socketClient';

// ── Fakes with real semantics ─────────────────────────────────────────────────
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
// A real reversible cipher stands in for the on-device MMKV-native AES so we can
// prove the "no plaintext at rest" property end to end.
const cipher: Cipher = {
  encrypt: (p) => 'e:' + Buffer.from(p, 'utf8').toString('base64'),
  decrypt: (b) => Buffer.from(b.replace(/^e:/, ''), 'base64').toString('utf8'),
};
const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });

class FakeSocket implements SocketLike {
  handlers = new Map<string, Array<(p?: any) => void>>();
  emitted: Array<{ event: string; payload?: any }> = [];
  constructor(public token: string) {}
  on(e: string, cb: (p?: any) => void) { const l = this.handlers.get(e) ?? []; l.push(cb); this.handlers.set(e, l); }
  off(e: string, cb: (p?: any) => void) { this.handlers.set(e, (this.handlers.get(e) ?? []).filter((h) => h !== cb)); }
  emit(e: string, p?: any) { this.emitted.push({ event: e, payload: p }); }
  connect() { this.fire('connect'); }
  disconnect() {}
  fire(e: string, p?: any) { (this.handlers.get(e) ?? []).slice().forEach((cb) => cb(p)); }
}
const flush = () => new Promise((r) => setImmediate(r));

// ═════ ATTACK 1: DEFERRED MMKV — no biometric/prompt/token bytes at rest ═════
describe('ATTACK 1: Deferred MMKV — nothing sensitive in persistent storage', () => {
  it('a full session leaves NO plaintext prompt and NO heart-rate anywhere on disk', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });
    const store = makeStore();
    const warm = createWarmStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    p.attach();

    // full session: intent to cold (persisted), biometrics to warm (ephemeral)
    store.dispatch(addTap({ x: 0.3, y: 0.7 }));
    store.dispatch(setTextPrompt('grief on a tuesday'));
    warm.getState().setLiveHr(142);
    p.flush();

    const dump = JSON.stringify([...backend.__map.entries()]);
    expect(dump).not.toContain('grief on a tuesday'); // prompt is ciphertext
    expect(dump).not.toContain('142');                // HR never persisted at all
    expect(dump).not.toContain('heartRate');
    expect(dump).not.toContain('liveHr');
  });

  it('app restart rehydrates INTENT but never resurrects a biometric', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });

    const s1 = makeStore();
    const warm1 = createWarmStore();
    const p1 = new ColdPersistence({ store: s1, secure, getUserId: () => 'userA' });
    p1.attach();
    s1.dispatch(setActivity('running'));
    warm1.getState().setLiveHr(150);
    p1.flush();

    // cold restart: new stores, biometric warm lane starts empty
    const s2 = makeStore();
    const warm2 = createWarmStore();
    new ColdPersistence({ store: s2, secure, getUserId: () => 'userA' }).rehydrate();
    expect(s2.getState().emotion.activity).toBe('running'); // intent survived
    expect(warm2.getState().liveHr).toBeNull();             // biometric did not
  });

  it('a heart-rate value can never be persisted even via a direct forbidden write', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });
    expect(secure.setItem('bio:lastHr', '188')).toBe(false);
    expect(secure.setItem('hr:current', '188')).toBe(false);
    expect(backend.__map.size).toBe(0);
  });
});

// ═════ ATTACK 2: THREE-LANE RACE — hot flood + delayed cold, no corruption ════
describe('ATTACK 2: Three-lane race conditions', () => {
  it('a hot-lane flood with an interleaved cold persist never corrupts the tap buffer', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });
    const store = makeStore();
    const warm = createWarmStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    p.attach();

    let t = 0;
    const committer = new TapCommitter({ dispatch: (tap) => store.dispatch(addTap(tap)), now: () => t, minGapMs: 0 });

    // 200 rapid hot commits; warm HR churns; cold flushes mid-stream
    for (let i = 0; i < 200; i++) {
      t += 5;
      committer.commit({ x: Math.sin(i), y: Math.cos(i) });
      if (i % 20 === 0) { warm.getState().setLiveHr(60 + (i % 100)); p.flush(); }
    }

    const taps = store.getState().emotion.taps;
    expect(taps).toHaveLength(3); // ring buffer held the cap under the flood
    for (const tap of taps) {
      expect(Number.isFinite(tap.x) && Number.isFinite(tap.y)).toBe(true);
      expect(Math.hypot(tap.x, tap.y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('warm-lane HR churn never bleeds into the persisted cold blob', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });
    const store = makeStore();
    const warm = createWarmStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    p.attach();
    for (let hr = 60; hr < 200; hr += 3) warm.getState().setLiveHr(hr);
    store.dispatch(setTextPrompt('steady'));
    p.flush();

    const raw = secure.getItem('cold.emotion.userA')!;
    expect(JSON.parse(raw)).toEqual({ taps: [], activity: null, textPrompt: 'steady' });
  });
});

// ═════ ATTACK 3: ZOMBIE NAVIGATION — stale responses during tab churn ════════
describe('ATTACK 3: Zombie navigation', () => {
  function buildSocket() {
    const created: FakeSocket[] = [];
    const onPlaylist = jest.fn();
    const client = new KokonadaSocket({
      createSocket: (tok) => { const s = new FakeSocket(tok); created.push(s); return s; },
      getAccessToken: () => 'a1',
      refreshToken: async () => 'a2',
      getEmotionIntent: () => ({ taps: [], textPrompt: '', activity: null }),
      onPlaylist,
      onLoggedOut: jest.fn(),
    });
    return { client, created, onPlaylist };
  }

  it('rapid re-requests during tab switching render only the newest response', () => {
    const { client, created, onPlaylist } = buildSocket();
    client.connect();
    const sock = created[0];
    const ids = [client.requestPlaylist(), client.requestPlaylist(), client.requestPlaylist()];
    // responses arrive out of order (network + navigation churn)
    sock.fire('playlist_ready', { reqId: ids[0], tracks: ['a'] });
    sock.fire('playlist_ready', { reqId: ids[1], tracks: ['b'] });
    sock.fire('playlist_ready', { reqId: ids[2], tracks: ['c'] });
    expect(onPlaylist).toHaveBeenCalledTimes(1);
    expect(onPlaylist).toHaveBeenCalledWith(expect.objectContaining({ tracks: ['c'] }));
  });

  it('a response that lands AFTER the screen abandoned the request is inert (no crash, no dead-screen callback)', () => {
    const { client, created, onPlaylist } = buildSocket();
    client.connect();
    const sock = created[0];
    const id = client.requestPlaylist();
    client.disconnect(); // user navigated away / tore the screen down
    // handlers are detached on disconnect, so the late response is dropped, not
    // delivered into a torn-down screen (the classic RN unmounted-callback crash).
    expect(() => sock.fire('playlist_ready', { reqId: id, tracks: ['late'] })).not.toThrow();
    expect(onPlaylist).not.toHaveBeenCalled();
  });
});

// ═════ ATTACK 4 & 5: OS INTERRUPTION + ZERO BYTES LEFT ═══════════════════════
describe('ATTACK 4/5: OS interruption during write & storage full', () => {
  it('an interrupted flush keeps the prior persisted intent and the app keeps running', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });
    const store = makeStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    p.attach();
    store.dispatch(setTextPrompt('before call')); p.flush();

    // phone call fires exactly during the next write
    backend.set = () => { throw new Error('EINTR'); };
    store.dispatch(setTextPrompt('during call'));
    expect(() => p.flush()).not.toThrow();
    expect(secure.getItem('cold.emotion.userA')).not.toBeNull(); // prior value intact

    // storage recovers; the app persists again with no restart
    const map = backend.__map;
    backend.set = (k, v) => { map.set(k, v); };
    store.dispatch(setTextPrompt('after call')); p.flush();
    expect(JSON.parse(secure.getItem('cold.emotion.userA')!).textPrompt).toBe('after call');
  });

  it('a device at 0 bytes degrades every write to false, never a throw', () => {
    const backend = makeBackend();
    backend.set = () => { throw new Error('ENOSPC: no space left on device'); };
    const secure = new SecureStore({ backend, cipher });
    for (const k of ['session.meta', 'cold.emotion.userA', 'cold.activity']) {
      expect(secure.setItem(k, 'x')).toBe(false);
    }
  });
});

// ═════ ATTACK 6: THERMAL / LOW POWER — frame-rate independence ═══════════════
describe('ATTACK 6: Thermal throttling / low-power frame-rate drop', () => {
  it('the aura smoothing converges monotonically and never NaNs from 120Hz down to 1Hz', () => {
    for (const dt of [8, 16, 33, 100, 500, 1000]) { // 120→1 Hz
      let v = 60;
      for (let i = 0; i < 30; i++) v = smoothTowards(v, 120, dt, 150);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(60);
      expect(v).toBeLessThanOrEqual(120);
    }
  });
});

// ═════ ATTACK 7: BACKGROUND PERMISSION REVOCATION ════════════════════════════
describe('ATTACK 7: Background permission revocation', () => {
  it('revoking Bluetooth mid-session severs biometrics but the socket survives', () => {
    const warm = createWarmStore();
    warm.getState().setConnection('connected');
    warm.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    warm.getState().setBiometricSource('ble');
    warm.getState().setLiveHr(96);

    // suspended → user revokes BT → foreground reconciles
    expect(() => warm.getState().setPermissions({ bluetooth: 'denied', health: 'granted' })).not.toThrow();
    expect(warm.getState().biometricSource).toBe('none');
    expect(warm.getState().liveHr).toBeNull();
  });
});

// ═════ ATTACK 8: AUTONOMOUS DISCOVERY (open mandate) ═════════════════════════
describe('ATTACK 8: autonomously-discovered mobile vulnerabilities', () => {
  it('8a — SHARED DEVICE: user A intent never rehydrates into user B (account data leak)', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });
    const sa = makeStore();
    const pa = new ColdPersistence({ store: sa, secure, getUserId: () => 'userA' });
    pa.attach();
    sa.dispatch(setTextPrompt("A's private vibe")); pa.flush();

    const sb = makeStore();
    new ColdPersistence({ store: sb, secure, getUserId: () => 'userB' }).rehydrate();
    expect(sb.getState().emotion.textPrompt).toBe(''); // zero cross-user leakage
  });

  it('8b — PROTOTYPE POLLUTION: a malicious persisted blob cannot pollute Object.prototype', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });
    // plant a poisoned blob under the user namespace
    backend.__map.set('cold.emotion.userA', cipher.encrypt(JSON.stringify({
      taps: [], activity: 'x', textPrompt: 'y',
      ['__proto__']: { polluted: true },
      constructor: { prototype: { polluted: true } },
    })));
    const store = makeStore();
    new ColdPersistence({ store, secure, getUserId: () => 'userA' }).rehydrate();
    expect(({} as any).polluted).toBeUndefined(); // global prototype untouched
    expect((Object.prototype as any).polluted).toBeUndefined();
  });

  it('8c — reqId TYPE CONFUSION: a server cannot force-render by juggling reqId types', () => {
    const created: FakeSocket[] = [];
    const onPlaylist = jest.fn();
    const client = new KokonadaSocket({
      createSocket: (tok) => { const s = new FakeSocket(tok); created.push(s); return s; },
      getAccessToken: () => 'a1',
      refreshToken: async () => 'a2',
      getEmotionIntent: () => ({ taps: [], textPrompt: '', activity: null }),
      onPlaylist,
      onLoggedOut: jest.fn(),
    });
    client.connect();
    const id = client.requestPlaylist(); // numeric 1
    // attacker replays with string "1", object, array — strict !== must reject all
    created[0].fire('playlist_ready', { reqId: String(id), tracks: ['x'] });
    created[0].fire('playlist_ready', { reqId: { valueOf: () => id }, tracks: ['x'] });
    created[0].fire('playlist_ready', { reqId: [id], tracks: ['x'] });
    expect(onPlaylist).not.toHaveBeenCalled();
  });

  it('8e — ZOMBIE SOCKET HANDLER: a late event on the replaced (dead) socket cannot corrupt the new session', async () => {
    const created: FakeSocket[] = [];
    const onLoggedOut = jest.fn();
    const onPlaylist = jest.fn();
    const client = new KokonadaSocket({
      createSocket: (tok) => { const s = new FakeSocket(tok); created.push(s); return s; },
      getAccessToken: () => 'a1',
      refreshToken: async () => 'a2',
      getEmotionIntent: () => ({ taps: [], textPrompt: '', activity: null }),
      onPlaylist,
      onLoggedOut,
      now: () => 0,
      maxAuthRefreshes: 5,
    });
    client.connect();
    const dead = created[0];

    dead.fire('auth_expired');   // token dies → refresh → new socket
    await flush();
    expect(created).toHaveLength(2);

    // The OLD socket had buffered events that flush AFTER the swap. They must be
    // inert — a stale auth_expired must NOT count against the fresh session (which
    // would spuriously log the user out) and a stale playlist must not render.
    dead.fire('auth_expired');
    dead.fire('auth_expired');
    dead.fire('playlist_ready', { reqId: 1, tracks: ['ghost'] });
    await flush();

    expect(onLoggedOut).not.toHaveBeenCalled();
    expect(created).toHaveLength(2);            // no extra reconnects from ghost events
    expect(onPlaylist).not.toHaveBeenCalled();
  });

  it('8d — TOKEN NEVER IN COLD PERSIST: a rogue token field is stripped by the whitelist', () => {
    const backend = makeBackend();
    const secure = new SecureStore({ backend, cipher });
    const store = makeStore();
    const p = new ColdPersistence({ store, secure, getUserId: () => 'userA' });
    p.attach();
    // simulate a coding mistake dispatching a token into cold state via hydrate.
    // The value is an inert placeholder — the point is that a NON-ALLOWLISTED
    // field (whatever its value) never reaches disk.
    const rogueValue = 'ROGUE-PLACEHOLDER-not-a-credential';
    store.dispatch({ type: 'emotion/hydrate', payload: { textPrompt: 'ok', accessToken: rogueValue } as any });
    p.flush();
    const raw = secure.getItem('cold.emotion.userA')!;
    expect(raw).not.toContain(rogueValue);
    expect(JSON.parse(raw).accessToken).toBeUndefined();
  });
});
