---
description: Give the exact capture runbook — an Android emulator by default, the owner's real phone only for the one final pass (build + manifest + logcat + repro).
argument-hint: [rows/features to test]
---
Produce a copy-ready capture runbook for: $ARGUMENTS
Device work closes on an emulator (DEC-192); the owner's real phone takes only the one quick pass at the end. Every command below runs in Git Bash, with the SDK's own tools (`emulator`, `adb`, `sdkmanager`, `avdmanager`) and the emulator's serial (`adb devices`, e.g. `emulator-5554`).

EMULATOR — the default; the session or the developer runs it, no one waits on the owner. Include exactly:
1) The AVD: each API level the work needs (a /page evidence pack: 28, 30, 34 and 36), made once with `sdkmanager "system-images;android-<api>;google_apis;x86_64"` and `avdmanager create avd -n kokonada-api<api> -k "system-images;android-<api>;google_apis;x86_64" -d pixel_6`. Start it with `emulator -avd <name> -gpu host` (`-gpu swiftshader_indirect` where the host GPU cannot serve it, `-no-window` for a run with no screen), wait with `adb -s <serial> wait-for-device`, then poll `adb -s <serial> shell getprop sys.boot_completed` until it prints 1; a "System UI isn't responding" dialog right after a cold boot is dismissed, not a finding.
2) The build: git pull; cd mobile/KokonadaHealth && npm install; cd android && ./gradlew :app:installDebug -PreactNativeArchitectures=x86_64. The Design Lab APK of `mobile/KokonadaHealth/scripts/lab/buildLabApk.mjs` is arm64-v8a only, which an x86_64 AVD does not run: until the lab scripts build x86_64, say that a lab capture on an emulator cannot be made rather than substitute another build. A /page evidence pack needs a debug-signed release Hermes build, not this debug build.
3) The manifest of the run, read from the emulator and saved beside the captures: the AVD (`adb -s <serial> emu avd name`), the image (`getprop ro.build.fingerprint`), the API level (`getprop ro.build.version.sdk`), the GPU renderer (`adb -s <serial> shell dumpsys SurfaceFlinger | grep -m1 'GLES:'`), the Skia backend (`getprop debug.hwui.renderer`), each property read with `adb -s <serial> shell getprop <property>`, and the commit SHA with an empty `git status --porcelain`. A software renderer (SwiftShader) is named as such: its pixels are not the phone's.
4) The capture: `adb -s <serial> logcat` with a tag filter relevant to the feature, saved to a file at repo root, and each screenshot with `adb -s <serial> exec-out screencap -p > <file>.png`.
5) The precise repro steps on the emulator, then the files and the manifest handed back with the report.
Never claimed from an emulator: frame timing, thermal, the leak loop, field pixel parity. Those wait for the real-phone pass.

THE REAL PHONE — only the one quick pass, after everything passed on emulators and before the owner's final review of a release. The owner runs it on his physical Galaxy, so hand him the runbook and wait for his results: 1) build steps (git pull; cd mobile/KokonadaHealth && npm install; cd android && ./gradlew :app:installDebug, or the signed release build the pass names); 2) the `adb logcat` capture command with a tag filter relevant to the feature, saving to a file at repo root; 3) the precise on-device steps; 4) how to hand the captured files back.

Do NOT guess-fix anything before the capture is back. This is a repro runbook; a /page evidence pack needs a release (Hermes) build instead.
