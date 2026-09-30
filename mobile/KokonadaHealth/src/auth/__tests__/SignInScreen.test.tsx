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
import { type as typography } from '../../design/tokens';
import * as theme from '../../design/theme';
import { SIGN_IN_BUTTON_HEIGHT, GOOGLE_SIGN_IN_WIDTH } from '../GoogleSignInButton';
import { StyleSheet } from 'react-native';

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
  // HX-6 label ruling (owner-signed RETIRE): the Google button is Google's pre-approved image, and its
  // accessible name equals the words drawn on it — "Sign in with Google" — so the five
  // "Continue with Google" pins at :45, :49, :67, :77 and :117 reverse to those words.
  it('renders the wordmark and a labelled Sign in with Google button', async () => {
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Kokonada');
    expect(byLabel(tree, 'Sign in with Google')).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('sets the wordmark in the display face at the refined 600 weight (not the old 700)', async () => {
    const tree = await render();
    const header = tree.root.findAll((n) => n.props.accessibilityRole === 'header')[0];
    const s = header.props.style;
    const st = Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
    expect(st.fontWeight).toBe(typography.weight.semibold);
    expect(st.fontFamily).toBe(typography.family.display);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('press drives the UNCHANGED flow: signInWithGoogle → setUser → onSignedIn', async () => {
    const setUser = jest.fn();
    (currentUserStore.getState as any) = () => ({ setUser });
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'Sign in with Google').props.onPress(); });
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith({ id: 'u1', displayName: 'Dan', email: 'd@x.io' });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('surfaces a sign-in failure as an alert, without flipping the gate', async () => {
    signIn.mockRejectedValueOnce(new Error('bad token'));
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'Sign in with Google').props.onPress(); });
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
    expect(byLabel(tree, 'Sign in with Google')).toBeTruthy();
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

  // REVERSED in HX-6 round 1 (designer review; signed by the owner 2026-09-30, DEC-106): this pinned BLACK on the
  // light face. Beside Google's white pill, Apple's White-with-outline style is the matching pair —
  // Apple HIG, "White with outline": "Use this style on white or light-color backgrounds that don't
  // provide sufficient contrast with the white button fill." The light canvas (surface.base) is
  // near-white, so the condition holds.
  it('uses the WHITE_OUTLINE Apple button on the light theme (pairs with Google\'s white pill)', async () => {
    (Platform as any).OS = 'ios';
    jest.spyOn(theme, 'useTheme').mockReturnValue({ name: 'light', c: theme.resolveScheme('light') });
    const tree = await render();
    const btn = tree.root.findAll((n) => n.props.testID === 'apple-signin-button')[0];
    expect(btn.props.buttonStyle).toBe(AppleButton.Style.WHITE_OUTLINE);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it.each(['light', 'dark'] as const)('rounds Apple\'s corners to half the shared height (a pill like Google\'s) on the %s face', async (face) => {
    (Platform as any).OS = 'ios';
    jest.spyOn(theme, 'useTheme').mockReturnValue({ name: face, c: theme.resolveScheme(face) });
    const tree = await render();
    const btn = tree.root.findAll((n) => n.props.testID === 'apple-signin-button')[0];
    expect(btn.props.cornerRadius).toBe(SIGN_IN_BUTTON_HEIGHT / 2);
    expect(btn.props.cornerRadius).toBe(20);
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

// HX-6 (CMP-099, CMP-100, CMP-101; MB-036): the button is Google's pre-approved image; Apple's
// button is the same height and width; on Android nothing Apple renders — no placeholder.
describe('SignInScreen — the official Google button (HX-6)', () => {
  const originalOS = Platform.OS;
  afterEach(() => { (Platform as any).OS = originalOS; });

  const host = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
    tree.root.findAll((n) => n.props.testID === id && typeof n.type === 'string')[0];

  it('shows Google\'s pre-approved image as the button — no words or G typed in code', async () => {
    const tree = await render();
    expect(host(tree, 'google-signin-image')).toBeTruthy();
    expect(texts(tree.toJSON()).join(' ')).not.toContain('Google'); // the words live in the image
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('while a Google sign-in is in flight: the image stays, a spinner sits outside it, nothing dims', async () => {
    let resolve!: (u: any) => void;
    signIn.mockReturnValue(new Promise((r) => { resolve = r; }));
    const tree = await render();
    await ReactTestRenderer.act(async () => { byLabel(tree, 'Sign in with Google').props.onPress(); });
    expect(host(tree, 'google-signin-image')).toBeTruthy();
    expect(host(tree, 'google-signin-busy')).toBeTruthy();
    const btn = host(tree, 'google-signin-button');
    expect(btn.props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
    const dimmed = btn.findAll((n) => typeof n.type === 'string')
      .map((n) => (StyleSheet.flatten(n.props.style) as any)?.opacity)
      .filter((o) => o !== undefined && o !== 1);
    expect(dimmed).toEqual([]);
    await ReactTestRenderer.act(async () => { resolve({ id: 'u1', displayName: 'Dan', email: 'd@x.io' }); });
    expect(host(tree, 'google-signin-busy')).toBeUndefined(); // the flow settles, the spinner goes
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  // Resilience, HX-6 round 1: a fast double-tap on Google must start ONE sign-in, and the button must
  // be disabled for the whole flight (the re-entry latch and the disabled prop are both pinned).
  it('a double-tap on Google while the first sign-in is pending calls signInWithGoogle once, and the button is disabled', async () => {
    let resolve!: (u: any) => void;
    signIn.mockReturnValue(new Promise((r) => { resolve = r; }));
    const tree = await render();
    const pressable = () =>
      tree.root.findAll((n) => n.props.testID === 'google-signin-button' && typeof n.props.onPress === 'function')[0];
    expect(pressable().props.disabled).toBe(false);
    await ReactTestRenderer.act(async () => { pressable().props.onPress(); }); // first tap — in flight
    expect(pressable().props.disabled).toBe(true);
    await ReactTestRenderer.act(async () => { pressable().props.onPress(); }); // second tap — must be ignored
    expect(signIn).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { resolve({ id: 'u1', displayName: 'Dan', email: 'd@x.io' }); });
    expect(pressable().props.disabled).toBe(false); // released once the flight settles
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('iOS: Apple\'s button renders at exactly Google\'s height and width (Apple no smaller; Google the same size)', async () => {
    (Platform as any).OS = 'ios';
    const tree = await render();
    const apple = tree.root.findAll((n) => n.props.testID === 'apple-signin-button')[0];
    const a = StyleSheet.flatten(apple.props.style) as any;
    const g = StyleSheet.flatten(host(tree, 'google-signin-image').props.style) as any;
    expect({ w: a.width, h: a.height }).toEqual({ w: GOOGLE_SIGN_IN_WIDTH, h: SIGN_IN_BUTTON_HEIGHT });
    expect({ w: a.width, h: a.height }).toEqual({ w: g.width, h: g.height });
    expect(a.maxWidth === undefined || a.maxWidth <= g.width).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('Android: nothing Apple renders — no disabled or look-alike button; the only button is Google\'s', async () => {
    (Platform as any).OS = 'android';
    const tree = await render();
    expect(tree.root.findAll((n) => n.props.testID === 'apple-signin-button')).toHaveLength(0);
    expect(tree.root.findAll((n) => (n.type as unknown) === 'AppleButton')).toHaveLength(0);
    const buttons = tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button');
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(['Sign in with Google']);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
