---
status: living
verified: 2026-10-19
owner: the owner (DAN- rows); security-auditor and resilience-auditor review (J17)
---

# Android release signing and the standalone build

How the production Android build of `mobile/KokonadaHealth` is signed and produced. Every step below was checked against `mobile/KokonadaHealth/android/app/build.gradle` on 2026-10-19 (the signing block landed in #174); writing it ran none of the commands, and no CI job signs, packages or bundles a release (`.github/workflows/ci.yml` compiles only). The older kit document (`RELEASE_SIGNING.md` under `mobile/native-snippets/`, now a Deleted row in `docs/ARCHIVE.md`; this file is a rewrite, not a copy) described a generated project that no longer exists.

## 1. What the build reads

`android/app/build.gradle` (lines 91–98 and 118–146 at the time of writing):

- It looks for `android/keystore.properties` next to the Gradle root. When the file exists, `signingConfigs.release` takes `storeFile`, `storePassword`, `keyAlias` and `keyPassword` from it; `storeFile` resolves relative to `android/app/`.
- `buildTypes.release` signs with `signingConfigs.release` when that file exists, else with the debug key, and prints no warning when it falls back. The debug key is `android/app/debug.keystore` (or the file the `kokonadaDebugKeystore` project property names, as `scripts/lab` passes it), which is untracked (`.gitignore:40`) and held per checkout, so a fresh clone or a task worktree has neither file. Build a release only in the checkout that holds `keystore.properties` and the release keystore.
- The `lab` build type (`applicationIdSuffix ".lab"`, the Design Lab, MB-084) always signs with the debug key, is never built as an App Bundle and is never uploaded.
- Identity: `applicationId "com.kokonadahealth"`, `versionCode 1`, `versionName "1.0"`. `versionCode` must strictly increase on every upload to Play. Whether the package stays `com.kokonadahealth` is `DAN-045`; once the app is published it can never change.

What keeps the two secret-bearing files out of git, and what does not:

- `mobile/KokonadaHealth/.gitignore:34,38` ignores `*.keystore` and `keystore.properties` by basename, under `mobile/KokonadaHealth/` only. A renamed copy (`keystore.properties.bak`, `keystore - Copy.properties`) is not ignored.
- `.githooks/pre-commit` refuses a staged `.keystore`, `.jks` or `.p12`, but not `keystore.properties`, and without gitleaks its fallback scan has no password pattern (`OPS-002`).
- `git add -f`, `--no-verify` or a clone without `core.hooksPath=.githooks` passes both. Never force-add either file, and keep every copy outside the repository.

## 2. The release keystore (permanent; back it up)

- File: `mobile/KokonadaHealth/android/app/kokonada-release.keystore`, alias `kokonada`; credentials in `mobile/KokonadaHealth/android/keystore.properties` (keys `storeFile`, `storePassword`, `keyAlias`, `keyPassword`). It exists; never create a second release key.
- The release certificate's SHA-1 is registered in the Google Cloud Console (the Android OAuth client of the Kokonada project) and in the Spotify developer dashboard. A build signed with a key whose certificate is not registered there cannot sign in with Google or connect Spotify. Read the fingerprint from the keystore when needed (`keytool -list -v -keystore kokonada-release.keystore -alias kokonada`, which prompts for the password); it is not written here.
- Losing the keystore or its passwords means the installed app can never be updated under the same signature. Back up the keystore and `keystore.properties` to two places and test one restore (`DAN-053` item 3): encrypted, offline or in a password manager, with the passwords kept apart from the file; never in a synced folder or in any git repository, `Kokonada-private` included.
- Play App Signing is decided before the first bundle upload. Play signs what it delivers with an app-signing key, and for a new app it generates that key unless one is supplied; the certificate Play signs with is the one Google sign-in and Spotify see on every store install:
  - Keep Google's key: register its fingerprints (Play Console → Protected with Play → Play Store distribution → Play app signing) in the Android OAuth client and the Spotify dashboard, beside the release certificate. Installs sideloaded from `kokonada-release.keystore` then cannot be updated from Play, nor the reverse.
  - Supply `kokonada-release.keystore` as the app-signing key: a separate upload key then signs what is uploaded (Google advises the two keys differ). Whether a new app can do this is not verified here; confirm it in the Console first.
  - Check Google sign-in and Spotify connect on the internal testing track before any wider track.

## 3. Build the standalone release

Before building, put the real `mobile/KokonadaHealth/src/health/config.ts` in place. The tracked copy holds placeholders (`BACKEND_URL`, `GOOGLE_WEB_CLIENT_ID` and `SPOTIFY_CLIENT_ID` hold `YOUR` values; `KW-016` in `WEAKNESSES_AND_FAILURES.md`), and a build made from it reaches no backend, cannot sign in and cannot play. The real copy is never committed, and nothing refuses a build that still holds a `YOUR` value.

From `mobile/KokonadaHealth/android`, with a JDK 17 on `JAVA_HOME`:

```
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK lands under `app/build/outputs/apk/release/`. The JS bundle and Hermes bytecode are embedded, so the installed app runs without Metro (release is not a debuggable variant). For a Play upload build a bundle instead:

```
./gradlew :app:bundleRelease
```

Verify the signer before sideloading or uploading. The APK (`apksigner` reads every signature scheme the plugin wrote):

```
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

The bundle, which carries a JAR signature (`apksigner` is for APKs):

```
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
```

A pass: the signer is not `CN=Android Debug`, and its SHA-256 equals the release certificate's (`keytool -list -v`, section 2). A build in a checkout without `keystore.properties` is debug-signed, with no warning: it will not keep the data of an installed release build, and it fails Google sign-in and Spotify connect (section 2).

## 4. Sideload for on-device QA

Copy the APK to the phone and install it; the same signature keeps the installed data and sign-in. `/device-qa` (`.claude/commands/device-qa.md`) has the capture runbook; `adb devices` first, the test phone drops its USB link intermittently.

## 5. Testers' Spotify connect (beta path)

Spotify Development Mode caps a solo developer's app at five authorised users, and the app owner's Spotify account must have Premium for the app to work in that mode (`CMP-001`). The public build shows Spotify as unavailable; the five-tester build flips `SPOTIFY_BETA_CONNECT` in `mobile/KokonadaHealth/src/experience/connect/betaFlags.ts` locally and uncommitted (its tripwire test keeps it `false` on `main`). Each tester's Spotify account is added in the Spotify dashboard under User Management. The dashboard's Redirect URIs hold both:

- the app's `kokonadahealth://spotify-callback` (`SPOTIFY_REDIRECT_URI` in `src/health/config.ts`; its scheme and host are the manifest placeholders at `build.gradle:112-116`), which App Remote authorises with;
- the backend's `/api/integrations/spotify/callback` URL, which must equal Railway's `SPOTIFY_REDIRECT_URI` exactly (`backend/app/services/spotify.js`).

The quota question itself is `/spotify-quota`.

## 6. What this runbook does not cover

Play Console forms, the privacy-policy URL and the store declarations (`docs/store/`), and the iOS build. The Play identity question (`DAN-045`) and the HALT items in `docs/plans/halts.md` gate the first store upload.
