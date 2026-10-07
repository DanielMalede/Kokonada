// QA-018: a real focus/blur driver. The app's tabs never unmount (RootNavigator.tsx; MB-032), so a page
// that keeps drawing while blurred is invisible to unmount-only parity. renderInTabs mounts the subject
// as one tab of a REAL NavigationContainer + bottom-tab navigator (as the app does) next to an empty
// sibling tab; blur() navigates to the sibling, focus() back. The subject stays mounted, and
// useIsFocused / useFocusEffect / navigation 'focus'/'blur' events behave exactly as in the app.

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const SUBJECT = 'Subject';
const ELSEWHERE = 'Elsewhere';

export interface FocusHarness {
  readonly tree: ReactTestRenderer.ReactTestRenderer;
  blur(): Promise<void>;
  focus(): Promise<void>;
  isFocused(): boolean;
  unmount(): Promise<void>;
}

const Tab = createBottomTabNavigator();
const Empty = () => null;

/** Mount `subject` as a focused tab of a real bottom-tab navigator, with a sibling tab to blur to. */
export async function renderInTabs(subject: React.ReactElement): Promise<FocusHarness> {
  const ref = createNavigationContainerRef<Record<string, undefined>>();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <NavigationContainer ref={ref}>
          <Tab.Navigator tabBar={() => null} screenOptions={{ headerShown: false }}>
            <Tab.Screen name={SUBJECT}>{() => subject}</Tab.Screen>
            <Tab.Screen name={ELSEWHERE} component={Empty} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  await act(async () => {}); // NavigationContainer's onReady
  const go = async (name: string) => {
    if (!ref.isReady()) throw new Error('QA-018: the navigator is not ready');
    await act(async () => { ref.navigate(name); });
  };
  return {
    tree,
    blur: () => go(ELSEWHERE),
    focus: () => go(SUBJECT),
    isFocused: () => ref.getCurrentRoute()?.name === SUBJECT,
    unmount: async () => { await act(async () => { tree.unmount(); }); },
  };
}
