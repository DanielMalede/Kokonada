/**
 * KokonadaHealth → the unified Kokonada app (RN migration).
 * Redux (cold lane) + SafeArea + gesture root + the 5-tab navigation shell.
 * On mount it restores the session and connects the playback pipeline (socket +
 * Spotify remote) so a generated vibe starts playing with no further wiring.
 */
import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { store } from './src/state/store';
import RootNavigator from './src/navigation/RootNavigator';
import { startPlayback } from './src/experience/playback/playbackServices';
import { AppLifecycle } from './src/experience/playback/AppLifecycle';

export default function App() {
  useEffect(() => { void startPlayback(); }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <SafeAreaProvider>
          <AppLifecycle />
          <RootNavigator />
        </SafeAreaProvider>
      </Provider>
    </GestureHandlerRootView>
  );
}
