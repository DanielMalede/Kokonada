// Presentation-layer breath + colour for the bio-aura. The pure deriveAuraUniforms (auraUniforms.ts)
// stays the SEALED source of HR hue/intensity/pulse — this module never modifies it; it reads its
// output and shapes the VISIBLE breath period and glow colour around two design FAIL conditions.

import { motion, emotionAnchors } from '../../design/tokens';
import { parseHex } from '../../design/contrast';
import { deriveAuraUniforms } from './auraUniforms';

// ── REGULATOR ETHIC (ADR-0009 core) ─────────────────────────────────────────
// The visible breath must SLOW and DEEPEN as arousal rises — NEVER speed up. A racing heart is
// met with a slower, deeper swell (downward entrainment). The resting breath (motion.duration.
// breath = 4200ms) is the FAST FLOOR; high arousal lengthens the period toward ~1.5× (~6300ms).
export const BREATH_FLOOR_MS = motion.duration.breath;            // 4200 — resting, fastest allowed
export const BREATH_CEIL_MS = Math.round(BREATH_FLOOR_MS * 1.5);  // 6300 — high-arousal, slowest

function clamp01(n: number): number {
  return Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : 0;
}

export function breathMsForArousal(arousal: number): number {
  return BREATH_FLOOR_MS + (BREATH_CEIL_MS - BREATH_FLOOR_MS) * clamp01(arousal);
}

// Recover the 0..1 HR-arousal the pure uniform encodes (intensity = FLOOR + a·SPAN) WITHOUT
// re-deriving — auraUniforms owns HR_MIN/HR_MAX, so we invert its output rather than duplicate
// the constants (no drift). Resting / no-HR → ~0 (breath at the fast floor); max HR → 1.
const INTENSITY_FLOOR = 0.1; // deriveAuraUniforms: intensity = 0.1 + t·0.8
const INTENSITY_SPAN = 0.8;
export function arousalFromHr(hr: number | null): number {
  // No valid signal → arousal 0 (breath at the fast floor, colour fully calm). The aura is
  // still visible at rest via its intensity-driven opacity — arousal is a separate axis, so an
  // absent watch must read as calm, not as the RESTING glow's intensity leaking in as arousal.
  if (hr === null || !Number.isFinite(hr)) return 0;
  return clamp01((deriveAuraUniforms(hr).intensity - INTENSITY_FLOOR) / INTENSITY_SPAN);
}

// ── NEVER-alarming-red ───────────────────────────────────────────────────────
// The HR glow ramps from the calm anchor to the hot CAP as arousal rises and stops there — it
// never reaches the `peak` anchor (a designer FAIL condition). Both ends are read from the tokens,
// so the ramp tracks the palette with zero drift: under AURORA that is SKY → VIOLET, both inside
// the cool band, matching deriveAuraUniforms' [198,262] hue clamp. The cap is therefore no longer
// merely a *softer* red — there is no warmth in it at all. A racing heart is met with deeper,
// cooler light, never an alarm colour.
const CALM_RGB = parseHex(emotionAnchors.calm);   // #3FB4F0 sky — resting
const CORAL_RGB = parseHex(emotionAnchors.coral); // #8B6FE8 violet — the HOT CAP (never emotionAnchors.peak)

export function hrGlowColor(hr: number | null): string {
  const a = arousalFromHr(hr);
  const mix = (from: number, to: number) => Math.round(from + (to - from) * a);
  return `rgb(${mix(CALM_RGB.r, CORAL_RGB.r)},${mix(CALM_RGB.g, CORAL_RGB.g)},${mix(CALM_RGB.b, CORAL_RGB.b)})`;
}
