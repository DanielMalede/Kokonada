// ─────────────────────────────────────────────────────────────────────────────
// KOKONADA DESIGN TOKENS — the single source of truth (Wave 2.8).
// "Calm / Premium Wellness × Bioluminescent Depth." Zero magic numbers in
// components: everything visual derives from here. Two themes:
//   • dark  — "Bioluminescence": deep-sea OLED black, one living cyan glow used as
//             DEPTH, not neon. The app breathes in the dark.
//   • light — "Clinical Premium": cool porcelain, frosted glass with solid,
//             contrast-safe fallbacks. Airy and trustworthy.
// Every content-over-surface pairing is WCAG 2.2 AA-verified in tokens.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { Hex } from './contrast';

// ── Semantic color matrices ──────────────────────────────────────────────────
export interface ColorScheme {
  surface: {
    base: Hex;      // app background (deepest)
    raised: Hex;    // cards / rows
    overlay: Hex;   // sheets / higher elevation
    glassFallback: Hex; // OPAQUE fallback the glass blur degrades to (must pass AA)
    hairline: Hex;  // 1px separators
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

const dark: ColorScheme = {
  surface: {
    base: '#060B11',        // abyss — deep-sea black with a blue cast
    raised: '#0E1721',      // depth
    overlay: '#182634',     // tide (glass base)
    glassFallback: '#182634',
    hairline: '#22303D',
  },
  content: {
    primary: '#EAF3F6',     // foam
    secondary: '#A9BAC6',   // mist
    tertiary: '#8397A4',    // haze (tuned up to hold AA on abyss)
    onAccent: '#04120F',    // near-black-green, rides on the bright glow fill
  },
  accent: {
    glow: '#31E1C4',        // plankton cyan — the signature
    glowInk: '#31E1C4',     // bright glow is dark-theme-safe for onAccent text
    bloom: '#8FB0FF',       // periwinkle
  },
  state: { success: '#3ECF8E', warning: '#E7B75B', danger: '#FF6B6B', info: '#31E1C4' },
};

const light: ColorScheme = {
  surface: {
    base: '#F3F8FA',        // porcelain — cool near-white
    raised: '#FFFFFF',
    overlay: '#E9F1F4',
    glassFallback: '#FFFFFF',
    hairline: '#D3DFE6',
  },
  content: {
    primary: '#0E1920',     // ink — deep slate
    secondary: '#3E5764',   // slate
    tertiary: '#4C6572',    // (tuned down to hold AA-normal on porcelain)
    onAccent: '#FFFFFF',    // white on the deep-teal fill
  },
  accent: {
    glow: '#0C8C7B',        // teal (readable as text/icon on porcelain)
    glowInk: '#0A7A6B',     // deeper teal fill so white onAccent passes AA
    bloom: '#3D6BE0',       // deeper periwinkle for light bg
  },
  state: { success: '#1E9E6A', warning: '#B87A18', danger: '#D64545', info: '#0C8C7B' },
};

export const colors = { dark, light } as const;
export type ThemeName = keyof typeof colors;

// ── emotionAccent — valence×arousal → hue (spec §2 / §3) ─────────────────────
// The palette shifts with mood. Anchor stops the runtime interpolates between;
// keep in lockstep with the Skia aura's deriveAuraUniforms so UI and aura agree.
// Calm (low arousal) = the brand glow; rising arousal heats cyan→coral→red.
export const emotionAnchors = {
  calm: '#31E1C4',    // low arousal
  warm: '#FFC06B',    // mid
  coral: '#FF8A73',   // elevated
  peak: '#FF5A5A',    // high arousal
} as const;

// ── Space (4-pt base, calm rhythm) ───────────────────────────────────────────
export const space = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48, '4xl': 64 } as const;

// ── Radius (generous, organic) ───────────────────────────────────────────────
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

// ── Type scale (modular ~1.25) — sizes are Dynamic-Type-scalable units ────────
export const type = {
  family: {
    // Indirection so bundled faces can replace these later without touching screens.
    display: 'System',
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
