import React from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

// The 5-tab shell from the approved blueprint. Screens are placeholders this
// sprint — the Skia radial wheel, Now Playing (App Remote), Pulse, History and
// Profile land in Sprint A8. This is the navigation skeleton the state lanes and
// socket client plug into. Verified on-device (not headless-snapshotted).

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
        <Tab.Screen name="Generate">{() => <Placeholder title="Generate" />}</Tab.Screen>
        <Tab.Screen name="NowPlaying">{() => <Placeholder title="Now Playing" />}</Tab.Screen>
        <Tab.Screen name="Pulse">{() => <Placeholder title="Pulse" />}</Tab.Screen>
        <Tab.Screen name="History">{() => <Placeholder title="History" />}</Tab.Screen>
        <Tab.Screen name="Profile">{() => <Placeholder title="Profile" />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
