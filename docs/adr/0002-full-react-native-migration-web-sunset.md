# ADR 0002 — Full React Native Migration; Web Sunset

- **Status:** Accepted (locked decision — do not relitigate)
- **Date:** recorded 2026-07-07 (decision predates this record)

## Context
The original product shipped as a React/Vite web app. Biometric-driven playback needs
native capabilities (Health Connect, background HR, Spotify App Remote, Skia/Reanimated at
120 Hz, secure Keychain storage) that the web platform cannot deliver, and the Web Playback
SDK is desktop-only. Maintaining two front ends splits effort.

## Decision
`mobile/KokonadaHealth` (bare **React Native 0.86**) is the future app. The React/Vite
**web is being sunset** (Squad 5). The Vercel domain survives for AASA/assetlinks deep links
and OG cards only.

## Consequences
- New feature work targets mobile; the web surfaces (`DiscoverPage`, `ActivityPanel`,
  `PlaylistDetailPage`, Garmin credentials form, offline-buffer player) are removed in Squad 5.
- Mobile must enter CI (currently local-only) so its suite gates like the backend does.
- The three-lane state architecture (HOT/WARM/COLD) is the sacred mobile invariant.
