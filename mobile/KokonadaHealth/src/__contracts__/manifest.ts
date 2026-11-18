// QA-040 (Stage 0 Q1): the contract manifest. Each contract ID maps to the tests that hold it, named by
// file (relative to the app, posix, case-exact) and jest's full name (the describe titles and the test
// title joined by spaces), never by line number. src/__contracts__/__tests__/contracts.test.ts fails
// when a referenced test is deleted, renamed, skipped, given a title the source does not spell out, or
// sits in a file jest does not run. A rewrite that retires a contract moves its reference to the v2
// test that now holds it, in the same PR.
//
// This file is data: it imports nothing (D8 rule 5 counts src/__contracts__ as production).
// The registry's wording "a test whose title carries its tag" is held here by file and full name, so no
// existing test was edited to add a tag.

export interface ContractRef { file: string; fullTitle: string }

export const CONTRACTS: Readonly<Record<string, readonly ContractRef[]>> = {
  'S10-1': [
    { file: 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx', fullTitle: 'NowPlayingScreen (Wave 2.8 reskin — playback contract preserved) subscribes to nowPlayingStore and unsubscribes on unmount (contract 1 — S10-1 no-leak)' },
  ],
  'NP-ATTR': [
    { file: 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx', fullTitle: 'NowPlayingScreen (Wave 2.8 reskin — playback contract preserved) Spotify attribution on Now Playing (NP-ATTR) renders the Spotify attribution mark + link-back on the surface, as its own element distinct from the receipt' },
    { file: 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx', fullTitle: 'NowPlayingScreen (Wave 2.8 reskin — playback contract preserved) Spotify attribution on Now Playing (NP-ATTR) reorder (Daniel): attribution sits between the meta and the receipt — it precedes the receipt in the tree' },
    { file: 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx', fullTitle: 'NowPlayingScreen (Wave 2.8 reskin — playback contract preserved) Spotify attribution on Now Playing (NP-ATTR) hands the attribution the playing track\'s own URI (track.uri) as its contentUri' },
    { file: 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx', fullTitle: 'NowPlayingScreen (Wave 2.8 reskin — playback contract preserved) Spotify attribution on Now Playing (NP-ATTR) re-targets the link-back when the track changes — never the previous track\'s URI' },
  ],
  'M1': [
    { file: 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx', fullTitle: 'NowPlayingScreen (Wave 2.8 reskin — playback contract preserved) discovery reveal lifecycle (M1 — cancel-on-change + no leak on unmount) M1(a): a discovery→discovery skip (new track.id) cancels the in-flight reveal (.stop) and starts a fresh reveal timing' },
    { file: 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx', fullTitle: 'NowPlayingScreen (Wave 2.8 reskin — playback contract preserved) discovery reveal lifecycle (M1 — cancel-on-change + no leak on unmount) M1(b): unmounting mid-reveal stops the animation (no leaked timer / setState-after-unmount)' },
  ],
  'T8': [
    { file: 'src/experience/profile/__tests__/ProfileScreen.test.tsx', fullTitle: 'ProfileScreen T8: an already-consented Sync proceeds straight to the OS flow — the wall is never shown' },
    { file: 'src/experience/profile/__tests__/ProfileScreen.test.tsx', fullTitle: 'ProfileScreen T8: a not-yet-consented Sync shows the wall and does NOT open the OS sheet until consent is granted' },
    { file: 'src/experience/profile/__tests__/ProfileScreen.test.tsx', fullTitle: 'ProfileScreen T8: when Health Connect is unavailable, routes to the install path — no wall, no OS sheet' },
  ],
  'T9': [
    { file: 'src/experience/profile/__tests__/ProfileScreen.test.tsx', fullTitle: 'ProfileScreen T9: offers Withdraw only when consent is granted; a two-step confirm calls the endpoint then reflects ungranted' },
    { file: 'src/experience/profile/__tests__/ProfileScreen.test.tsx', fullTitle: 'ProfileScreen T9: hides the Withdraw action when consent is not granted' },
    { file: 'src/experience/profile/__tests__/ProfileScreen.test.tsx', fullTitle: 'ProfileScreen T9: the withdraw confirm uses a neutral tone, not the account-deletion danger red' },
  ],
  'T10': [
    { file: 'src/experience/profile/__tests__/ProfileScreen.test.tsx', fullTitle: 'ProfileScreen T10: under reduced motion, the consent Modal uses animationType "none" (no slide)' },
  ],
  'Fork-4A': [
    { file: 'src/experience/generate/__tests__/GenerateScreen.test.tsx', fullTitle: 'GenerateScreen — soft inline retry on failure (Fork 4A, NEVER a toast) renders an in-surface honest line + Retry when the error store has a message' },
    { file: 'src/experience/generate/__tests__/GenerateScreen.test.tsx', fullTitle: 'GenerateScreen — soft inline retry on failure (Fork 4A, NEVER a toast) the Retry label uses content.secondary — AA-normal on base in LIGHT, not the sub-AA accent.glow' },
  ],
  'honest-empty': [
    { file: 'src/experience/pulse/__tests__/PulseScreen.test.tsx', fullTitle: 'PulseScreen — honest-empty language (NEVER a bare dash) renders the whole-screen empty state when the body is not in the picture' },
    { file: 'src/experience/pulse/__tests__/PulseScreen.test.tsx', fullTitle: 'PulseScreen — honest-empty language (NEVER a bare dash) the empty-state CTA routes to the in-app connect surface' },
    { file: 'src/experience/pulse/__tests__/PulseScreen.test.tsx', fullTitle: 'PulseScreen — honest-empty language (NEVER a bare dash) gives an honest per-metric SENTENCE, never a dash (#90 / D-4b)' },
    { file: 'src/experience/pulse/__tests__/PulseScreen.test.tsx', fullTitle: 'PulseScreen — honest-empty language (NEVER a bare dash) a Garmin-only gauge NEVER offers a try-again, even with a live Health Connect source' },
  ],
};
