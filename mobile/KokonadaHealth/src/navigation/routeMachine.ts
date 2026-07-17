// The app's top-level route states. The splash holds while the native BootSplash and
// the JS ignition settle; once it resolves, exactly one of the other four shows.
export type Route = 'splash' | 'onboarding' | 'signin' | 'connect' | 'app';

// Where to go once the splash dwell completes, given the three facts that matter:
//   • hasUser         — is an identity present (recovered session or fresh sign-in)?
//   • onboardingSeen  — has this device ever finished the FTUE (one-way flag)?
//   • connectResolved — has this signed-in account finished (or escaped, via mood-only)
//                       Connect Services on this device? (§4; per-userId device flag)
//
// The hasUser short-circuit stays FIRST and unconditional — this is the sacred logout
// guard: a logged-out user (hasUser false) can never be pulled to 'connect' or 'app' by a
// stale connectResolved fact; they always resolve to 'signin' (if the FTUE is seen) or
// 'onboarding' (first run only). connectResolved is consulted EXCLUSIVELY behind the
// short-circuit, so a present-but-unresolved account lands on 'connect' first, and a
// present-and-resolved account goes straight to the app. Onboarding remains reachable from
// EXACTLY one state — a first-run device (no user, never seen).
export function resolvePostSplashRoute(
  hasUser: boolean,
  onboardingSeen: boolean,
  connectResolved = false,
): Route {
  if (hasUser) return connectResolved ? 'app' : 'connect';
  return onboardingSeen ? 'signin' : 'onboarding';
}
