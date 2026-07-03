/**
 * KokonadaHealth → the unified Kokonada app (RN migration, Sprint A7 foundation).
 * Redux (cold lane) + SafeArea + the 5-tab navigation shell. Screens are
 * placeholders until Sprint A8 (Skia radial wheel, App Remote player, Pulse).
 */
import React from 'react';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { store } from './src/state/store';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    </Provider>
  );
}
