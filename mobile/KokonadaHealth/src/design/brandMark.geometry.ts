// ─────────────────────────────────────────────────────────────────────────────
// AURORA SEED — the brand mark geometry (the single source of truth for the mark).
// PURE DATA, zero view imports: consumed BOTH by the Skia BrandMark component AND by
// the SVG asset script (scripts/brand/buildBrandSvg.mjs), so the radii/hex/stops are
// authored exactly ONCE and can never drift between the live app and the launcher icons.
//
// Coordinate system: a unit [0,1]² canvas, centre C=(0.5,0.5). The Android adaptive icon
// renders this at unit×108dp; iOS at unit×1024px. All radii/stroke-widths/blurs are
// FRACTIONS of the rendered size, so the same numbers scale to any target.
//
// NOTE: this file is authored in erasable-only TypeScript (const + `as const` + interfaces)
// so Node's type-stripping can import it directly from the ESM (.mjs) asset script.
// ─────────────────────────────────────────────────────────────────────────────

export const CENTER = 0.5;

// Android-12 circle-mask safe radius (fraction of the icon). The essential mark (rings +
// seed) must stay inside it; the bloom may bleed past it because it fades to alpha 0 before
// the edge (SoftGlow law), so the mask clips only fully-transparent pixels.
export const SAFE_RADIUS = 0.3056;

// Concentric geometry — fractions of the unit canvas. Shared by the Skia mark and the SVG.
export const geometry = {
  core: {
    // bright pinpoint highlight sitting on the glowing seed body
    highlight: { r: 0.028 },
    // the glowing seed point (+~2dp soft bloom at 108dp → 0.0185 of the canvas)
    body: { r: 0.055, blur: 0.0185 },
  },
  // the breath ring — the one that reads as the pulse
  ring1: { r: 0.185, sw: 0.018, blur: 0.02 },
  // the faint outer ring — thinner, dimmer, sits just inside the safe circle
  ring2: { r: 0.285, sw: 0.011, blur: 0.015 },
  // the bloom aura. `r` is the radial-gradient field extent used by the SVG; softCore/softBlur
  // are the Circle+Blur fractions the Skia mark uses to paint the same soft field.
  bloom: { r: 0.46, softCore: 0.3, softBlur: 0.1 },
} as const;

// A bloom gradient stop: `offset` is the radial position (0=centre, 1=field edge), `alpha`
// is the opacity there. The final stop is ALWAYS alpha 0 — the "fade to 0 before the radius,
// no hard rim" SoftGlow law that makes the aura a field, not a flat disc.
export interface BloomStop {
  offset: number;
  alpha: number;
}

// A treatment is a full palette for one surface family. `bg` is the opaque background used
// by the full-bleed icon assets + bootsplash (the on-screen BrandMark draws NO bg — the
// screen provides surface.base). Ring hue is shared by both rings; per-ring alpha differs.
export interface Treatment {
  bg: string;
  bgGradient: readonly [string, string];
  coreHighlight: string;
  coreBody: string;
  ring: string;
  ring1Alpha: number;
  ring2Alpha: number;
  bloom: string;
  bloomStops: readonly BloomStop[];
}

// AURORA re-tint: the mark is now "an aurora orb on midnight" — a luminous sky-blue seed with a warm
// gold spark at its heart, ringed and haloed by the Aurora violet. The core/bloom are drawn from the
// aurora palette (sky #5EC8F5 / violet #9B7BF0 / gold #FFCB6E) and TUNED to each canvas: the bright
// blob hues glow on the midnight face; the deeper aurora stops (sky #3FB4F0 / gold #F5B93A) read on
// the porcelain face. bg (= surface.base gradient) and ring (= accent.glow) ride the tokens BY
// CONSTRUCTION, so brandMark.geometry.test.ts's "no drift from surface.base / accent.glow" invariant
// holds forever. The violet bloom is shared — the halo is the same aurora light on both faces.
export const treatments: { readonly dark: Treatment; readonly light: Treatment } = {
  // Aurora Nocturne — the PRIMARY launcher treatment (the aurora orb on midnight indigo).
  dark: {
    bg: '#0E1030',
    bgGradient: ['#0E1030', '#080A20'],
    coreHighlight: '#FFCB6E', // the warm gold spark at the seed's heart
    coreBody: '#5EC8F5',      // the luminous sky-blue orb
    ring: '#9B7BF0',          // the Aurora violet breath rings (= accent.glow)
    ring1Alpha: 0.85,
    ring2Alpha: 0.38,
    bloom: '#9B7BF0',         // the violet aurora halo
    bloomStops: [
      { offset: 0.0, alpha: 0.55 },
      { offset: 0.35, alpha: 0.28 },
      { offset: 1.0, alpha: 0.0 },
    ],
  },
  // Aurora Day — light surfaces + marketing + favicon (the same orb, softer, on cool porcelain).
  light: {
    bg: '#FAFAFF',
    bgGradient: ['#FAFAFF', '#EEF1FC'],
    coreHighlight: '#F5B93A', // the deeper gold spark — reads on porcelain (the vivid gold would wash out)
    coreBody: '#3FB4F0',      // the deeper aurora sky — a vivid orb on the cool-white canvas
    ring: '#8B6FE8',          // the Aurora violet, deepened so it reads on porcelain (= accent.glow)
    ring1Alpha: 0.9,
    ring2Alpha: 0.3,
    bloom: '#9B7BF0',
    bloomStops: [
      { offset: 0.0, alpha: 0.22 },
      { offset: 0.35, alpha: 0.11 },
      { offset: 1.0, alpha: 0.0 },
    ],
  },
} as const;

// Monochrome — Android-13 themed / iOS-18 tinted. A single flat-white silhouette on
// transparent: seed + both rings, NO bloom, NO gradient, NO blur (a monochrome layer cannot
// glow, so the glow would only muddy the tint). Radii reuse `geometry` — no duplicated numbers.
export const monochrome = {
  color: '#FFFFFF',
  core: { r: geometry.core.body.r },
  ring1: { r: geometry.ring1.r, sw: geometry.ring1.sw },
  ring2: { r: geometry.ring2.r, sw: geometry.ring2.sw },
} as const;
