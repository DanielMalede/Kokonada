# Discovery UI — Design Spec (Screen Design phase)

> Scope locked with Daniel 2026-07-13. The vector Live Discovery engine (#125–#130) is live and
> self-healing but invisible; this phase builds the visible discovery experience. Design language:
> Calm / Premium Wellness × Bioluminescent (`docs/UI_UX_OVERHAUL_SPEC.md`); intent: `docs/VISION.md`;
> per-screen catalog: `docs/SCREENS.md`. No RN screen code before the designer's visual direction
> lands; every Spotify-facing choice passes the compliance-auditor before build.

## Locked scope

1. **Surfaces:** (a) a richer "why this discovery" treatment on Now Playing, (b) discovery badges.
   NO dedicated discovery screen and NO History recap this phase.
2. **Receipt enriched from the start:** the backend derives an honest discovery-specific reason —
   the nearest anchor in the *user's own library* by embedding similarity ("Because you love X") —
   threaded through selection → `toClientTrack`.
3. **Badge home:** the §7-spec'd but never-built **Up-Next queue sheet** on Now Playing; badges
   live on its rows.
4. **Sheet is interactive:** tap a row → playback jumps there (`skipToIndex`, already implemented
   in the playback orchestrator).

## A. Backend — enriched discovery receipt (contract-first)

For each selected discovery track, compute its nearest library anchor by embedding similarity — the
anonymous `TrackCatalog` already holds key-aligned embeddings for both library and discovery entries
(`recordingKeyOf`). Extend the receipt additively:

```
receipt: { label, detail?, anchor?: { title, artist } }
```

- Familiar tracks unchanged. If no anchor clears a similarity floor, the field is omitted and the
  UI degrades to the current pill.
- The honesty rule (`buildReceipt`, `backend/app/sockets/biometricHandler.js`) holds: derived from
  real embeddings, never guessed.
- Anchor is computed per-user at serve time and NEVER stored on the anonymous catalog
  (zero-knowledge / catalog anonymity preserved).
- Performance: no per-track Atlas round-trip — batch or in-memory over the user's library
  embeddings; the pinned selection p95 < 300ms budget is a hard constraint.

## B. Now Playing — the "why this discovery" moment

The existing receipt pill (`NowPlayingScreen.tsx`) becomes a designed discovery treatment for
`isDiscovery` tracks: discovery label + anchor line ("Because you love X"), `emotionAccent`-driven,
calm regulating motion. Familiar tracks keep the quiet pill. Absent anchor data → graceful fallback
to the current pill. No error states, ever.

## C. Up-Next queue sheet (new component on Now Playing)

The §7 "open full playlist" affordance, finally built: a sheet over Now Playing showing the
generated set with the live cursor.

- **Rows:** title/artist + `DiscoveryBadge`. **No per-track cover art** (Spotify Dev Mode 403s the
  art path; App Remote art resolves only the playing track) — virtualized, typography/accent-driven.
- **Header:** honest set summary ("50 tracks · 12 new for you").
- **Tap-to-jump** via the orchestrator. #130 invariants must hold under user-intent cursor moves:
  jump to a dead discovery track → same one-report + audible auto-skip self-heal; jump while
  disconnected → degrades in place (reason-threaded); the consecutive-failure cap still bounds.
- **States:** cursor playing/paused · foreign-track reconcile (remote is truth) · disconnected
  (soft) · end-of-queue.

## D. DiscoveryBadge

One tokenized, reusable component (sheet rows now; History detail later). WCAG 2.2 AA; color never
the only signal; designer-authored.

## Verification

- Backend suite green, no baseline regression (≈109 suites / 1250).
- Mobile suite green from `mobile/KokonadaHealth` via `./node_modules/.bin/jest`, no baseline
  regression (57 / 587).
- Per-screen DoD: tokens only · light + dark · reduced-motion · WCAG 2.2 AA · 60fps floor ·
  on-device before/after screenshots · designer SHIP verdict · resilience audit · compliance pass.
- Tap-to-jump edge cases fold into the pending #130 device logcat QA.
