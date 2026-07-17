// The 5-state boot/route machine. App is no longer a bare `user ? tabs : signin`
// ternary — it resolves 'splash' | 'onboarding' | 'signin' | 'connect' | 'app'. The whole
// reason this decision is a PURE function (not tangled into a component effect) is so the ONE
// dangerous regression can be pinned unambiguously: a LOGOUT must land on Sign-in, NEVER
// back on Onboarding (and never on the post-auth Connect screen). Because onboardingSeen is a
// one-way flag (see onboardingStore), a logged-out user who has ever finished the FTUE always
// resolves to 'signin'.
//
// The THIRD fact (§4): connectResolved — has the signed-in account finished (or escaped, via
// mood-only) Connect Services on this device? A present user who has NOT resolved lands on the
// 'connect' setup screen first; once resolved they go straight to the app. connectResolved is
// only ever consulted BEHIND the hasUser short-circuit, so it can never pull a logged-out user
// away from 'signin'.

import { resolvePostSplashRoute, type Route } from '../routeMachine';

describe('resolvePostSplashRoute — destination once the splash dwell completes', () => {
  it('a present-and-resolved user resolves to the app (returning session or completed setup)', () => {
    expect(resolvePostSplashRoute(true, false, true)).toBe('app');
    expect(resolvePostSplashRoute(true, true, true)).toBe('app');
  });

  it('a present-but-UNRESOLVED user lands on Connect Services first (regardless of onboardingSeen)', () => {
    expect(resolvePostSplashRoute(true, false, false)).toBe('connect');
    expect(resolvePostSplashRoute(true, true, false)).toBe('connect');
  });

  it('first run — no user, onboarding never seen — resolves to onboarding', () => {
    expect(resolvePostSplashRoute(false, false, false)).toBe('onboarding');
  });

  it('REGRESSION GUARD: logout (no user) with onboarding already seen resolves to SIGNIN, never onboarding', () => {
    const dest: Route = resolvePostSplashRoute(false, true);
    expect(dest).toBe('signin');
    expect(dest).not.toBe('onboarding');
  });

  it('REGRESSION GUARD: a logged-out user NEVER routes to connect — connectResolved is inert without a user', () => {
    // Whatever the stale connectResolved fact holds, no-user always resolves signin/onboarding.
    expect(resolvePostSplashRoute(false, true, true)).toBe('signin');
    expect(resolvePostSplashRoute(false, true, false)).toBe('signin');
    expect(resolvePostSplashRoute(false, false, true)).toBe('onboarding');
    expect(resolvePostSplashRoute(false, false, false)).toBe('onboarding');
  });

  it('the ONLY route to onboarding is: no user AND never seen — every other state avoids it', () => {
    const cases: Array<[boolean, boolean, boolean]> = [
      [true, true, true],
      [true, true, false],
      [true, false, true],
      [true, false, false],
      [false, true, true],
      [false, true, false],
    ];
    for (const [hasUser, seen, resolved] of cases) {
      expect(resolvePostSplashRoute(hasUser, seen, resolved)).not.toBe('onboarding');
    }
    expect(resolvePostSplashRoute(false, false, false)).toBe('onboarding');
  });
});
