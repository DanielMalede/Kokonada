import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';

jest.setTimeout(20000); // cold-require headroom for CI (same rationale as ProfileScreen, #84)

jest.mock('../auth', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('../currentUser', () => ({ currentUserStore: { getState: () => ({ setUser: jest.fn() }) } }));
jest.mock('../../prodBootstrap', () => ({ onSignedIn: jest.fn().mockResolvedValue(undefined) }));

import { SignInScreen } from '../SignInScreen';
import { signInWithGoogle } from '../auth';
import { currentUserStore } from '../currentUser';
import { onSignedIn } from '../../prodBootstrap';

const signIn = signInWithGoogle as jest.Mock;

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
