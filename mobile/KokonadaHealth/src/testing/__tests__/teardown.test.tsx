/// <reference types="node" />
import React, { useEffect, useState } from 'react';
import * as path from 'path';
import * as RN from 'react-native';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFrameCallback } from 'react-native-reanimated';
import { useMotion } from '../../design/theme';
import { useCalmPulse } from '../../design/system/useCalmPulse';
import { createWarmStore, type WarmStore } from '../../state/warm/warmStore';
import { SystemStateDock } from '../../navigation/SystemStateDock';
import { TAB_ROUTES } from '../../navigation/tabRoutes';
import { FakeSocketServer, type FakeSocket } from '../socket';
import { APP_ROOT, productionFiles } from '../guards/productionImports';
import { loadMutant } from '../mutant';
import { installTeardownProbes, missingRouteFixtures, navigatorRoutes, ROUTE_FIXTURES, type TeardownProbes } from '../teardown';

// A test that plants a mutant loads @babel/core inside the test VM on first use (src/testing/mutant.ts);
// under full-suite worker contention that cold load overran the 5 s default (q3-final-jest run file),
// so only those tests get MUTANT_TIMEOUT_MS; every other test keeps the default.
const MUTANT_TIMEOUT_MS = 30000;

// QA-103 (S10-1): every subscription, listener, loop, timer and clock a page opens is closed on
// unmount. The harness composes the shared fakes (QA-044 platform, QA-045 stores and socket, QA-046
// motion) with a timer registry, snapshots every live count before mount, and compares after unmount,
// naming each category that changed. Per-screen pins today hand-enumerate a subset
// (GenerateScreen.test.tsx:660-692 misses AccessibilityInfo and useMotion).
// Pass rule: every route: live counts after unmount == before mount. The route manifest reads the
// routes from the real navigator; a page registers its fixture in ROUTE_FIXTURES when it lands
// (v2 pages are not on main yet, D8 rule 3).

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

let probes: TeardownProbes;
let server: FakeSocketServer;
beforeEach(() => {
  server = new FakeSocketServer({ validTokens: ['t'] });
  probes = installTeardownProbes({ sockets: server });
});
afterEach(() => { probes.restore(); });

type Leak = 'none' | 'platform' | 'store' | 'socket' | 'frameCallback' | 'loop' | 'timer' | 'interval';

// One component that opens one of everything, and a `leak` that skips exactly one cleanup.
function Page({ store, socket, leak }: { store: WarmStore; socket: FakeSocket; leak: Leak }) {
  const { reduced } = useMotion();                                     // AccessibilityInfo listener (closed by useMotion)
  useCalmPulse(false, 2000, { rest: 0.3, peak: 1, still: 0.6 });       // an RN Animated loop (stopped by useCalmPulse)
  const frame = useFrameCallback(() => {}, true);                       // a frame callback (unregistered on unmount)
  void frame;
  const [, setN] = useState(0);
  useEffect(() => {
    const kb = RN.Keyboard.addListener('keyboardDidShow', () => {});
    const off = store.subscribe(() => setN((n) => n + 1));
    const onReady = () => {};
    socket.on('playlist_ready', onReady);
    const t = setTimeout(() => {}, 60_000);
    const i = setInterval(() => {}, 1_000);
    return () => {
      if (leak !== 'platform') kb.remove();
      if (leak !== 'store') off();
      if (leak !== 'socket') socket.off('playlist_ready', onReady);
      if (leak !== 'timer') clearTimeout(t);
      if (leak !== 'interval') clearInterval(i);
    };
  }, [store, socket, leak]);
  return <Text>{reduced ? 'still' : 'live'}</Text>;
}
// A leaked frame callback or loop needs a source the component does not clean up.
function LeakyExtras({ leak }: { leak: Leak }) {
  useEffect(() => {
    if (leak === 'loop') RN.Animated.loop(RN.Animated.timing(new RN.Animated.Value(0), { toValue: 1, duration: 500, useNativeDriver: true })).start();
  }, [leak]);
  return null;
}

async function mountPage(leak: Leak) {
  const store = createWarmStore();
  const s = server.createSocket('t') as FakeSocket;
  const tracker = probes.trackStore(store, 'page-warm');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { tree = ReactTestRenderer.create(<><Page store={store} socket={s} leak={leak} /><LeakyExtras leak={leak} /></>); });
  return { tree, tracker };
}

describe('QA-103 · teardown parity across every category', () => {
  it('a page that closes everything it opens: live counts after unmount == before mount', async () => {
    const before = probes.snapshot();
    const { tree } = await mountPage('none');
    const during = probes.snapshot();
    expect(during.platform.AccessibilityInfo).toBe(before.platform.AccessibilityInfo + 1);
    expect(during.platform.Keyboard).toBe(before.platform.Keyboard + 1);
    expect(during.extraStores['page-warm']).toBe(1);
    expect(during.socketListeners).toBe(before.socketListeners + 1);
    expect(during.loops).toBe(before.loops + 1);
    expect(during.frameCallbacks).toBe(before.frameCallbacks + 1);
    expect(during.timers).toBeGreaterThanOrEqual(before.timers + 2);
    await act(async () => { tree.unmount(); });
    expect(() => probes.assertParity(before)).not.toThrow();
  });

  it.each([
    ['platform', /platform\.Keyboard: 1 more/],
    ['store', /store page-warm: 1 more/],
    ['socket', /socket listeners: 1 more/],
    ['timer', /timers: 1 more/],
    ['interval', /timers: 1 more/],
    ['loop', /RN Animated loops: 1 more/],
  ] as Array<[Leak, RegExp]>)('planted: a %s left open after unmount fails parity, naming it', async (leak, message) => {
    const before = probes.snapshot();
    const { tree } = await mountPage(leak);
    await act(async () => { tree.unmount(); });
    expect(() => probes.assertParity(before)).toThrow(message);
  });

  it('planted: a frame callback kept alive by an owner that outlives the page fails parity', async () => {
    const before = probes.snapshot();
    const handles: Array<{ setActive(a: boolean): void }> = [];
    function Owner({ children }: { children: React.ReactNode }) { handles.push(useFrameCallback(() => {}, true)); return <>{children}</>; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<Owner><Text>page</Text></Owner>); });
    // "unmount the page" but the owner (a navigator-level host, say) stays: the callback stays registered
    expect(() => probes.assertParity(before)).toThrow(/frame callbacks: 1 more/);
    await act(async () => { tree.unmount(); });
    expect(() => probes.assertParity(before)).not.toThrow();
  });

  it('a real production component passes: SystemStateDock (useMotion, a store subscription, an Animated timing)', async () => {
    const warm = createWarmStore();
    probes.trackStore(warm, 'dock-warm');
    const before = probes.snapshot();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={METRICS}><SystemStateDock store={warm} /></SafeAreaProvider>); });
    await act(async () => { tree.unmount(); });
    expect(() => probes.assertParity(before)).not.toThrow();
  });

  it('planted: the same component with its store unsubscribe removed (in memory) fails parity', async () => {
    const { SystemStateDock: Mutant } = loadMutant<typeof import('../../navigation/SystemStateDock')>(
      path.join(APP_ROOT, 'src/navigation/SystemStateDock.tsx'),
      [{ find: 'return () => { mounted = false; off(); };', replace: 'return () => { mounted = false; };' }],
      require,
    );
    const warm = createWarmStore();
    probes.trackStore(warm, 'dock-warm');
    const before = probes.snapshot();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={METRICS}><Mutant store={warm} /></SafeAreaProvider>); });
    await act(async () => { tree.unmount(); });
    expect(() => probes.assertParity(before)).toThrow(/store dock-warm: 1 more/);
  }, MUTANT_TIMEOUT_MS);

  it('the timer registry follows real timers: a fired timeout is no longer live', async () => {
    const before = probes.snapshot();
    await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
    expect(probes.snapshot().timers).toBe(before.timers);
  });
});

describe('QA-103 · the route manifest', () => {
  it('reads the routes from the real navigator (a scan that finds nothing must fail, not pass)', () => {
    const routes = navigatorRoutes(productionFiles());
    expect(routes.length).toBeGreaterThanOrEqual(5);
    expect(routes).toEqual(expect.arrayContaining([...TAB_ROUTES]));
  });

  it('planted: a navigator route with no registered fixture is reported', () => {
    const quote = String.fromCharCode(39);
    const planted = 'export const N = () => <Tab.Navigator><Tab.Screen name=' + quote + 'Planted' + quote + ' component={X} /></Tab.Navigator>;';
    const file = path.join(APP_ROOT, 'src/navigation/PlantedNavigator.tsx');
    const routes = navigatorRoutes([file], () => planted);
    expect(routes).toEqual(['Planted']);
    expect(missingRouteFixtures(routes, { Other: () => null })).toEqual(['Planted']);
    expect(missingRouteFixtures(routes, { Planted: () => null })).toEqual([]);
  });

  it('starts empty: pages register their fixtures as they land (D8 rule 3; the per-route run is owed at P1)', () => {
    expect(Object.keys(ROUTE_FIXTURES)).toEqual([]);
  });
});
