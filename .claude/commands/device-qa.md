---
description: Give the exact on-device capture runbook (build + logcat + repro).
argument-hint: [rows/features to test]
---
Produce a copy-ready on-device capture runbook for the physical Galaxy for: $ARGUMENTS
Include exactly: 1) build steps (git pull; cd mobile/KokonadaHealth && npm install; cd android && ./gradlew :app:installDebug); 2) the `adb logcat` capture command with a tag filter relevant to the feature, saving to a file at repo root; 3) the precise on-device repro steps; 4) how to hand the captured file back. Then wait for my results. Do NOT guess-fix anything before I bring the capture.
