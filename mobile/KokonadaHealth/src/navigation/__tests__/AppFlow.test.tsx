import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

// AppFlow is the 4-state boot/route machine that replaces App's old `user ? tabs : signin`
// ternary. It shows the JS splash while ignition settles, holds one inhale, then resolves
// to onboarding / signin / app. The child screens are heavy (navigation, native surfaces),
// so they are stubbed to markers — this suite pins ROUTING, not screen internals.

const marker = (testID: string) => () => React.createElement(View, { testID });
jest.mock('../../prodBootstrap', () => ({ startApp: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../splash/SplashScreen', () => ({ SplashScreen: marker('route-splash') }));
jest.mock('../../onboarding/OnboardingScreen', () => ({ OnboardingScreen: marker('route-onboarding') }));
jest.mock('../../auth/SignInScreen', () => ({ SignInScreen: marker('route-signin') }));
jest.mock('../RootNavigator', () => ({ __esModule: true, default: marker('route-app') }));
jest.mock('../../experience/playback/AppLifecycle', () => ({ AppLifecycle: () => null }));

import BootSplash from 'react-native-bootsplash';
import { AppFlow, SPLASH_DWELL_MS } from '../AppFlow';
import { motion } from '../../design/tokens';
import { currentUserStore } from '../../auth/currentUser';
import { onboardingStore } from '../../onboarding/onboardingStore';

const USER = { id: 'u1', displayName: 'Dan', email: 'd@x.io' };
const has = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id).length > 0;

// render, then let ignition settle + the (0ms) dwell fire so the route resolves.
async function renderResolved(dwellMs = 0) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<AppFlow dwellMs={dwellMs} />); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return tree;
}

beforeEach(() => {
  (BootSplash.hide as jest.Mock).mockClear();
  currentUserStore.setState({ user: null });
  onboardingStore.setState({ seen: false });
});

describe('AppFlow — 4-state route machine', () => {
  it('the splash dwell is the brand breath / 3 (a single inhale), derived from the token', () => {
    expect(SPLASH_DWELL_MS).toBe(Math.round(motion.duration.breath / 3));
  });

  it('holds on the splash until ignition settles + the dwell elapses (no premature route)', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    // a long dwell so we can observe the splash still up right after mount
    await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<AppFlow dwellMs={100000} />); });
    await ReactTestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 20)); });
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

  it('a recovered session (user present) resolves to the app', async () => {
    currentUserStore.setState({ user: USER });
    const tree = await renderResolved();
    expect(has(tree, 'route-app')).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('REGRESSION: logout returns to SIGNIN, never back to onboarding', async () => {
    onboardingStore.setState({ seen: true });
    currentUserStore.setState({ user: USER });
    const tree = await renderResolved();
    expect(has(tree, 'route-app')).toBe(true);
    // user logs out
    await ReactTestRenderer.act(async () => { currentUserStore.getState().clear(); });
    expect(has(tree, 'route-signin')).toBe(true);
    expect(has(tree, 'route-onboarding')).toBe(false);
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

  it('signing in from signin advances to the app', async () => {
    onboardingStore.setState({ seen: true });
    const tree = await renderResolved();
    expect(has(tree, 'route-signin')).toBe(true);
    await ReactTestRenderer.act(async () => { currentUserStore.getState().setUser(USER); });
    expect(has(tree, 'route-app')).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('AppFlow — native BootSplash hand-off (re-homed from App)', () => {
  it('hides the native BootSplash once ignition settles (revealing the JS splash)', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AppFlow dwellMs={100000} start={jest.fn().mockResolvedValue(undefined)} />);
    });
    await ReactTestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(BootSplash.hide).toHaveBeenCalledWith({ fade: true });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hides the native BootSplash even when ignition REJECTS (never trapped behind the splash)', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AppFlow dwellMs={100000} start={jest.fn().mockRejectedValue(new Error('bootstrap failed'))} />);
    });
    await ReactTestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(BootSplash.hide).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hides the native BootSplash on the deadline when ignition HANGS (no settle ever)', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AppFlow dwellMs={100000} splashDeadlineMs={40} start={() => new Promise<void>(() => {})} />);
    });
    expect(BootSplash.hide).not.toHaveBeenCalled(); // not before the deadline
    await ReactTestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(BootSplash.hide).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
