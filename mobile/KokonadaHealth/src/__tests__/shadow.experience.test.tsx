// ═══════════════════════════════════════════════════════════════════════════
// SHADOW AUDIT — Sprint A8 (RN Experience) — UI THREAD & NATIVE INTEGRATION ATTACK
// Frantic tapping under an erratic aura, Spotify remote severance mid-song, and
// the hot→cold handoff race — plus autonomously-discovered UI-lifecycle bugs.
// The Skia/Reanimated rendering is on-device; here we attack the pure logic those
// worklets/shaders invoke and the real component's subscription lifecycle.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer from '../state/cold/emotionSlice';
import { screenToCircumplex, isOnWheel, type WheelLayout } from '../experience/wheel/wheelGeometry';
import { deriveAuraUniforms, advancePulsePhase } from '../experience/aura/auraUniforms';
import { GenerateController } from '../experience/generate/generateController';
import { SpotifyPlayerController, type SpotifyRemoteLike } from '../experience/player/spotifyController';
import { createWarmStore } from '../state/warm/warmStore';
import { KokonadaSocket, type SocketLike } from '../net/socketClient';

const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });
const layout: WheelLayout = { cx: 170, cy: 170, radius: 170 };

// ═════ ATTACK 1: SKIA FRAME-RATE DROP — frantic multi-finger + erratic aura ═══
describe('ATTACK 1: frantic multi-finger tapping while the aura calculates HR spikes', () => {
  it('500 chaotic taps + erratic HR spikes never produce a NaN geometry or uniform', () => {
    const store = makeStore();
    const controller = new GenerateController({
      store, warmStore: createWarmStore(),
      socket: { requestPlaylist: () => 1, requestHeartPlaylist: () => 2 },
      now: () => 0, minGapMs: 0,
    });

    let phase = 0;
    for (let i = 0; i < 500; i++) {
      // multiple simultaneous fingers, some wildly off-canvas
      const points = [
        { x: Math.sin(i) * 400, y: Math.cos(i) * 400 },
        { x: (i * 37) % 500 - 100, y: (i * 53) % 500 - 100 },
        { x: NaN, y: i },
      ];
      for (const p of points) {
        if (isOnWheel(p, layout)) {
          const c = screenToCircumplex(p, layout);
          expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
          controller.commitTap(c);
        }
      }
      // aura recomputes on an erratic HR stream, advancing a dropped-frame clock
      const hr = [NaN, 0, 300, 55 + (i % 90), 9999, Infinity][i % 6];
      const u = deriveAuraUniforms(hr as number);
      expect(Number.isFinite(u.hue) && Number.isFinite(u.intensity) && u.pulseHz > 0).toBe(true);
      phase = advancePulsePhase(phase, u.pulseHz, (i % 7) * 20);
      expect(Number.isFinite(phase)).toBe(true);
    }
    // the cold buffer survived the barrage, still capped and valid
    const taps = store.getState().emotion.taps;
    expect(taps.length).toBeLessThanOrEqual(3);
    for (const t of taps) expect(Math.hypot(t.x, t.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

// ═════ ATTACK 2: SPOTIFY REMOTE SEVERANCE mid-song while the wheel spins ══════
describe('ATTACK 2: Spotify remote severed while the wheel is actively tapping', () => {
  class FlakyRemote implements SpotifyRemoteLike {
    connected = false; listeners = new Map<string, Array<(...a: any[]) => void>>();
    boom: Error | null = null;
    async connect() { this.connected = true; }
    async disconnect() { this.connected = false; }
    async isConnectedAsync() { return this.connected; }
    async playUri() { if (this.boom) throw this.boom; if (!this.connected) throw new Error('nc'); }
    async pause() { if (this.boom) throw this.boom; }
    async resume() { if (this.boom) throw this.boom; }
    addListener(e: string, cb: any) { const l = this.listeners.get(e) ?? []; l.push(cb); this.listeners.set(e, l); }
    removeAllListeners() { this.listeners.clear(); }
    sever() { this.connected = false; (this.listeners.get('remoteDisconnected') ?? []).forEach((c) => c()); }
  }

  it('severance + revoked auth while committing taps: no fatal throw, both lanes survive', async () => {
    const remote = new FlakyRemote();
    const player = new SpotifyPlayerController({ remote, getToken: async () => 'tok', onError: () => {} });
    const store = makeStore();
    const controller = new GenerateController({
      store, warmStore: createWarmStore(),
      socket: { requestPlaylist: () => 1, requestHeartPlaylist: () => 2 }, now: () => 0, minGapMs: 0,
    });

    await player.connect();
    controller.commitTap({ x: 0.2, y: 0.2 });

    // Spotify app killed mid-song, then every command auth-fails, while taps keep coming
    remote.sever();
    remote.boom = new Error('AUTHENTICATION_SERVICE_UNAVAILABLE');
    await expect(player.play('spotify:track:x')).resolves.toEqual({ ok: false });
    controller.commitTap({ x: 0.6, y: -0.1 });
    await expect(player.pause()).resolves.toEqual({ ok: false });

    expect(player.getState()).toBe('disconnected');            // player degraded
    expect(store.getState().emotion.taps).toHaveLength(2);     // wheel lane untouched
  });
});

// ═════ ATTACK 3: HOT-TO-COLD RACE ═══════════════════════════════════════════
describe('ATTACK 3: rapid taps racing a laneCommit handoff', () => {
  it('interleaving commits and submits swallows no coordinate and misaligns none', () => {
    const store = makeStore();
    const emitted: number[] = [];
    const controller = new GenerateController({
      store, warmStore: createWarmStore(),
      socket: { requestPlaylist: () => { emitted.push(store.getState().emotion.taps.length); return emitted.length; }, requestHeartPlaylist: () => 0 },
      now: () => 0, minGapMs: 0,
    });

    const seq: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 12; i++) {
      const p = { x: (i - 6) / 12, y: (6 - i) / 12 };
      seq.push(p);
      controller.commitTap(p);
      if (i % 4 === 3) controller.submit(); // submit races the tap stream
    }
    // final store state is exactly the last 3 committed, in order
    expect(store.getState().emotion.taps).toEqual(seq.slice(-3));
    // every submit saw a non-empty, valid buffer (never a torn/empty read)
    expect(emitted.every((n) => n >= 1 && n <= 3)).toBe(true);
  });
});

// ═════ ATTACK 4 (autonomous): generate/heart reqId cross-contamination ═══════
describe('ATTACK 4 (autonomous): mixing Generate and Listen-to-heart requests', () => {
  class FakeSocket implements SocketLike {
    handlers = new Map<string, Array<(p?: any) => void>>(); emitted: any[] = [];
    on(e: string, cb: any) { const l = this.handlers.get(e) ?? []; l.push(cb); this.handlers.set(e, l); }
    off(e: string, cb: any) { this.handlers.set(e, (this.handlers.get(e) ?? []).filter((h) => h !== cb)); }
    emit(e: string, p?: any) { this.emitted.push({ e, p }); }
    connect() { this.fire('connect'); } disconnect() {}
    fire(e: string, p?: any) { (this.handlers.get(e) ?? []).slice().forEach((c) => c(p)); }
  }

  it('a stale Generate response cannot render after the user switched to Listen-to-heart', () => {
    const created: FakeSocket[] = [];
    const onPlaylist = jest.fn();
    const client = new KokonadaSocket({
      createSocket: () => { const s = new FakeSocket(); created.push(s); return s; },
      getAccessToken: () => 'a', refreshToken: async () => 'b',
      getEmotionIntent: () => ({ taps: [{ x: 0.1, y: 0.1 }], textPrompt: '', activity: null }),
      onPlaylist, onLoggedOut: jest.fn(),
    });
    client.connect();
    const genId = client.requestPlaylist();      // user tapped Generate
    const heartId = client.requestHeartPlaylist(80); // then switched to the heart
    expect(heartId).not.toBe(genId);

    created[0].fire('playlist_ready', { reqId: genId, tracks: ['stale-generate'] });
    expect(onPlaylist).not.toHaveBeenCalled();    // the superseded generate is dropped
    created[0].fire('playlist_ready', { reqId: heartId, tracks: ['heart'] });
    expect(onPlaylist).toHaveBeenCalledWith(expect.objectContaining({ tracks: ['heart'] }));
  });
});

// ═════ ATTACK 5 (autonomous): watch flapping null↔spike every frame ══════════
describe('ATTACK 5 (autonomous): a flapping watch (null↔spike) never NaNs the aura', () => {
  it('alternating null and absurd HR keeps every uniform and the pulse finite', () => {
    let phase = 0;
    const stream = [null, 999, null, -10, NaN, 200, null, Infinity, 47];
    for (let i = 0; i < 300; i++) {
      const u = deriveAuraUniforms(stream[i % stream.length] as any);
      expect(Number.isFinite(u.hue) && Number.isFinite(u.intensity)).toBe(true);
      expect(u.pulseHz).toBeGreaterThan(0);
      phase = advancePulsePhase(phase, u.pulseHz, 16);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(2 * Math.PI);
    }
  });
});

// ═════ ATTACK 6 (autonomous): screen-unmount subscription lifecycle ══════════
describe('ATTACK 6 (autonomous): GenerateScreen warm-store subscription on unmount', () => {
  // The classic RN crash: a store subscription that outlives the component fires
  // setState into an unmounted tree (leak + "update on unmounted component"). The
  // screen must unsubscribe on unmount.
  it('unmounting the Generate tab unsubscribes from the warm store (every subscribe is cleaned up)', async () => {
    const { GenerateScreen } = require('../experience/generate/GenerateScreen');
    const { warmStore } = require('../state/store');
    const store = makeStore();

    // Track subscribe/unsubscribe parity on the shared warm-store singleton.
    // (React 18+ dropped the "setState on unmounted component" warning, so a leak
    // is silent at runtime — we must observe the subscription lifecycle directly.)
    let subs = 0;
    let unsubs = 0;
    const realSubscribe = warmStore.subscribe.bind(warmStore);
    const spy = jest.spyOn(warmStore, 'subscribe').mockImplementation((cb: any) => {
      subs += 1;
      const realUnsub = realSubscribe(cb);
      return () => { unsubs += 1; realUnsub(); };
    });

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <Provider store={store}><GenerateScreen /></Provider>,
      );
    });
    await ReactTestRenderer.act(async () => { tree.unmount(); });

    spy.mockRestore();
    expect(subs).toBeGreaterThan(0);   // it did subscribe for live HR
    expect(unsubs).toBe(subs);         // and cleaned up every subscription on unmount
  });
});
