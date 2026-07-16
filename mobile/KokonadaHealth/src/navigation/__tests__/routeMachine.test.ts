// The 4-state boot/route machine. App is no longer a bare `user ? tabs : signin`
// ternary — it resolves 'splash' | 'onboarding' | 'signin' | 'app'. The whole reason
// this decision is a PURE function (not tangled into a component effect) is so the ONE
// dangerous regression can be pinned unambiguously: a LOGOUT must land on Sign-in, NEVER
// back on Onboarding. Because onboardingSeen is a one-way flag (see onboardingStore), a
// logged-out user who has ever finished the FTUE always resolves to 'signin'.

import { resolvePostSplashRoute, type Route } from '../routeMachine';

describe('resolvePostSplashRoute — destination once the splash dwell completes', () => {
  it('a present user always resolves to the app (returning session or fresh sign-in)', () => {
    expect(resolvePostSplashRoute(true, false)).toBe('app');
    expect(resolvePostSplashRoute(true, true)).toBe('app');
  });

  it('first run — no user, onboarding never seen — resolves to onboarding', () => {
    expect(resolvePostSplashRoute(false, false)).toBe('onboarding');
  });

  it('REGRESSION GUARD: logout (no user) with onboarding already seen resolves to SIGNIN, never onboarding', () => {
    const dest: Route = resolvePostSplashRoute(false, true);
    expect(dest).toBe('signin');
    expect(dest).not.toBe('onboarding');
  });

  it('the ONLY route to onboarding is: no user AND never seen — every other state avoids it', () => {
    const cases: Array<[boolean, boolean]> = [
      [true, true],
      [true, false],
      [false, true],
    ];
    for (const [hasUser, seen] of cases) {
      expect(resolvePostSplashRoute(hasUser, seen)).not.toBe('onboarding');
    }
    expect(resolvePostSplashRoute(false, false)).toBe('onboarding');
  });
});
