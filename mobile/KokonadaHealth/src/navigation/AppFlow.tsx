import React, { useEffect, useState } from 'react';
import BootSplash from 'react-native-bootsplash';
import { motion } from '../design/tokens';
import { startApp as prodStartApp } from '../prodBootstrap';
import { currentUserStore } from '../auth/currentUser';
import { onboardingStore } from '../onboarding/onboardingStore';
import { resolvePostSplashRoute } from './routeMachine';
import { SplashScreen } from '../splash/SplashScreen';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { SignInScreen } from '../auth/SignInScreen';
import { AppLifecycle } from '../experience/playback/AppLifecycle';
import RootNavigator from './RootNavigator';

// The 4-state boot/route machine (replaces App's old `user ? tabs : signin` ternary).
//
// The native BootSplash sits on top during ignition; startApp is raced against an 8s
// deadline (unchanged), then BootSplash.hide({fade}) reveals the JS SplashScreen beneath.
// The JS splash then holds for ONE inhale (breath/3 — the dwell is NOT reduced under
// reduced motion, matching the shipped BreathingGlow) and resolves.
//
// Routing is DERIVED, not imperative: the route is a pure function of (splash phase, is a
// user present, has onboarding been seen). Both facts are live subscriptions, so login,
// logout, and finishing the FTUE all flow through one place. The crucial property this
// buys: a LOGOUT resolves to 'signin' (onboardingSeen is a one-way flag), never 'onboarding'.

// startApp's network calls carry no timeout; a hung (not rejected) bootstrap would else
// leave the user behind the splash forever — hide is raced against this deadline.
export const SPLASH_DEADLINE_MS = 8000;
// The JS-splash dwell: one inhale. Derived from the breath token (unchanged by reduced motion).
export const SPLASH_DWELL_MS = Math.round(motion.duration.breath / 3);

export function AppFlow({
  dwellMs = SPLASH_DWELL_MS,
  start = prodStartApp,
  splashDeadlineMs = SPLASH_DEADLINE_MS,
}: {
  dwellMs?: number;
  start?: () => Promise<void>;
  splashDeadlineMs?: number;
} = {}) {
  const [phase, setPhase] = useState<'splash' | 'resolved'>('splash');
  const [hasUser, setHasUser] = useState(() => !!currentUserStore.getState().user);
  const [seen, setSeen] = useState(() => onboardingStore.getState().seen);

  useEffect(() => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => { deadline = setTimeout(resolve, splashDeadlineMs); });
    const settled = start().catch((e: any) => { console.log('[koko] startApp failed:', e?.message ?? e); });
    void Promise.race([settled, timedOut]).then(() => {
      clearTimeout(deadline);
      void BootSplash.hide({ fade: true }); // reveal the JS splash beneath
      dwell = setTimeout(() => setPhase('resolved'), dwellMs); // hold one inhale, then route
    });

    // Reactive facts: identity (login/logout/recovery) and the one-shot FTUE flag.
    const unUser = currentUserStore.subscribe((s) => setHasUser(!!s.user));
    const unSeen = onboardingStore.subscribe((s) => setSeen(s.seen));
    return () => { clearTimeout(deadline); clearTimeout(dwell); unUser(); unSeen(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const route = phase === 'splash' ? 'splash' : resolvePostSplashRoute(hasUser, seen);

  switch (route) {
    case 'splash':
      return <SplashScreen />;
    case 'onboarding':
      return <OnboardingScreen />;
    case 'signin':
      return <SignInScreen />;
    case 'app':
    default:
      return (
        <>
          <AppLifecycle />
          <RootNavigator />
        </>
      );
  }
}
