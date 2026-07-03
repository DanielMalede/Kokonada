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
import { store } from './src/state/store';
import RootNavigator from './src/navigation/RootNavigator';
import { SignInScreen } from './src/auth/SignInScreen';
import { AppLifecycle } from './src/experience/playback/AppLifecycle';
import { currentUserStore } from './src/auth/currentUser';
import { startApp } from './src/prodBootstrap';

export default function App() {
  const [user, setUser] = useState(() => currentUserStore.getState().user);

  useEffect(() => {
    void startApp();
    // The gate is reactive: identity recovery (startApp), login, and logout all flow
    // through currentUserStore, so this single subscription drives tabs ↔ SignIn.
    return currentUserStore.subscribe((s) => setUser(s.user));
  }, []);

  return (
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
  );
}
