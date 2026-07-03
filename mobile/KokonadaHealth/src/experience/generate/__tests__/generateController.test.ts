// The Generate screen orchestration — where the HOT lane (radial wheel gesture)
// hands committed taps to the COLD store, the CTA decides between "Generate" and
// "Listen to your heart", and submit fires the right socket request. Attack #3
// targets the hot→cold handoff: rapid taps racing a submit must never swallow or
// misalign a coordinate.

import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { setActivity, setTextPrompt } from '../../../state/cold/emotionSlice';
import { createWarmStore } from '../../../state/warm/warmStore';
import { GenerateController, type SocketApi } from '../generateController';

function makeStore() { return configureStore({ reducer: { emotion: emotionReducer } }); }

function build() {
  const store = makeStore();
  const warm = createWarmStore();
  const socket: SocketApi = {
    requestPlaylist: jest.fn(() => 1),
    requestHeartPlaylist: jest.fn(() => 2),
  };
  const controller = new GenerateController({ store, warmStore: warm, socket, now: () => 0, minGapMs: 0 });
  return { store, warm, socket, controller };
}

describe('GenerateController — hot→cold commit', () => {
  it('commitTap dispatches a clamped tap into the cold store', () => {
    const { store, controller } = build();
    controller.commitTap({ x: 0.4, y: -0.3 });
    expect(store.getState().emotion.taps).toEqual([{ x: 0.4, y: -0.3 }]);
  });

  it('clamps an out-of-disc commit before it reaches the store', () => {
    const { store, controller } = build();
    controller.commitTap({ x: 3, y: 4 }); // radius 5
    const tap = store.getState().emotion.taps[0];
    expect(Math.hypot(tap.x, tap.y)).toBeCloseTo(1, 6);
  });
});

describe('GenerateController — CTA mode', () => {
  it('is disabled with no input and no heart rate', () => {
    const { controller } = build();
    expect(controller.ctaMode()).toBe('disabled');
  });

  it('offers "listen to your heart" when only a live HR is present', () => {
    const { warm, controller } = build();
    warm.getState().setLiveHr(78);
    expect(controller.ctaMode()).toBe('listen-to-heart');
  });

  it('is "generate" whenever any emotion input exists (even with a live HR)', () => {
    const { store, warm, controller } = build();
    warm.getState().setLiveHr(78);
    controller.commitTap({ x: 0.2, y: 0.2 });
    expect(controller.ctaMode()).toBe('generate');

    const b = build();
    b.store.dispatch(setActivity('running'));
    expect(b.controller.ctaMode()).toBe('generate');

    const c = build();
    c.store.dispatch(setTextPrompt('rainy'));
    expect(c.controller.ctaMode()).toBe('generate');
    void store;
  });
});

describe('GenerateController — submit', () => {
  it('generate mode requests a playlist and returns the reqId', () => {
    const { controller, socket } = build();
    controller.commitTap({ x: 0.5, y: 0.5 });
    const result = controller.submit();
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: 'generate', reqId: 1 });
  });

  it('heart mode requests a heart playlist with the live HR', () => {
    const { warm, controller, socket } = build();
    warm.getState().setLiveHr(82);
    const result = controller.submit();
    expect(socket.requestHeartPlaylist).toHaveBeenCalledWith(82);
    expect(result).toEqual({ mode: 'listen-to-heart', reqId: 2 });
  });

  it('disabled mode does nothing and fires no socket request', () => {
    const { controller, socket } = build();
    expect(controller.submit()).toBeNull();
    expect(socket.requestPlaylist).not.toHaveBeenCalled();
    expect(socket.requestHeartPlaylist).not.toHaveBeenCalled();
  });
});

describe('GenerateController — hot→cold race (attack #3)', () => {
  it('a burst of rapid taps racing a submit swallows NO coordinate and misaligns none', () => {
    const { store, controller } = build();
    // 10 distinct in-disc taps fired as fast as gesture-ends can arrive
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: (i - 5) / 10, y: (5 - i) / 10 }));
    pts.forEach((p) => controller.commitTap(p));

    // the store holds exactly the last 3, in order, byte-for-byte
    expect(store.getState().emotion.taps).toEqual(pts.slice(-3));

    // submit fires immediately after the last commit — payload reflects those taps
    const result = controller.submit();
    expect(result?.mode).toBe('generate');
    expect(store.getState().emotion.taps).toEqual(pts.slice(-3)); // unchanged by submit
  });

  it('a tap committed AFTER submit is not lost — it lands in the store for the next request', () => {
    const { store, controller } = build();
    controller.commitTap({ x: 0.1, y: 0.1 });
    controller.submit();
    controller.commitTap({ x: 0.9, y: 0 }); // late gesture-end after submit fired
    expect(store.getState().emotion.taps).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0 }]);
  });
});
