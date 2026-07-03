import React from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GenerateScreen } from '../experience/generate/GenerateScreen';

// The 5-tab shell from the approved blueprint. Generate is now the live Context &
// Emotion Input Suite (Skia wheel + bio-aura, wired to the cold store via
// GenerateController); Now Playing / Pulse / History / Profile remain placeholders
// pending A9+. Verified on-device.

const Tab = createBottomTabNavigator();

function Placeholder({ title }: { title: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>{title}</Text>
    </View>
  );
}

export const TAB_ROUTES = ['Generate', 'NowPlaying', 'Pulse', 'History', 'Profile'] as const;

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Generate">{() => <GenerateScreen />}</Tab.Screen>
        <Tab.Screen name="NowPlaying">{() => <Placeholder title="Now Playing" />}</Tab.Screen>
        <Tab.Screen name="Pulse">{() => <Placeholder title="Pulse" />}</Tab.Screen>
        <Tab.Screen name="History">{() => <Placeholder title="History" />}</Tab.Screen>
        <Tab.Screen name="Profile">{() => <Placeholder title="Profile" />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
