# HALT — Five Health Connect / Play blockers in shipped Android code

**Raised:** 2026-08-26 by `compliance-auditor`, all sources fetched that day.
**Severity:** blocks **any** Play track, including closed testing. One item is a live user-facing privacy misstatement.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor` re-audit. Items 1 and 5 need a human (hosting + Play Console).
**Status:** not started.

---

## HALT 1 · Our "privacy policy" is a link to Google's own documentation

**Requirement** — https://developer.android.com/health-and-fitness/health-connect/get-started:
> "Your Android manifest needs to have an Activity that displays your app's privacy policy… **Note:** The activity must display the same privacy policy you provide for your app in the Google Play Console."

**What the code does** — `android/app/src/main/java/com/kokonadahealth/PermissionsRationaleActivity.kt:18-19`:
```kotlin
// TODO: replace with your hosted privacy policy describing how health data is used.
webView.loadUrl("https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started")
```

When a user taps **privacy policy** on the Health Connect permission screen, we render **Google's developer documentation** inside a Kokonada WebView. It also trips Google's trademark rule against displaying Brand Features "in any manner that implies a relationship with, affiliation with, sponsorship by, or endorsement by Google."

**Fix** — host the real policy, load that URL, and put the identical URL in the Play Console field. No release while the TODO stands.

## HALT 2 · On Android 14+ the privacy-policy link opens our home screen

**Requirement** — the manifest snippet on the same page requires the alias to target the rationale activity.

**What the code does** — `AndroidManifest.xml:90-99` sets `android:targetActivity=".MainActivity"`.

On Android 14+, where **Health Connect is part of the system** (the dominant install base), the required privacy surface is simply absent — the user lands on our launch screen.

**Fix** — retarget the alias to `.PermissionsRationaleActivity`.

## HALT 3 · Duplicate rationale intent-filter makes resolution ambiguous on Android ≤13

`AndroidManifest.xml:75-77` puts `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` on **MainActivity**, and `:84-86` puts the same action on **PermissionsRationaleActivity**. Two components claim one action, so the OS shows a chooser or picks arbitrarily. **This defeats HALT 2's fix even after the URL is corrected.**

**Fix** — delete the filter from MainActivity; keep it only on the rationale activity.

## HALT 4 · There is no privacy-policy link or text anywhere in the shipped app

**Requirement** — https://support.google.com/googleplay/android-developer/answer/16679511:
> "Your app must post a privacy policy link in the designated field within Play Console, **and a privacy policy link or text within the app itself**."

**What the code does** — a repo-wide grep of `mobile/KokonadaHealth/src` for `Linking` / `openURL` / `https://` returns exactly three destinations: Spotify OAuth, the Spotify download page, and the Health Connect Play listing. `ConsentSheet.tsx` — the Article 9 wall, where this belongs — has none.

**Note:** the canvas already solved this and the port dropped it. `Consent.dc.html` carries "Read the full privacy notice".

**Fix** — port that link into `ConsentSheet.tsx` and `VaultConsentPanel.tsx`.

## HALT 5 · The Health apps declaration appears not to be filed

**Requirement** — https://support.google.com/googleplay/android-developer/answer/14738291:
> "All developers that have an app published on Google Play must complete the Health apps declaration, **including apps on closed testing, open testing, or production tracks**."

Without it, allow-listed against package `com.kokonadahealth`, **Health Connect reads fail for real users** no matter how correct the client is — and data-type access is allow-listed per package regardless of app version.

Corroborating evidence the release checklist has not been run: `src/health/config.ts:2` still reads `https://YOUR-BACKEND.up.railway.app`, and the rationale URL is still a TODO.

**Fix** — file the declaration with a per-permission justification, including for `READ_HEALTH_DATA_HISTORY`.

---

## What is right, and must not be broken fixing the above

**The consent sequencing is the strongest part of the integration.** Play's Prominent Disclosure rules require in-app disclosure, before collection, with affirmative action, and that navigating away is never read as consent. `ConnectServicesScreen.tsx:153-155` presents `ConsentSheet` before the OS sheet; `ConsentSheet.tsx:124-127` gates on a server-acked grant; back/dismiss maps to `onDecline`. `connectController.test.ts` pins `requestHealthPermissions` as *not* called on unsupported, install-required, consent-required, stale-version and offline. **Verdict: COMPLIANT, with regression guards. Protect it.**

**Permission scope is genuinely minimised** — four read types plus history, no background access, and `permissions.ts:23-26` documents why `READ_HEALTH_DATA_IN_BACKGROUND` is deliberately not requested. That is the posture reviewers want.

**The twice-cancelled permission path is handled** (`ConnectServicesScreen.tsx:156-161` deep-links into Health Connect settings). **The CTA wording passes** — "Connect a wearable" avoids the prohibited "Connect to Health Connect."

---

## Also needs fixing, lower severity

| Item | File | Fix |
|---|---|---|
| "Historical readings" listed as a **data type** | `ConsentSheet.tsx:24`, `VaultConsentPanel.tsx:26` | It is a *permission*, not a category — our own `permissions.ts:19` says so. Move it to its own line. |
| "Sleep" vs "Sleep sessions" drift | `VaultConsentPanel.tsx:24` vs `ConsentSheet.tsx:22` | Align both on "Sleep session", matching the OS sheet the user sees seconds later. |
| Retention absent from shipped copy | `ConsentSheet.tsx` "How long we keep it" | Says only "minimised over time". Port the canvas facts (90 days / one year). |
| History wording understates granted scope | canvas + shipped | `READ_HEALTH_DATA_HISTORY` grants the **entire** history; 182 days is our self-imposed window. Say both — it is also a trust win. |
| Setup docs teach over-scoping | `native-snippets/AndroidManifest.additions.xml:14,15,19`, `SETUP_ANDROID.md:93` | Still declare SpO2, respiratory rate and background access. Anyone following the doc reintroduces three unjustified scopes and contradicts the filed declaration. Align or delete. |
| iOS ships an Android-only CTA | `ConnectServicesScreen.tsx:145` | On iOS its only outcome is "Available on Android" — App Store 2.1 non-functional-feature territory. Gate or hide. |
| "Google Health Connect" | `backend/app/services/wearable/healthStore.js:4` | Google never brands it that way. Cosmetic. |

## Standing constraint, worth pinning

The Spotify mark on Pulse sits on a surface rendering Health Connect data. As drawn it is inside a **functional** mini-player with a transport control, which is compliant. **The moment it becomes an upsell, a Premium prompt or a partner placement on a health-data surface, it enters Play's Limited Use clause** (answer/9888170) prohibiting use of health data for serving ads. Pin this; do not let a growth experiment cross it.

## Explicitly UNVERIFIED — do not assume either way

- **There is no Health Connect brand-guidelines page** — the expected URL returns **404**. No required attribution line ("Powered by Health Connect" or similar) could be verified. **Do not invent one.** If the logo is ever used, it needs Android brand-team approval, which the brand guidelines say takes **at least a week**.
- **Pre-tap platform-availability disclosure** — no Google rule found requiring it. Our post-tap alert is not a violation. (Our own `SCREENS.md:161` asks for a pre-check anyway, and `healthConnect.ts:17-23` already returns `'unsupported'` before any user action — so gating the CTA is free.)
- **Data-type label matching** — no requirement found; accuracy still binds.
