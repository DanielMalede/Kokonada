import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo, Platform } from 'react-native';

jest.setTimeout(20000); // cold-require headroom for CI (same rationale as ProfileScreen, #84)

jest.mock('../auth', () => ({ signInWithGoogle: jest.fn(), signInWithApple: jest.fn() }));
jest.mock('../currentUser', () => ({ currentUserStore: { getState: () => ({ setUser: jest.fn() }) } }));
jest.mock('../../prodBootstrap', () => ({ onSignedIn: jest.fn().mockResolvedValue(undefined) }));

import { AppleButton } from '@invertase/react-native-apple-authentication';
import { SignInScreen } from '../SignInScreen';
import { signInWithGoogle, signInWithApple } from '../auth';
import { currentUserStore } from '../currentUser';
import { onSignedIn } from '../../prodBootstrap';
import * as theme from '../../design/theme';

const signIn = signInWithGoogle as jest.Mock;
const signInApple = signInWithApple as jest.Mock;

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label)[0];

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<SignInScreen />); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  signIn.mockResolvedValue({ id: 'u1', displayName: 'Dan', email: 'd@x.io' });
});

describe('SignInScreen (Wave 2.8 reskin — logic contract preserved)', () => {
  it('renders the wordmark and a labelled Continue with Google button', async () => {
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Kokonada');
    expect(byLabel(tree, 'Continue with Google')).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('press drives the UNCHANGED flow: signInWithGoogle → setUser → onSignedIn', async () => {
    const setUser = jest.fn();
    (currentUserStore.getState as any) = () => ({ setUser });
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'Continue with Google').props.onPress(); });
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith({ id: 'u1', displayName: 'Dan', email: 'd@x.io' });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('surfaces a sign-in failure as an alert, without flipping the gate', async () => {
    signIn.mockRejectedValueOnce(new Error('bad token'));
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'Continue with Google').props.onPress(); });
    const alert = tree.root.findAll((n) => n.props.accessibilityRole === 'alert')[0];
    expect(alert).toBeTruthy();
    expect(texts(tree.toJSON()).join(' ')).toContain('bad token');
    expect(onSignedIn).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders under reduced-motion (the breathing glow stills, no crash)', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
    const tree = await render();
    expect(texts(tree.toJSON()).join(' ')).toContain('Kokonada');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('SignInScreen — Sign in with Apple (App Store Guideline 4.8, iOS)', () => {
  const originalOS = Platform.OS;
  afterAll(() => { (Platform as any).OS = originalOS; });
  afterEach(() => { jest.restoreAllMocks(); }); // undo any useTheme spy

  it('renders the official Apple button on iOS and drives signInWithApple → setUser → onSignedIn', async () => {
    (Platform as any).OS = 'ios';
    const setUser = jest.fn();
    (currentUserStore.getState as any) = () => ({ setUser });
    signInApple.mockResolvedValue({ id: 'u2', displayName: '', email: 'relay@privaterelay.appleid.com' });
    const tree = await render();
    const btn = tree.root.findAll((n) => n.props.testID === 'apple-signin-button')[0];
    expect(btn).toBeTruthy();
    await ReactTestRenderer.act(async () => { await btn.props.onPress(); });
    expect(signInApple).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith({ id: 'u2', displayName: '', email: 'relay@privaterelay.appleid.com' });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('does NOT render the Apple button on Android (4.8 applies on iOS only; Google still offered)', async () => {
    (Platform as any).OS = 'android';
    const tree = await render();
    expect(tree.root.findAll((n) => n.props.testID === 'apple-signin-button').length).toBe(0);
    expect(byLabel(tree, 'Continue with Google')).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('uses the WHITE Apple button on the dark theme (Apple HIG: light button on dark bg)', async () => {
    (Platform as any).OS = 'ios';
    jest.spyOn(theme, 'useTheme').mockReturnValue({ name: 'dark', c: theme.resolveScheme('dark') });
    const tree = await render();
    const btn = tree.root.findAll((n) => n.props.testID === 'apple-signin-button')[0];
    expect(btn.props.buttonStyle).toBe(AppleButton.Style.WHITE);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('uses the BLACK Apple button on the light theme (Apple HIG: dark button on light bg)', async () => {
    (Platform as any).OS = 'ios';
    jest.spyOn(theme, 'useTheme').mockReturnValue({ name: 'light', c: theme.resolveScheme('light') });
    const tree = await render();
    const btn = tree.root.findAll((n) => n.props.testID === 'apple-signin-button')[0];
    expect(btn.props.buttonStyle).toBe(AppleButton.Style.BLACK);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('shows NO error banner when Apple sign-in is cancelled (provider resolves null)', async () => {
    (Platform as any).OS = 'ios';
    const setUser = jest.fn();
    (currentUserStore.getState as any) = () => ({ setUser });
    signInApple.mockResolvedValue(null); // benign user cancel — not an error
    const tree = await render();
    const btn = tree.root.findAll((n) => n.props.testID === 'apple-signin-button')[0];
    await ReactTestRenderer.act(async () => { await btn.props.onPress(); });
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'alert').length).toBe(0);
    expect(setUser).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('ignores a re-entrant tap while a sign-in is already in flight (no double-fire)', async () => {
    (Platform as any).OS = 'ios';
    let resolve!: (u: any) => void;
    signInApple.mockReturnValue(new Promise((r) => { resolve = r; }));
    const tree = await render();
    const btn = tree.root.findAll((n) => n.props.testID === 'apple-signin-button')[0];
    await ReactTestRenderer.act(async () => { btn.props.onPress(); });      // first tap — in flight
    await ReactTestRenderer.act(async () => { btn.props.onPress(); });      // re-entrant — must be ignored
    expect(signInApple).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { resolve({ id: 'u', displayName: '', email: 'e' }); });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
