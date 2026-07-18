import React from 'react';
import { View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GenerateScreen } from '../experience/generate/GenerateScreen';
import { NowPlayingScreen } from '../experience/playback/NowPlayingScreen';
import { PulseScreen } from '../experience/pulse/PulseScreen';
import { HistoryScreen } from '../experience/history/HistoryScreen';
import { ProfileScreen } from '../experience/profile/ProfileScreen';
import { SystemStateDock } from './SystemStateDock';
import { EmotionTabBar } from './EmotionTabBar';

// The 5-tab shell from the approved blueprint, now dressed in E2 chrome. All five tabs are live:
// Generate (Skia wheel + bio-aura + context suite), Now Playing, Pulse (state-vector gauges),
// History (server-side session feed), and Profile (integrations + logout + GDPR).
//
// E2 wraps the navigator in a flex column: the SystemStateDock sits at the TOP — the single, global
// "the music never stops" offline banner, which participates in layout so content shifts DOWN and is
// never occluded — and the bottom tabs use a CUSTOM EmotionTabBar (Skia glyphs, live emotion tint).
// The reactive emotion subscription lives inside that chrome, so the five screens never re-render on
// an emotion change. Screens keep their exports/imports; TAB_ROUTES is re-exported unchanged.

export { TAB_ROUTES } from './tabRoutes';

const Tab = createBottomTabNavigator();

export default function RootNavigator() {
  return (
    <View style={styles.root}>
      <SystemStateDock />
      <NavigationContainer>
        <Tab.Navigator
          tabBar={(props) => <EmotionTabBar {...props} />}
          screenOptions={{ headerShown: false }}
        >
          <Tab.Screen name="Generate">{() => <GenerateScreen />}</Tab.Screen>
          <Tab.Screen name="NowPlaying">{() => <NowPlayingScreen />}</Tab.Screen>
          <Tab.Screen name="Pulse">{() => <PulseScreen />}</Tab.Screen>
          <Tab.Screen name="History">{() => <HistoryScreen />}</Tab.Screen>
          <Tab.Screen name="Profile">{() => <ProfileScreen />}</Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
