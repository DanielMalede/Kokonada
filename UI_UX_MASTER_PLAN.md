# Kokonada — UI/UX Master Plan

> **Status:** Implemented.
> Kokonada turns your **body + mood** into a live, personalized playlist. This document is the design system and architecture reference for the production UI: a bright, white-based **Light Mode** with a vibrant emotion-accent palette, plus a seamless **Dark Mode**, built on **shadcn/ui + Tailwind v4**.

---

## 1. Product-design critique that drove the redesign

The original build was a 3-page MVP (`Auth → Integrations → Dashboard`) on a permanently-dark navy/gold theme. The gaps we fixed:

| Problem | Fix |
|---|---|
| No value-prop moment before asking for OAuth + health data | Added a **Welcome carousel** |
| Hard double-gate (music **and** wearable both required) | Added a **"Try with mood only"** path — wearable is now optional |
| The raw valence×arousal (X/Y) grid was the primary input | Replaced in the flow with **mood-preset chips + a context field** |
| The generation moment was invisible ("request sent ✓") | Added a branded **AI Generating** overlay |
| The player was a cramped panel | Added a full-screen **Now Playing** route |
| Playlists vanished; no profile/settings/theme control | Added **History, Playlist Detail, Profile, Settings** |
| No offline/empty/recalibration states | Added **OfflineBanner, EmptyState, recalibration** UI |

---

## 2. Page architecture (11 screens + states)

```
ONBOARDING       Splash (auth-check) · Welcome carousel (3 panels)
AUTH & SETUP     Login · Connect Services (mood-only path, "why" accordion)
CORE LOOP        Dashboard (mood chips + context + biometrics)
                 → AI Generating overlay → Now Playing (full screen)
LIBRARY & ACCT   History · Playlist Detail · Profile · Settings (theme toggle)
DISCOVER         Placeholder ("coming soon")
CROSS-CUTTING    OfflineBanner · EmptyState · Skeleton · Recalibration toast
```

### User flow
```
First run:  Splash → Welcome(1·2·3) → Login → Connect Services
                                                   │  (music required; wearable optional via "mood only")
Returning:  ───────────────────────────────────►  Dashboard
  pick mood chip + optional context → Generate → choose Live/Save
     → AI Generating (2–4s, dismissed on playlist_ready) → Now Playing
  biometrics shift → recalibration → queue re-tunes
  bottom nav / sidebar → History → Playlist Detail · Profile → Settings
```
The wearable is optional via the "mood only" path; the AI runs on the mood chip + context text until a wearable connects.

---

## 3. Component strategy — shadcn/ui + Tailwind v4

- **Init:** `radix-nova` style, neutral base, CSS variables. `components.json` + `@/*` alias (Vite + tsconfig).
- **Primitives in use:** Button, Card, Dialog, Drawer/Sheet, Tabs, Switch, **Slider**, Toggle/**ToggleGroup**, DropdownMenu, Avatar, Badge, Separator, Input, Textarea, Progress, ScrollArea, Skeleton, Sonner, Tooltip, Accordion, AlertDialog, Sidebar, Label.
- **Theme provider:** `next-themes` (`attribute="class"`, `storageKey="koko-theme"`, `defaultTheme="system"`) — drives the `.dark` class, persistence, system detection, and the Sonner toaster.

### Primitive → page map
| Page | Primitives |
|---|---|
| Login | Button, custom OAuth rows |
| Integrations | Card, **Switch**, Badge, Accordion, Button |
| Dashboard | **ToggleGroup** (mood chips), Textarea, Button, Card, Dialog (mode), Progress |
| Now Playing | **Slider** (progress), Badge, Button |
| History / Detail | Card, Badge, Button, EmptyState |
| Profile | Avatar, Card, Separator, Button |
| Settings | **ToggleGroup** (theme), **Switch**, **Slider**, AlertDialog, Separator |

---

## 4. Dual-theme design system

shadcn's neutral grayscale is overridden with Kokonada's identity. All tokens live in `src/index.css` (`@theme inline` + `:root` / `.dark`, oklch).

**Signature — the Emotion Aura:** a fixed, soft radial-gradient layer behind every screen that shifts hue with the user's mood (selected chip) and heart-rate zone. Light = a whisper of color through frosted white; Dark = a deep glow. Driven by `--aura-a` / `--aura-b` (set at runtime in `EmotionAura.tsx`), `transition: background 1200ms`. Respects `prefers-reduced-motion` and a Settings toggle (`.aura-off`).

**Palette (key tokens)**
| Token | Light | Dark |
|---|---|---|
| `--background` | white | near-black, blue cast |
| `--primary` (brand violet) | `oklch(0.58 0.20 285)` ≈ `#7C5CF5` | `oklch(0.68 0.15 285)` |
| `--coral` | `oklch(0.70 0.18 22)` ≈ `#FF6361` | lifted |
| `--emotion-{focus,energize,calm,unwind,intense,neutral}` | blue / coral / steel / violet / orange / slate | lifted luminosity |

**Typography**
- **Display — Clash Display** (Fontshare): headings, mood labels, track titles.
- **Body — Plus Jakarta Sans** (Google).
- **Data — Space Mono** (Google): BPM, timestamps, indices.

**Radius:** `--radius: 0.875rem` (sm/md/lg/xl/2xl/3xl derived). **Spacing:** 8px base.

### Dark-mode toggle
3-way `ToggleGroup` (Light / Dark / System) in Settings → `next-themes.setTheme`. Persists to `localStorage('koko-theme')`; default follows OS.

---

## 5. Navigation

- **Mobile (primary):** floating pill bottom bar (`BottomNav`) — Home · History · **Now Playing** (center) · Discover · Profile. A persistent `NowPlayingBar` mini-player sits above it when a live track is active.
- **Desktop (≥768px):** left `DesktopSidebar` (240px) with brand mark, nav, mini-player, and Settings; bottom bar hidden.
- `AppShell` owns the live connections (Socket.IO, Spotify SDK, playlist-play trigger) so they persist across in-app navigation.

---

## 6. Implementation map

```
frontend/src/
  index.css                      dual-theme tokens, fonts, Emotion Aura, .aura-off
  components.json · lib/utils.ts  shadcn config + cn()
  components/ui/*                  shadcn primitives
  context/ThemeProvider.tsx        next-themes wrapper
  lib/moods.ts                     mood presets → {x,y} taps + aura colors
  lib/history.ts                   localStorage session history
  components/
    AppShell · BottomNav · DesktopSidebar · NowPlayingBar
    EmotionAura · MoodChips · HRZoneBar · ThemeToggle
    SplashScreen · EmptyState · OfflineBanner · PageHeader · GeneratingOverlay
  pages/
    WelcomePage · LoginPage · IntegrationsPage
    AppPage (Dashboard) · NowPlayingPage · GeneratingOverlay
    PlaylistHistoryPage · PlaylistDetailPage
    UserProfilePage · SettingsPage · DiscoverPage
  router.tsx                       guards + onboarding gate + AppShell layout
```

**Backend/Redux contract unchanged.** Mood chips map to the existing `emotion.taps` `{x,y}` shape, so the `emotion_update` socket payload and AI pipeline are untouched. The only slice change: `integrations.moodOnly` (relaxes the completion gate for the wearable-free path).

---

## 7. Verification

- `npm run build` — type-checks and bundles clean.
- `npm run lint` — 0 errors.
- `npm test` — slice/component/player tests pass; `MoodChips.test.tsx` covers the new emotion input preserving the single-tap payload.
- Manual: toggle theme in Settings → every surface inverts and persists; pick a mood → aura transitions; mobile bottom bar clears content at 375/390/768px; Generate → AI Generating → Now Playing.
