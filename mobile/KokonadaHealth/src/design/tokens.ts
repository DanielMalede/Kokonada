// ─────────────────────────────────────────────────────────────────────────────
// KOKONADA DESIGN TOKENS — the single source of truth (Wave 2.8).
// "Calm / Premium Wellness × Bioluminescent Depth." Zero magic numbers in
// components: everything visual derives from here. Two themes:
//   • dark  — "Bioluminescence": deep-sea OLED black, one living gold glow used as
//             DEPTH, not neon. The app breathes in the dark.
//   • light — "Clinical Premium": cool porcelain, frosted glass with solid,
//             contrast-safe fallbacks. Airy and trustworthy.
// Every content-over-surface pairing is WCAG 2.2 AA-verified in tokens.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { Hex } from './contrast';

// A discovery accent maps a valence×arousal quadrant to a text-safe `ink` (AA on every discovery
// surface, both themes), a decorative `wash` (alpha baked into the hex), and an `onAccent` label
// that rides ON the ink fill (AA over its own ink in dark). `intense` is deliberately VIOLET,
// never red — the regulator ethic lives in the token, not the component.
export type EmotionQuadrant = 'calm' | 'joyful' | 'intense' | 'reflective';
export interface EmotionQuadrantColor { ink: Hex; wash: Hex; onAccent: Hex; }
export type EmotionAccent = Record<EmotionQuadrant, EmotionQuadrantColor>;

// ── Semantic color matrices ──────────────────────────────────────────────────
export interface ColorScheme {
  surface: {
    base: Hex;      // app background (deepest)
    raised: Hex;    // cards / rows
    overlay: Hex;   // sheets / higher elevation
    glassFallback: Hex; // OPAQUE fallback the glass blur degrades to (must pass AA)
    hairline: Hex;  // 1px separators
    scrim: Hex;     // decorative dim behind a modal sheet (alpha; not a text backdrop → no AA)
  };
  content: {
    primary: Hex;   // titles / body
    secondary: Hex; // supporting text
    tertiary: Hex;  // captions / disabled (still AA on base)
    onAccent: Hex;  // text/icon on an accent fill
  };
  accent: {
    glow: Hex;      // THE brand bioluminescent accent
    glowInk: Hex;   // accent fill that carries onAccent text at AA (button surfaces)
    bloom: Hex;     // secondary bio accent
  };
  // valence×arousal quadrant accent for discovery UI (calm.ink === accent.glow, dark).
  emotionAccent: EmotionAccent;
  state: {
    success: Hex;
    warning: Hex;
    danger: Hex;
    info: Hex;
  };
}

// glass is expressed as fallback + alpha so the frost can render where supported and
// degrade to the opaque fallback (which is what the AA test judges).
export const glassAlpha = { dark: 0.55, light: 0.6 } as const;

// The brand accent literal, shared by each theme's `accent.glow` and its calm `emotionAccent.ink`
// so a calm session provably wears the brand accent — one source per theme, no drift. Aurum gold.
const BRAND_GLOW_DARK: Hex = '#F2C879';
const BRAND_GLOW_LIGHT: Hex = '#7A5A10';

const dark: ColorScheme = {
  surface: {
    base: '#060B11',        // abyss — deep-sea black with a blue cast
    raised: '#0E1721',      // depth
    overlay: '#182634',     // tide (glass base)
    glassFallback: '#182634',
    hairline: '#22303D',
    scrim: '#00000073',     // 45% black behind the Up-Next sheet
  },
  content: {
    primary: '#EAF3F6',     // foam
    secondary: '#A9BAC6',   // mist
    tertiary: '#8397A4',    // haze (tuned up to hold AA on abyss)
    onAccent: '#1C1408',    // near-black-umber, rides on the bright gold glow fill
  },
  accent: {
    glow: BRAND_GLOW_DARK,    // aurum gold — the signature
    glowInk: BRAND_GLOW_DARK, // the bright gold is dark-theme-safe for onAccent text
    bloom: '#C9A6FF',         // amethyst
  },
  emotionAccent: {
    calm:       { ink: BRAND_GLOW_DARK, wash: '#F2C87924', onAccent: '#1C1408' },
    joyful:     { ink: '#FFC24D', wash: '#FFC24D24', onAccent: '#1C1408' },
    intense:    { ink: '#D9ADFF', wash: '#D9ADFF24', onAccent: '#1C1408' }, // violet, not red — regulator ethic
    reflective: { ink: '#B7A6FF', wash: '#B7A6FF24', onAccent: '#1C1408' },
  },
  state: { success: '#3ECF8E', warning: '#E7B75B', danger: '#FF6B6B', info: '#C9A6FF' },
};

const light: ColorScheme = {
  surface: {
    base: '#F3F8FA',        // porcelain — cool near-white
    raised: '#FFFFFF',
    overlay: '#E9F1F4',
    glassFallback: '#FFFFFF',
    hairline: '#D3DFE6',
    scrim: '#12202B59',     // 35% cool slate behind the Up-Next sheet
  },
  content: {
    primary: '#0E1920',     // ink — deep slate
    secondary: '#3E5764',   // slate
    tertiary: '#4C6572',    // (tuned down to hold AA-normal on porcelain)
    onAccent: '#2A1B00',    // near-black-umber on the gold fill
  },
  accent: {
    glow: BRAND_GLOW_LIGHT, // deep aurum gold (readable as text/icon on porcelain)
    glowInk: '#D99A2E',     // brighter gold fill so the dark onAccent passes AA
    bloom: '#6D4BC9',       // deeper amethyst for light bg
  },
  emotionAccent: {
    calm:       { ink: BRAND_GLOW_LIGHT, wash: '#7A5A1014', onAccent: '#2A1B00' },
    joyful:     { ink: '#8F5410', wash: '#8F541014', onAccent: '#2A1B00' },
    intense:    { ink: '#6E3FC4', wash: '#6E3FC414', onAccent: '#FFFFFF' }, // violet, not red — regulator ethic
    reflective: { ink: '#573CB8', wash: '#573CB814', onAccent: '#FFFFFF' },
  },
  state: { success: '#1E9E6A', warning: '#B4791E', danger: '#B4322F', info: '#6D4BC9' },
};

export const colors = { dark, light } as const;
export type ThemeName = keyof typeof colors;

// ── emotionAccent — valence×arousal → hue (spec §2 / §3) ─────────────────────
// The palette shifts with mood. Anchor stops the runtime interpolates between;
// keep in lockstep with the Skia aura's deriveAuraUniforms so UI and aura agree.
// Calm (low arousal) = the brand glow; rising arousal shifts the hue gold→amber→
// coral-pink toward amethyst — a warm bloom, never an alarming red.
export const emotionAnchors = {
  calm: '#F2C879',    // low arousal
  warm: '#F0A85E',    // mid
  coral: '#E58AB8',   // elevated
  peak: '#B368D6',    // high arousal
} as const;

// single source for the future brand hero gradient; no consumer yet
export const signatureGradient = ['#F7D08A', '#F2C879', '#E58AB8', '#7C4DD0'] as const;

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
  duration: { instant: 0, fast: 120, base: 240, slow: 420, breath: 4200 },
  // reduced-motion collapses transitions to near-instant and stills the breath.
  durationReduced: { instant: 0, fast: 0, base: 0, slow: 0, breath: 0 },
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
