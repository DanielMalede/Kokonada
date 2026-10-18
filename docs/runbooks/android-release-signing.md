---
status: living
verified: 2026-10-18
owner: the owner (DAN- rows); security-auditor and resilience-auditor review (J17)
---

# Android release signing and the standalone build

How the production Android build of `mobile/KokonadaHealth` is signed and produced. Every step below was checked against `mobile/KokonadaHealth/android/app/build.gradle` on 2026-10-18 (the signing block landed in #174). The older kit document (`RELEASE_SIGNING.md` under `mobile/native-snippets/`, now a Deleted row in `docs/ARCHIVE.md`; this file is a rewrite, not a copy) described a generated project that no longer exists.

## 1. What the build reads

`android/app/build.gradle` (lines 91–97 and 128–146 at the time of writing):

- It looks for `android/keystore.properties` next to the Gradle root. When the file exists, `signingConfigs.release` takes `storeFile`, `storePassword`, `keyAlias` and `keyPassword` from it.
- `buildTypes.release` signs with `signingConfigs.release` when that file exists, else with the debug key, so a fresh clone and CI still build.
- The `lab` build type (`applicationIdSuffix ".lab"`, the Design Lab, MB-084) always signs with the debug key and is never uploaded.
- Identity: `applicationId "com.kokonadahealth"`, `versionCode 1`, `versionName "1.0"`. `versionCode` must strictly increase on every upload to Play.

Both secret-bearing files are ignored by `mobile/KokonadaHealth/.gitignore` (`keystore.properties`, `*.keystore`), and `.githooks/pre-commit` refuses a staged `.keystore`, `.jks` or `.p12`. They never enter the repository.

## 2. The release keystore (permanent; back it up)

- File: `mobile/KokonadaHealth/android/app/kokonada-release.keystore`, alias `kokonada`; credentials in `mobile/KokonadaHealth/android/keystore.properties` (keys `storeFile`, `storePassword`, `keyAlias`, `keyPassword`).
- The release certificate's SHA-1 is registered in the Google Cloud Console (the Android OAuth client of the Kokonada project) and in the Spotify developer dashboard. A build signed with another key cannot sign in with Google or connect Spotify. Read the fingerprint from the keystore when needed (`keytool -list -v -keystore kokonada-release.keystore -alias kokonada`); it is not written here.
- Losing the keystore or its passwords means the installed app can never be updated under the same signature. Play App Signing (Play holds the app-signing key; the upload key can be rotated) is the recommended enrolment before the first store upload.

## 3. Build the standalone release

From `mobile/KokonadaHealth/android`, with a JDK 17 on `JAVA_HOME`:

```
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK lands under `app/build/outputs/apk/release/`. The JS bundle and Hermes bytecode are embedded, so the installed app runs without Metro (release is not a debuggable variant). For a Play upload build a bundle instead:

```
./gradlew :app:bundleRelease
```

Verify the signature before sideloading or uploading (with `minSdkVersion 26` the Android Gradle plugin signs with the v2/v3 schemes, which `jarsigner` does not see):

```
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

A build on a machine without `keystore.properties` is debug-signed and will not keep the data of an installed release build; it also fails Google sign-in and Spotify connect (section 2).

## 4. Sideload for on-device QA

Copy the APK to the phone and install it; the same signature keeps the installed data and sign-in. `/device-qa` (`.claude/commands/device-qa.md`) has the capture runbook; `adb devices` first, the test phone drops its USB link intermittently.

## 5. Testers' Spotify connect (beta path)

Spotify Development Mode caps a solo developer's app at five authorised users. The public build shows Spotify as unavailable; the five-tester build flips `SPOTIFY_BETA_CONNECT` in `mobile/KokonadaHealth/src/experience/connect/betaFlags.ts` locally and uncommitted (its tripwire test keeps it `false` on `main`). Each tester's Spotify account is added in the Spotify dashboard under User Management, and the backend's integrations callback URL is in its Redirect URIs. The quota question itself is `/spotify-quota`.

## 6. What this runbook does not cover

Play Console forms, the privacy-policy URL and the store declarations (`docs/store/`), and the iOS build. The Play identity question (`DAN-045`) and the HALT items in `docs/plans/halts.md` gate the first store upload.
