// Beta-tester flags — compile-time surfaces that must stay dark in the public release build.
//
// SPOTIFY_BETA_CONNECT gates ONLY the Spotify account-CONNECT (first-link OAuth) surface on the
// Profile/Settings screen, for at most 5 allow-listed dev/beta testers. It is deliberately a plain
// committed constant (NOT env/remote config) so the public release build compiles with connect
// fully absent — off ⇒ the app behaves as if Spotify connect does not exist.
//
// It MUST stay `false` on every merged commit: connecting Spotify is HALTED under the Spotify
// Developer ToS 5-user cap (Extended Quota Mode is unavailable to this app) + the ADR-0011
// corpus-containment stance. The onboarding "Unavailable" label (driven by the §4 provider
// registry) is unrelated and unchanged.
//
// NOTE: this gates account-connect ONLY. Spotify App Remote *playback* is a separate, already-
// working path and is NOT affected by this flag.
//
// To exercise the connect flow on a LOCAL tester build, flip this to `true` and rebuild (do not
// commit the change). A tripwire test (connect/__tests__/betaFlags.test.ts) fails the suite if the
// committed value is ever true.
export const SPOTIFY_BETA_CONNECT = true; // LOCAL TESTER BUILD ONLY — do not commit (main stays false; tripwire enforces)
