// ─────────────────────────────────────────────────────────────────────────────
// KOKONADA DESIGN TOKENS — the single source of truth (AURORA, LOCKED 2026-07-13).
// "Living light." The interface is a soft, breathing aurora of sky → violet → gold.
// The ambient aurora is the BRAND; the user's emotion becomes the focal glow; UI floats
// on top as frosted glass. Gold is the premium signature (key moments only). Two faces:
//   • light — "Day": #FAFAFF → #EEF1FC canvas, frosted white glass. The primary face.
//   • dark  — "Aurora Nocturne": #0E1030 → #080A20 midnight, the same aurora hues
//             glowing through smoked glass.
// This file is the plain-hex LEAF of the design graph: it imports NOTHING but the Hex
// type, so tamagui.config.ts can depend on it without a cycle (config → tokens, never
// the reverse). Every content-over-surface pairing is WCAG 2.2 AA-verified in
// tokens.test.ts, and the emotion inks again in emotionAccent.contrast.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { Hex } from './contrast';

// A discovery accent maps a valence×arousal quadrant to a text-safe `ink` (AA on every discovery
// surface, both themes) and a decorative `wash` (alpha baked into the hex). `intense` is
// deliberately VIOLET, never red — the regulator ethic lives in the token, not the component.
export type EmotionQuadrant = 'calm' | 'joyful' | 'intense' | 'reflective';
export interface EmotionQuadrantColor { ink: Hex; wash: Hex; }
export type EmotionAccent = Record<EmotionQuadrant, EmotionQuadrantColor>;

// ── Aurora field ─────────────────────────────────────────────────────────────
// The ambient aurora is painted as four soft radial blobs drifting over the canvas. Colour and
// opacity are separate so a Skia/gradient consumer can feed either without re-parsing a hex.
export interface AuroraBlob { color: Hex; alpha: number; }
// Frosted glass: a translucent fill + blur radius + 1px border. `glassFallback` on the scheme is
// the OPAQUE colour this degrades to where backdrop blur is unavailable (that is what AA judges).
export interface AuroraGlass { bg: string; blur: number; border: string; }
export interface AuroraTokens {
  blobs: { sky: AuroraBlob; violet: AuroraBlob; gold: AuroraBlob; pink: AuroraBlob };
  blur: number;      // blob blur radius
  flow: number;      // ms — the ambient aurora drift cycle
  focalGlow: number; // ms — the emotion focal-glow breath
  // BOTH variants are exposed from either theme: a screen can render the Day glass over a
  // Nocturne surface (and vice-versa) during a theme cross-fade without reaching across schemes.
  glass: { day: AuroraGlass; night: AuroraGlass };
}

// A text scrim is an alpha RAMP (top → bottom) of a surface colour, laid between the aurora and
// copy so text stays AA over a moving gradient without flattening the aurora to a solid block.
export interface TextScrim { base: Hex; from: number; to: number; }

// ── Semantic color matrices ──────────────────────────────────────────────────
export interface ColorScheme {
  surface: {
    base: Hex;      // app background (deepest)
    canvasTop: Hex;    // canvas gradient start (=== base)
    canvasBottom: Hex; // canvas gradient end
    raised: Hex;    // cards / rows
    overlay: Hex;   // sheets / higher elevation
    glassFallback: Hex; // OPAQUE fallback the glass blur degrades to (must pass AA)
    hairline: Hex;  // 1px separators
    hairlineGold: string; // the premium 1px gold frame (alpha rgba — decorative, no AA)
    veilColor: Hex; // the veil laid over the aurora to seat UI on it
    textScrim: TextScrim; // alpha ramp that keeps copy AA over the moving aurora
    scrim: Hex;     // decorative dim behind a modal sheet (alpha; not a text backdrop → no AA)
  };
  content: {
    primary: Hex;   // titles / body
    secondary: Hex; // supporting text
    tertiary: Hex;  // captions / disabled (still AA on base)
    muted: Hex;     // the Aurora supporting-text hue (mockup --mut)
    onAccent: Hex;  // text/icon on an accent fill
  };
  accent: {
    glow: Hex;      // THE brand accent — the Aurora violet focal glow
    glowIdle: Hex;  // the focal glow at rest, before any emotion tap re-tints it
    glowInk: Hex;   // accent fill that carries onAccent text at AA (button surfaces)
    gold: Hex;      // the premium gold signature (key moments only)
    goldInk: Hex;   // gold as TEXT — darkened/lightened per theme so it reads at AA
    goldGraphic: Hex; // gold as an icon/graphic (AA-large), e.g. the active tab
    bloom: Hex;     // secondary bio accent (periwinkle)
  };
  // valence×arousal quadrant accent for discovery UI. In AURORA these are the four wheel corners:
  // calm = sky, joyful = gold, intense = violet, reflective = indigo. The ink is the AA-safe text
  // form of that corner; `auroraGlow` (emotionAccent.ts) is the continuous decorative form.
  emotionAccent: EmotionAccent;
  state: {
    success: Hex;
    warning: Hex;
    danger: Hex;
    info: Hex;
  };
  aurora: AuroraTokens;
}

// glass is expressed as fallback + alpha so the frost can render where supported and
// degrade to the opaque fallback (which is what the AA test judges).
export const glassAlpha = { dark: 0.55, light: 0.6 } as const;

// ── The Aurora field (shared by BOTH faces) ──────────────────────────────────
// The aurora hues are the BRAND and do not change with the colour scheme — only the canvas they
// drift over does. One object, referenced by both schemes, so a hue can never drift between faces.
const aurora: AuroraTokens = {
  blobs: {
    sky:    { color: '#5EC8F5', alpha: 0.9 },
    violet: { color: '#9B7BF0', alpha: 0.85 },
    gold:   { color: '#FFCB6E', alpha: 0.85 },
    pink:   { color: '#F79AC0', alpha: 0.45 }, // the faintest stop — an accent, never a subject
  },
  blur: 15,
  flow: 15000,      // one full ambient drift (mirrored in motion.duration.flow)
  focalGlow: 4600,  // the focal-glow breath (mirrored in motion.duration.focalGlow)
  glass: {
    day:   { bg: 'rgba(255,255,255,0.52)', blur: 10, border: 'rgba(255,255,255,0.66)' },
    night: { bg: 'rgba(255,255,255,0.10)', blur: 10, border: 'rgba(255,255,255,0.18)' },
  },
};

// The 1px premium frame — the SAME 30% gold on both faces (it reads as a rim of light, and a
// per-theme value would make the frame feel like two different products).
const HAIRLINE_GOLD = 'rgba(212,175,95,0.30)';

// AURORA NOCTURNE — the dark face. Midnight canvas, the same aurora glowing through smoked glass.
const dark: ColorScheme = {
  surface: {
    base: '#0E1030',        // midnight indigo — the canvas top
    canvasTop: '#0E1030',
    canvasBottom: '#080A20', // deepest — the canvas settles into near-black indigo
    raised: '#161A3C',      // cards / rows lifted off the canvas
    overlay: '#20264C',     // sheets (glass base)
    glassFallback: '#1A1E42',
    hairline: '#2A2E55',
    hairlineGold: HAIRLINE_GOLD,
    veilColor: '#0A0C28',
    textScrim: { base: '#0A0C28', from: 0, to: 0.55 },
    scrim: '#00000073',     // 45% black behind the Up-Next sheet
  },
  content: {
    primary: '#EEF0FF',     // near-white with an indigo cast
    secondary: '#CFD0EC',
    // AURORA folds the legacy `tertiary` role onto `muted`: both mean "faintest supporting text
    // that still clears AA on base", and two near-identical greys only invited drift.
    tertiary: '#A7A6D0',
    muted: '#A7A6D0',
    onAccent: '#0E1030',    // midnight ink rides ON the bright violet fill
  },
  accent: {
    glow: '#9B7BF0',        // the Aurora violet — the signature focal glow
    glowIdle: '#9B7BF0',
    glowInk: '#9B7BF0',     // bright violet is dark-theme-safe as a fill for midnight onAccent text
    gold: '#F5B93A',
    goldInk: '#FFD37A',     // lifted gold so it reads as TEXT on midnight
    goldGraphic: '#E7C879',
    bloom: '#9DB4FF',       // periwinkle
  },
  emotionAccent: {
    calm:       { ink: '#7FCDF5', wash: '#3FB4F024' }, // sky
    joyful:     { ink: '#FFD37A', wash: '#F5B93A24' }, // gold
    intense:    { ink: '#C4A6FF', wash: '#8B6FE824' }, // violet, not red — regulator ethic
    reflective: { ink: '#9DB4FF', wash: '#4B6FD024' }, // indigo
  },
  state: { success: '#3ECF8E', warning: '#E7B75B', danger: '#FF9BA0', info: '#7FCDF5' },
  aurora,
};

// AURORA DAY — the primary face. Cool porcelain-blue canvas, frosted white glass.
const light: ColorScheme = {
  surface: {
    base: '#FAFAFF',        // the canvas top — cool near-white
    canvasTop: '#FAFAFF',
    canvasBottom: '#EEF1FC',
    raised: '#FFFFFF',
    overlay: '#F3F4FE',
    glassFallback: '#F5F6FE',
    hairline: '#D8DEEA',
    hairlineGold: HAIRLINE_GOLD,
    veilColor: '#F5F6FF',
    textScrim: { base: '#F3F4FE', from: 0, to: 0.6 },
    scrim: '#12202B59',     // 35% cool slate behind the Up-Next sheet
  },
  content: {
    primary: '#241B45',     // deep indigo ink
    secondary: '#3F3A61',
    tertiary: '#6A6589',    // folded onto `muted` — see the Nocturne note above
    muted: '#6A6589',
    onAccent: '#FFFFFF',    // white rides ON the deep violet fill
  },
  accent: {
    glow: '#8B6FE8',        // the Aurora violet, readable as a graphic on porcelain
    glowIdle: '#8B6FE8',
    glowInk: '#6E3FC4',     // DEEPER violet fill so white onAccent clears AA (the glow itself is too light)
    gold: '#F5B93A',
    goldInk: '#8A5A12',     // deepened gold so it reads as TEXT on porcelain
    goldGraphic: '#C99A1E',
    bloom: '#3A5CCC',       // deeper periwinkle for a light bg
  },
  emotionAccent: {
    calm:       { ink: '#1F6FA6', wash: '#3FB4F014' }, // sky
    joyful:     { ink: '#8A5A12', wash: '#F5B93A14' }, // gold
    intense:    { ink: '#6E3FC4', wash: '#8B6FE814' }, // violet, not red — regulator ethic
    reflective: { ink: '#3A5CCC', wash: '#4B6FD014' }, // indigo
  },
  state: { success: '#1E9E6A', warning: '#B87A18', danger: '#B4322F', info: '#1F6FA6' },
  aurora,
};

export const colors = { dark, light } as const;
export type ThemeName = keyof typeof colors;

// ── emotionAnchors — HR arousal → hue (the aura ramp) ────────────────────────
// The stops the HR aura interpolates between as arousal rises; kept in lockstep with the Skia
// aura's deriveAuraUniforms (hue band [198,262]) so the UI and the aura always agree.
// AURORA re-tints the ENTIRE ramp into the cool band: sky → periwinkle → violet → indigo. Rising
// arousal no longer "heats" toward red — a racing heart is met with deeper, cooler light, never an
// alarm colour. That never-red guarantee is pinned as a VALUE invariant (blue ≥ red at EVERY
// anchor) in tokens.test.ts, so no later edit can quietly warm the ramp back up.
export const emotionAnchors = {
  calm: '#3FB4F0',    // low arousal — the Aurora sky stop
  warm: '#6FA6EC',    // mid — periwinkle
  coral: '#8B6FE8',   // elevated — the Aurora violet stop (the HOT CAP the aura ramps to)
  peak: '#4B6FD0',    // high arousal — indigo (retained as the triad's hot anchor, never rendered)
} as const;

// ── Space (4-pt base, calm rhythm) ───────────────────────────────────────────
export const space = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48, '4xl': 64 } as const;

// ── Radius (generous, organic) ───────────────────────────────────────────────
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

// ── Type scale (modular ~1.25) — sizes are Dynamic-Type-scalable units ────────
export const type = {
  family: {
    // Indirection so bundled faces can replace these later without touching screens.
    display: 'GeneralSans-Semibold',
    text: 'System',
    mono: 'monospace',
  },
  size: { display: 34, title: 28, heading: 22, subheading: 18, body: 16, callout: 15, footnote: 13, caption: 11 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  // multiply size → lineHeight; calmer copy breathes at ~1.4.
  leading: { tight: 1.12, snug: 1.28, normal: 1.44 },
  tracking: { display: -0.4, heading: -0.2, body: 0, caption: 0.3 },
} as const;

// ── Elevation — soft, diffuse, wellness-grade (not harsh Material drops) ──────
export const elevation = {
  e0: { shadowColor: '#000', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  e1: { shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  e2: { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  e3: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 40, shadowOffset: { width: 0, height: 16 }, elevation: 12 },
} as const;

// ── Motion — calm signatures; EVERY duration ships a reduced-motion variant ───
export const motion = {
  // `flow` (ambient aurora drift) and `focalGlow` (the emotion focal-glow breath) mirror
  // aurora.flow / aurora.focalGlow — they live here too so every animated surface reads its
  // duration from ONE place and automatically gets the reduced-motion variant below.
  duration: { instant: 0, fast: 120, base: 240, slow: 420, breath: 4200, flow: 15000, focalGlow: 4600 },
  // reduced-motion collapses transitions to near-instant and stills every ambient loop.
  durationReduced: { instant: 0, fast: 0, base: 0, slow: 0, breath: 0, flow: 0, focalGlow: 0 },
  easing: {
    calm: [0.22, 1, 0.36, 1] as const,   // easeOutQuint — settles, never snaps
    enter: [0.16, 1, 0.3, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
  },
  spring: {
    calm: { stiffness: 120, damping: 18, mass: 1 },     // soft overshoot
    gentle: { stiffness: 90, damping: 20, mass: 1 },
  },
} as const;

// ── Haptics vocabulary (semantic, curated — respect system/silent settings) ──
export const haptics = {
  selection: 'selection',   // wheel tick / chip pick
  commit: 'impactMedium',   // generate / confirm
  success: 'notificationSuccess',
  warning: 'notificationWarning',
} as const;
export type HapticKey = keyof typeof haptics;
