# Discovery UI — Visual Direction & Token Authority

> Authored by the `designer` agent (read-only), 2026-07-13. This is the per-surface build authority
> the `developer` builds against, alongside `docs/SCREENS.md` and `docs/UI_UX_OVERHAUL_SPEC.md`.
> Design language: Calm / Premium Wellness × Bioluminescent (light "Clinical Premium" primary, dark
> "Bioluminescence" alternate). Visual layer only — no change to the ≤3-tap payload, three-lane state,
> `screenToCircumplex`, or any socket/DTO contract.

Scope: (a) Now Playing "why this discovery" treatment · (b) Up-Next queue sheet · (c) `DiscoveryBadge`.
Source files: `mobile/KokonadaHealth/src/experience/playback/NowPlayingScreen.tsx`, `playbackQueue.ts`,
`playbackOrchestrator.ts`, `nowPlayingStore.ts`, `mobile/KokonadaHealth/src/design/tokens.ts`, `theme.ts`,
`contrast.ts`, `backend/app/sockets/biometricHandler.js` (`buildReceipt`).

---

## 1. Vision Frame — token delta for discovery

### 1.1 Reused (no new tokens)
- Sheet body surface → `surface.overlay` + `elevation.e3`.
- Sheet/header text → `content.primary/secondary/tertiary` (AA-verified on overlay, both themes).
- Row separators → `surface.hairline`. Familiar pill → `surface.raised` + `surface.hairline` (shipped, unchanged).
- Spacing/radius/type/elevation/haptics → `space`, `radius`, `type`, `elevation`, `haptics`.
- Motion → `motion.duration.slow`, `motion.easing.enter/exit`, `motion.spring.gentle` (+ `durationReduced` variants).

### 1.2 NEW TOKEN A — `emotionAccent` (valence×arousal quadrant matrix)
The existing `emotionAnchors` is an arousal-heat scale wired only to the HR Skia aura; its bright stops
FAIL AA as text on light porcelain, and its red `peak` must never touch discovery UI (regulator ethic).
Discovery needs a valence×arousal quadrant accent with a text-safe `ink` and a decorative `wash`.
**Intense (negative valence × high arousal) is deliberately violet, not red** — the ethic is in the token.

**DARK — "Bioluminescence"** (vs `base #060B11` / `raised #0E1721` / `overlay #182634`):

| Quadrant (v, a) | `ink` | Contrast base/raised/overlay | `wash` (14% α) |
|---|---|---|---|
| `calm` (v≥0, a<0) | `#31E1C4` | 11.9 / 10.9 / 9.3 | `#31E1C424` |
| `joyful` (v≥0, a≥0) | `#FFC06B` | 12.2 / 11.2 / 9.5 | `#FFC06B24` |
| `intense` (v<0, a≥0) | `#C4A6FF` | 9.8 / 8.9 / 7.5 | `#C4A6FF24` |
| `reflective` (v<0, a<0) | `#9DB4FF` | 9.8 / 9.0 / 7.6 | `#9DB4FF24` |

**LIGHT — "Clinical Premium"** (vs `base #F3F8FA` / `raised #FFFFFF` / `overlay #E9F1F4`):

| Quadrant | `ink` | Contrast base/raised/overlay | `wash` (8% α) |
|---|---|---|---|
| `calm` | `#0A7A6B` | 4.89 / 5.24 / 4.58 | `#0A7A6B14` |
| `joyful` | `#A34E24` | 5.34 / 5.72 / 5.00 | `#A34E2414` |
| `intense` | `#6E3FC4` | 6.19 / 6.62 / 5.79 | `#6E3FC414` |
| `reflective` | `#3A5CCC` | 5.48 / 5.72 / 5.12 | `#3A5CCC14` |

Every `ink` clears AA-normal (4.5) on all three surfaces, both themes. Tightest pair: `calm`-light on
`overlay` = 4.58 — passes, but never render calm-light ink below `type.size.caption` (SHIP-gate flag).
`calm.ink` reuses the shipped `accent.glow` value — a calm session wears the brand accent.

**NEW helper `emotionAccentFor(taps): quadrant`** — pure/presentational; reads committed
`emotionSlice.taps` (x=valence, y=arousal −1..1), mean with a `‖·‖ < 0.15 → calm` deadzone, quadrant by
sign. No taps → `calm`. **Static for the session** (never flickers track-to-track). Read-only over state.

### 1.3 NEW TOKEN B — `surface.scrim`
Decorative dim behind the Up-Next sheet. `dark: #00000073` (45%), `light: #12202B59` (35%). Not a text
backdrop → no AA requirement.

### 1.4 Additive contract note — receipt `anchor`
Mobile `TrackReceipt` + `sanitizeReceipt` (`playbackQueue.ts`) additively accept
`anchor?: { title: string; artist: string }`, kept only when both are non-empty strings (mirror the
existing defensive pattern). On-device half of backend Section A. Sacred-contract-safe.

### 1.5 Semantic motion aliases (map to existing tokens; zero new numbers)
`sheetPresent`/`sheetDismiss` → `spring.gentle`; `discoveryReveal` → `duration.slow` + `easing.enter`;
`cursorGlide` → `spring.gentle`. All inherit `durationReduced`/no-spring under reduced motion.

---

## 2. Per-surface direction

### 2.a Now Playing — "why this discovery" moment
Extends the shipped `now-playing-receipt` node. Three branches, one node, no error state ever:
1. **Familiar** (label "Familiar favorite") → the quiet pill, exactly as shipped.
2. **Discovery + anchor** → designed treatment.
3. **Discovery, no anchor** → graceful fallback to the quiet pill ("New discovery" + detail).

Branch 2, same pill/slot re-dressed top-down: leading discovery glyph (✦/dot-in-ring) in
`emotionAccent[q].ink` (the shape signal); Line 1 label "New discovery" (`content.primary`, `caption`,
`semibold`); Line 2 anchor "Because you love " (`content.secondary`, `footnote`) + `{anchor.title}` in
`emotionAccent[q].ink` (`footnote`, `medium`, 1 line, tail-truncate); Line 3 detail (`content.tertiary`,
`caption`, first to drop). Container fill `surface.raised`; border `emotionAccent[q].ink` at hairline.
Motion: `discoveryReveal` on track-change (elapsed-time driven, never per-frame); no perpetual breathing
(deliberate — never competes with the shipped `PlaybackAura`); reduced motion → instant swap.
a11y: `accessibilityLabel` "Why this track: New discovery. Because you love {title} by {artist}.{detail}".
Keep `testID="now-playing-receipt"`; add `testID="now-playing-discovery"` on the enriched branch.

**Sheet trigger (SCREENS §7 "open full playlist"):** low-emphasis chevron-up + "Up next"
(`content.secondary`, ≥44pt), tap or swipe-up opens the sheet; reduced motion → no bounce.

### 2.b Up-Next queue sheet
Modal sheet over Now Playing. No per-track cover art → pure typography + accent (calmer/more premium
than mismatched thumbnails). Scrim `surface.scrim` over dimmed art; body `surface.overlay` (opaque — no
full-height blur behind a scrolling list, a 60fps decision) + `elevation.e3`, top radius `radius.xl`,
grabber. Header: honest summary "50 tracks · 12 new for you" (`content.secondary`, `subheading`; tint
"12 new" in `emotionAccent[q].ink`), `surface.hairline` divider. Rows (virtualized FlatList/FlashList):
title (`content.primary`, `callout`, 1 line) over artist (`content.secondary`, `footnote`, 1 line);
trailing `DiscoveryBadge` on discovery rows; separators `surface.hairline`; no per-row shadow.

States (all soft, no red, no dead ends): **cursor** → 3px leading rail (`emotionAccent[q].ink`) + row
wash + `semibold` title + state glyph (▶/❙❙) [four non-color signals]; **foreign-track reconcile** →
no rail, soft note "Playing from Spotify", tap reclaims; **disconnected** → note "Reconnecting…" (never
`state.danger`), rows dim but tappable; **end-of-queue** → soft footer "End of set · finding more…".
Tap-to-jump: optimistic rail `cursorGlide` then reconciled to real orchestrator state (dead discovery →
#130 one-report + audible auto-skip; disconnected → degrade in place; failure cap). Motion mirrors real
state only. Reduced motion → instant present/dismiss/jump. a11y: focus-trapped modal
(`accessibilityViewIsModal`); rows are buttons "Play {title} by {artist}[, new discovery][, now
playing/paused], track {i+1} of {n}"; `haptics.selection` on jump commit.

### 2.c DiscoveryBadge (reusable)
Pill (`radius.pill`), height = one `caption` line + `space.xs`, `space.sm` h-padding. Fill
`emotionAccent[q].wash`; border `emotionAccent[q].ink` hairline (≥3:1); leading glyph ✦ in
`emotionAccent[q].ink` (shape signal); label "New" (`content.primary`, `caption`, `semibold`). API: takes
session quadrant `q`; `neutral` variant (`content.secondary` + `surface.hairline`) for future History.
Differentiation = presence of the badge + "New" + glyph, never hue. a11y: decorative-hidden in-row
(meaning folds into row label); standalone `accessibilityLabel="New discovery"`. Flat fill + hairline +
one glyph → free at 60fps in a virtualized list.

---

## 3. Open design risks — on-device REVISE checklist for the SHIP gate
1. Accent divergence (brand-cyan aura vs. amber/violet/indigo treatment) — verify reads as intentional; fallback: collapse discovery accent to `calm.ink`.
2. `calm`-light ink margin (4.58 on overlay) — confirm comfortable under Galaxy glare; never below `caption`.
3. Wash visibility floor — cursor must be unambiguous with the wash effectively off (rail + weight + glyph carry it).
4. Sheet-over-art legibility in LIGHT (porcelain-on-porcelain) — bump `scrim.light` alpha only if the sheet doesn't read as elevated.
5. Reveal on rapid skips — `discoveryReveal` must interrupt cleanly (cancel-on-change), hold 60fps; else instant swap.
6. Tap-to-jump reconcile snap-back — the optimistic rail glide-back must feel like a calm correction; verify against the #130 logcat QA.
7. Dynamic Type overflow — treatment stays ≤3 lines (detail drops first, anchor never); rows stay 2 lines; badge doesn't crowd the artist.

**Verdict:** direction complete and buildable on tokens with zero magic numbers; the 7 items are the on-device REVISE checklist for the built-screen gate.
