# The Design Lab (MB-084)

The Design Lab renders design scenes on a real phone for evidence captures. It is never part of
the app people install. Apple 2.3.1(a) with 2.2 and Google Play's Deceptive Behavior policy forbid
hidden or dormant features in **any** uploaded build: every Play Console track, App Store Connect,
and TestFlight. So the lab is kept **absent** from every build that can be uploaded, not merely
unreachable in it. That is done by structure, and the checks below prove it.

## Where it lives

| Part | Path | In which build |
|---|---|---|
| JS entry | `index.lab.js` | the `lab` build type only, bundled by the lab scripts |
| JS code | `src/design/lab/` | reached only from `index.lab.js` |
| Sentinel | `src/design/lab/sentinel.ts` | a string no other module holds; the checks search for it |
| Android activity, manifest, name | `android/app/src/lab/` | merged into the `lab` build type only |
| Build type | `lab` in `android/app/build.gradle` | package `com.kokonadahealth.lab`, debug-signed, never uploaded |

The `lab` build type is release-equivalent (not debuggable; Hermes; JS built with `--dev false`).
It is a separate package that installs beside the real app and shares none of its data. Its
manifest removes the real app's activities, the network permission, every health, Bluetooth and
location permission, and both of the real app's URL schemes. It is opened by an explicit intent
with launch arguments, never by a deep link.

## How exclusion is enforced

- **`index.js` never imports the lab.** `src/design/lab/__tests__/labExclusion.test.ts` checks
  this on every jest run: the import closure of `index.js`, and every import edge into the lab.
- **`npm run lab:excluded`** (CI, job "Mobile — jest"):
  - Metro bundles `index.js` with the release Gradle task's own flags, and `hermesc` compiles it.
  - The JS, the sourcemap and the Hermes bytecode must hold no lab trace.
  - Positive control: the same pipeline over `index.lab.js` must show the sentinel. Otherwise a
    clean result proves nothing.
- **`npm run lab:manifests`** (CI, job "Mobile — Android compile check"):
  - Every merged manifest Gradle wrote is checked.
  - `release`, and any other variant that is not the lab, declares no lab component.
  - The lab declares none of the real app.
- **Gradle refuses:**
  - to configure while `ENTRY_FILE` is set. The React Native plugin applies that variable to every
    variant, release included. Never use it.
  - to build the lab as an App Bundle (`bundleLab`). An App Bundle is the format Play Console takes.
  - to package a lab APK without its bundle in `android/app/src/lab/assets/`.

  Because `lab` is a build type, the aggregate `assemble` and `build` tasks now include it, and they
  stop at that last refusal until the lab bundle exists. Build the variant you mean
  (`assembleDebug`, `assembleRelease`, `bundleRelease`).

## Before any upload

Scan the exact file you are about to upload. Exit 0 means no trace was found; 1 means a trace was
found; 2 means the scan could not run.

```sh
npm run lab:excluded -- --scan android/app/build/outputs/bundle/release/app-release.aab
```

## iOS

There is no lab target on iOS: the Xcode project builds `index.js` only. The iOS `main.jsbundle`
comes from the same `index.js` closure that the jest check covers on every run.

If an iOS lab target is ever added:

- check the iOS `main.jsbundle` the same way (`npm run lab:excluded -- --platform ios`);
- scan the archive's `.ipa` before every App Store Connect or TestFlight upload;
- keep the lab target out of any scheme that is archived for upload.
