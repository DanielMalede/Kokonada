import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Animated } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Deterministic theme + motion (real useColorScheme/useReduceMotion resolve async under jest). The
// mock is shared by the dock AND the OfflineBanner beneath it (both import design/theme), so one
// switch controls reduced-motion for the whole shell under test.
jest.mock('../../design/theme', () => ({ useTheme: jest.fn(), useMotion: jest.fn() }));

import { SystemStateDock } from '../SystemStateDock';
import { OFFLINE_GRACE_MS } from '../../design/system/OfflineBanner';
import { createWarmStore } from '../../state/warm/warmStore';
import { useTheme, useMotion } from '../../design/theme';
import { colors, motion } from '../../design/tokens';

const TOP = 47;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: TOP, left: 0, right: 0, bottom: 34 } };

jest.useFakeTimers();
beforeEach(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();
  (useTheme as jest.Mock).mockReturnValue({ name: 'dark', c: colors.dark });
  (useMotion as jest.Mock).mockReturnValue({ reduced: false, duration: motion.duration });
});
afterAll(() => { jest.useRealTimers(); });

type Store = ReturnType<typeof createWarmStore>;
async function mount(store: Store, onRetry?: () => void) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SystemStateDock store={store} onRetry={onRetry} />
      </SafeAreaProvider>,
    );
  });
  return tree;
}
async function advance(ms: number) { await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(ms); }); }
const host = (n: any) => typeof n.type === 'string';
const flat = (node: any): Record<string, any> => {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
};
const banner = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => host(n) && n.props?.testID === 'offline-banner')[0];
const dock = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => host(n) && n.props?.testID === 'system-state-dock')[0];

describe('SystemStateDock — the live system-state shell (E2)', () => {
  it('(a) warmStore disconnect surfaces the banner after ONE grace window (single debounce, not double)', async () => {
    const store = createWarmStore();
    store.getState().setConnection('connected'); // start online → banner hidden
    const tree = await mount(store);
    expect(banner(tree)).toBeUndefined();
    await ReactTestRenderer.act(async () => { store.getState().setConnection('disconnected'); });
    await advance(OFFLINE_GRACE_MS - 1);
    expect(banner(tree)).toBeUndefined();       // still inside the SINGLE grace
    await advance(1);
    expect(banner(tree)).toBeTruthy();          // visible after exactly one grace — not re-debounced
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(b) a transient blip (disconnect→reconnect within grace) is swallowed — the banner never shows', async () => {
    const store = createWarmStore();
    store.getState().setConnection('connected');
    const tree = await mount(store);
    await ReactTestRenderer.act(async () => { store.getState().setConnection('disconnected'); });
    await advance(OFFLINE_GRACE_MS - 200);
    await ReactTestRenderer.act(async () => { store.getState().setConnection('connected'); }); // recovered in time
    await advance(2000);
    expect(banner(tree)).toBeUndefined();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(c) the dock sits at the TOP safe-area inset (never under the status bar)', async () => {
    const store = createWarmStore();
    const tree = await mount(store);
    expect(flat(dock(tree)).paddingTop).toBe(TOP);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(d) DISPLAY-ONLY: the dock reads connection but NEVER mutates it (no setConnection)', async () => {
    const store = createWarmStore(); // default connection = 'disconnected'
    const setSpy = jest.spyOn(store.getState(), 'setConnection');
    const onRetry = jest.fn();
    const tree = await mount(store, onRetry);
    await advance(OFFLINE_GRACE_MS);
    expect(banner(tree)).toBeTruthy();
    // pressing Retry routes to the injected reconnect entry — still no store mutation from the dock
    const retry = tree.root.findAll((n) => host(n) && n.props?.testID === 'offline-retry')[0];
    await ReactTestRenderer.act(async () => { retry.props.onClick?.(); retry.parent?.props?.onPress?.(); });
    expect(setSpy).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(e) disposes the warmStore subscription on unmount (no leak)', async () => {
    const store = createWarmStore();
    const realSubscribe = store.subscribe.bind(store);
    const unsub = jest.fn();
    jest.spyOn(store, 'subscribe').mockImplementation((l: any) => { const u = realSubscribe(l); return () => { unsub(); u(); }; });
    const tree = await mount(store);
    expect(store.subscribe).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    expect(unsub).toHaveBeenCalled();
  });

  it('(f) reduced-motion → the slide SNAPS (no Animated.timing) and the layout is unchanged', async () => {
    (useMotion as jest.Mock).mockReturnValue({ reduced: true, duration: motion.durationReduced });
    const timingSpy = jest.spyOn(Animated, 'timing');
    const store = createWarmStore();
    store.getState().setConnection('connected');
    const tree = await mount(store);
    await ReactTestRenderer.act(async () => { store.getState().setConnection('disconnected'); });
    await advance(OFFLINE_GRACE_MS);
    expect(banner(tree)).toBeTruthy();               // present, snapped in
    expect(timingSpy).not.toHaveBeenCalled();        // no slide/fade animation under reduced motion
    expect(flat(dock(tree)).paddingTop).toBe(TOP);   // layout unchanged
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    timingSpy.mockRestore();
  });

  it('(g) the calm appear SLIDE animates when motion is on (translateY + opacity via Animated)', async () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    const store = createWarmStore();
    store.getState().setConnection('connected');
    const tree = await mount(store);
    await ReactTestRenderer.act(async () => { store.getState().setConnection('disconnected'); });
    await advance(OFFLINE_GRACE_MS);
    expect(banner(tree)).toBeTruthy();
    expect(timingSpy).toHaveBeenCalled();            // the visible edge drove the slide-in
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    timingSpy.mockRestore();
  });
});
