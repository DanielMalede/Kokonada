# HALT — Health Connect / Play blockers: five in shipped Android code (2026-08-26), and the Play account type (2026-10-04)

**Raised:** 2026-08-26 by `compliance-auditor`, all sources fetched that day.
**Severity:** blocks **any** Play track, including closed testing. One item is a live user-facing privacy misstatement.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor` re-audit. Items 1 and 5 need a human (hosting + Play Console).
**Status:** (2026-10-04, `e4743af`) HALT 1–3 are fixed in code by HX-5 (#208) (`PermissionsRationaleActivity.kt:72-85`; `AndroidManifest.xml:82,91`). HALT 2–3 close on #208's device evidence (`CMP-067`, `MB-035`); HALT 1 also needs the hosted policy (`CMP-066`, `DAN-015`). HALT 4: the link ships on Sign-in and the Vault (`SignInScreen.tsx:109-111`; `VaultConsentPanel.tsx:56`), and on the consent sheet only from the build that sets `PRIVACY_POLICY_HOSTED` (`legalLinks.ts:30`; `ConsentSheet.tsx:221-225`); it closes once `DAN-015` hosts the page (`CMP-081`). HALT 5 and HALT 6 are open. HALT 5 is filed from the Play account that closes HALT 6, after `DAN-015`. The sections below are the text as raised.

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

## HALT 6 · Account type (CMP-093)

*Added 2026-10-04 from `compliance-auditor`'s re-check of `CMP-093`; sources fetched that day.*

**Requirement** — https://support.google.com/googleplay/android-developer/answer/10788890 (Play Console Requirements):
> "When creating your Play Console account, developers providing the following services must register as an Organization:" … "1.2. Health apps, such as Medical apps and Human Subjects Research apps. Learn more about Health app categories."

The linked page (answer/13996367) counts "Health and fitness apps" among health apps, and an app that reads health data must declare health features (answer/14738291).

**What stops** — no personal Google Play developer account is created for Kokonada, and no build goes to any Play track from one, internal testing included.

**Fix** — an organisation account with a D-U-N-S number ("up to 30 days", answer/13628312), or a written statement from Google Play that a Health-and-fitness-only declaration is outside §1.2. For the Israel tester stage an APK installed directly needs no Play account. The owner's steps are TASKS `DAN-056`, `DAN-057` and `DAN-058`.

## Exit criteria

*Added 2026-10-04.* The first upload to any Play track, internal testing included, waits until:
- HALT 1 to HALT 5 above are closed on evidence;
- **HALT 6 · Account type (CMP-093)** is closed: a verified organisation account with a D-U-N-S number exists, or Google Play's written statement is kept as `CMP-093` evidence;
- the store-gate hardening PR is merged, with:
  - the rxandroidble fix: `tools:node="remove"` on both `uses-permission-sdk-23` location entries that rxandroidble 1.17.2 adds to the merged release manifest with no `maxSdkVersion`, so the app declares location it never reads (`compliance-auditor`, V1 lab round 1: a HALT on any Play upload, not on a directly installed tester build);
    - **Satisfied in code by this PR (MB-093); closes when this PR's CI is green (the Android gate lines, the macOS phase run) and, for the Android line, when the Android 12+ device checks pass.** The main manifest removes both entries (`AndroidManifest.xml:28-33`). The merged release and debug manifests, the release variant's packaged manifest and a real debug APK (`aapt2 dump permissions`) carry neither, and FINE stays only up to API 30. CI's Android job holds every uploadable variant's merged permissions to `scripts/lab/uploadPermissions.mjs`. The Android 12+ device checks: `dumpsys package` lists no location permission, a live-HR scan works with only Nearby devices granted and Location off, and the permission dump of the exact artifact uploaded shows no location beyond FINE capped at API 30. **CI condition met, 2026-10-06:** PR #221's CI run 37428747263 on `5c01def` passed every job, the Android job that runs the gate included (https://github.com/DanielMalede/Kokonada/actions/runs/37428747263); #221 merged as `1c3ac55`, and main's run 37432740039 logs the gate lines (release 15 permissions, debug 16, all on their allow-lists). Still open here: the Android 12+ device checks and the dump of the exact artifact uploaded (TASKS `MB-093`).
  - the iOS `ENTRY_FILE` guard (a bundle-phase script, a pbxproj pin and a bash test), a precondition on any iOS archive: no iOS archive is exported for upload, and nothing goes to TestFlight or App Store Connect, until that PR is merged and the IPA scan exits 0.
    - **Satisfied in code by this PR (MB-093); closes when this PR's CI is green (the Android gate lines, the macOS phase run) and, for the Android line, when the Android 12+ device checks pass.** The bundle phase runs `ios/scripts/bundle-react-native.sh` through `with-environment.sh`. Before `react-native-xcode.sh` runs, the wrapper refuses: any `ENTRY_FILE` other than `index.js`; an `index.ios.js`; a non-empty `EXTRA_PACKAGER_ARGS`, `CLI_PATH`, `BUNDLE_COMMAND`, `BUNDLE_CONFIG`, `CONFIG_JSON`, `CONFIG_CMD`, `NODE_ARGS` or `BUNDLE_NAME`; a `PROJECT_ROOT` other than the app root; and `SKIP_BUNDLING` outside Debug. `scripts/ios/__tests__/bundlePhase.test.ts` pins the phase and runs it. The refusals are not exhaustive, so the IPA scan with exit 0 stays a condition on every archive and the control for every input; the first Release archive log (the wrapper ran and `main.jsbundle` was produced) is still owed. **CI condition met, 2026-10-06:** PR #221's CI run 37428747263 on `5c01def` passed every job, its macOS iOS build taking the bundle phase through the wrapper (https://github.com/DanielMalede/Kokonada/actions/runs/37428747263), and #221 merged as `1c3ac55`. CI builds Debug for the simulator, where bundling is skipped, so the first Release archive log and the scan of that exact IPA stay open (TASKS `OPS-143`).

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
