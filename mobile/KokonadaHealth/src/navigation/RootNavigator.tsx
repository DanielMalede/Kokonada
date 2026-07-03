import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GenerateScreen } from '../experience/generate/GenerateScreen';
import { NowPlayingScreen } from '../experience/playback/NowPlayingScreen';
import { PulseScreen } from '../experience/pulse/PulseScreen';
import { HistoryScreen } from '../experience/history/HistoryScreen';
import { ProfileScreen } from '../experience/profile/ProfileScreen';

// The 5-tab shell from the approved blueprint. All five tabs are now live: Generate
// (Skia wheel + bio-aura + context suite), Now Playing, Pulse (state-vector gauges),
// History (server-side session feed), and Profile (integrations + logout + GDPR).

const Tab = createBottomTabNavigator();

export const TAB_ROUTES = ['Generate', 'NowPlaying', 'Pulse', 'History', 'Profile'] as const;

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Generate">{() => <GenerateScreen />}</Tab.Screen>
        <Tab.Screen name="NowPlaying">{() => <NowPlayingScreen />}</Tab.Screen>
        <Tab.Screen name="Pulse">{() => <PulseScreen />}</Tab.Screen>
        <Tab.Screen name="History">{() => <HistoryScreen />}</Tab.Screen>
        <Tab.Screen name="Profile">{() => <ProfileScreen />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
