# HALT — Sign in with Apple cannot work: the iOS entitlement does not exist

**Raised:** 2026-08-26 by `compliance-auditor`, verified against App Review Guidelines fetched that day.
**Severity:** store-submission blocker. App Review Guideline **2.1(a)** and **4.8**.
**Routing:** **Pause & Guide** — a human must do steps 1–2 in the Apple Developer portal and Xcode. Then `developer` for step 4.
**Status:** not started.

---

## The defect

`SignInScreen.tsx:89-95` renders Apple's official `AppleButton`, and `auth.ts:70` calls `appleAuth.performRequest(...)`. The client code is correct. **The iOS project has no entitlement for it.**

| Check | Result |
|---|---|
| `mobile/KokonadaHealth/ios/**/*.entitlements` | **no file exists** |
| `CODE_SIGN_ENTITLEMENTS` in `KokonadaHealth.xcodeproj/project.pbxproj` | **not present** |
| `com.apple.developer.applesignin` anywhere under `ios/` | **zero matches** |
| A `.gitignore` rule hiding it | none — the absence is real |

Without `com.apple.developer.applesignin` in the binary, `ASAuthorizationController` fails immediately with `ASAuthorizationError.unknown` (1000). A reviewer taps the button, gets an error, and the app is rejected under 2.1 — **and** under 4.8, because the alternative login required alongside Google Sign-In does not function.

## Why our tests said this was fine — a false green

The only evidence Apple sign-in works is two Jest suites that **mock the native module**: `src/auth/__tests__/SignInScreen.test.tsx:95` and `src/auth/__tests__/loginFlow.test.ts:84`. There is no on-device proof. There is also no `ios/Podfile.lock` in the repo, so the iOS pod graph has never been resolved here.

This is exactly the failure mode `CLAUDE.md` warns about for the `developer` agent: *"real (on-device) evidence, never green mocks."* Two passing suites certified a capability that cannot execute.

## Guideline 4.8 — and the trap in it

Fetched 2026-08-26 from https://developer.apple.com/app-store/review/guidelines/:

> "Apps that use a third-party or social login service (such as Facebook Login, **Google Sign-In**, …) to set up or authenticate the user's primary account with the app **must also offer as an equivalent option another login service**…"

> "Another login service is not required if: **Your app exclusively uses your company's own account setup and sign-in systems.**"

Google Sign-In is named explicitly, so 4.8 is triggered. **Landing the email/password path does not exempt us** — the exception is conditioned on *"exclusively"*, and an app offering Google *and* first-party email is not exclusive. Our own email system also cannot satisfy 4.8's capability profile, because it offers no email-relay privacy option.

The gating logic itself is correct — `SignInScreen.tsx:49` gates on `Platform.OS === 'ios' && appleAuth.isSupported`, and with `IPHONEOS_DEPLOYMENT_TARGET = 15.1` there is no device where Google renders and Apple silently hides. The backend correctly accepts Apple's private-relay address (`auth.ts:67-68`). **All of that is void until the entitlement exists.**

## The fix

1. **Apple Developer portal** → Certificates, IDs & Profiles → the App ID → enable **Sign In with Apple**; regenerate provisioning profiles.
2. **Xcode** → target → Signing & Capabilities → **+ Capability → Sign In with Apple**. This creates `KokonadaHealth.entitlements` with `com.apple.developer.applesignin = [Default]` and sets `CODE_SIGN_ENTITLEMENTS`. **Commit that file.**
3. Confirm `POST /api/auth/apple` verifies the identity token against the Services ID / bundle ID matching the enabled capability.
4. **Gate release on a real-device run, not a Jest run.** Add an on-device verification step to the device-QA runbook so this cannot be certified by mocks again.

## Related

- `docs/plans/DEV_SIGNIN_BRAND_ASSETS.md` — the mark/asset failures on the same screen.
- `docs/plans/DEV_EMAIL_SIGNIN_PATH.md` — note the "exclusively" clause above; that item does **not** remove this obligation.
