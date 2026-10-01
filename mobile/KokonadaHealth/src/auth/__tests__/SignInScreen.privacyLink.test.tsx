import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Platform, StyleSheet } from 'react-native';

jest.setTimeout(20000); // cold-require headroom for CI (same rationale as SignInScreen.test.tsx)

jest.mock('../auth', () => ({ signInWithGoogle: jest.fn(), signInWithApple: jest.fn() }));
jest.mock('../currentUser', () => ({ currentUserStore: { getState: () => ({ setUser: jest.fn() }) } }));
jest.mock('../../prodBootstrap', () => ({ onSignedIn: jest.fn().mockResolvedValue(undefined) }));

import { SignInScreen } from '../SignInScreen';
import { signInWithGoogle } from '../auth';
import { space } from '../../design/tokens';
import { PRIVACY_POLICY_LABEL } from '../../legal/legalLinks';

// HX-5 (CMP-026, CMP-081; compliance brief M6; designer direction Part 2). The privacy-policy link
// is on sign-in from the first frame — before any sign-in button acts (Spotify Developer Terms V.12,
// "before they install or signup"; WP260 fn 29, "prior to, rather than after, sign-up"). It closes
// the actions block: Google → Apple (iOS) → error → link, so an error stays next to the buttons it
// is about. It is never disabled, never a button, and never says "agree".

const signIn = signInWithGoogle as jest.Mock;
const originalOS = Platform.OS;

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;
afterEach(async () => {
  (Platform as any).OS = originalOS;
  const t = mounted;
  mounted = null;
  if (t) await ReactTestRenderer.act(async () => { t.unmount(); });
});
beforeEach(() => {
  jest.clearAllMocks();
  signIn.mockResolvedValue({ id: 'u1', displayName: 'Dan', email: 'd@x.io' });
});

async function render() {
  await ReactTestRenderer.act(async () => { mounted = ReactTestRenderer.create(<SignInScreen />); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return mounted!;
}

type Node = ReactTestRenderer.ReactTestInstance;
const outermost = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && n.parent?.props?.testID !== id)[0];
const ancestors = (n: Node): Node[] => (n.parent ? [n.parent, ...ancestors(n.parent)] : []);
// Host nodes in document (reading) order.
const hostOrder = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => typeof n.type === 'string');
const position = (tree: ReactTestRenderer.ReactTestRenderer, pick: (n: Node) => boolean) => hostOrder(tree).findIndex(pick);
const isHostWithId = (id: string) => (n: Node) => n.props.testID === id;

// The actions block: the nearest host View holding both the Google button and the link.
function actionsBlock(tree: ReactTestRenderer.ReactTestRenderer) {
  const google = outermost(tree, 'google-signin-button');
  const link = outermost(tree, 'privacy-policy-link');
  const linkUp = new Set(ancestors(link));
  return ancestors(google).find((a) => typeof a.type === 'string' && linkUp.has(a))!;
}

describe('SignInScreen — the privacy-policy link', () => {
  it.each(['android', 'ios'] as const)('%s: present at first render, before anything is pressed', async (os) => {
    (Platform as any).OS = os;
    const tree = await render();
    const link = outermost(tree, 'privacy-policy-link');
    expect(link).toBeDefined();
    expect(link.props.accessibilityRole).toBe('link');
    expect(link.props.accessibilityLabel).toBe(PRIVACY_POLICY_LABEL);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('closes the actions block, as its last child, space.lg below what is above it', async () => {
    (Platform as any).OS = 'android';
    const tree = await render();
    const block = actionsBlock(tree);
    const last = block.children[block.children.length - 1] as Node;
    expect(last.findAll(isHostWithId('privacy-policy-link')).length).toBeGreaterThan(0);
    const wrapper = ancestors(outermost(tree, 'privacy-policy-link'))
      .find((a) => typeof a.type === 'string' && StyleSheet.flatten(a.props.style)?.marginTop !== undefined);
    expect(StyleSheet.flatten(wrapper!.props.style).marginTop).toBe(space.lg);
  });

  it('Android: Google first, then the link', async () => {
    (Platform as any).OS = 'android';
    const tree = await render();
    expect(position(tree, isHostWithId('google-signin-button'))).toBeGreaterThanOrEqual(0);
    expect(position(tree, isHostWithId('google-signin-button')))
      .toBeLessThan(position(tree, isHostWithId('privacy-policy-link')));
  });

  it('iOS: the link comes after Apple’s button (the render pins what Windows cannot build)', async () => {
    (Platform as any).OS = 'ios';
    const tree = await render();
    const apple = position(tree, (n) => n.props.testID === 'apple-signin-button');
    expect(apple).toBeGreaterThanOrEqual(0);
    expect(position(tree, isHostWithId('google-signin-button'))).toBeLessThan(apple);
    expect(apple).toBeLessThan(position(tree, isHostWithId('privacy-policy-link')));
  });

  it('a sign-in error sits between the buttons and the link', async () => {
    (Platform as any).OS = 'android';
    signIn.mockRejectedValueOnce(new Error('bad token'));
    const tree = await render();
    const google = tree.root.findAll((n) => n.props.accessibilityLabel === 'Sign in with Google' && typeof n.props.onPress === 'function')[0];
    await ReactTestRenderer.act(async () => { await google.props.onPress(); });
    const alert = position(tree, (n) => n.props.accessibilityRole === 'alert');
    expect(alert).toBeGreaterThan(position(tree, isHostWithId('google-signin-button')));
    expect(alert).toBeLessThan(position(tree, isHostWithId('privacy-policy-link')));
  });

  it('is never disabled, even while a sign-in is in flight', async () => {
    (Platform as any).OS = 'android';
    let resolve!: (u: unknown) => void;
    signIn.mockReturnValue(new Promise((r) => { resolve = r; }));
    const tree = await render();
    expect(outermost(tree, 'privacy-policy-link').props.accessibilityState).toEqual({ disabled: false });
    const google = tree.root.findAll((n) => n.props.accessibilityLabel === 'Sign in with Google' && typeof n.props.onPress === 'function')[0];
    await ReactTestRenderer.act(async () => { google.props.onPress(); });
    expect(outermost(tree, 'privacy-policy-link').props.accessibilityState).toEqual({ disabled: false });
    await ReactTestRenderer.act(async () => { resolve({ id: 'u1', displayName: 'Dan', email: 'd@x.io' }); });
  });

  it('frames nothing as agreed to: no "agree", "accept" or "By continuing" anywhere on sign-in', async () => {
    (Platform as any).OS = 'android';
    const tree = await render();
    const words = tree.root.findAll((n) => n.type === 'Text').map((t) => String(t.props.children)).join(' ');
    expect(words).not.toMatch(/agree|accept|by continuing/i);
  });
});
