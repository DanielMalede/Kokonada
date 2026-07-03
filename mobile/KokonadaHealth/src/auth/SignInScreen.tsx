import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { signInWithGoogle } from './auth';
import { currentUserStore } from './currentUser';
import { onSignedIn } from '../prodBootstrap';

// The auth gate's signed-out face. A successful Google sign-in installs the rotating
// session (QA4 Suspect #1 fix inside signInWithGoogle), sets the current user (which
// flips the gate to the tabs), then wires the authenticated session.
export function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPress = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await signInWithGoogle();
      currentUserStore.getState().setUser(user);
      await onSignedIn();
    } catch (e: any) {
      setError(e?.message ?? 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}>
      <Text style={{ fontSize: 28, fontWeight: '700' }}>Kokonada</Text>
      <Text style={{ opacity: 0.6, textAlign: 'center' }}>Music that matches your body and your mood.</Text>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        style={{ backgroundColor: '#4f8cff', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>Continue with Google</Text>}
      </Pressable>
      {error ? <Text style={{ color: '#ff5a5a' }}>{error}</Text> : null}
    </View>
  );
}
