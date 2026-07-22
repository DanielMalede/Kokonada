# Handoff: Kokonada — AURORA Design System & 10 Core Screens

## Overview
Kokonada turns a person's body + mind into a live music playlist. This package documents the **AURORA** design language and 10 core mobile screens, including the interactive **Generate** emotion-wheel and a full **Day / Aurora Nocturne** dark mode. The centerpiece experiences are the **bio-aura** (a breathing focal glow driven by the user's emotion) and **Genesis** (the playlist-generating overlay); everything else is intentionally restrained.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, **not** production code to copy directly. They are authored as "Design Components" (`.dc.html`) that use inline styles + a small runtime (`support.js`); this is a prototyping format, not a target runtime.

The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI, native, etc.) using its established patterns, component library, and theming system. If no environment exists yet, choose the most appropriate framework and implement the designs there. Lift the exact tokens, layout, and behavior described below — do not ship the HTML as-is.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, and interactions are specified. Recreate pixel-perfectly using the codebase's libraries. Where this design hand-draws icons (nav glyphs, lock, play/skip triangles) as CSS/SVG placeholders, **substitute the codebase's real icon set**.

---

## Design Tokens

### Aurora gradient (the brand ambient field)
Stops: sky `#3FB4F0` → violet `#8B6FE8` → gold `#F5B93A`. Soft pink `#F79AC0` is allowed as an extra ambient stop. Used for the wordmark (gradient text), app icon orb, and the ambient background blobs on every screen.

### Reactive emotion → color (Generate screen)
Bilinear interpolation over a valence (x) × arousal (y) wheel. Recolors the focal glow, tap dots, accent, and primary CTA. Corner anchors (normalized x,y where x=0 left/negative, x=1 right/positive, y=0 top/high-arousal, y=1 bottom/low-arousal):
- **top-left** (0,0) neg-high = violet `#8B6FE8`
- **top-right** (1,0) pos-high = gold `#F5B93A`
- **bottom-left** (0,1) neg-low = indigo `#4B6FD0`
- **bottom-right** (1,1) pos-low = sky `#3FB4F0`

High-arousal-negative must stay **soft** (violet) — never an alarming red. Compute: `top = lerp(TL,TR,x)`, `bottom = lerp(BL,BR,x)`, `color = lerp(top,bottom,y)`, all in RGB.

### Glass (frosted panels)
- Light: `background: rgba(255,255,255,.52)`, `backdrop-filter: blur(10px)`, `border: 1px solid rgba(255,255,255,.66)`
- Nocturne: `background: rgba(255,255,255,.10)`, `border: 1px solid rgba(255,255,255,.18)`

### Canvas / surface
- Light canvas gradient: `#FAFAFF → #EEF1FC`. Page behind phones: `#E9E7F3`.
- Nocturne canvas gradient: `#0E1030 → #080A20`. Page behind phones: `#0A0C22`.

### Text
- Deep indigo `#241B45` (light) / `#EEF0FF` (dark)
- Muted `#6F6A90` (light) / `#A7A6D0` (dark)

### Gold signature
- Gold hairline frame around each phone: `1px solid rgba(212,175,95,.3)`
- Gold is premium — used sparingly: the wordmark end-stop, the center nav "generate" orb, premium badge, play button, active nav tab.

### Theming implementation
Implemented as CSS custom properties toggled by a `data-theme="night"` attribute on the root:
```
:root        { --canvas-a:#FAFAFF; --canvas-b:#EEF1FC; --glass:rgba(255,255,255,.52); --glass-br:rgba(255,255,255,.66); --text:#241B45; --muted:#6F6A90; --page:#E9E7F3 }
[data-theme=night] { --canvas-a:#0E1030; --canvas-b:#080A20; --glass:rgba(255,255,255,.10); --glass-br:rgba(255,255,255,.18); --text:#EEF0FF; --muted:#A7A6D0; --page:#0A0C22 }
```

### Typography
- Family: **Manrope** (400/500/600/700/800). Small technical labels use a monospace stack (`ui-monospace, Menlo, monospace`) with `letter-spacing: .08–.12em`, often uppercase.
- Screen titles: 800, ~20–22px, `letter-spacing:-.01em`. Body: 500, 12–13px, line-height ~1.5. Muted mono captions: 10–11px.

### Radii & shadow
- Phone frame: `border-radius: 36px`, overflow hidden. Frame shadow: `0 22px 54px -18px rgba(36,27,69,.5)`.
- Cards/rows: 15–20px. Pills/CTAs: 14–16px. Toggle tracks: fully rounded (`22px`).
- CTA shadow tinted to its fill, e.g. `0 10px 24px -8px #8B6FE8` (or `var(--emotion)` on Generate).

### Motion
- `flow` — aurora blob drift, ~13–19s per blob, `ease-in-out infinite alternate` (translate + scale up to ~1.2).
- `breathe` — bio-aura, 4.6s `ease-in-out infinite alternate` (`scale .94→1.1`, `opacity .82→1`).
- `spin` — Genesis conic ring, 6s linear infinite.
- `shimmer` — Genesis progress bar sweep, 1.6s linear infinite.
- **Honor `prefers-reduced-motion: reduce`** — neutralize all of the above.

---

## Screens / Views

Every screen is a **236 × 512px** phone frame with the gold hairline border, an ambient Aurora background (4 blurred drifting radial-gradient blobs: sky top-left, violet center, pink bottom-left, gold bottom-right), and a `9:41` status bar. UI floats on frosted glass. Target WCAG AA contrast for text over aurora/glass.

### 01 · Splash
Centered breathing aurora orb (112px, radial sky→violet→gold, glow shadow) → gradient wordmark "Kokonada" → muted tagline "your body, in music". Bottom mono caption "TUNING IN…".

### 02 · Onboarding
Glass circle (120px) holding a 72px breathing orb → headline "Music that feels you" (800/21px) → muted sub → 3-dot pager (active = 20px violet pill) → full-width violet CTA "Get started" → muted "Skip".

### 03 · Login
Small gradient wordmark + "Welcome back" → glass card: EMAIL field (`ari@kokonada.fm`), PASSWORD field (dots), violet "Continue" CTA → "or" divider → two glass provider buttons (Apple = dark square glyph; Google = conic-gradient dot) → footer "New here? Create account" (violet link).

### 04 · Connect Services
Title "Connect your world" + sub "The more signals, the truer the tune." Then **two labeled sections**, each with a mono uppercase divider header:
- **WEARABLES & HEALTH**: Apple Health (Connected, toggle on/violet), Oura Ring (Tap to connect, toggle off).
- **MUSIC PLATFORMS**: Spotify (Connected, toggle on), Apple Music (Tap to connect, toggle off).
Each row: glass card, 34px rounded gradient icon tile, name (700/13) + status (10px; connected = sky `#3FB4F0`, else muted), and a 38×22 toggle. Bottom violet "Continue" CTA.

### 05 · Generate (interactive — hero)
Header "How are you?" + "Tap the field — up to 3 points." **Emotion wheel**: 188px glass circle with 4 corner color tints (violet/gold/indigo/sky), crosshair axes, mono corner labels (TENSE / ELATED / LOW / CALM), and a central breathing focal glow tinted `var(--emotion)`. Below: live state label (800/18, e.g. "Calm · bright") + mono sub ("avg of N points"). Undo + Clear glass buttons. Full-width CTA "Generate playlist" filled with `var(--emotion)`. Bottom nav with center "generate" tab active (gold orb). See **Interactions**.

### 06 · Genesis (generating overlay)
Dark midnight frame (always dark, even in Day) with dimmed aurora. Center: 150px rotating conic ring (masked to a ring) around a breathing `var(--emotion)` aura. Text "Composing your aurora…" + "reading heart, breath & motion". Shimmer progress bar. Gold mono "12 TRACKS FORMING".

### 07 · Now Playing
"NOW PLAYING" mono label + gold "calm · bright" chip. Square album-art placeholder (diagonal striped gradient + gold corner glow + "ALBUM ART" label). Track "Aurora Drift" / "Kokonada AI · session 04". Scrubber (42% filled, gold knob with glow, 1:42 / 4:03). Transport: prev/next triangles + 56px gold play orb (white play triangle). Glass "why this" chip: "Chosen for HR 72 · steady breath". Bottom nav, home active.

### 08 · Pulse
Title "Your pulse". 132px HR ring (conic gold 0→72%, masked) with "72 / BPM" center. Two glass cards: **STATE** (mini valence×arousal wheel with a sky dot at pos-low/bottom-right) and **TREND** (SVG polyline sparkline in violet + "Steady · bright"). Live-reading glass row (breathing 32px orb + "HRV 58ms · resp 14/min"). Bottom nav, pulse active.

### 09 · History
Title "History". 4 glass rows, each: 32px gradient aura swatch + session name + timestamp + track count + duration. Sessions: Morning lift (Today, 14 tracks, 52 min), Deep focus (Yesterday, 22 tracks, 1h 18m), Wind down (Mon, 9 tracks, 34 min), Run pace (Sun, 18 tracks, 1h 02m). Bottom nav, history active.

### 10 · Profile / Privacy Vault
64px aura avatar + "Ari Chen" + gold "PREMIUM" badge. "PRIVACY VAULT" section (CSS lock glyph + mono label). Glass card of 4 data-source rows with toggles: Heart rate (on), Sleep & recovery (on), Location (off/muted), Listening history (on). Footer with gold hairline top-border + CSS lock glyph + "Your data stays on device". Bottom nav, profile active.

### Bottom Nav (shared, 5 tabs)
Frosted glass bar, 58px tall, top border. Tabs: home (rounded-square outline), pulse (3 bars), **generate** (center 36px gold-gradient orb with white plus, raised `margin-top:-16px`), history (clock circle), profile (head+shoulders). Active tab = gold `#F5B93A`; inactive = `var(--muted)`. The center generate orb is always the gold-gradient signature.

---

## Interactions & Behavior

### Generate emotion wheel (the one live interaction)
- Tapping inside the wheel places a dot at the click position, **clamped to the circle** (radius 0.5 in normalized coords).
- **Ring buffer of 3**: a 4th tap drops the oldest (`taps.slice(-3)`).
- Each dot is colored by its own position via the bilinear map; the focal glow, accent, and CTA use the **average** of all current taps.
- Live label: arousal word (`y<0.4 Energized`, `<0.6 Steady`, else `Calm`) + " · " + valence word (`x<0.4 heavy`, `<0.6 neutral`, else `bright`).
- **Undo** removes the last dot; **Clear** empties. With no taps, label = "Tap the field", sub = "awaiting your signal", and the default glow uses `colorAt(0.5, 0.42)`.

### Day / Night toggle (global)
Segmented pill (Day | Night) in the header toggles `data-theme` on the root, recoloring the entire mockup via CSS variables with a 0.5s background transition. Active segment = violet→gold gradient fill.

### Everything else
Static mockups (no wired navigation). In production, wire the natural flow: Splash → Onboarding → Login → Connect → Generate → Genesis → Now Playing, with Pulse / History / Profile reachable from the nav.

---

## State Management
- `night: boolean` — theme toggle.
- `taps: {x:number, y:number}[]` (max 3, normalized 0–1) — emotion-wheel points.
- Derived per render: average `(ax, ay)`, `emotion` color string, per-dot colors, `stateLabel`, `tapCountLabel`.
- Production additions (not in mock): auth/session, connected-services status, live biometric stream (HR/HRV/resp), generated playlist + playback state, session history, privacy toggles.

## Assets
No external image assets. All visuals are CSS/SVG: gradient orbs, blurred radial-gradient aurora blobs, diagonal-stripe album placeholder, SVG polyline sparkline, and hand-drawn CSS icons (nav glyphs, lock, play/skip triangles, toggles). **Replace hand-drawn icons with the codebase's icon library.** Font: Manrope (Google Fonts). Album art is a labeled placeholder — supply real artwork.

## Screenshots
Reference renders are in `screens/` — three Day-mode captures (`01/02/03-light-01-05.png`) and three Aurora Nocturne captures (`01/02/03-night.png`) that together cover all 10 screens plus the header and Day/Night toggle.

## Files
- `Canvas.dc.html` — all 10 screens in a responsive grid, plus header wordmark + Day/Night toggle and all logic (emotion math, theme state).
- `Aurora.dc.html` — the ambient 4-blob aurora background (reused per frame).
- `BottomNav.dc.html` — the 5-tab frosted nav; takes an `active` prop.
- `support.js` — prototyping runtime for the `.dc.html` format (reference only; not part of the target app).
