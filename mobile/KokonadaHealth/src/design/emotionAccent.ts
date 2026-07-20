// Presentational selector: map the committed emotionSlice taps (x = valence, y = arousal, each
// −1..1) to a discovery accent quadrant. Pure, read-only, and STATIC for the session — the accent
// is chosen once from the mean of the taps, never per-track, so the discovery UI never flickers.
// It never throws: malformed / absent input degrades to `calm` (the brand-accent default).

import type { Tap } from '../state/cold/emotionSlice';
import type { EmotionQuadrant } from './tokens';

// Below this mean-vector magnitude the user sat effectively at the neutral origin — no committed
// lean in any direction → the calm brand accent.
const ORIGIN_DEADZONE = 0.15;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function emotionAccentFor(taps: readonly Tap[] | null | undefined): EmotionQuadrant {
  if (!Array.isArray(taps) || taps.length === 0) return 'calm';

  let sumX = 0;
  let sumY = 0;
  let n = 0;
  for (const t of taps) {
    if (t && typeof t === 'object' && isFiniteNumber((t as Tap).x) && isFiniteNumber((t as Tap).y)) {
      sumX += (t as Tap).x;
      sumY += (t as Tap).y;
      n += 1;
    }
  }
  if (n === 0) return 'calm';

  const meanX = sumX / n;
  const meanY = sumY / n;
  if (Math.hypot(meanX, meanY) < ORIGIN_DEADZONE) return 'calm';

  // Quadrant by the SIGN of the mean (x = valence, y = arousal).
  if (meanX >= 0) return meanY < 0 ? 'calm' : 'joyful';
  return meanY >= 0 ? 'intense' : 'reflective';
}

// ── auroraGlow — the CONTINUOUS twin of emotionAccentFor (AURORA) ────────────
// `emotionAccentFor` above answers "which of four AA-safe INKS does this session wear?" and is
// deliberately discrete — text may never sit on an interpolated colour we have not contrast-proven.
// `auroraGlow` answers the DECORATIVE question: "what colour is the light at this exact point on
// the wheel?" It bilinearly blends the four Aurora gradient stops across the whole valence×arousal
// disc, so the focal glow / tap dot / CTA tint travels smoothly with the finger instead of snapping
// between four flat quadrants. It is NEVER used as a text colour, so it carries no AA obligation.
//
// Axes match screenToCircumplex exactly: x = valence (+ right), y = arousal (+ up).
//
//        +arousal
//   violet ──────── gold
//     │               │
//  −valence        +valence
//     │               │
//   indigo ──────── sky
//        −arousal
//
// This feeds a Skia uniform every frame, so — like deriveAuraUniforms — it must be total: every
// input, including NaN/∞/undefined, yields a well-formed #RRGGBB and it never throws.

export type AuroraCorner = readonly [number, number, number];
export type AuroraCornerName = 'intense' | 'joyful' | 'reflective' | 'calm';

// The Aurora gradient stops as raw channels (kept in lockstep with tokens.ts — auroraGlow.test.ts
// pins each corner against the token literal, so a re-tint that misses one fails loudly).
export const AURORA_CORNERS: Record<AuroraCornerName, AuroraCorner> = {
  intense: [139, 111, 232],   // #8B6FE8 violet — top-left  (−valence / +arousal)
  joyful: [245, 185, 58],     // #F5B93A gold   — top-right (+valence / +arousal)
  reflective: [75, 111, 208], // #4B6FD0 indigo — bottom-left  (−valence / −arousal)
  calm: [63, 180, 240],       // #3FB4F0 sky    — bottom-right (+valence / −arousal)
};

// A non-finite, missing or non-numeric coordinate collapses to the ORIGIN. That is not an arbitrary
// fallback: the bilinear value AT the origin is exactly the mean of the four corners, so a garbage
// input degrades to a neutral Aurora rather than to black, to a corner, or to NaN.
function axis(n: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function channelHex(n: number): string {
  const b = Math.round(n);
  return (b < 0 ? 0 : b > 255 ? 255 : b).toString(16).toUpperCase().padStart(2, '0');
}

export function auroraGlow(x: number, y: number): string {
  const xu = (axis(x) + 1) / 2; // 0 = −valence … 1 = +valence
  const yu = (axis(y) + 1) / 2; // 0 = −arousal … 1 = +arousal
  const { intense, joyful, reflective, calm } = AURORA_CORNERS;
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const top = lerp(intense[i], joyful[i], xu);  // +arousal edge: violet → gold
    const bottom = lerp(reflective[i], calm[i], xu); // −arousal edge: indigo → sky
    out += channelHex(lerp(bottom, top, yu));
  }
  return out;
}
