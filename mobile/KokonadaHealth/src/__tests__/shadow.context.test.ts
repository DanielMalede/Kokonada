// ═══════════════════════════════════════════════════════════════════════════
// SHADOW AUDIT — Sprint A10 (Context Suite + Foreground) — UI-INTEGRATION ATTACK
// Attacks the payload composed from the three Context inputs and the foreground
// reconcile lifecycle. Real store + slice + KokonadaSocket + warm store + orchestrator.
// ═══════════════════════════════════════════════════════════════════════════

import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { setActivity, setTextPrompt, addTap } from '../state/cold/emotionSlice';
import { serializeForPersist } from '../state/cold/emotionSlice';
import { MAX_PROMPT_LENGTH } from '../experience/generate/promptSanitizer';
import { KokonadaSocket, type SocketLike } from '../net/socketClient';
import { createWarmStore } from '../state/warm/warmStore';
import { reconcileOnForeground } from '../experience/playback/foregroundReconcile';
import { PlaybackOrchestrator } from '../experience/playback/playbackOrchestrator';
import { PlaybackQueue } from '../experience/playback/playbackQueue';

const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });

class FakeSocket implements SocketLike {
  handlers = new Map<string, Array<(p?: any) => void>>(); emitted: Array<{ event: string; payload?: any }> = [];
  on(e: string, cb: any) { const l = this.handlers.get(e) ?? []; l.push(cb); this.handlers.set(e, l); }
  off(e: string, cb: any) { this.handlers.set(e, (this.handlers.get(e) ?? []).filter((h) => h !== cb)); }
  emit(e: string, p?: any) { this.emitted.push({ event: e, payload: p }); }
  connect() { this.fire('connect'); } disconnect() {}
  fire(e: string, p?: any) { (this.handlers.get(e) ?? []).slice().forEach((c) => c(p)); }
}

function makeClient(store: ReturnType<typeof makeStore>) {
  const created: FakeSocket[] = [];
  const client = new KokonadaSocket({
    createSocket: () => { const s = new FakeSocket(); created.push(s); return s; },
    getAccessToken: () => 'a', refreshToken: async () => 'b',
    getEmotionIntent: () => {
      const e = store.getState().emotion;
      return { taps: e.taps, textPrompt: e.textPrompt, activity: e.activity };
    },
    onPlaylist: jest.fn(), onLoggedOut: jest.fn(),
  });
  return { client, created };
}

// ═════ ATTACK 1: PROMPT BOX CHAOS (injection & overflow) ═════════════════════
describe('ATTACK 1: prompt overflow / injection cannot bloat state, MMKV, or the payload', () => {
  it('a 50k-char injection paste is capped in state, in the persisted blob, AND in the socket payload', () => {
    const store = makeStore();
    const nasty = ('{"$where":"1"}\0' + "'; DROP TABLE t;--").repeat(5000);
    store.dispatch(setTextPrompt(nasty));

    // state bounded + null-free
    expect(store.getState().emotion.textPrompt.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(store.getState().emotion.textPrompt).not.toContain('\0');

    // persisted MMKV blob bounded (~cap + JSON key overhead, NOT the 50k blob)
    expect(serializeForPersist(store.getState().emotion).length).toBeLessThan(MAX_PROMPT_LENGTH + 200);

    // socket payload bounded — the 50k blob never crosses the wire
    const { client, created } = makeClient(store);
    client.connect();
    created[0].emitted.length = 0;
    client.requestPlaylist();
    const emotion = created[0].emitted.find((e) => e.event === 'emotion_update');
    expect(emotion?.payload.textPrompt.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
  });
});

// ═════ ATTACK 2: BACKGROUND-FOREGROUND DESYNC ═══════════════════════════════
describe('ATTACK 2: external track change + Bluetooth off, then foreground', () => {
  it('reconcile updates Now Playing to the truth and severs the dead biometric lane', async () => {
    const nowPlaying: any[] = [];
    const orch = new PlaybackOrchestrator({
      player: { play: async () => ({ ok: true }), pause: async () => ({ ok: true }), resume: async () => ({ ok: true }) },
      socket: { requestPlaylist: () => 1, requestHeartPlaylist: () => 1, ensureConnected: () => {} },
      queue: new PlaybackQueue(), onNowPlaying: (s) => nowPlaying.push(s),
    });
    await orch.handlePlaylist({ tracks: [{ id: 'a', uri: 'spotify:track:a', title: 'a', artist: 'x' }] });
    const warm = createWarmStore();
    warm.getState().setLiveHr(120);

    await reconcileOnForeground({
      orchestrator: orch, warmStore: warm,
      readPlayback: async () => ({ isPlaying: true, uri: 'spotify:track:FOREIGN' }),
      readPermissions: async () => ({ bluetooth: 'denied', health: 'granted' }),
    });

    expect(orch.getNowPlaying().isPlaying).toBe(false);   // foreign track → not ours
    expect(warm.getState().biometricSource).toBe('none'); // dead biometric lane
    expect(warm.getState().liveHr).toBeNull();
  });
});

// ═════ ATTACK 3: RAPID CONTEXT SWITCHING ═════════════════════════════════════
describe('ATTACK 3: spam activity + prompt as a generation fires', () => {
  it('the payload carries the EXACT committed state at the instant the request is sent', () => {
    const store = makeStore();
    const { client, created } = makeClient(store);
    client.connect();

    // frantic switching
    store.dispatch(setActivity('running'));
    store.dispatch(setTextPrompt('fast'));
    store.dispatch(setActivity('resting'));
    store.dispatch(setTextPrompt('calm now'));
    store.dispatch(addTap({ x: 0.3, y: 0.3 }));

    created[0].emitted.length = 0;
    client.requestPlaylist(); // fires at THIS instant

    const emotion = created[0].emitted.find((e) => e.event === 'emotion_update');
    expect(emotion?.payload).toEqual({ taps: [{ x: 0.3, y: 0.3 }], textPrompt: 'calm now', activity: 'resting' });
  });
});

// ═════ ATTACK 4 (autonomous): biometric revocation must not lie about the socket
describe('ATTACK 4 (autonomous): turning off Bluetooth must not fake a socket disconnect', () => {
  it('severs biometrics but leaves the independent server-socket connection intact', () => {
    const warm = createWarmStore();
    warm.getState().setConnection('connected'); // the Kokonada server socket is up
    warm.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    warm.getState().setBiometricSource('ble');
    warm.getState().setLiveHr(80);

    // user turns off Bluetooth (kills the biometric transport only)
    warm.getState().setPermissions({ bluetooth: 'denied', health: 'granted' });

    expect(warm.getState().biometricSource).toBe('none'); // biometric lane down
    expect(warm.getState().liveHr).toBeNull();
    expect(warm.getState().connection).toBe('connected'); // socket lane UNTOUCHED — no false disconnect
  });
});

// ═════ ATTACK 5 (autonomous): control-only / whitespace prompt is not "input" ═
describe('ATTACK 5 (autonomous): a prompt of only control bytes is empty intent', () => {
  it('a prompt of only null/control bytes sanitizes to empty and is not committed input', () => {
    const store = makeStore();
    store.dispatch(setTextPrompt('\0\x01\x1f\x7f'));
    expect(store.getState().emotion.textPrompt).toBe('');
  });
});
