// The app's top-level route states. The splash holds while the native BootSplash and
// the JS ignition settle; once it resolves, exactly one of the other three shows.
export type Route = 'splash' | 'onboarding' | 'signin' | 'app';

// Where to go once the splash dwell completes, given the two facts that matter:
//   • hasUser        — is an identity present (recovered session or fresh sign-in)?
//   • onboardingSeen — has this device ever finished the FTUE (one-way flag)?
//
// Onboarding is reachable from EXACTLY one state — a first-run device (no user, never
// seen). Every other combination avoids it. In particular a logout (hasUser false) after
// the FTUE (onboardingSeen true) resolves to 'signin', never back to 'onboarding'.
export function resolvePostSplashRoute(hasUser: boolean, onboardingSeen: boolean): Route {
  if (hasUser) return 'app';
  return onboardingSeen ? 'signin' : 'onboarding';
}
