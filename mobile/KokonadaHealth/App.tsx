/**
 * KokonadaHealth → the unified Kokonada app (RN migration).
 * Redux (cold lane) + SafeArea + gesture root + the 5-tab navigation shell behind an
 * auth gate. On mount it runs the full ignition sequence (startApp): builds the
 * encrypted store, recovers the session, connects the socket + Spotify + biometrics,
 * and rehydrates persisted intent. The gate shows SignIn until a user is present.
 */
import React, { useEffect, useState } from 'react';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import BootSplash from 'react-native-bootsplash';
import { store } from './src/state/store';
import RootNavigator from './src/navigation/RootNavigator';
import { SignInScreen } from './src/auth/SignInScreen';
import { AppLifecycle } from './src/experience/playback/AppLifecycle';
import { currentUserStore } from './src/auth/currentUser';
import { startApp } from './src/prodBootstrap';
import tamaguiConfig from './tamagui.config';

// startApp's network calls carry no timeout, so a hung (not rejected) bootstrap would
// otherwise leave the user behind the splash forever — hide is raced against this deadline.
const SPLASH_DEADLINE_MS = 8000;

export default function App() {
  const [user, setUser] = useState(() => currentUserStore.getState().user);

  useEffect(() => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      deadline = setTimeout(resolve, SPLASH_DEADLINE_MS);
    });
    const settled = startApp().catch((e) => {
      console.log('[koko] startApp failed:', e?.message ?? e);
    });
    void Promise.race([settled, timedOut]).then(() => {
      clearTimeout(deadline);
      void BootSplash.hide({ fade: true });
    });
    // The gate is reactive: identity recovery (startApp), login, and logout all flow
    // through currentUserStore, so this single subscription drives tabs ↔ SignIn.
    return currentUserStore.subscribe((s) => setUser(s.user));
  }, []);

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Provider store={store}>
          <SafeAreaProvider>
            {user ? (
              <>
                <AppLifecycle />
                <RootNavigator />
              </>
            ) : (
              <SignInScreen />
            )}
          </SafeAreaProvider>
        </Provider>
      </GestureHandlerRootView>
    </TamaguiProvider>
  );
}
