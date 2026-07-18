import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// RootNavigator is the SHELL every screen renders in. The 5 screens are heavy (Skia, sockets,
// native surfaces), so they are stubbed to markers — this suite pins the COMPOSITION (the dock
// above the navigator, the custom emotion tab bar, headerShown), not screen internals. The real
// NavigationContainer + Tab.Navigator + EmotionTabBar + SystemStateDock are mounted for real.

const marker = (testID: string) => () => React.createElement(View, { testID });
jest.mock('../../experience/generate/GenerateScreen', () => ({ GenerateScreen: marker('screen-Generate') }));
jest.mock('../../experience/playback/NowPlayingScreen', () => ({ NowPlayingScreen: marker('screen-NowPlaying') }));
jest.mock('../../experience/pulse/PulseScreen', () => ({ PulseScreen: marker('screen-Pulse') }));
jest.mock('../../experience/history/HistoryScreen', () => ({ HistoryScreen: marker('screen-History') }));
jest.mock('../../experience/profile/ProfileScreen', () => ({ ProfileScreen: marker('screen-Profile') }));

import RootNavigator, { TAB_ROUTES } from '../RootNavigator';
import { TAB_LABELS } from '../tabRoutes';
import emotionReducer from '../../state/cold/emotionSlice';
import { warmStore } from '../../state/store';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const host = (n: any) => typeof n.type === 'string';

async function mount() {
  const store = configureStore({ reducer: { emotion: emotionReducer } });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Provider store={store}>
        <SafeAreaProvider initialMetrics={METRICS}>
          <RootNavigator />
        </SafeAreaProvider>
      </Provider>,
    );
  });
  await ReactTestRenderer.act(async () => {}); // flush NavigationContainer onReady
  return tree;
}

beforeEach(() => { warmStore.getState().setConnection('connected'); }); // quiet the offline-grace timer
afterEach(() => { warmStore.getState().reset(); });

describe('RootNavigator — the E2 shell composition', () => {
  it('mounts under Provider + SafeAreaProvider without throwing', async () => {
    const tree = await mount();
    expect(tree.root.findAll((n) => host(n) && n.props?.testID === 'screen-Generate').length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('mounts the SystemStateDock exactly ONCE, at the top of the shell', async () => {
    const tree = await mount();
    expect(tree.root.findAll((n) => host(n) && n.props?.testID === 'system-state-dock')).toHaveLength(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('wires the custom EmotionTabBar — 5 tabs in TAB_ROUTES order', async () => {
    const tree = await mount();
    const tabs = tree.root.findAll((n) => n.props?.accessibilityRole === 'tab' && typeof n.props?.onPress === 'function');
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(TAB_ROUTES.map((r) => TAB_LABELS[r]));
    // the emotion tab bar's tablist container is present (proves the custom tabBar replaced the default)
    expect(tree.root.findAll((n) => host(n) && n.props?.accessibilityRole === 'tablist')).toHaveLength(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('preserves headerShown:false — no navigation header is rendered', async () => {
    const tree = await mount();
    expect(tree.root.findAll((n) => n.props?.accessibilityRole === 'header')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('preserves the TAB_ROUTES export contract (5 routes, unchanged order)', () => {
    expect(TAB_ROUTES).toEqual(['Generate', 'NowPlaying', 'Pulse', 'History', 'Profile']);
  });
});
