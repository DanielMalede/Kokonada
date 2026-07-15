/**
 * KokonadaHealth → the unified Kokonada app (RN migration).
 * Redux (cold lane) + SafeArea + gesture root + the 4-state boot/route machine (AppFlow).
 * AppFlow runs the full ignition sequence (startApp) behind the native BootSplash, reveals
 * the JS splash, then routes: Splash → Onboarding (first run) / SignIn / the tab shell.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { store } from './src/state/store';
import { AppFlow } from './src/navigation/AppFlow';
import tamaguiConfig from './tamagui.config';

export default function App() {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Provider store={store}>
          <SafeAreaProvider>
            <AppFlow />
          </SafeAreaProvider>
        </Provider>
      </GestureHandlerRootView>
    </TamaguiProvider>
  );
}
