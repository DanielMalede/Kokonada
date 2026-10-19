---
status: living
verified: 2026-10-19
owner: the owner (DAN- rows); security-auditor and resilience-auditor review (J17)
---

# Android release signing and the standalone build

How the production Android build of `mobile/KokonadaHealth` is signed and produced. Every step below was checked against `mobile/KokonadaHealth/android/app/build.gradle` on 2026-10-19 (the signing block landed in #174); writing it ran none of the commands, and no real release has been built from it yet (`OPS-028`, `OPS-103`). CI builds the release JS bundle (`:app:createBundleReleaseJsAndAssets` in `.github/workflows/ci.yml`) but validates no signing, packages no APK and runs no `bundleRelease`. The older kit document (`RELEASE_SIGNING.md` under `mobile/native-snippets/`, now a Deleted row in `docs/ARCHIVE.md`; this file is a rewrite, not a copy) described a generated project that no longer exists.

## 1. What the build reads

`android/app/build.gradle` (lines 91–98 and 118–146 at the time of writing):

- It looks for `android/keystore.properties` next to the Gradle root. When the file exists, `signingConfigs.release` takes `storeFile`, `storePassword`, `keyAlias` and `keyPassword` from it; `storeFile` resolves relative to `android/app/`.
- `buildTypes.release` signs with `signingConfigs.release` when that file exists, else with the debug key, and prints no warning when it falls back. The debug key is `android/app/debug.keystore` (or the file the `kokonadaDebugKeystore` project property names, as `scripts/lab` passes it). It is untracked (`**/debug.keystore` at `.gitignore:40`; `*.keystore` at `mobile/KokonadaHealth/.gitignore:34`) and held per checkout: a task worktree may hold its own (`MB-089`), and a fresh clone holds none, where the release build most likely stops at signing validation instead (not verified). Neither holds the release files. Build a release only in the checkout that holds `keystore.properties` and the release keystore, today the main checkout, and leave it clean afterwards (section 3).
- The `lab` build type (`applicationIdSuffix ".lab"`, the Design Lab, MB-084) always signs with the debug key, is never built as an App Bundle and is never uploaded.
- Identity: `applicationId "com.kokonadahealth"`, `versionCode 1`, `versionName "1.0"`. `versionCode` must strictly increase on every upload to Play. Whether the package stays `com.kokonadahealth` is `DAN-045`; once the app is published it can never change.

What keeps the two secret-bearing files out of git, and what does not:

- `mobile/KokonadaHealth/.gitignore:34,38` ignores `*.keystore` and `keystore.properties` by basename, under `mobile/KokonadaHealth/` only. A renamed copy (`keystore.properties.bak`, `keystore - Copy.properties`) is not ignored.
- `.githooks/pre-commit` refuses a staged `.keystore`, `.jks` or `.p12`, but not `keystore.properties`, and without gitleaks its fallback scan has no password pattern (`OPS-002`).
- `git add -f` passes the ignore rule (the hook still refuses a `.keystore`, not `keystore.properties`); `--no-verify`, or a clone without `core.hooksPath=.githooks`, passes the hook. Never force-add either file, and keep every other copy outside the repository.
- Inside the main checkout, any session on this machine can read both files, and commands that `.claude/settings.json` pre-allows can publish them without a prompt; the repository is public (`OPS-303`). Until that row moves them out of the tree or closes that access, treat both as exposed to every session here.

## 2. The release keystore (permanent; back it up)

- File: `mobile/KokonadaHealth/android/app/kokonada-release.keystore`, alias `kokonada`; credentials in `mobile/KokonadaHealth/android/keystore.properties` (keys `storeFile`, `storePassword`, `keyAlias`, `keyPassword`). It exists: never create a second release key, and never copy `mobile/native-snippets/keystore.properties.example` over the existing `keystore.properties`, which holds the only recorded copy of the release passwords (`KW-034`).
- The release certificate's SHA-1 is registered in the Google Cloud Console (the Android OAuth client of the Kokonada project) and in the Spotify developer dashboard, as the July handoff recorded; the owner lists what both consoles hold under `DAN-097`. A build signed with a key whose certificate is not registered there cannot sign in with Google or connect Spotify. Read the fingerprint from the keystore when needed (`keytool -list -v -keystore kokonada-release.keystore -alias kokonada`, which prompts for the password); it is not written here. Never pass a password on a command line (`-storepass`, `-Pandroid.injected.signing.store.password`): it lands in shell history.
- Losing the keystore or its passwords means the installed app can never be updated under the same signature. Back them up to two places and test one restore (`DAN-053` item 3): the keystore on encrypted offline media; `keystore.properties`, or its two passwords, only in a password manager or an encrypted volume; never in a synced folder or in any git repository, `Kokonada-private` included. Where the copies are is recorded outside this public repository.
- Play App Signing is decided before the first bundle upload, in the owner's own words (`DAN-096`). Play signs what it delivers with an app-signing key. For a new app it generates one by default ("quantum-ready, hybrid signing with Google-generated keys": an RSA 4096 key with a post-quantum ML-DSA-65 key), and a developer can supply their own only before the app's first release; confirm the exact cut-off in the Console (Play Console Help 9842756, as `compliance-auditor` and `security-auditor` read it on 2026-10-19). Google sign-in and Spotify see the certificate Play signs with on every store install.
  - Recommended (`security-auditor` on #264): keep Google's app-signing key and use `kokonada-release.keystore` as the upload key; a lost upload key can be reset by Google, a lost app-signing key cannot. Register Google's app-signing certificate (Play Console → Protected with Play → Play Store distribution → Play app signing) with Google sign-in and in the Spotify dashboard, beside the release certificate. An Android OAuth client holds one package and one SHA-1, so Google's certificate most likely needs a second Android client (not verified; confirm in the Cloud Console). While the release certificate stays registered, the release key remains a valid Google sign-in and Spotify credential for the package. Store installs and sideloaded installs then carry different signatures, so neither can update the other.
  - The alternative: supply `kokonada-release.keystore` as the app-signing key, which gives up the hybrid key. Google advises that the upload key and the app-signing key differ, so a new upload key then signs what is uploaded, `keystore.properties` points at it for `bundleRelease`, and its certificate is registered too if sideloaded builds are signed with it.
  - Check Google sign-in and Spotify connect on the internal testing track before any wider track, with a Spotify account already linked through the sideloaded tester build (section 5).

## 3. Build the standalone release

Before building, put the real `mobile/KokonadaHealth/src/health/config.ts` in place: the owner's copy in `Kokonada-private`, which `KW-016` in `WEAKNESSES_AND_FAILURES.md` asks for (until it exists, the only real copies are uncommitted edits in two worktrees). The tracked copy holds placeholders (`BACKEND_URL`, `GOOGLE_WEB_CLIENT_ID` and `SPOTIFY_CLIENT_ID` hold `YOUR` values), and a build made from it reaches no backend, cannot sign in and cannot play; nothing refuses a build that still holds a `YOUR` value. Never stage or commit the real copy, and never hide it with `git update-index --skip-worktree`. When the build is done, restore the template (`git checkout -- mobile/KokonadaHealth/src/health/config.ts`): the main checkout must stay clean, or the session start cannot fast-forward it (`CLAUDE.md`, session start step 2).

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

A pass: the signer is not `CN=Android Debug`, and its SHA-256 equals the certificate of the key meant to sign that file (`keytool -list -v`, section 2): the release certificate for a sideloaded APK, and the upload key's certificate for a bundle, which is the release certificate under the recommended choice. A release build in a checkout that has a debug keystore but no `keystore.properties` is debug-signed, with no warning: it will not keep the data of an installed release build, and it fails Google sign-in and Spotify connect.

Before any upload, on any Play track, internal app sharing included, scan the exact file (`QA-077` D9, `OPS-103`): from `mobile/KokonadaHealth`, run `node scripts/lab/assertLabExcluded.mjs --scan <the .aab or .apk to upload>`. Exit 0 is required, and exit 1 or 2 blocks the upload; keep the artifact's name, its SHA-256 and the exit code with the upload record (`docs/store/play-health-connect-declaration.md`, the Design Lab line).

## 4. Sideload for on-device QA

Copy the APK to the phone and install it; the same signature keeps the installed data and sign-in. `/device-qa` (`.claude/commands/device-qa.md`) has the capture runbook; `adb devices` first, the test phone drops its USB link intermittently.

## 5. Testers' Spotify connect (beta path)

Spotify Development Mode caps a solo developer's app at five authorised users, and the app owner's Spotify account must have Premium for the app to work in that mode (`CMP-001`). The public build shows Spotify as unavailable; the five-tester build flips `SPOTIFY_BETA_CONNECT` in `mobile/KokonadaHealth/src/experience/connect/betaFlags.ts` locally and uncommitted (its tripwire test keeps it `false` on `main`). That build is an APK sideloaded to the allow-listed testers only: never build it as a bundle and never upload it to any Play track, since anyone not on the list would see Spotify connect and get errors, and a promoted build would break `CMP-001`. Revert the flag before any `bundleRelease`. Each tester's Spotify account is added in the Spotify dashboard under Users Management. The dashboard's Redirect URIs hold both:

- `kokonadahealth://spotify-callback`, the tracked template's `SPOTIFY_REDIRECT_URI` (`src/health/config.ts`; its scheme and host are the manifest placeholders at `build.gradle:112-116`);
- the backend's `/api/integrations/spotify/callback` URL, which must equal Railway's `SPOTIFY_REDIRECT_URI` exactly (`backend/app/services/spotify.js`).

The real `config.ts` sets the app's `SPOTIFY_REDIRECT_URI` to the backend URL, not to the scheme. Which one the shipped build authorises with is open (`DAN-098`); remove neither from the dashboard until it is ruled. The quota question itself is `/spotify-quota`.

## 6. What this runbook does not cover

Play Console forms, the privacy-policy URL and the store declarations (`docs/store/`), and the iOS build. The Play identity question (`DAN-045`), the Play App Signing choice (`DAN-096`), the `QA-077` D9 scan (`OPS-103`) and the HALT items in `docs/plans/halts.md` gate the first store upload.
