// ═══════════════════════════════════════════════════════════════════════════
// SACRED CONTRACT REGRESSION (T9) — the emotion→socket payload is byte-for-byte.
// The §5/§6 redesign adds local-only undo/clear + a reactive accent + Genesis, and
// must NOT perturb the wire: emotion_update = {taps,textPrompt,activity} (≤3 taps),
// request_playlist = {reqId}, emitted ONLY at connect and immediately before a
// request — never per tap/undo/clear. This test drives the REAL store + reducers +
// KokonadaSocket through the full undo/clear/re-tap dance and pins the payload.
// ═══════════════════════════════════════════════════════════════════════════

import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, {
  addTap, undoTap, clearTaps, setActivity, setTextPrompt, resetEmotion,
} from '../state/cold/emotionSlice';
import { KokonadaSocket, type SocketLike } from '../net/socketClient';

const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });

class FakeSocket implements SocketLike {
  handlers = new Map<string, Array<(p?: any) => void>>();
  emitted: Array<{ event: string; payload?: any }> = [];
  on(e: string, cb: any) { const l = this.handlers.get(e) ?? []; l.push(cb); this.handlers.set(e, l); }
  off(e: string, cb: any) { this.handlers.set(e, (this.handlers.get(e) ?? []).filter((h) => h !== cb)); }
  emit(e: string, p?: any) { this.emitted.push({ event: e, payload: p }); }
  connect() { this.fire('connect'); } disconnect() {}
  fire(e: string, p?: any) { (this.handlers.get(e) ?? []).slice().forEach((c) => c(p)); }
  clientEmits(e: string) { return this.emitted.filter((x) => x.event === e); }
}

function build(store: ReturnType<typeof makeStore>) {
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

describe('SACRED — undo/clear/re-tap never perturb the emotion→socket payload', () => {
  it('after addTap×3 → undoTap → clearTaps → addTap the payload is EXACTLY {taps,textPrompt,activity}, ≤3 taps', () => {
    const store = makeStore();
    const { client, created } = build(store);
    client.connect();
    const sock = created[0];

    // The full §5 dance — every step is local cold-state only.
    store.dispatch(addTap({ x: 0.1, y: 0.1 }));
    store.dispatch(addTap({ x: 0.2, y: 0.2 }));
    store.dispatch(addTap({ x: 0.3, y: 0.3 }));       // buffer full (3)
    expect(store.getState().emotion.taps).toHaveLength(3);
    store.dispatch(undoTap());                          // 2
    store.dispatch(clearTaps());                        // 0 (activity/prompt still intact)
    store.dispatch(addTap({ x: 0.4, y: -0.4 }));        // 1
    store.dispatch(setActivity('running'));
    store.dispatch(setTextPrompt('rainy'));

    // NOT ONE emit was produced by any tap/undo/clear — the wire is silent until a request.
    sock.emitted.length = 0;
    expect(sock.clientEmits('emotion_update')).toHaveLength(0);
    expect(sock.clientEmits('request_playlist')).toHaveLength(0);

    const reqId = client.requestPlaylist();

    // emotion_update THEN request_playlist, in order, byte-for-byte.
    expect(sock.emitted.map((e) => e.event)).toEqual(['emotion_update', 'request_playlist']);
    const emotion = sock.clientEmits('emotion_update')[0];
    expect(emotion.payload).toEqual({ taps: [{ x: 0.4, y: -0.4 }], textPrompt: 'rainy', activity: 'running' });
    expect(emotion.payload.taps.length).toBeLessThanOrEqual(3);
    expect(sock.clientEmits('request_playlist')[0].payload).toEqual({ reqId });
  });

  it('a 4th tap after the dance still caps at 3 — undo/clear can only shrink, never lift the cap', () => {
    const store = makeStore();
    const { client, created } = build(store);
    client.connect();
    const sock = created[0];

    for (const x of [0.1, 0.2, 0.3]) store.dispatch(addTap({ x, y: 0 }));
    store.dispatch(undoTap());
    for (const x of [0.5, 0.6, 0.7, 0.8]) store.dispatch(addTap({ x, y: 0 })); // spam past the cap
    sock.emitted.length = 0;
    client.requestPlaylist();

    const payload = sock.clientEmits('emotion_update')[0].payload;
    expect(payload.taps).toHaveLength(3);                          // hard cap holds
    expect(payload.taps.map((t: any) => t.x)).toEqual([0.6, 0.7, 0.8]); // oldest evicted, order preserved
  });

  it('resetEmotion still wipes all three lanes (logout semantics unchanged by the new reducers)', () => {
    const store = makeStore();
    store.dispatch(addTap({ x: 0.4, y: 0.4 }));
    store.dispatch(setActivity('focus'));
    store.dispatch(setTextPrompt('deep'));
    store.dispatch(resetEmotion());
    expect(store.getState().emotion).toEqual({ taps: [], activity: null, textPrompt: '' });
  });

  it('clearTaps is NOT resetEmotion — it preserves activity + prompt (distinct semantics)', () => {
    const store = makeStore();
    store.dispatch(addTap({ x: 0.4, y: 0.4 }));
    store.dispatch(setActivity('focus'));
    store.dispatch(setTextPrompt('deep'));
    store.dispatch(clearTaps());
    expect(store.getState().emotion).toEqual({ taps: [], activity: 'focus', textPrompt: 'deep' });
  });
});
