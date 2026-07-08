# ADR 0009 — Design Language: Calm/Premium Wellness × Bioluminescent Depth (Biometric-Regulation UI)

- **Status:** Accepted (execution gated behind the Wave 2.8 Vision-Frame approval)
- **Date:** 2026-07-08
- **Spec:** `docs/UI_UX_OVERHAUL_SPEC.md` (authoritative Wave 2.8 directive)

## Context
The app's logic plane is device-verified (playback, live biometric mode, intelligence
surfaces), but the visual layer is a themed default, not a product identity. Kokonada's
premise — music as a physiological regulator — demands a UI that expresses the same
philosophy as the backend `translate()` recovery gating: a stressed body gets calm, not
stimulation. A generic "reactive" UI that mirrors biometrics would visually agitate exactly
when the user most needs calming.

## Decision
Adopt **"Calm / Premium Wellness × Bioluminescent Depth"** as the single design language,
with **biometric regulation — never mirroring — as its ethical core**:

- **Regulating direction:** UI motion (Reanimated spring physics, Skia blur/breath rate)
  binds to ingested BPM/HRV, but under stress signals the UI *slows, softens, deepens* to
  entrain the user downward. It never speeds up or intensifies with stress.
- **Dual state:** Light = "Clinical Premium" (airy frosted glass with WCAG-AA-safe solid
  fallbacks); Dark = "Bioluminescence" (deep OLED-optimised, luminous accents as depth).
- **Token-first:** all styling flows from a centralised Tamagui token architecture
  (color/type/space/motion/haptics) — zero magic numbers in components; `emotionAccent`
  derives from the existing valence×arousal circumplex.
- **Restraint clauses:** earcons OFF by default; haptics semantic and sparse; parallax
  subtle, opt-out, disabled under reduced-motion/low-power; every motion token ships a
  reduced-motion variant. 60 fps is the hard floor (120 Hz where the panel supports it).
- **Sacred contracts:** the ≤3-tap emotion payload, three-lane state architecture
  (HOT Reanimated / WARM zustand / COLD Redux), `screenToCircumplex` geometry, and all
  socket/DTO contracts are untouchable — this is a visual layer, not a rewrite.

## Consequences
- Wave 2.8 opens with a mandatory **Vision-Frame approval gate** (token system + 2–3 mockup
  directions + one fully-built hero Generate screen on-device) before any screen rollout;
  after approval the system is locked and screens roll out PR-per-screen with before/after
  on-device screenshots.
- Accessibility (WCAG 2.2 AA, Dynamic Type, screen-reader wheel alternative, color-blind-safe
  encoding) is done **once**, folded into A12 (Wave 2.3), not twice.
- Brand identity (app icon, wordmark, bootsplash, motion signature) is a deliverable of the
  overhaul, presented in the Vision Frame.
- Any future visual work that agitates under stress signals violates this ADR.
