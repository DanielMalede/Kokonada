# DEV ITEM — Sign-in brand assets, button styling and the privacy manifest

**Raised:** 2026-08-26 by `compliance-auditor`, against sources fetched that day.
**Routing:** `developer` under TDD → `compliance-auditor` re-check before submission.
**Status:** not started. Canvas side is fixed; everything below is shipped code.

The canvas failures found in the same audit have already been corrected: `Login.dc.html` drew a monochrome hand-made "G" and `&#63743;` (U+F8FF — the Apple logo glyph from Apple's private-use area). Both are now official-asset slots, matching NowPlaying and Receipt. The items below are in the app.

---

## 1 · Google button — NEEDS-ASSET

**Requirement** — Sign in with Google Branding Guidelines, https://developers.google.com/identity/branding-guidelines (page last updated 2026-07-07 UTC, fetched 2026-08-26):

> "Following these guidelines on displaying the Sign in with Google button is **required for app verification**."

> "Regardless of the text, you can't change the size or color of the Google 'G' logo. It must be the standard color version … and appear on a white background."

Prohibited, verbatim: *"Use monochrome versions of the Google 'G' for the button"*, *"Create your own icon for the button"*, *"Put the standard color Google 'G' icon on a colored background other than light, dark, or neutral"*.

**What the code does** — `SignInScreen.tsx:67-86`: the button contains **no Google mark at all**, only a `<Text>` reading "Continue with Google". There is no sanctioned logo-free variant. Fill and stroke come from theme tokens, and in dark theme `c.surface.raised` is `#161A3C` (`tokens.ts:122`) — a coloured background, outside Google's permitted light / dark / neutral fills.

**Fix** — `@react-native-google-signin/google-signin@16.1.2` is already a dependency (`package.json:16`) and ships `GoogleSigninButton`, which renders the official asset. Use it, or use the pre-approved downloads. **Do not hand-roll the mark.**

Also apply Google's padding structure — Android/Web `12 / 10 / 12`px, **iOS `16 / 12 / 16`px** — which neither surface implements. There is **no minimum height or width**; the only sizing rule is preserving aspect ratio so the logo is never stretched.

**Passing already:** the wording. "Sign in with Google", "Sign up with Google" and "Continue with Google" are all permitted, and localisation is *"permitted and encouraged."*

## 2 · Apple button style in dark mode — NEEDS CHANGE

**Requirement** — Apple HIG, Sign in with Apple (fetched 2026-08-26):

> "**Black:** … Use this style on white or light-color backgrounds that provide sufficient contrast; **don't use it on black or dark backgrounds.**"

**What the code does** — `SignInScreen.tsx:91` hard-codes `buttonStyle={AppleButton.Style.BLACK}`. The screen background is `c.surface.base`, which in dark is `#0E1030` (`tokens.ts:119`) — near-black.

**Fix** — drive it from the theme: `BLACK` in light, `WHITE` in dark. Optionally set `cornerRadius` to `radius.pill`; the HIG says *"Adjust the corner radius to match the appearance of other buttons in your app"*, and today Apple's default radius sits beside a pill-shaped Google button.

**Worth recording:** the auditor corrected a premise I gave it — Apple **does** permit a custom button (*"If your interface requires it, you can create a custom Sign in with Apple button"*), but only within fixed bounds: official logo artwork only, title from a fixed set, logo and title both black or white, title font size **43% of button height**, logo height matched to button height, no vertical padding, minimum 140×30pt. Using the system `AppleButton` remains the right call — it satisfies all of that by construction.

## 3 · Apple button height under Dynamic Type — NEEDS CHANGE

**Requirement** — HIG: *"Make a Sign in with Apple button no smaller than other sign-in buttons."* Google's equivalent: *"displayed at least as prominently as other third party sign-in options."* **Neither vendor mandates an order** — Google-then-Apple is fine — but both set a prominence floor.

**What the code does** — the two heights are equal *by coincidence*, via different mechanisms. Google: `paddingVertical: space.lg` (16) ×2 plus a `typography.size.body` (16) text line ≈ **52**. Apple: `height: 52`, hard-coded (`SignInScreen.tsx:115`).

At accessibility text sizes the Google button grows past 52 while Apple stays fixed — so the Apple button becomes measurably smaller than another sign-in button, breaching the HIG **on exactly the devices belonging to users who most need larger text**.

**Fix** — derive both from one shared token, or scale the Apple height with `PixelRatio.getFontScale()`.

## 4 · Privacy manifest declares nothing — NEEDS CHANGE

**Requirement** — App Privacy Details, https://developer.apple.com/app-store/app-privacy-details/ (fetched 2026-08-26):

> "You need to identify all of the data you or your third-party partners collect… Even if you collect the data for reasons other than analytics or advertising, it still needs to be declared."

**What the code does** — `ios/KokonadaHealth/PrivacyInfo.xcprivacy:32-33` has `<key>NSPrivacyCollectedDataTypes</key><array/>` — **empty** — while `auth.ts:72` requests `Scope.FULL_NAME` and `Scope.EMAIL`, `KokonadaUser` carries `id/displayName/email/avatarUrl`, and the app handles heart rate and HRV.

At minimum: Contact Info → Name, Email Address; Identifiers → User ID; Health & Fitness → Health.

**Fix** — populate it, and make the App Store Connect privacy answers match exactly; a mismatch between the two is the common rejection path.

**Scoped honestly:** the auditor flagged as **UNVERIFIED** whether an empty `NSPrivacyCollectedDataTypes` is *itself* a rejection trigger — it could not find a verbatim clause saying so. What is firmly cited is the App Store Connect disclosure obligation above, which an empty manifest contradicts.

**Minimisation note, not a blocker:** if `displayName` is only cosmetic, dropping `Scope.FULL_NAME` reduces both the disclosure surface and the GDPR Art. 5(1)(c) exposure.

## 5 · Google Play account-deletion web link — UNVERIFIED

Play requires **both** an in-app deletion path **and** a public web URL for deletion requests (https://support.google.com/googleplay/android-developer/answer/13327111, fetched 2026-08-26), submitted via the Data safety form. The in-app path passes. **The web URL cannot be verified from this repo — confirm in Play Console before release.** This is a listing-level takedown risk, not a code fix.

## Related

- `docs/plans/HALT_SIGN_IN_WITH_APPLE_ENTITLEMENT.md` — the blocker on the same screen. Nothing here ships before that clears.
- `docs/plans/DEV_GARMIN_DEREGISTRATION_ON_DELETE.md` — the auditor independently rated it a **pre-submission blocker**: Apple requires deletion of the account record "along with associated personal data", Play says "and associated data", and a live Garmin registration pushing biometrics for a deleted user fails both as well as GDPR Art. 17.
