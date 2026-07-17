import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

// AppFlow is the 4-state boot/route machine that replaces App's old `user ? tabs : signin`
// ternary. It shows the JS splash while ignition settles, holds one inhale, then resolves
// to onboarding / signin / app. The child screens are heavy (navigation, native surfaces),
// so they are stubbed to markers — this suite pins ROUTING, not screen internals.
//
// Timing is driven with FAKE timers so the `Promise.race → BootSplash.hide → dwell`
// sequence is deterministic — no real-clock sleeps racing microtasks (no flake).

const marker = (testID: string) => () => React.createElement(View, { testID });
jest.mock('../../prodBootstrap', () => ({ startApp: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../splash/SplashScreen', () => ({ SplashScreen: marker('route-splash') }));
jest.mock('../../onboarding/OnboardingScreen', () => ({ OnboardingScreen: marker('route-onboarding') }));
jest.mock('../../auth/SignInScreen', () => ({ SignInScreen: marker('route-signin') }));
// A render-COUNTING mock (not a plain marker) so a test can assert the connect screen is NEVER
// rendered on the sacred boot path — proving the gate hydrates BEFORE the splash dwell resolves.
// It wraps the same `marker` the other routes use (a direct React reference isn't allowed in a
// jest.mock factory; only the `marker` helper and mock-prefixed vars are).
let mockConnectRenders = 0;
jest.mock('../../experience/connect/ConnectServicesScreen', () => {
  const render = marker('route-connect');
  return { ConnectServicesScreen: () => { mockConnectRenders += 1; return render(); } };
});
jest.mock('../RootNavigator', () => ({ __esModule: true, default: marker('route-app') }));
jest.mock('../../experience/playback/AppLifecycle', () => ({ AppLifecycle: () => null }));

import BootSplash from 'react-native-bootsplash';
import { AppFlow, SPLASH_DWELL_MS } from '../AppFlow';
import { motion } from '../../design/tokens';
import { currentUserStore } from '../../auth/currentUser';
import { onboardingStore } from '../../onboarding/onboardingStore';
import { connectStore } from '../../experience/connect/connectStore';

const USER = { id: 'u1', displayName: 'Dan', email: 'd@x.io' };
const has = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id).length > 0;

type Props = Partial<React.ComponentProps<typeof AppFlow>>;
async function mount(props: Props) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<AppFlow {...props} />); });
  return tree;
}
// deterministically advance ignition (flush the start→race→hide→dwell chain) by `ms`.
async function advance(ms: number) {
  await ReactTestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}
// mount + resolve the route (0ms dwell fires immediately).
async function renderResolved(props: Props = {}) {
  const tree = await mount({ dwellMs: 0, ...props });
  await advance(50);
  return tree;
}

beforeEach(() => {
  jest.useFakeTimers();
  (BootSplash.hide as jest.Mock).mockReset();
  (BootSplash.hide as jest.Mock).mockResolvedValue(undefined);
  currentUserStore.setState({ user: null });
  onboardingStore.setState({ seen: false });
  connectStore.setState({ resolved: false, moodOnly: false });
  mockConnectRenders = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('AppFlow — 4-state route machine', () => {
  it('the splash dwell is the brand breath / 3 (a single inhale), derived from the token', () => {
    expect(SPLASH_DWELL_MS).toBe(Math.round(motion.duration.breath / 3));
  });

  it('holds on the splash until ignition settles + the dwell elapses (no premature route)', async () => {
    const tree = await mount({ dwellMs: 100000 });
    await advance(50); // ignition settles + hide fires, but the long dwell has NOT elapsed
    expect(has(tree, 'route-splash')).toBe(true);
    expect(has(tree, 'route-onboarding')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('first run (no user, never seen) resolves to onboarding', async () => {
    const tree = await renderResolved();
    expect(has(tree, 'route-onboarding')).toBe(true);
    expect(has(tree, 'route-splash')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('returning but logged-out (never a user, onboarding already seen) resolves to signin', async () => {
    onboardingStore.setState({ seen: true });
    const tree = await renderResolved();
    expect(has(tree, 'route-signin')).toBe(true);
    expect(has(tree, 'route-onboarding')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a recovered AND resolved session (user present, connect done) resolves to the app', async () => {
    currentUserStore.setState({ user: USER });
    connectStore.setState({ resolved: true });
    const tree = await renderResolved();
    expect(has(tree, 'route-app')).toBe(true);
    expect(has(tree, 'route-connect')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a signed-in but UNRESOLVED session lands on Connect Services (§4), not the app', async () => {
    currentUserStore.setState({ user: USER }); // connectStore stays unresolved (beforeEach)
    const tree = await renderResolved();
    expect(has(tree, 'route-connect')).toBe(true);
    expect(has(tree, 'route-app')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('resolving Connect (markResolved) flips the route connect → app', async () => {
    currentUserStore.setState({ user: USER });
    const tree = await renderResolved();
    expect(has(tree, 'route-connect')).toBe(true);
    await ReactTestRenderer.act(async () => { connectStore.getState().markResolved(); });
    expect(has(tree, 'route-app')).toBe(true);
    expect(has(tree, 'route-connect')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('choosing mood-only (setMoodOnly) also flips the route connect → app', async () => {
    currentUserStore.setState({ user: USER });
    const tree = await renderResolved();
    expect(has(tree, 'route-connect')).toBe(true);
    await ReactTestRenderer.act(async () => { connectStore.getState().setMoodOnly(); });
    expect(has(tree, 'route-app')).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('REGRESSION: logout returns to SIGNIN, never onboarding OR the post-auth connect screen', async () => {
    onboardingStore.setState({ seen: true });
    currentUserStore.setState({ user: USER });
    connectStore.setState({ resolved: true });
    const tree = await renderResolved();
    expect(has(tree, 'route-app')).toBe(true);
    // user logs out — connectResolved is inert without a user
    await ReactTestRenderer.act(async () => { currentUserStore.getState().clear(); });
    expect(has(tree, 'route-signin')).toBe(true);
    expect(has(tree, 'route-onboarding')).toBe(false);
    expect(has(tree, 'route-connect')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a recovered+resolved session renders the app with NO connect flash (resolved read before the dwell)', async () => {
    currentUserStore.setState({ user: USER });
    connectStore.setState({ resolved: true }); // as if bindConnectKV hydrated it before the dwell
    const tree = await renderResolved();
    // The dwell resolves straight to app — connect is never rendered.
    expect(has(tree, 'route-app')).toBe(true);
    expect(has(tree, 'route-connect')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('H2 no-flash: hydrating the gate DURING startup (bind-before-dwell) resolves to app, connect NEVER renders', async () => {
    onboardingStore.setState({ seen: true });
    // The real boot path hydrates identity + the connect gate INSIDE startApp — across its awaits,
    // AFTER AppFlow has attached its store subscriptions — and the dwell is raced against startApp,
    // so both facts land before phase flips to 'resolved'. Yield a microtask first to model that
    // ordering (a synchronous set would fire before AppFlow subscribes, unlike the real async boot).
    const start = jest.fn(async () => {
      await Promise.resolve();
      currentUserStore.getState().setUser(USER);
      connectStore.getState().markResolved();
    });
    const tree = await renderResolved({ start });
    expect(has(tree, 'route-app')).toBe(true);
    expect(has(tree, 'route-connect')).toBe(false);
    // The counting mock proves it: the connect screen was rendered ZERO times on the boot path.
    expect(mockConnectRenders).toBe(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('completing onboarding (markSeen) flips the route to signin', async () => {
    const tree = await renderResolved();
    expect(has(tree, 'route-onboarding')).toBe(true);
    await ReactTestRenderer.act(async () => { onboardingStore.getState().markSeen(); });
    expect(has(tree, 'route-signin')).toBe(true);
    expect(has(tree, 'route-onboarding')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('signing in from signin advances to Connect Services (§4) first, then the app once resolved', async () => {
    onboardingStore.setState({ seen: true });
    const tree = await renderResolved();
    expect(has(tree, 'route-signin')).toBe(true);
    // Fresh sign-in — connect is not yet resolved for this account, so setup shows first.
    await ReactTestRenderer.act(async () => { currentUserStore.getState().setUser(USER); });
    expect(has(tree, 'route-connect')).toBe(true);
    expect(has(tree, 'route-app')).toBe(false);
    // …and completing (or escaping) Connect advances to the app.
    await ReactTestRenderer.act(async () => { connectStore.getState().setMoodOnly(); });
    expect(has(tree, 'route-app')).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('AppFlow — native BootSplash hand-off (re-homed from App)', () => {
  it('hides the native BootSplash once ignition settles (revealing the JS splash)', async () => {
    const tree = await mount({ dwellMs: 100000, start: jest.fn().mockResolvedValue(undefined) });
    await advance(50);
    expect(BootSplash.hide).toHaveBeenCalledWith({ fade: true });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hides the native BootSplash even when ignition REJECTS (never trapped behind the splash)', async () => {
    const tree = await mount({ dwellMs: 100000, start: jest.fn().mockRejectedValue(new Error('bootstrap failed')) });
    await advance(50);
    expect(BootSplash.hide).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('advances the route even if BootSplash.hide throws SYNCHRONOUSLY (bad native build)', async () => {
    (BootSplash.hide as jest.Mock).mockImplementation(() => { throw new Error('native module missing'); });
    const tree = await renderResolved();
    expect(has(tree, 'route-onboarding')).toBe(true); // not stranded on the splash forever
    expect(has(tree, 'route-splash')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hides the native BootSplash on the deadline when ignition HANGS (no settle ever)', async () => {
    const tree = await mount({ dwellMs: 100000, splashDeadlineMs: 40, start: () => new Promise<void>(() => {}) });
    expect(BootSplash.hide).not.toHaveBeenCalled(); // not before the deadline
    await advance(60); // past the 40ms deadline → race resolves via the timeout
    expect(BootSplash.hide).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
