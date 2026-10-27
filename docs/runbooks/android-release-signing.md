---
status: living
verified: 2026-10-27
owner: the owner (DAN- rows); security-auditor and resilience-auditor review (J17)
---

# Android release signing and the standalone build

How the production Android build of `mobile/KokonadaHealth` is produced and signed. Since #271 (`3a5e28a`, `OPS-303`) Gradle signs no release build: `assembleRelease` yields `app-release-unsigned.apk`, which no device installs, and the one signing step is `mobile/KokonadaHealth/scripts/release/sign-release.ps1`, run by the owner as the Windows account `kokonada-signer`, the only account (with SYSTEM) that can read the upload key. Every statement below was checked on 2026-10-27 against `main` at `0f4674f`: `mobile/KokonadaHealth/android/app/build.gradle`, the script, `.gitignore`, `.githooks/pre-commit`, `.claude/settings.json` and `mobile/KokonadaHealth/src/__tests__/releaseSigning.test.ts`. None of them changed between `0f4674f` and `ae19937`. Writing it ran none of the commands; Windows PowerShell 5.1's parser accepted the new lines of round 7 without running them, and `backend/tests/releaseRunbookCustody.test.js` pins the fenced commands of sections 2 and 3, and their order, as text.

**Not provisioned yet.** On 2026-10-27 `C:\KokonadaSigner` does not exist on the owner's machine, so the account, the vault, the tools and the upload key described here are still to be set up (section 2). Until they are, no release-signed build can be made. The old release key (`kokonada-release.keystore`, alias `kokonada`) and its plaintext `keystore.properties`, which holds both of its passwords, are still on this machine, git-ignored, in three places: the main checkout and the `.claude/worktrees/h1-evidence` and `.claude/worktrees/hx3-evidence` worktrees (`OPS-303`, checked by file name only). Until every copy is deleted, treat the old key and both passwords as exposed to every session on this machine. The denies of section 1 bind only the Read and Edit tools, and the commands `.claude/settings.json` pre-allows, `npm test *`, `npm run *` (`:10-11`) and `npx jest *` (`:17`), run code that can read both files and send them anywhere (SEC-264-8). So the rotation (`F7`, section 2) is mandatory, and nothing is signed with the old key again. CI builds the release JS bundle (`:app:createBundleReleaseJsAndAssets`, `.github/workflows/ci.yml:244`) but packages no APK and runs no `bundleRelease`, so that `assembleRelease` really yields an unsigned APK has not been checked by a build yet (RA-271-5). The older kit documents (`mobile/native-snippets/RELEASE_SIGNING.md` and `mobile/SETUP_ANDROID.md`, now Deleted rows in `docs/ARCHIVE.md`) described a generated project that no longer exists.

## 1. What the build does, and does not, read

`android/app/build.gradle`:

- `signingConfigs` holds the debug config only (`:109-119`). `buildTypes.release` (`:125-135`) names no `signingConfig`, loads no `keystore.properties` and has no debug fallback, so a release build that skips the signer cannot be installed. `releaseSigning.test.ts` pins this as text (rules `[gradle-keystore]`, `[gradle-configs]`, `[gradle-release]`, `[gradle-fallback]` at `:124-127`) and fails on any signing config, fallback or `keystore.properties` read in the release path.
- The debug key is `android/app/debug.keystore`, or the file named by the `kokonadaDebugKeystore` project property, which `scripts/lab` passes (`:111-114`). It is untracked (`.gitignore:40`) and each checkout holds its own copy (`MB-089`). The `lab` build type (`:141-144`, `applicationIdSuffix ".lab"`, the Design Lab, `MB-084`) always signs with the debug key, is never built as an App Bundle and is never uploaded.
- Identity: `applicationId "com.kokonadahealth"` (`:98`), `versionCode 1` (`:101`), `versionName "1.0"` (`:102`). `versionCode` must strictly increase on every upload to Play. Whether the package stays `com.kokonadahealth` is `DAN-045`; once the app is published it can never change.
- `mobile/native-snippets/keystore.properties.example` is still tracked, but the build no longer reads any `keystore.properties`. Three places name it by its exact path: `.gitignore:48`, `.githooks/pre-commit:23` and `backend/tests/preCommitSecretGuard.test.js:37`. Its comment header says it is obsolete, that no signing password goes into any checkout, and points to section 2 of this runbook; its four value lines still carry the retired key's names and the placeholders (`OPS-356`).

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

- **The key.** It is `C:\KokonadaSigner\vault\kokonada-upload.p12`: PKCS12, alias `kokonada-upload` (`sign-release.ps1:28`, `:124-125`; the script reads no other name). The owner generates it as `kokonada-signer` inside the vault (provisioning step 8).
- **Its password.** It lives only in `C:\KokonadaSigner\vault\ks.pass`. That account writes it once with `Read-Host -AsSecureString | ConvertFrom-SecureString | Set-Content C:\KokonadaSigner\vault\ks.pass` (`:29-31`), which binds it to that account on this machine through DPAPI.
- **The old key.** `kokonada-release.keystore` (alias `kokonada`) is retired by the rotation. The old certificate's removal from the Google Cloud and Spotify consoles, and the new certificate's registration there, are `DAN-097`. Each copy of the old key is deleted, or kept only on offline media.
- **Fingerprints.** The new certificate's SHA-1 and SHA-256 are registered before any release-signed build reaches a tester. They go on the Android OAuth client of the Kokonada project (package `com.kokonadahealth`) in the Google Cloud Console, and in the Spotify developer dashboard (`DAN-097`). A build signed with an unregistered certificate cannot sign in with Google or connect Spotify. Read the fingerprints from `apksigner verify --print-certs` on a signed build. They are public and are not written here.
- **What the backend checks.** Today it checks only the token's `aud` (`backend/app/controllers/authController.js:19`). The `azp` allowlist of the project's own Android clients lands with `BE-180`, which has not merged. From then on, every Android client that signs a shipped build goes into that list before the build is tested, Play's app-signing certificate included.
- **No password on a command line.** Never pass one (`-storepass`, `--ks-pass pass:`, `-Pandroid.injected.signing.store.password`): it lands in shell history. The script never does.
- **Backups.** If the key or its password is lost, the installed app cannot be updated under the same signature until Play resets the upload key. Back both up to two places and test one restore (`DAN-053` item 3):
  - the key file on two encrypted offline drives;
  - the password only in a password manager the owner's Windows account cannot read (provisioning step 1);
  - never in a synced folder, and never in any git repository, `Kokonada-private` included.

  Where the copies are is recorded outside this public repository. Prove the restore by signing one test APK with the restored copy.
- **Play App Signing.** It is decided before the first bundle upload, in the owner's own words (`DAN-096`). `security-auditor` recommended on #264 that Google keeps the app-signing key and `kokonada-upload.p12` serves as the upload key, because Google can reset a lost upload key but nobody can recover a lost app-signing key. This runbook prepares for that choice, a Google-generated app signing key, until the owner rules on `DAN-096`. Under it:
  - At enrolment, let Google generate the app signing key; never upload your own, so no copy of the key that signs store installs ever exists on this machine.
  - At launch, register the fingerprints of the Google-held app signing keys beside the upload certificate, with Google sign-in (the Android OAuth client) and in the Spotify dashboard: every one the Console lists, since Play's default quantum-ready hybrid signing has three keys (Play Console Help 9842756, CA-264-10). They are under Play Console → Protected with Play → Play Store protection → Manage Play app signing. Once sideloaded QA builds stop, remove the upload certificate from the OAuth client.
  - Store installs and sideloaded installs carry different signatures, so neither can update the other.
  - Check Google sign-in and Spotify connect on the internal testing track before any wider track.
- **If the upload key or its password leaks.** Stop signing. Ask for an upload key reset in Play Console (Play app signing → request upload key reset), which Play App Signing allows because Google holds the app signing key. Generate the new key by provisioning step 8, register its certificate and remove the leaked one on the Android OAuth client and in the Spotify dashboard (`DAN-097`), and uninstall every sideloaded QA build signed with the leaked key, since a build under the new key cannot update it. Record the incident on `OPS-303`.

### Provisioning, once, by the owner

What protects the key is who owns each folder, not only who may write it: the owner of a file or a folder can always rewrite its permissions, elevated or not. Folders made from the owner's normal window would be owned by his account and would inherit `C:\`'s defaults (Authenticated Users Modify, CREATOR OWNER Full Control). Code in his session could then grant itself `bin\` and replace a file of the JDK (only `java.exe` is pinned, `sign-release.ps1:130`, `:137`), or rename `bin\` away, and the next run would load that code into the JVM that holds the password (SEC-264-10, RA-32). So the owner's account owns nothing under `C:\KokonadaSigner`, and nothing there inherits from `C:\`.

**The owner rule.** Administrators (`BUILTIN\Administrators`, SID `S-1-5-32-544`) own the root, `in\`, `out\` and `bin\`, and every file under `bin\`. `kokonada-signer` owns `vault\` and `work\`. Every file in those two folders is created by `kokonada-signer` and is owned by it anyway, so the folder's owner matches its contents, and the one account each folder exists for is the only one that can change its permissions short of elevation. `security-auditor` also allowed SYSTEM as the vault's owner; one owner is chosen so that the expected listing of step 7 is exact.

**The provisioning administrator.** The owner ruled on 2026-10-27 that provisioning runs from a separate administrator account used for nothing else, `kokonada-admin`, and not from his daily account elevated: rounds 4 to 6 of #264 kept finding races and user code inside that elevated window (RA-39, RA-43, RA-45). His daily account stays as it is; whether it becomes a standard account is still open (`DAN-121`). No other account can write `kokonada-admin`'s profile, its module folder, its `PATH` or its cmd AutoRun without elevating, so code in the owner's session cannot plant anything that runs in its windows. Its password is typed only on Windows' secure screens, the sign-in screen and the Ctrl+Alt+Del screen, and kept like the signer's: in a password manager the owner's Windows account cannot read, on a separate device such as the phone, typed by hand and never through the clipboard. It is never typed into a User Account Control prompt, a `runas` or any other window of the owner's session: code there would then hold the administrator this account exists to keep from it.

0. **The provisioning administrator.** This is the one moment the daily account elevates for this runbook. Press Win+R, type `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile` and press Ctrl+Shift+Enter, which runs it as administrator. In this window, type no password and nothing but these four lines. Even with `-NoProfile`, the console host can load PSReadLine from the daily account's own `Documents\WindowsPowerShell\Modules` before the first line runs (RA-45), so whatever is typed here may be read by code the owner's session wrote:

   ```
   $env:PSModulePath = "$PSHOME\Modules"
   (Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\Lsa).LimitBlankPasswordUse
   if ((Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\Lsa).LimitBlankPasswordUse -eq 1) { C:\Windows\System32\net.exe user kokonada-admin /add } else { 'STOP: blank passwords are not limited to console sign-in' }
   C:\Windows\System32\net.exe localgroup Administrators kokonada-admin /add
   ```

   - The second line must print `1`. With `LimitBlankPasswordUse` at 1, Windows' default, an account whose password is empty can sign in only at the console (Microsoft's policy "Accounts: Limit local account use of blank passwords to console logon only"), so not through `runas` or a network sign-in. That is what keeps the new account out of reach of the owner's session for the minute it has no password. How far that holds against code calling Windows' sign-in functions directly in the owner's session is NOT VERIFIED on this machine, and neither is the value itself until the line prints it. If the line prints anything else, the third line creates nothing: stop, and record the value on `OPS-304`.
   - `C:\Windows\System32\net.exe user kokonada-admin /add` with no password creates the account with an empty one and asks for nothing. If a local password policy requires a minimum length it refuses, and provisioning stops there.
   - Close the window. At once, lock the screen, choose **Switch user** and sign in as `kokonada-admin` on the Windows sign-in screen, with the empty password; Windows creates its profile. Then press Ctrl+Alt+Del and choose **Change a password**: leave the old password empty and type the new one twice. It is a new password that a password manager the owner's Windows account cannot read, the phone's, generates and keeps; type it by hand, never through the clipboard.
   - From here on, the daily account does not elevate for this runbook, and each later step that needs an administrator runs in `kokonada-admin`'s own session.

**The elevated window.** Steps 1 to 6 run in `kokonada-admin`'s own session, in one elevated window. Lock the screen, choose **Switch user** and sign in as `kokonada-admin`. Press Win+R, type `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile` and press Ctrl+Shift+Enter; an administrator's consent prompt asks for no password. Since no other account can write that profile, the guards below are defence in depth: they keep whatever might ever land in it out of this window (RA-39, RA-45).

- `-NoProfile` skips the profile scripts.
- The window's first line, below, limits module loading to Windows' own folder (`C:\Windows\System32\WindowsPowerShell\v1.0\Modules`), where `Get-FileHash`, `Expand-Archive` and `Get-Acl` live. It is a plain string, so no cmdlet loads before the path is fixed.
- The second line prints where PSReadLine came from: the console host loads it before the first line runs, from the module path it started with. It must print nothing, or a path that starts with `C:\Program Files\WindowsPowerShell\Modules\` or with `$PSHOME` (`C:\Windows\System32\WindowsPowerShell\v1.0\`). A path under a `Documents` folder means a profile's module ran in this window: close it and find out why.
- Every Windows program outside PowerShell runs by its full path in `C:\Windows\System32`, never by a bare name that `PATH` resolves (RA-45): icacls, net, cmd and curl.
- Every `cmd` runs as `C:\Windows\System32\cmd.exe /d /c`: `/d` skips the AutoRun commands.
- No `git` command runs in this window: git reads a checkout's `.git/config` and hooks, which every session of the owner's can write. Step 4 runs git in the owner's normal window.
- Leave the window in its own folder (`C:\Windows\System32`): `cmd` runs a program from its current folder before `PATH`, and a checkout is a folder every session can write.

```
$env:PSModulePath = "$PSHOME\Modules"
(Get-Module PSReadLine).Path
```

In the commands, `<owner>` is the owner's own daily account as `whoami` prints it in his normal window, and `<PC>` is this computer's name.

1. **The account.** In the elevated window:

   ```
   C:\Windows\System32\net.exe user kokonada-signer /add
   ```

   This creates a standard account (a member of Users only, never of Administrators) with an empty password, as step 0 does, resting on the same `LimitBlankPasswordUse` check. Its Windows password is then set, and from then on typed, only on Windows' secure screens: lock the screen, choose **Switch user** and sign in as `kokonada-signer` on the Windows sign-in screen with the empty password, so Windows creates its profile; press Ctrl+Alt+Del, choose **Change a password**, leave the old one empty and type the new one twice; then sign out, and switch back to `kokonada-admin`. Keep it in a password manager the owner's Windows account cannot read: one on a separate device, such as the phone, or one never unlocked under that account. Type it by hand, never through the clipboard. Code in the owner's session can read his clipboard, the keys he types in his own windows and any password manager unlocked under his account. With this password it could start a process as `kokonada-signer`, plant code in that account's profile, and read the key and `ks.pass` at the next run (SEC-264-12). So it is never typed into a `runas` prompt or any console window, the owner's or `kokonada-admin`'s. Back in the elevated window, `C:\Windows\System32\net.exe localgroup Administrators` must not list `kokonada-signer`.
2. **The folders, their owners and their permissions.** If `C:\KokonadaSigner` exists already, stop: something else made it. Remove it with `C:\Windows\System32\cmd.exe /d /c rmdir /s /q C:\KokonadaSigner`, which deletes a link inside it without following it, and start again.

   | Folder | Owner | Permissions, and nothing else (inheritance removed) | What it holds |
   |---|---|---|---|
   | `C:\KokonadaSigner` | Administrators | Administrators and SYSTEM Full Control; the owner's account and `kokonada-signer` Read & execute, this folder only | the five folders |
   | `in\` | Administrators | Administrators and SYSTEM Full Control; the owner's account Modify; `kokonada-signer` Read & execute | the unsigned APK |
   | `work\` | `kokonada-signer` | `kokonada-signer` Modify; SYSTEM Full Control | the script's working copies, removed at the end of every run (`:301-306`) |
   | `out\` | Administrators | Administrators and SYSTEM Full Control; `kokonada-signer` Modify; the owner's account Read & execute | the signed APK, and nothing else (`:299`) |
   | `bin\` | Administrators | Administrators and SYSTEM Full Control; `kokonada-signer` and the owner's account Read & execute | the tools and the script |
   | `vault\` | `kokonada-signer` | `kokonada-signer` Modify; SYSTEM Full Control | the key and `ks.pass` |

   First the root alone, made in one call that carries its final security descriptor, before anything can be created in it (RA-43, SEC-264-13, RA-32). A root made by `New-Item` and closed afterwards with `icacls` inherits `C:\`'s Authenticated Users Modify, delete included, until its inheritance is removed. In that window code in the owner's session could delete the empty root and put a junction to a folder of its own in its place: every later command would follow it and build the vault inside that folder, and the code could swap the tree after the checks. Or it could create `bin\jdk\` inside the real root first, so the real JDK would be moved one level below the planted one and step 5 would pin the planted `java.exe`. `CreateDirectory` with a security descriptor makes the folder already owned by Administrators, with Full Control for Administrators and SYSTEM on it and everything below it, and nothing inherited from `C:\`. It does nothing to a path that exists, so the line refuses one first:

   ```
   $sd = New-Object System.Security.AccessControl.DirectorySecurity
   $sd.SetOwner([System.Security.Principal.SecurityIdentifier]'S-1-5-32-544')
   $sd.SetAccessRuleProtection($true, $false)
   $sd.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.SecurityIdentifier]'S-1-5-32-544', 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
   $sd.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.SecurityIdentifier]'S-1-5-18', 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
   if (Test-Path C:\KokonadaSigner) { 'STOP: C:\KokonadaSigner exists' } else { [void][System.IO.Directory]::CreateDirectory('C:\KokonadaSigner', $sd) }
   (Get-Item C:\KokonadaSigner -Force).Attributes
   (Get-Acl C:\KokonadaSigner).Owner
   Get-ChildItem C:\KokonadaSigner -Recurse -Force
   ```

   - If the create line printed `STOP`, a path is already there: remove it as above and start again.
   - `(Get-Item C:\KokonadaSigner -Force).Attributes` must print `Directory`. Anything else, `ReparsePoint` above all, means the path is a link or not the folder this line made. `Test-Path` follows a link and may answer `False` for one whose target is missing, and `CreateDirectory` may then leave that link in place (neither checked on this machine); this line catches it either way.
   - `(Get-Acl C:\KokonadaSigner).Owner` must print `BUILTIN\Administrators`. A folder that code in the owner's session made between `Test-Path` and `CreateDirectory` would belong to his account, and `CreateDirectory` would have returned it untouched; this line catches that.
   - The last line must print nothing.

   If any of the three checks fails, sign nothing: remove the root as above, start again, and find out why if it fails twice. Nothing below runs before all three pass.

   Then the five folders, in this order: the owners first, then one grant per folder while the root's inherited Full Control still lets the elevated window in, then the removal of each folder's inheritance, and last the root's own grants, made this-folder-only:

   ```
   New-Item -ItemType Directory -Path C:\KokonadaSigner\in, C:\KokonadaSigner\work, C:\KokonadaSigner\out, C:\KokonadaSigner\bin, C:\KokonadaSigner\vault
   C:\Windows\System32\icacls.exe C:\KokonadaSigner /setowner *S-1-5-32-544 /T /C
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\work /setowner kokonada-signer
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\vault /setowner kokonada-signer
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\in /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '<owner>:(OI)(CI)M' 'kokonada-signer:(OI)(CI)RX'
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\work /grant:r '*S-1-5-18:(OI)(CI)F' 'kokonada-signer:(OI)(CI)M'
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\out /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' 'kokonada-signer:(OI)(CI)M' '<owner>:(OI)(CI)RX'
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\bin /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' 'kokonada-signer:(OI)(CI)RX' '<owner>:(OI)(CI)RX'
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\vault /grant:r '*S-1-5-18:(OI)(CI)F' 'kokonada-signer:(OI)(CI)M'
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\in /inheritance:r
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\work /inheritance:r
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\out /inheritance:r
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\bin /inheritance:r
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\vault /inheritance:r
   C:\Windows\System32\icacls.exe C:\KokonadaSigner /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' '<owner>:RX' 'kokonada-signer:RX'
   ```

   The quotes matter: unquoted, PowerShell reads `(OI)` as an expression and `<` as a redirection. From here on the elevated window has no access to `work\` and `vault\`: neither grants Administrators anything. A JVM crash log `hs_err_*.log` can land in `work\` (`:140`); the script never removes it. After reading one, delete it from the signer session (RA-271-R2-4).
3. **The tools.** First prove that files this window creates belong to Administrators (RA-42). If they belonged to an account the owner's session can act as, that session could rewrite their permissions and swap an archive between its hash check and its unpacking:

   ```
   New-Item -ItemType File -Path C:\KokonadaSigner\bin\probe
   (Get-Acl C:\KokonadaSigner\bin\probe).Owner
   Remove-Item C:\KokonadaSigner\bin\probe
   ```

   The second line must print `BUILTIN\Administrators`. If it prints `<PC>\kokonada-admin`, go on: no other session can act as that account, and the `/setowner` lines below and in step 5 give every file under `bin\` to Administrators. If it prints anything else, stop. Whether Windows' default gives Administrators here has not been checked on this machine.

   Both archives are downloaded into `C:\KokonadaSigner\bin\stage`, which inherits `bin\`'s permissions, so only administrators can write it, and are hashed and unpacked there in the same elevated window. Nothing is hashed in one folder and unpacked from another that the owner's account can write (RA-33).
   - **Android build-tools 37.0.0**, `build-tools_r37_windows.zip`, from `https://dl.google.com/android/repository/build-tools_r37_windows.zip`. Google's SDK repository manifest, `https://dl.google.com/android/repository/repository2-3.xml`, lists it under `build-tools;37.0.0` for `windows`, size `61077164`, SHA-1 `e9c97e26b5b5678002e9d3fed632c841ae62d99f`; the manifest gives SHA-1 only. A download of 2026-10-27 whose size and SHA-1 matched the manifest has SHA-256 `68075aa319ed8a01cf1a565ed1e61a3c1a801dd49191c35851248dc293c33b1a`. Re-read the manifest's entry in a browser before downloading; the guard below compares both values before unpacking. Downloading the archive directly skips `sdkmanager`'s licence prompt; the Android SDK License Agreement (`developer.android.com/studio/terms`) binds by use all the same. Its `lib\apksigner.jar` is Java 8 bytecode and runs on the JDK below. The whole folder goes into `bin\build-tools\`, not three files: `zipalign.exe` and `aapt2.exe` load the DLLs beside them, and the script's header leaves the rest of the build-tools to `bin\`'s permissions (`:43-44`). The script needs build-tools 35 or newer (`:127-129`). The archive's top folder is moved by what it holds, not by a name written here, since build-tools 35's archive unpacked to `android-15` (SEC-264-15).
   - **The JDK** is Eclipse Temurin 17, an OpenJDK build under GPLv2 with the Classpath Exception, release `jdk-17.0.20.1+1`. The file is `OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip`, SHA-256 `e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0`. That value was read on 2026-10-27 from the Adoptium API and from the release's `.sha256.txt` on github.com/adoptium/temurin17-binaries, and both agree. Do not use Oracle JDK 17 (updates after 17.0.12 are under the OTN licence, not NFTC) or the IDE's JBR, which an IDE in the owner's account keeps updating. Its top folder becomes `bin\jdk\`, so that `java.exe` sits at `bin\jdk\bin\java.exe` (`:130`).

   ```
   New-Item -ItemType Directory -Path C:\KokonadaSigner\bin\stage
   C:\Windows\System32\curl.exe -fL -o C:\KokonadaSigner\bin\stage\build-tools_r37_windows.zip https://dl.google.com/android/repository/build-tools_r37_windows.zip
   C:\Windows\System32\curl.exe -fL -o C:\KokonadaSigner\bin\stage\OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip
   Get-FileHash C:\KokonadaSigner\bin\stage\build-tools_r37_windows.zip -Algorithm SHA1
   Get-FileHash C:\KokonadaSigner\bin\stage\build-tools_r37_windows.zip -Algorithm SHA256
   Get-FileHash C:\KokonadaSigner\bin\stage\OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip -Algorithm SHA256
   ```

   Keep the three printed values with the build record. `Get-FileHash` prints upper case and PowerShell's `-eq` ignores case, so the guards below compare the lower-case values as written. Each line unpacks or moves only when its check holds, and prints a line starting `STOP` otherwise:

   ```
   if ((Get-FileHash C:\KokonadaSigner\bin\stage\build-tools_r37_windows.zip -Algorithm SHA1).Hash -eq 'e9c97e26b5b5678002e9d3fed632c841ae62d99f' -and (Get-FileHash C:\KokonadaSigner\bin\stage\build-tools_r37_windows.zip -Algorithm SHA256).Hash -eq '68075aa319ed8a01cf1a565ed1e61a3c1a801dd49191c35851248dc293c33b1a') { Expand-Archive -LiteralPath C:\KokonadaSigner\bin\stage\build-tools_r37_windows.zip -DestinationPath C:\KokonadaSigner\bin\stage\bt } else { 'STOP: build-tools_r37_windows.zip does not match its hashes' }
   if ((Get-FileHash C:\KokonadaSigner\bin\stage\OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip -Algorithm SHA256).Hash -eq 'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0') { Expand-Archive -LiteralPath C:\KokonadaSigner\bin\stage\OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip -DestinationPath C:\KokonadaSigner\bin\stage\jdk } else { 'STOP: the JDK archive does not match its hash' }
   $bt = @(Get-ChildItem C:\KokonadaSigner\bin\stage\bt -Directory); if ($bt.Count -eq 1 -and -not (Test-Path C:\KokonadaSigner\bin\build-tools)) { Move-Item $bt[0].FullName C:\KokonadaSigner\bin\build-tools } else { 'STOP: bin\build-tools exists, or the archive did not unpack to one folder' }
   $jdk = @(Get-ChildItem C:\KokonadaSigner\bin\stage\jdk -Directory); if ($jdk.Count -eq 1 -and -not (Test-Path C:\KokonadaSigner\bin\jdk)) { Move-Item $jdk[0].FullName C:\KokonadaSigner\bin\jdk } else { 'STOP: bin\jdk exists, or the archive did not unpack to one folder' }
   ```

   If any line printed `STOP`, sign nothing: remove `bin\` with `C:\Windows\System32\cmd.exe /d /c rmdir /s /q C:\KokonadaSigner\bin` and find out why first. `Move-Item` onto a folder that exists would put the real tree one level below it, which is why each move first checks that its target does not exist. Otherwise:

   ```
   Remove-Item C:\KokonadaSigner\bin\stage -Recurse -Force
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\bin /setowner *S-1-5-32-544 /T /C
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\bin\build-tools /reset /T /C
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\bin\jdk /reset /T /C
   ```

   Moving to a later build-tools or Temurin 17 build is a change to this runbook in its own PR, with its own hashes.
4. **The script.** Copy its LF bytes, as they are on `main`, into `C:\KokonadaSigner\bin\sign-release.ps1`. Git runs in the owner's normal window, in his own session, never in `kokonada-admin`'s; the elevated window only copies the file into `bin\` and hashes it there, and the pin read on github.com decides whether the content is right.
   - Switch user to the owner's own session (`kokonada-admin`'s stays signed in, locked). In his normal window, in a checkout (`<checkout>` below), with `<temp>` the folder `C:\Windows\System32\cmd.exe /d /c echo %TEMP%` prints there:

     ```
     git -C <checkout> fetch origin
     C:\Windows\System32\cmd.exe /d /c "git -C <checkout> show origin/main:mobile/KokonadaHealth/scripts/release/sign-release.ps1 > %TEMP%\sign-release.ps1"
     ```

     `cmd`'s `>` writes git's bytes unchanged. Windows PowerShell 5.1's own `>` re-encodes them as UTF-16, and that copy never matches.
   - Switch user back to `kokonada-admin`. In the elevated window (`<temp>` is in the owner's profile, which Administrators can read):

     ```
     C:\Windows\System32\cmd.exe /d /c copy /b <temp>\sign-release.ps1 C:\KokonadaSigner\bin\sign-release.ps1
     Get-FileHash C:\KokonadaSigner\bin\sign-release.ps1 -Algorithm SHA256
     ```

   - The hash must equal `e5e738923aa03af15473261ca7c7abe859ef17031aed248cb9c466cd0e9d2606`: the copy on `main`, landed in #271 (`3a5e28a`) and unchanged at `ae19937`. Read that value from this runbook on github.com, `https://github.com/DanielMalede/Kokonada/blob/main/docs/runbooks/android-release-signing.md`, on a second device, the phone: not from a checkout, which every session on this machine can write, and not in a browser on this machine, whose page code in the owner's session can change (`security-auditor`'s S3 note at `66058cb`). A copy that differs: delete it and stop.
   - Any change to the script on `main` changes this line in the same PR.
5. **The four tool pins.** Write the four tools' SHA-256 values, in lower case, into the four lines `$ZipalignSha256`, `$Aapt2Sha256`, `$ApksignerSha256` and `$JavaSha256` of the copy in `C:\KokonadaSigner\bin` (`:134-137`), from the elevated window, since only administrators can write `bin\`. No editor is used: Windows 11's Notepad is a packaged app that may not start elevated, an editor may change the line ends, and a hash typed by hand can be mistyped (`security-auditor`'s S3 note at `66058cb`). Each `Replace` line below swaps exactly one placeholder line for the value `Get-FileHash` computes, and nothing else changes. `[System.IO.File]` reads and writes the text as it is, so the LF line ends stay: `WriteAllText` writes UTF-8 without a byte-order mark, which for this ASCII file is the same bytes, where Windows PowerShell 5.1's `Set-Content` would write CRLF and the system code page. After the write, every file under `bin\` goes back to Administrators, since a written file may belong to whoever wrote it (RA-42):

   ```
   $f = 'C:\KokonadaSigner\bin\sign-release.ps1'
   $t = [System.IO.File]::ReadAllText($f)
   $t = $t.Replace('$ZipalignSha256 = ''<pin after provisioning>''', '$ZipalignSha256 = ''' + (Get-FileHash C:\KokonadaSigner\bin\build-tools\zipalign.exe -Algorithm SHA256).Hash.ToLowerInvariant() + '''')
   $t = $t.Replace('$Aapt2Sha256 = ''<pin after provisioning>''', '$Aapt2Sha256 = ''' + (Get-FileHash C:\KokonadaSigner\bin\build-tools\aapt2.exe -Algorithm SHA256).Hash.ToLowerInvariant() + '''')
   $t = $t.Replace('$ApksignerSha256 = ''<pin after provisioning>''', '$ApksignerSha256 = ''' + (Get-FileHash C:\KokonadaSigner\bin\build-tools\lib\apksigner.jar -Algorithm SHA256).Hash.ToLowerInvariant() + '''')
   $t = $t.Replace('$JavaSha256 = ''<pin after provisioning>''', '$JavaSha256 = ''' + (Get-FileHash C:\KokonadaSigner\bin\jdk\bin\java.exe -Algorithm SHA256).Hash.ToLowerInvariant() + '''')
   [System.IO.File]::WriteAllText($f, $t)
   Select-String -LiteralPath $f -CaseSensitive -Pattern '^\$(Zipalign|Aapt2|Apksigner|Java)Sha256 = ''[0-9a-f]{64}''$'
   [System.IO.File]::ReadAllText($f).Contains("`r")
   C:\Windows\System32\icacls.exe C:\KokonadaSigner\bin /setowner *S-1-5-32-544 /T /C
   ```

   - `Select-String` must print exactly four lines, numbered 134 to 137, each with a 64-character lower-case value. Fewer means a placeholder was not found: delete the copy, copy it again by step 4 and repeat.
   - The `Contains` line must print `False`: no carriage return entered the file, so its line ends are still LF.

   Only that copy changes: the repository copy keeps the placeholders `<pin after provisioning>`. Until all four are filled, every run is refused by design (`:174-177`).
6. **The edited copy's hash.** Run `Get-FileHash C:\KokonadaSigner\bin\sign-release.ps1 -Algorithm SHA256` and keep the edited copy's SHA-256 in the password manager of step 1, beside the key's password, never in a file: every file the owner's account can write, a session can change. Compare it before every run (section 3, step 2). A copy that differs must not run. Close the elevated window and sign out of `kokonada-admin`.
7. **The permission check.** It runs in `kokonada-signer`'s own session, now and before every run (section 3, step 2): that account can read the permissions of all six folders, while the elevated window can no longer open `work\` or `vault\`. Lock the screen, choose **Switch user** and sign in as `kokonada-signer`. Press Win+R, type `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile` and press Enter (not elevated). Then run:

   ```
   $env:PSModulePath = "$PSHOME\Modules"
   (Get-Module PSReadLine).Path
   (Get-Item C:\KokonadaSigner -Force).Attributes
   Get-ChildItem C:\KokonadaSigner -Recurse -Force -Attributes ReparsePoint
   Get-Acl -Path C:\KokonadaSigner, C:\KokonadaSigner\in, C:\KokonadaSigner\work, C:\KokonadaSigner\out, C:\KokonadaSigner\bin, C:\KokonadaSigner\vault | Format-List Path,Owner,AreAccessRulesProtected,AccessToString
   Get-ChildItem C:\KokonadaSigner\bin -Recurse -Force | Get-Acl | Where-Object { $_.Owner -ne 'BUILTIN\Administrators' -or $_.AreAccessRulesProtected -or @($_.Access | Where-Object { -not $_.IsInherited }).Count -gt 0 } | Format-List Path,Owner
   (Get-ChildItem C:\KokonadaSigner -Force).Name
   (Get-ChildItem C:\KokonadaSigner\bin -Force).Name
   Get-ChildItem C:\KokonadaSigner\in, C:\KokonadaSigner\work, C:\KokonadaSigner\out, C:\KokonadaSigner\vault -Recurse -Force | Get-Acl | Format-List Path,Owner,AreAccessRulesProtected,AccessToString
   ```

   The expected listing of the `Get-Acl -Path` command, entry by entry (the order of the lines inside `AccessToString` may differ):

   ```
   Path                    : Microsoft.PowerShell.Core\FileSystem::C:\KokonadaSigner
   Owner                   : BUILTIN\Administrators
   AreAccessRulesProtected : True
   AccessToString          : BUILTIN\Administrators Allow  FullControl
                             NT AUTHORITY\SYSTEM Allow  FullControl
                             <PC>\<owner> Allow  ReadAndExecute, Synchronize
                             <PC>\kokonada-signer Allow  ReadAndExecute, Synchronize

   Path                    : Microsoft.PowerShell.Core\FileSystem::C:\KokonadaSigner\in
   Owner                   : BUILTIN\Administrators
   AreAccessRulesProtected : True
   AccessToString          : BUILTIN\Administrators Allow  FullControl
                             NT AUTHORITY\SYSTEM Allow  FullControl
                             <PC>\<owner> Allow  Modify, Synchronize
                             <PC>\kokonada-signer Allow  ReadAndExecute, Synchronize

   Path                    : Microsoft.PowerShell.Core\FileSystem::C:\KokonadaSigner\work
   Owner                   : <PC>\kokonada-signer
   AreAccessRulesProtected : True
   AccessToString          : NT AUTHORITY\SYSTEM Allow  FullControl
                             <PC>\kokonada-signer Allow  Modify, Synchronize

   Path                    : Microsoft.PowerShell.Core\FileSystem::C:\KokonadaSigner\out
   Owner                   : BUILTIN\Administrators
   AreAccessRulesProtected : True
   AccessToString          : BUILTIN\Administrators Allow  FullControl
                             NT AUTHORITY\SYSTEM Allow  FullControl
                             <PC>\kokonada-signer Allow  Modify, Synchronize
                             <PC>\<owner> Allow  ReadAndExecute, Synchronize

   Path                    : Microsoft.PowerShell.Core\FileSystem::C:\KokonadaSigner\bin
   Owner                   : BUILTIN\Administrators
   AreAccessRulesProtected : True
   AccessToString          : BUILTIN\Administrators Allow  FullControl
                             NT AUTHORITY\SYSTEM Allow  FullControl
                             <PC>\kokonada-signer Allow  ReadAndExecute, Synchronize
                             <PC>\<owner> Allow  ReadAndExecute, Synchronize

   Path                    : Microsoft.PowerShell.Core\FileSystem::C:\KokonadaSigner\vault
   Owner                   : <PC>\kokonada-signer
   AreAccessRulesProtected : True
   AccessToString          : NT AUTHORITY\SYSTEM Allow  FullControl
                             <PC>\kokonada-signer Allow  Modify, Synchronize
   ```

   **Pass criterion.** The check passes only when all of these hold; otherwise sign nothing, and find out why first.
   - `(Get-Module PSReadLine).Path` prints nothing or a path that starts with `C:\Program Files\WindowsPowerShell\Modules\` or with `$PSHOME` (`C:\Windows\System32\WindowsPowerShell\v1.0\`), never one under the account's own `Documents` (RA-45).
   - `(Get-Item C:\KokonadaSigner -Force).Attributes` prints `Directory`, and the `ReparsePoint` sweep prints nothing: the root is the folder provisioning made, and no reparse point (a junction, a symbolic link or a mount point) sits anywhere under it (RA-43). These two run before the listings because `Get-Acl` and `Get-ChildItem` follow a link and would list its target as if it were the vault.
   - The `Get-Acl -Path` command lists six entries, and each `Owner` is the one the table names. No `Owner` is the owner's account.
   - `AreAccessRulesProtected` is `True` on all six.
   - Each `AccessToString` holds exactly its lines above and no other. No line names Everyone, `BUILTIN\Users`, `NT AUTHORITY\Authenticated Users` or `CREATOR OWNER`, and the owner's account holds Modify on `in\` alone.
   - The `bin\` owner sweep (`Get-ChildItem C:\KokonadaSigner\bin -Recurse -Force | Get-Acl | Where-Object …`) prints nothing: every file under `bin\` is owned by Administrators and carries only the permissions it inherits from `bin\`.
   - The root's name listing prints exactly `bin`, `in`, `out`, `vault` and `work`, and `bin\`'s exactly `build-tools`, `jdk` and `sign-release.ps1` (in any order): no `stage`, no `probe`, nothing else.
   - The last command lists every entry below `in\`, `work\`, `out\` and `vault\`. `work\` holds nothing. `in\` and `out\` hold only `.apk` files and no folder. At provisioning, before step 8, `vault\` holds nothing. From step 8 on, and before every run, `vault\` holds exactly `kokonada-upload.p12` and `ks.pass`: each `Owner` is `<PC>\kokonada-signer`, `AreAccessRulesProtected` is `False`, and `AccessToString` holds exactly `vault\`'s two lines above, so neither file carries a rule of its own.

   Record the provisioning output with the build record on `OPS-304` (RA-271-R2-3). The script refuses a link on these folders but never reads their permissions (`MB-140` (6)), so this check is the only one that does.
8. **The key and its password.** In the same `kokonada-signer` window as step 7:

   ```
   C:\KokonadaSigner\bin\jdk\bin\keytool.exe -genkeypair -storetype PKCS12 -keystore C:\KokonadaSigner\vault\kokonada-upload.p12 -alias kokonada-upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Kokonada"
   ```

   - keytool asks for the password at its prompt, twice. It is one password for the store and the key: a PKCS12 store gives its key the store's password and asks for no other, which is why the script hands `apksigner` only `--ks-pass`. Never add `-storepass` or `-keypass` (see "No password on a command line" above).
   - The password is a random one of at least 24 characters that the password manager generates and keeps: the one of step 1, which the owner's Windows account cannot read. Type it at each prompt by hand, never through the clipboard. It is new: never the old key's password, which sat in plaintext in `keystore.properties`.
   - `-validity 10000` is about 27 years. Android recommends at least 25 years, Play requires validity ending after 22 October 2033, and keytool's default is 90 days.
   - The name fields are published in every APK the key signs, so `-dname` holds the app's name and nothing personal.
   - Then write `ks.pass` with the same password, as section 2 says: `Read-Host -AsSecureString | ConvertFrom-SecureString | Set-Content C:\KokonadaSigner\vault\ks.pass` (`:29-31`).
   - Run step 7's last command again: `vault\` must now hold exactly the two files its pass criterion names.
9. **Acceptance.** The first runs prove the signer on real input (`MB-139`). Capture each of these, as console text or a screenshot, and record it on `OPS-304`:
   - (a) In the signer's own session, the run passes the session check (`:117`). The badging check refuses `app-debug.apk` as debuggable (`:266`) and the Design Lab's `app-lab.apk` as another package (`:265`).
   - (b) `app-release-unsigned.apk` from section 3, step 1, passes the badging check, is signed and verified, and passes the 16 KB check (`:296-297`). Keep the three SHA-256 lines.

   The session check's refusal branch (`:118`) is not captured by this runbook. Provoking it needs a process started as `kokonada-signer` from another session, which means typing the signer's Windows password into that session (SEC-264-12). It stays open on `MB-139`.

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

1. First, in the owner's own session: close every agent session and terminal it opened, and the IDE, run `./gradlew --stop` in `mobile/KokonadaHealth/android`, stop Metro, and check that the sentinel's scheduled run is not due during the signing. This is hygiene, not a control: it removes what you forgot to close, never code that hides, and the custody of the key rests on the signer account and the checks below.
2. Lock the screen, choose **Switch user**, and sign in as `kokonada-signer` on the Windows sign-in screen.
3. Open a Windows PowerShell window in that session first, as provisioning step 7 does: press Win+R, type `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile` and press Enter. The script started straight from the Run dialog or a shortcut would close its console with the three hashes still unread (RA-271-R2-6). `-NoProfile` and the first line below keep the account's profile scripts and its own module folder out of the checks that follow (`MB-140` (12) does the same inside the script), and the second prints where PSReadLine came from, as in provisioning step 7.
4. Check the custody, before every run. All three checks must pass; if any fails, sign nothing and sign out.

   ```
   $env:PSModulePath = "$PSHOME\Modules"
   (Get-Module PSReadLine).Path
   Get-FileHash C:\KokonadaSigner\bin\sign-release.ps1 -Algorithm SHA256
   ```

   - `(Get-Module PSReadLine).Path` prints nothing or a path that starts with `C:\Program Files\WindowsPowerShell\Modules\` or with `$PSHOME`.
   - The hash equals the edited copy's SHA-256 kept in the password manager (provisioning step 6).
   - The commands of provisioning step 7, run in this window, meet its pass criterion, with the root a plain `Directory`, no reparse point under it, `vault\` holding exactly its two files and `work\` nothing.
5. Run the full-path command:

   ```
   C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\KokonadaSigner\bin\sign-release.ps1 -In <name>.apk -Out <name>.apk
   ```

6. Read the result. The script moves the signed APK out of `work\` (`:299`), and a move keeps `work\`'s permissions, so the owner's account cannot read the file yet (RA-34). Run `C:\Windows\System32\icacls.exe C:\KokonadaSigner\out\<name>.apk /reset`, which gives it `out\`'s permissions. `MB-140` (8) moves this step into the script.
7. Choose **Sign out**, not Switch user.

Never start the script from the owner's session: never `runas`, never `/savecred`, never `-NoExit` (`:15-19`). The script refuses a session whose interactive user is not the account it runs as (WTSQuerySessionInformation, WTSUserName; `:106-119`), which is exactly what `runas` gives. There is no exception: `runas` would type the signer's Windows password into the owner's session (SEC-264-12), so the refusal branch at `:118` is not captured by this runbook and stays open on `MB-139`.

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
- **No elevation.** The design holds only against code that does not elevate (`:21-22`). An administrator can read any account's files and memory. Microsoft does not treat User Account Control as a security boundary, so when the owner's daily account is an administrator, code in his session may reach elevation without a prompt he notices; the design is strongest when that account is a standard one (`DAN-121`). Provisioning from `kokonada-admin` (step 0, the owner's ruling of 2026-10-27) takes the elevated provisioning window out of his session, and step 0's four lines are the only ones his daily account runs elevated; it does not stop code that elevates in his session from reaching `bin\` or the vault later.
- **The password in the heap.** The script zeroes and frees the password's BSTR, but the managed string that fills the child's environment stays in the script's process heap until the garbage collector reclaims it (`:56-58`). Only `kokonada-signer`, SYSTEM and an administrator can read that process's memory, and the process ends with the run; sign out after every run.
- **ELF alignment.** `zipalign -c -P 16` checks the 16 KB zip alignment only. The ELF LOAD-segment 16 KB alignment of every native library is checked separately, on a real release build, before the first upload (`:61-63`, C271-4).
- **No bundle signing yet.** There is no App Bundle signing step (SEC-271-5). Play takes an `.aab`, `bundleRelease` yields an unsigned one and the script signs APKs only (`:4-7`). The `jarsigner` step, run under the same account and the same rules, is its own row. Until it exists, nothing is uploaded to Play.

**Step 3, before any upload on any Play track, internal app sharing included.** Scan the exact file (`QA-077` D9, `OPS-103`): from `mobile/KokonadaHealth`, run `node scripts/lab/assertLabExcluded.mjs --scan <the file to upload>`. The upload needs exit 0; exit 1 or 2 blocks it. Keep the artifact's name, its SHA-256 and the exit code with the upload record (`docs/store/play-health-connect-declaration.md:113`).

## 4. Sideload for on-device QA

QA builds are to be release-signed through the same signer step, under the owner's ruling `F3` of 2026-10-20 (`OPS-303`). Copy the signed APK from `out\` to the phone, after the `/reset` of section 3, step 2, and install it. The same signature keeps the installed data and sign-in.

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
