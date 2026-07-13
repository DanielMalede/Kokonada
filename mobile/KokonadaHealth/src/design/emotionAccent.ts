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
