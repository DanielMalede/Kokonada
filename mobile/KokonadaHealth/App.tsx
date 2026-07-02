/**
 * KokonadaHealth — Android companion (Health Connect + live BLE heart rate).
 * Entry point: Google Sign-In -> build medical profile -> live BLE HR -> strict 3-min fallback.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ConnectHealthScreen from './src/components/ConnectHealthScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <ConnectHealthScreen />
    </SafeAreaProvider>
  );
}
