# KokonadaHealth — the mobile app

The React Native app of Kokonada (Android first; the iOS HealthKit lane is `docs/plans/healthkit/`). It reads live biometrics (Health Connect, a BLE strap, later HealthKit), lets the user name a mood, and plays the music the backend chooses through Spotify.

- **Build and run (debug):** `npm install`, then `npm run android` with a device or emulator attached. Metro starts on its own.
- **Tests and lint:** `npm test` (jest), `npm run lint`; the design-system lint and the Design Lab exclusion checks run in CI (`.github/workflows/ci.yml`).
- **Release build and signing:** `docs/runbooks/android-release-signing.md`.
- **On-device QA:** `/device-qa` (the capture runbook); the Design Lab build is `scripts/lab/README.md`.
- **Where the code lives:** `src/experience/` (screens), `src/design/` (tokens and components), `src/health/` (the health lanes), `src/auth/`, `src/net/`, `src/state/`; the native modules are under `modules/`.
- **Design direction:** `docs/plans/design-v2-plan.md` and `docs/design-v2/` (current), `docs/design-v1/` (v1, history where it conflicts).
- **Brand assets and fonts:** `assets/brand/google/README.md`, `assets/fonts/README.md` (their licence rules are tested).

The rules of work are in the repository's `CLAUDE.md`; the map of the documentation is the root `README.md`.
