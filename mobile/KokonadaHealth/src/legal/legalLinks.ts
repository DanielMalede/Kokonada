// The privacy policy's address and the words that lead to it (HX-5, HX DT-7).
//
// The address is spelled in exactly two files: here, for the app's own links, and in
// android/app/src/main/res/values/strings.xml (privacy_policy_url), for the Health Connect
// rationale screen. Health Connect requires that screen to show the same policy filed in Play
// Console, so legalLinks.test.ts pins the two equal and legalLinksSpelling.test.ts fails on a
// third spelling. Change the address in both files together, never anywhere else.
//
// This module imports nothing. It is deliberately separate from legalCopy.ts: the consent sheet
// may import this module and PrivacyPolicyLink, and never legalCopy or LegalNote
// (legalSingleSource.test.ts, DEC-117).

// DEC-116: the owner's final address. A static https address with no query, fragment or user, so
// opening it tells the host nothing but the reader's IP address.
export const PRIVACY_POLICY_URL = 'https://kokonada.github.io/privacy/';

// The owner's term. The hosted page carries the same title.
export const PRIVACY_POLICY_LABEL = 'Privacy policy';

// The screen-reader hint: the link leaves the app.
export const PRIVACY_POLICY_HINT = 'Opens in your browser';

// Shown, with the address beneath it as selectable text, when the browser cannot be opened, so the
// link is never a dead end.
export const PRIVACY_POLICY_OPEN_FAILED = 'We couldn’t open a browser. It’s at:';

// DEC-117: the consent sheet shows its link only once the policy page is hosted (DAN-015). Sign-in
// and the Vault show theirs now. Turning this on changes the rendered consent screen; the tripwire
// in legalLinks.test.ts lists what must come with it.
export const PRIVACY_POLICY_HOSTED: boolean = false;
