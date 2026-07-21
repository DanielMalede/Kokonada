// ─────────────────────────────────────────────────────────────────────────────
// AURORA SURFACES — the legibility + morphing-CTA math for the living aurora field.
// Pure, view-free helpers that turn the Aurora tokens into the exact fills a screen
// paints, so every value that lands on a MOVING gradient is contrast-proven in
// auroraSurfaces.test.ts rather than eyeballed. Two jobs:
//
//   1. AA-OVER-AURORA — the aurora is a live, drifting gradient; a token that clears
//      AA on a flat surface can be illegible the instant a gold blob slides under it.
//      `textScrimFill` densifies the token scrim ramp to a FLOOR alpha at which copy
//      (content.primary AND content.muted) clears AA over the WORST-case blob, both
//      under the bare scrim and under the frosted glass a cluster wears on top.
//   2. THE MORPHING CTA — `auroraCtaStops` runs sky → the user's continuous emotion
//      glow → premium gold; `onAuroraInk` picks the label ink whose WORST contrast
//      across the whole label band clears AA-large (never a naive midpoint guess).
//
// FAIL RULE (mirrors the token contract): if a pairing drops under AA the fix is to
// DARKEN/DENSIFY the scrim or DEEPEN a stop — never to lower a threshold.
// ─────────────────────────────────────────────────────────────────────────────

import { colors, emotionAnchors, type ColorScheme, type ThemeName, type AuroraGlass } from './tokens';
import { auroraGlow } from './emotionAccent';
import { parseHex, contrastRatio, type Hex } from './contrast';

// ── The densified text-scrim floor (per theme) ───────────────────────────────
// The token scrim RAMP (surface.textScrim: 0 → ~0.55/0.6) is tuned for display copy over
// a hero. Supporting copy (content.muted) over a moving GOLD/PINK blob fails at that `to`
// alpha, so a text CLUSTER lays its scrim down at this floor instead — the minimum alpha
// at which BOTH primary and muted clear AA over every blob (bare + under glass), verified
// in auroraSurfaces.test.ts. It is strictly ABOVE the ramp `to`; that gap is the "load-
// bearing densification". Kept just past the measured minimum (0.86/0.89) for headroom.
export const TEXT_SCRIM_FLOOR: Record<ThemeName, number> = { dark: 0.88, light: 0.9 };

/** The scrim a text cluster lays between the aurora and its copy: the token scrim hue at
 *  the densified FLOOR alpha (an rgba a Skia/View backdrop consumes directly). */
export function textScrimFill(scheme: ColorScheme, name: ThemeName): string {
  const { r, g, b } = parseHex(scheme.surface.textScrim.base);
  return `rgba(${r},${g},${b},${TEXT_SCRIM_FLOOR[name]})`;
}

/** The frosted glass a cluster wears ON TOP of its scrim — the Day glass on the light face,
 *  the Nocturne glass on dark (the face whose canvas the cluster actually floats over). */
export function glassFor(scheme: ColorScheme, name: ThemeName): AuroraGlass {
  return name === 'light' ? scheme.aurora.glass.day : scheme.aurora.glass.night;
}

// ── The morphing CTA gradient (sky → your emotion → gold) ─────────────────────
// Anchors are token-sourced so a re-tint can never drift the CTA off the aurora: the left
// stop is the calm SKY (emotionAnchors.calm), the right the premium GOLD, and the mid is
// the user's continuous `auroraGlow` — DEEPENED toward the intense corner because the bright
// violet glow is too light to carry a label. The other three poles are left untouched.
const CTA_SKY: Hex = emotionAnchors.calm;              // #3FB4F0
const CTA_GOLD: Hex = colors.dark.accent.gold;         // #F5B93A (shared by both faces)
export const DEEP_INTENSE: Hex = colors.light.accent.glowInk; // #6E3FC4 — the deep-violet fill ink
export const CTA_MID_STOP = 0.55;
// The label is CENTRED but WIDE — its ends sit well outside the mid stop, so the ink is judged
// across this conservative span (±0.21 of the mid), not at the midpoint alone (a midpoint-only
// judgement ships a button whose edges are illegible). Verified to clear AA-large for EVERY mean.
export const CTA_LABEL_BAND: readonly [number, number] = [0.34, 0.76];
// The two candidate label inks (token-sourced): the deep-indigo primary and pure white. The chosen
// one is whichever holds AA-large across the whole band for the current emotion glow.
export const CTA_INK = { dark: colors.light.content.primary, light: colors.light.content.onAccent } as const; // #241B45 / #FFFFFF

export type CtaStops = readonly [string, string, string];

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
function axis(n: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
function channelHex(n: number): string {
  const b = Math.round(n);
  return (b < 0 ? 0 : b > 255 ? 255 : b).toString(16).toUpperCase().padStart(2, '0');
}
function mix(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number): string {
  return `#${channelHex(a.r + (b.r - a.r) * t)}${channelHex(a.g + (b.g - a.g) * t)}${channelHex(a.b + (b.b - a.b) * t)}`;
}

// How "intense" a mean is: 1 at the intense corner (−valence / +arousal), EXACTLY 0 at each of
// the other three corners (one factor is 0 there → the pole is untouched), and negligible at the
// origin (0.0625 → a sub-1-channel nudge, so the CTA never jumps). Squared to keep the origin quiet.
function intenseWeight(x: number, y: number): number {
  const wx = clamp01((1 - axis(x)) / 2); // 1 toward −valence
  const wy = clamp01((axis(y) + 1) / 2); // 1 toward +arousal
  return (wx * wy) ** 2;
}

/** The three CTA gradient stops for the committed mean [x=valence, y=arousal]. */
export function auroraCtaStops(x: number, y: number): CtaStops {
  const glow = parseHex(auroraGlow(x, y));
  const deep = parseHex(DEEP_INTENSE);
  return [CTA_SKY, mix(glow, deep, intenseWeight(x, y)), CTA_GOLD];
}

/** Sample the 3-stop gradient (stop0 @0, stop1 @CTA_MID_STOP, stop2 @1) at position `t`. Total:
 *  a non-finite / out-of-range t clamps into [0,1] (it feeds a Skia gradient — never a NaN stop). */
export function sampleGradient(stops: CtaStops, t: number): string {
  const tt = Number.isFinite(t) ? clamp01(t) : 0;
  return tt <= CTA_MID_STOP
    ? mix(parseHex(stops[0]), parseHex(stops[1]), tt / CTA_MID_STOP)
    : mix(parseHex(stops[1]), parseHex(stops[2]), (tt - CTA_MID_STOP) / (1 - CTA_MID_STOP));
}

function minContrastOverBand(ink: string, stops: CtaStops): number {
  let worst = Infinity;
  for (let t = CTA_LABEL_BAND[0]; t <= CTA_LABEL_BAND[1] + 1e-9; t += 0.02) {
    worst = Math.min(worst, contrastRatio(ink, sampleGradient(stops, t)));
  }
  return worst;
}

/** The ADAPTIVE label ink: the candidate whose WORST contrast across the label band is highest.
 *  A max-min rule, not a luminance threshold — the naive "mid ≥ .35 → dark else white" guess ships
 *  a sub-AA-large button on some means (pinned as a counter-example in auroraSurfaces.test.ts). */
export function onAuroraInk(stops: CtaStops): string {
  return minContrastOverBand(CTA_INK.dark, stops) >= minContrastOverBand(CTA_INK.light, stops)
    ? CTA_INK.dark
    : CTA_INK.light;
}
