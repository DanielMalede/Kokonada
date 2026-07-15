/**
 * @format
 */

import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

// App's job is now pure COMPOSITION: it wraps the provider stack (Tamagui, gesture root,
// Redux, SafeArea) around the AppFlow route machine. The boot/route behaviour it used to
// own (startApp + BootSplash hand-off + the auth gate) moved into AppFlow and is pinned in
// src/navigation/__tests__/AppFlow.test.tsx. Here we only assert App mounts AppFlow inside
// the providers without crashing.

const marker = (testID: string) => () => React.createElement(View, { testID });
jest.mock('../src/navigation/AppFlow', () => ({ AppFlow: marker('app-flow') }));
// SafeAreaProvider gates its children on a native layout measurement that never fires in
// the headless renderer; pass children through so the composition is observable.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));

import App from '../App';

test('composes the provider stack and mounts AppFlow', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<App />); });
  expect(tree.root.findAll((n) => n.props?.testID === 'app-flow').length).toBeGreaterThan(0);
  await ReactTestRenderer.act(async () => { tree.unmount(); });
});
