# KOKONADA — UI/UX MASTER OVERHAUL SPEC
## "The Synesthetic Living App" — Design Directive (Blueprint Wave 2.8)

> **Design language:** *Calm / Premium Wellness × Bioluminescent Depth.*
> The app is a living instrument that fuses the human nervous system with sound. It does not decorate data — it **breathes with the user, to calm the user.**
> **Status:** Scheduled design phase. Persisted as the authoritative spec for Wave 2.8; the Master Blueprint references this file.

---

## 0. PRIME DIRECTIVE & GUARDRAILS (read before anything)

**Persona:** Lead Product Designer + Principal Frontend Architect, Apple-Design-Award calibre. Take full end-to-end ownership; innovate proactively within the approved system. But elite design leadership is **vision *with* a gate** — that discipline is exactly what ships award-winning apps.

**Do NOT start until all are true:**
- PR #101 (Spotify playback authorization + vector-icon bundling) is fixed, merged, and **device-verified**.
- Wave 2.6 / D1 tooling (Tamagui / Moti / Lottie / bootsplash / vector-icons) merged.
- Defects D-3 (History nomenclature) and D-4 (Pulse display) resolved.
- Runs **before** Wave 3 (store submission); **merge/coordinate with A12 a11y (Wave 2.3)** so accessibility is done once.

**The one approval gate (mandatory):**
Before any mass rollout, present a **Vision Frame** for sign-off:
1. the design-token system (color/type/space/motion/haptics),
2. 2–3 mockup directions within Calm/Premium × Bioluminescent,
3. **one fully-built hero screen** (the Generate screen) running on-device.
After approval → free hand *within* the approved system. No approval-fishing on every screen; no unbounded "overhaul the whole codebase" in one commit.

**Incremental delivery:** PR-per-screen, each with before/after on-device screenshots as closing evidence. Big-bang rewrites are unreviewable and get rejected.

**SACRED CONTRACTS — visual layer only, never touch:**
- the ≤3-tap emotion payload contract; the three-lane state architecture (HOT Reanimated / WARM zustand / COLD Redux Toolkit); the Skia wheel geometry (`screenToCircumplex`); every backend socket/DTO contract.
- Do not regress the pinned tests (S9-1, S10-1, S11-1, S12-1, and the D-series). This is styling on top of working logic, not a rewrite.

---

## 1. PHILOSOPHY — "Breathe WITH the user, to calm the user"

**Generative, biometric-bound UI — as a regulator, not a mirror.** Bind Reanimated spring physics (stiffness/damping) and Skia blur radii to ingested Garmin/Health-Connect BPM & HRV — but in the **regulating** direction: when biometrics indicate stress (low HRV / elevated resting-relative HR), the UI **slows, softens, deepens** its breath-rate animation to gently entrain the user downward. It never visually agitates. This mirrors the backend `translate()` recovery-gating philosophy (a wrecked body gets calm, not bangers) and is the ethical core of a wellness product.

**Dual state:**
- **Light — "Clinical Premium":** airy, frosted-glass (glassmorphism) with **solid, contrast-safe fallbacks** (glass must still pass WCAG AA).
- **Dark — "Bioluminescence":** deep OLED-optimised, luminous accents used as *depth*, not neon chaos. Seamless animated toggle.

---

## 2. THE DESIGN SYSTEM (tokens — zero magic numbers)

All styling flows from a centralised Tamagui token architecture; no hardcoded values in components.

- **Color:** semantic matrices — `surface / content / accent / state / emotionAccent`. `emotionAccent` derives from valence×arousal so the palette shifts with mood (reuse the existing circumplex + `deriveAuraUniforms`). Full light + dark maps. **Every pairing verified WCAG 2.2 AA (AAA for body text where feasible), including over glass/gradient.**
- **Type:** modular scale + full **Dynamic Type** support. One expressive display face + one highly legible text face. No fixed pixel type.
- **Space / radius / elevation:** consistent scales; elevation via soft, diffuse, wellness-grade shadows (not harsh Material drops).
- **Motion tokens:** durations + **easing curves as tokens** (calm = slower, organic spring signatures). **Every motion token ships a `prefers-reduced-motion` variant** and a low-power variant.
- **Haptics vocabulary:** a curated, semantic set (`selection`, `commit`, `success`, `warning`) — subtle, respect system settings/silent, never spammy.
- **Earcons:** **OFF by default, opt-in**, subtle, respect silent mode and a11y. (Correcting "earcon on every state change" — that harms accessibility and delight.)

---

## 3. SIGNATURE EXPERIENCES (the "wow", disciplined)

- **The Genesis Loader (no spinners):** a Skia, mathematically-driven "neural analysis" — a **calm, breathing** sine-driven fluid/particle field, not a frantic storm. Reduced-motion → elegant static/skeleton; low-power/thermal → simplified render. Frame-rate-independent (advance by elapsed time).
- **Bio-Aura centerpiece (already built — elevate, don't rebuild):** drive hue/intensity/breath through the existing `deriveAuraUniforms(hr)`, keep the NaN/∞ hard clamps and `advancePulsePhase` frame-rate independence (a single bad uniform crashes the Skia surface — do not weaken the guards).
- **Emotion Wheel:** elevate visuals/materials only; `screenToCircumplex` geometry and the tap-commit worklet are untouchable.
- **Gyroscopic parallax:** **subtle**, opt-out, auto-disabled under reduced-motion / low-power; never applied to critical tap targets (accessibility + accidental activation).
- **Gestural choreography:** fluid, interruptible, continuous gestures via `react-native-gesture-handler`, running exclusively on the UI thread.
- **Cross-modal sync (synesthesia):** curated visual + haptic (+ optional earcon) on *key* commits only — tap-commit, generate, track-change — not on every state change.

---

## 4. SCREEN-BY-SCREEN SCOPE

- **FTUE / Onboarding:** a cinematic, guided **sensory** journey that teaches the body↔music connection with almost no text. Preserve the "**Try with mood only**" path (wearable optional).
- **Auth:** Sign in with Apple / Google to **exact HIG** dimensions, fonts, and placement.
- **Generate (HERO — build first for the Vision Frame):** aura + radial wheel + activity chips + prompt + the morphing CTA (Generate ↔ "Listen to your heart" ↔ disabled).
- **Now Playing:** full-screen, album-art gyro-parallax, fluid transport, mix receipts.
- **Pulse:** the biometric dashboard — calm gauge fills, friendly status labels, and **honest empty states** ("Not shared by your watch") rather than bare dashes. (Body Battery / Daily Readiness are Garmin-proprietary, absent from Health Connect — present them as such, not as errors.)
- **History:** friendly titles + Manual/Live source (D-3), list items that feel like manipulable material.
- **Profile / Integrations — "Privacy Vault" aesthetic:** wrap Health-Connect permissions in a premium, trust-establishing vault UI. **Normalise the integration rows** (consistent Connected/Disconnected status + action — fixes the current YouTube inconsistency) with brand-exact Spotify/YouTube marks.
- **Tab bar:** real, calm iconography (the current tofu boxes are a font-bundling bug fixed in PR #101 — the redesign owns the final icon language).
- **System states everywhere:** stunning offline/degraded, ghosted premium empty states, and seamless skeletons. Never trap the user.

---

## 5. BRAND IDENTITY (a product, not a template)

Define the Kokonada mark end-to-end: **app icon, wordmark/logotype, splash (bootsplash), color signature, and a motion signature** (a recognisable "breath" animation used as a brand gesture). Identity is what separates an award app from a themed template — treat it as a deliverable, present it in the Vision Frame.

---

## 6. PERFORMANCE (realistic extremism, zero jank)

- **Thread architecture:** all UI/gesture animation on the UI thread via Reanimated worklets; a 120 Hz gesture never touches JS.
- **Frame-rate honesty:** target **120 Hz where the panel supports it; 60fps is the HARD floor — never drop below.** ("120fps floor" is not real on most panels; the discipline is *never drop frames*, not a fictional ceiling.)
- **Graceful degradation:** monitor battery/thermal/low-power state; throttle Skia radii, particle counts, and parallax gracefully.
- **Memory purity:** dispose Skia/graphic instances cleanly on unmount; **parity-test subscribe/unsubscribe** (React 18 removed the unmount warning — per the S10-1 lesson, prove teardown with parity, not the removed warning).

---

## 7. ACCESSIBILITY (first-class, merged with A12)

- **WCAG 2.2 AA** minimum: contrast (including over glass/gradients), Dynamic Type, minimum tap targets, logical focus order.
- **Screen reader:** fully label the emotion wheel **and** ship the text/list alternative emotion selector (required by the original a11y mandate) for users who can't use a precision 2D map.
- **Reduced motion:** honoured by every motion token; parallax/particles/aura simplify or stop.
- **Color-blind safe:** never encode emotion/state by color alone — pair with shape/label.
- Do this work **once**, folded into A12 (Wave 2.3), not twice.

---

## 8. PROCESS, TESTING & GOVERNANCE

- **Gate:** Vision Frame approval before rollout (§0).
- **Delivery:** PR-per-screen; strict TDD for any logic (mostly presentational — test token application, reduced-motion branches, empty-state logic, teardown parity); **on-device screenshots are the closing evidence**, not green mocks.
- **Baselines:** do not regress mobile (51 suites / 455 tests) or backend; add visual-regression snapshots where feasible.
- **ADR:** record the chosen design language + biometric-regulation philosophy as an ADR (`docs/adr/`).
- **Model economy:** Vision Frame + token system + hero screen = Opus-class; per-screen restyle drops to Sonnet once the direction and tokens are approved.

---

## 9. DEFINITION OF DONE (the overhaul)

Every surface: on the token system with **zero magic numbers**; light + dark; reduced-motion + low-power paths present; **WCAG 2.2 AA** verified; **60fps floor held on the physical Galaxy**; brand identity applied; all sacred contracts and pinned tests intact; **device-verified with before/after screenshots**. Anything short of all of these is not done.
