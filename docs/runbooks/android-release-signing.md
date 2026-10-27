---
status: living
verified: 2026-10-27
owner: the owner (DAN- rows); security-auditor and resilience-auditor review (J17)
---

# Android release signing and the standalone build

How the production Android build of `mobile/KokonadaHealth` is produced and signed. Since #271 (`3a5e28a`, `OPS-303`) Gradle signs no release build: `assembleRelease` yields `app-release-unsigned.apk`, which no device installs, and the one signing step is `mobile/KokonadaHealth/scripts/release/sign-release.ps1`, run by the owner as the Windows account `kokonada-signer`, the only account (with SYSTEM) that can read the upload key. Every statement below was checked on 2026-10-27 against `main` at `0f4674f`: `mobile/KokonadaHealth/android/app/build.gradle`, the script, `.gitignore`, `.githooks/pre-commit`, `.claude/settings.json` and `mobile/KokonadaHealth/src/__tests__/releaseSigning.test.ts`. Writing it ran none of the commands.

**Not provisioned yet.** On 2026-10-27 `C:\KokonadaSigner` does not exist on the owner's machine, so the account, the vault, the tools and the upload key described here are still to be set up (section 2). Until they are, no release-signed build can be made, and the old release key (`kokonada-release.keystore` with its `keystore.properties`) is still in the main checkout, git-ignored (`OPS-303`). CI builds the release JS bundle (`:app:createBundleReleaseJsAndAssets`, `.github/workflows/ci.yml:244`) but packages no APK and runs no `bundleRelease`, so that `assembleRelease` really yields an unsigned APK has not been checked by a build yet (RA-271-5). The older kit documents (`mobile/native-snippets/RELEASE_SIGNING.md` and `mobile/SETUP_ANDROID.md`, now Deleted rows in `docs/ARCHIVE.md`) described a generated project that no longer exists.

## 1. What the build does, and does not, read

`android/app/build.gradle`:

- `signingConfigs` holds the debug config only (`:109-119`). `buildTypes.release` (`:125-135`) names no `signingConfig`, loads no `keystore.properties` and has no debug fallback, so a release build that skips the signer cannot be installed. `releaseSigning.test.ts` pins this as text (rules `[gradle-keystore]`, `[gradle-configs]`, `[gradle-release]`, `[gradle-fallback]` at `:124-127`) and fails on any signing config, fallback or `keystore.properties` read in the release path.
- The debug key is `android/app/debug.keystore`, or the file named by the `kokonadaDebugKeystore` project property, which `scripts/lab` passes (`:111-114`). It is untracked (`.gitignore:40`) and each checkout holds its own copy (`MB-089`). The `lab` build type (`:141-144`, `applicationIdSuffix ".lab"`, the Design Lab, `MB-084`) always signs with the debug key, is never built as an App Bundle and is never uploaded.
- Identity: `applicationId "com.kokonadahealth"` (`:98`), `versionCode 1` (`:101`), `versionName "1.0"` (`:102`). `versionCode` must strictly increase on every upload to Play. Whether the package stays `com.kokonadahealth` is `DAN-045`; once the app is published it can never change.
- `mobile/native-snippets/keystore.properties.example` is still tracked, but the build no longer reads any `keystore.properties`. Three places name it by its exact path: `.gitignore:48`, `.githooks/pre-commit:23` and `backend/tests/preCommitSecretGuard.test.js:37`. Its text still describes the old flow (L-271-1).

What keeps a signing secret out of git if one ever reaches a checkout:

- `.gitignore:44-47` ignores every copy of `*keystore*.properties*`, `*.keystore*`, `*.jks*` and `*.p12*` anywhere in the tree (#267, `OPS-002`), and `:40` ignores `**/debug.keystore`.
- `.githooks/pre-commit:20-28` refuses a staged path of those shapes, under any name a copy gets. Its fallback scan (`:38-50`) runs only on a machine without gitleaks. It refuses an added line that sets `storePassword` or `keyPassword` to any value but `CHANGE_ME` (`:45-50`). The hook is tracked as 100755, so git runs it on every OS (`:5`).
- `git add -f` gets past the ignore rule and `--no-verify` gets past the hook. Never use either on a secret.
- `.claude/settings.json` (#270, `OPS-171`) denies every session Read and Edit of these paths:
  - `**/keystore.properties`, `**/*.keystore`, `**/*.jks`, `**/*.p12`, `**/*.p8` and `**/*.pem` (`:259-270`);
  - `C:\KokonadaSigner\**`, written `//c/KokonadaSigner/**` (`:283-284`);
  - `**/*.key` and `**/*.pfx` (`:301-304`).

  A deny wins over any allow in a local or user settings file. `backend/tests/claudeSettings.policy.test.js:305-342` pins these denies.

## 2. The upload key, the signer account and its folders

The key is meant to live only under `kokonada-signer`, so no checkout and no session can read it: the owner's rulings of 2026-10-20 `F1` (a separate Windows account) and `F7` (rotate the key now), recorded under `OPS-303`.

- **The key.** It is `C:\KokonadaSigner\vault\kokonada-upload.p12`: PKCS12, alias `kokonada-upload` (`sign-release.ps1:28`, `:124-125`; the script reads no other name). The owner generates it as `kokonada-signer` inside the vault.
- **Its password.** It lives only in `C:\KokonadaSigner\vault\ks.pass`. That account writes it once with `Read-Host -AsSecureString | ConvertFrom-SecureString | Set-Content C:\KokonadaSigner\vault\ks.pass` (`:29-31`), which binds it to that account on this machine through DPAPI.
- **The old key.** `kokonada-release.keystore` (alias `kokonada`) is retired by the rotation. The old certificate's removal from the Google Cloud and Spotify consoles, and the new certificate's registration there, are `DAN-097`. Each copy of the old key is deleted, or kept only on offline media.
- **Fingerprints.** The new certificate's SHA-1 and SHA-256 are registered before any release-signed build reaches a tester. They go on the Android OAuth client of the Kokonada project (package `com.kokonadahealth`) in the Google Cloud Console, and in the Spotify developer dashboard (`DAN-097`). A build signed with an unregistered certificate cannot sign in with Google or connect Spotify. Read the fingerprints from `apksigner verify --print-certs` on a signed build. They are public and are not written here.
- **What the backend checks.** Today it checks only the token's `aud` (`backend/app/controllers/authController.js:19`). The `azp` allowlist of the project's own Android clients lands with `BE-180`, which has not merged. From then on, every Android client that signs a shipped build goes into that list before the build is tested, Play's app-signing certificate included.
- **No password on a command line.** Never pass one (`-storepass`, `--ks-pass pass:`, `-Pandroid.injected.signing.store.password`): it lands in shell history. The script never does.
- **Backups.** If the key or its password is lost, the installed app cannot be updated under the same signature until Play resets the upload key. Back both up to two places and test one restore (`DAN-053` item 3):
  - the key file on two encrypted offline drives;
  - the password only in a password manager;
  - never in a synced folder, and never in any git repository, `Kokonada-private` included.

  Where the copies are is recorded outside this public repository. Prove the restore by signing one test APK with the restored copy.
- **Play App Signing.** It is decided before the first bundle upload, in the owner's own words (`DAN-096`). `security-auditor` recommended on #264 that Google keeps the app-signing key and `kokonada-upload.p12` serves as the upload key, because Google can reset a lost upload key but nobody can recover a lost app-signing key. Under that choice:
  - Register Google's app-signing certificate beside the upload certificate, with Google sign-in and in the Spotify dashboard. It is under Play Console → Protected with Play → Play Store distribution → Play app signing.
  - Store installs and sideloaded installs carry different signatures, so neither can update the other.
  - Check Google sign-in and Spotify connect on the internal testing track before any wider track.

### Provisioning, once, by the owner

1. **The account and its folders.** Create the standard Windows account `kokonada-signer`, then create these folders under `C:\KokonadaSigner`:

   | Folder | Who may use it | What it holds |
   |---|---|---|
   | `in\` | the owner's account writes, `kokonada-signer` reads | the unsigned APK |
   | `work\` | `kokonada-signer` Modify, SYSTEM Full Control, nobody else | the script's working copies, removed at the end of every run (`:301-306`) |
   | `out\` | receives the verified APK, and nothing else (`:299`) | the signed APK |
   | `bin\` | writable by administrators only | the tools and the script |
   | `vault\` | `kokonada-signer` and SYSTEM only | the key and `ks.pass` |

   A JVM crash log `hs_err_*.log` can land in `work\` (`:140`); the script never removes it. After reading one, delete it from the signer session (RA-271-R2-4).
2. **The tools.** Put the four tools in `bin\`:
   - `zipalign.exe`, `aapt2.exe` and `lib\apksigner.jar` from Android build-tools 35 or newer, under `C:\KokonadaSigner\bin\build-tools\` (`:127-129`);
   - the dedicated JDK under `C:\KokonadaSigner\bin\jdk\`, so that `java.exe` sits at `bin\jdk\bin\java.exe` (`:130`).

   The JDK is Eclipse Temurin 17, an OpenJDK build under GPLv2 with the Classpath Exception, release `jdk-17.0.20.1+1`. The file is `OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip`, SHA-256 `e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0`. That value was read on 2026-10-27 from the Adoptium API and from the release's `.sha256.txt` on github.com/adoptium/temurin17-binaries, and both agree. Compare the downloaded zip with it (`Get-FileHash <zip> -Algorithm SHA256`) before extracting. Do not use Oracle JDK (its NFTC licence) or the IDE's JBR, which an IDE in the owner's account keeps updating. Moving to a later Temurin 17 build is a change to this runbook in its own PR, with its own hash.
3. **The script.** Copy the repository's script into `bin\` as `C:\KokonadaSigner\bin\sign-release.ps1`.
   - Copy its LF bytes (`git show origin/main:mobile/KokonadaHealth/scripts/release/sign-release.ps1`). A copy from a CRLF checkout hashes differently.
   - Check the copy with `Get-FileHash -Algorithm SHA256`. The value must be `e5e738923aa03af15473261ca7c7abe859ef17031aed248cb9c466cd0e9d2606`: the copy on `main`, landed in #271 (`3a5e28a`) and unchanged at `0f4674f`.
   - Any change to the script on `main` changes this line in the same PR.
4. **The four tool pins.** Run `Get-FileHash -Algorithm SHA256` on the four tools. Write the lower-case values into the four lines `$ZipalignSha256`, `$Aapt2Sha256`, `$ApksignerSha256` and `$JavaSha256` of the copy in `C:\KokonadaSigner\bin` (`:134-137`). Only that copy changes: the repository copy keeps the placeholders `<pin after provisioning>`. Until all four are filled, every run is refused by design (`:174-177`).
5. **The edited copy's hash.** Record `Get-FileHash` of the edited copy in the owner's private record, outside this public repository. Compare it before every run (section 3, step 2). A copy that differs must not run.
6. **The ACLs.** Record `icacls` of `work\`, `out\`, `vault\` and `bin\` with the build record (RA-271-R2-3). The script refuses a link on these folders but never reads their permissions, so this listing is the only check that `work\` admits nobody else.
7. **The key and its password.** As `kokonada-signer`, generate the key in `vault\` and write `ks.pass` as above.

## 3. Build unsigned, then sign as `kokonada-signer`

Before building, put the real `mobile/KokonadaHealth/src/health/config.ts` in place: the owner's copy in `Kokonada-private` (`KW-016`).

- The tracked copy holds placeholders: `BACKEND_URL`, `GOOGLE_WEB_CLIENT_ID` and `SPOTIFY_CLIENT_ID` hold `YOUR` values (`config.ts:2`, `:7`, `:14`). A build made from it reaches no backend, cannot sign in and cannot play, and nothing refuses a build that still holds a `YOUR` value.
- Never stage or commit the real copy, and never hide it with `git update-index --skip-worktree`.
- When the build is done, restore the template with `git checkout -- mobile/KokonadaHealth/src/health/config.ts`. The main checkout must stay clean, or the session start cannot fast-forward it (`CLAUDE.md`, session start step 2).

**Step 1, from `mobile/KokonadaHealth/android`, with a JDK 17 on `JAVA_HOME`.** Not the IDE's JBR: #271's developer reported that it is JDK 25 and fails the arm64 CMake configure. That report has not been re-checked here.

```
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The output is `app/build/outputs/apk/release/app-release-unsigned.apk`. The JS bundle and Hermes bytecode are embedded, so the installed app runs without Metro: release is not a debuggable variant (`build.gradle:36`). Copy it under a plain name into `C:\KokonadaSigner\in\`.

**Step 2, in the signer's own Windows session.** Do it exactly as the script's header says (`sign-release.ps1:9-22`):

1. Lock the screen, choose **Switch user**, and sign in as `kokonada-signer` on the Windows sign-in screen.
2. Open a Windows PowerShell window in that session first. Started from the Run dialog or a shortcut, the console closes with the three hashes still unread (RA-271-R2-6).
3. Compare `Get-FileHash C:\KokonadaSigner\bin\sign-release.ps1 -Algorithm SHA256` with the edited copy's hash in the owner's private record (provisioning step 5).
4. Run the full-path command:

   ```
   C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\KokonadaSigner\bin\sign-release.ps1 -In <name>.apk -Out <name>.apk
   ```

5. Read the result, then choose **Sign out**, not Switch user.

Never start the script from the owner's session: never `runas`, never `/savecred`, never `-NoExit` (`:15-19`). The script refuses a session whose interactive user is not the account it runs as (WTSQuerySessionInformation, WTSUserName; `:106-119`), which is exactly what `runas` gives.

What the script does, in order, stopping at the first failure (`:33-66`):

1. **Session check.** It refuses to run unless `[Environment]::UserName` is `kokonada-signer` and the interactive user of this Windows session is the same account (`:89-91`, `:106-119`).
2. **Plain names.** `-In` must be a plain `.apk` name in `in\`, and `-Out` a plain `.apk` name not yet present in `out\`. A folder, a drive, `..` or a link is refused (`:143-169`, `:217-237`).
3. **Tool hashes and links.** It checks the four tool hashes and refuses a link on any tool, on the key and on `ks.pass`. All of this happens before any tool runs and before `ks.pass` is read (`:174-183`, `:219-227`).
4. **The input copy.** It opens the input and checks, through the open handle, that the file's final path is `in\<-In>` itself (GetFinalPathNameByHandle). It then copies the bytes into `work\`, and every later step reads that copy (`:245-256`).
5. **The badging check.** `aapt2 dump badging` must show package `com.kokonadahealth`, not debuggable and not testOnly (`:261-267`).
6. **Align and sign.** It runs `zipalign -P 16 -f 4`, then `apksigner sign` (`:269-285`). The password reaches `apksigner` only as `--ks-pass env:KOKONADA_SIGNER_KS_PASS`, set in that one child's environment and removed when the child exits. Every JVM starts with `-XX:+DisableAttachMechanism`, `-XX:-UsePerfData` and `-XX:ErrorFile` in `work\` (`:140`).
7. **Verify.** `apksigner verify --print-certs` must show exactly one signer (`:287-294`), and `zipalign -c -P 16` must pass (`:296-297`).
8. **Deliver.** It moves the verified APK to `out\<-Out>` (`:299`) and prints three SHA-256 values: the input's, the signer certificate's and the signed APK's (`:308-311`). Keep those three lines with the build's record (`OPS-304`). The certificate's SHA-256 must equal the registered upload certificate's.

**Residuals the design accepts:**

- **The C# compile.** The script's one `Add-Type` (`:98-105`) compiles its P/Invoke declarations with the .NET Framework's `csc.exe` into the signer's `%TEMP%`, before the session check (SEC-271-R2-1). Only the `bin\` and profile permissions and the precondition below protect that step.
- **No elevation.** The design holds only against code that does not elevate (`:21-22`). An administrator can read any account's files and memory.
- **ELF alignment.** `zipalign -c -P 16` checks the 16 KB zip alignment only. The ELF LOAD-segment 16 KB alignment of every native library is checked separately, on a real release build, before the first upload (`:61-63`, C271-4).
- **No bundle signing yet.** There is no App Bundle signing step (SEC-271-5). Play takes an `.aab`, `bundleRelease` yields an unsigned one and the script signs APKs only (`:4-7`). The `jarsigner` step, run under the same account and the same rules, is its own row. Until it exists, nothing is uploaded to Play.

**Step 3, before any upload on any Play track, internal app sharing included.** Scan the exact file (`QA-077` D9, `OPS-103`): from `mobile/KokonadaHealth`, run `node scripts/lab/assertLabExcluded.mjs --scan <the file to upload>`. The upload needs exit 0; exit 1 or 2 blocks it. Keep the artifact's name, its SHA-256 and the exit code with the upload record (`docs/store/play-health-connect-declaration.md:113`).

## 4. Sideload for on-device QA

QA builds are to be release-signed through the same signer step, under the owner's ruling `F3` of 2026-10-20 (`OPS-303`). Copy the signed APK from `out\` to the phone and install it. The same signature keeps the installed data and sign-in.

- **Until the signer is provisioned,** device QA uses debug builds (`installDebug`, `.claude/commands/device-qa.md:6`).
- **A debug build stops signing in with Google** once no debug certificate is registered on the production OAuth client (`DAN-097`).
- **Run `adb devices` first.** The test phone drops its USB link intermittently.
- **Never sign `app-lab.apk`** (`com.kokonadahealth.lab`) with the upload key. The script's badging check refuses it (`:265`).

## 5. Testers' Spotify connect (beta path)

Spotify Development Mode caps a solo developer's app at five authorised users, and the app owner's Spotify account must have Premium for the app to work in that mode (`CMP-001`). The public build shows Spotify as unavailable.

The five-tester build flips `SPOTIFY_BETA_CONNECT` in `mobile/KokonadaHealth/src/experience/connect/betaFlags.ts:19` locally and uncommitted; its tripwire test keeps it `false` on `main`. That build is an APK sideloaded to the allow-listed testers only:

- **Never build it as a bundle, and never upload it to any Play track.** Anyone not on the list would see Spotify connect and get errors, and a promoted build would break `CMP-001`.
- **Revert the flag before any `bundleRelease`.**

Add each tester's Spotify account in the Spotify dashboard under Users Management. The dashboard's Redirect URIs hold both of these:

- `kokonadahealth://spotify-callback`, the tracked template's `SPOTIFY_REDIRECT_URI` (`src/health/config.ts:15`). Its scheme and host are the manifest placeholders at `build.gradle:107`.
- The backend's `/api/integrations/spotify/callback` URL. It must equal Railway's `SPOTIFY_REDIRECT_URI` exactly (`backend/app/services/spotify.js`).

The real `config.ts` sets the app's `SPOTIFY_REDIRECT_URI` to the backend URL, not to the scheme. Which URI the shipped build authorises with is open (`DAN-098`); remove neither from the dashboard until that is ruled. The quota question itself is `/spotify-quota`.

## 6. What this runbook does not cover

This runbook does not cover:

- the Play Console forms;
- the privacy-policy URL;
- the store declarations (`docs/store/`);
- the iOS build.

These gate the first store upload:

- the Play identity question (`DAN-045`);
- the Play App Signing choice (`DAN-096`);
- the bundle signing step (SEC-271-5);
- the ELF and bundle 16 KB checks (C271-4);
- the console registrations (`DAN-097`);
- the `QA-077` D9 scan (`OPS-103`);
- the HALT items in `docs/plans/halts.md`.
