import type { EmotionTap } from '@/store/slices/emotionSlice';

/**
 * Mood presets that replace the raw valence×arousal (X/Y) grid in the
 * Dashboard flow. Each preset still maps to a coordinate on the circumplex
 * so the existing `emotion_update` socket payload (taps: {x, y}[]) and the
 * downstream AI pipeline are completely untouched.
 *
 *   x = valence  (-1 unpleasant … +1 pleasant)
 *   y = arousal  (-1 calm … +1 energetic)
 */
export interface Mood {
  key: string;
  label: string;
  description: string;
  x: number;
  y: number;
  /** CSS custom properties used to paint the Emotion Aura + chip accent. */
  auraA: string;
  auraB: string;
}

export const MOODS: Mood[] = [
  {
    key: 'focus',
    label: 'Focus',
    description: 'Locked-in, steady concentration',
    x: 0.35,
    y: 0.25,
    auraA: 'var(--emotion-focus)',
    auraB: 'var(--emotion-unwind)',
  },
  {
    key: 'energize',
    label: 'Energize',
    description: 'Upbeat, driving momentum',
    x: 0.6,
    y: 0.85,
    auraA: 'var(--emotion-energize)',
    auraB: 'var(--emotion-intense)',
  },
  {
    key: 'calm',
    label: 'Calm',
    description: 'Settled and clear',
    x: 0.45,
    y: -0.55,
    auraA: 'var(--emotion-calm)',
    auraB: 'var(--emotion-focus)',
  },
  {
    key: 'unwind',
    label: 'Unwind',
    description: 'Soft, low-key wind-down',
    x: 0.2,
    y: -0.35,
    auraA: 'var(--emotion-unwind)',
    auraB: 'var(--emotion-calm)',
  },
  {
    key: 'uplift',
    label: 'Uplift',
    description: 'Bright and hopeful',
    x: 0.8,
    y: 0.4,
    auraA: 'var(--emotion-energize)',
    auraB: 'var(--emotion-unwind)',
  },
  {
    key: 'intense',
    label: 'Intense',
    description: 'Full-throttle, high effort',
    x: 0.1,
    y: 0.95,
    auraA: 'var(--emotion-intense)',
    auraB: 'var(--emotion-energize)',
  },
];

const NEUTRAL_AURA = { a: 'var(--emotion-neutral)', b: 'var(--emotion-focus)' };

/** Find the preset whose coordinate is closest to a given tap. */
export function moodForTap(tap: EmotionTap): Mood {
  let best = MOODS[0];
  let bestDist = Infinity;
  for (const mood of MOODS) {
    const d = (mood.x - tap.x) ** 2 + (mood.y - tap.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = mood;
    }
  }
  return best;
}

/** Recover the selected mood key from the current taps (single-select chips). */
export function selectedMoodKey(taps: EmotionTap[]): string | null {
  if (taps.length === 0) return null;
  return moodForTap(taps[taps.length - 1]).key;
}

/**
 * Resolve the two aura colors from the live app state. Priority:
 *   1. The most recent emotion tap → its nearest mood.
 *   2. A very high heart rate with no mood set → "intense".
 *   3. Neutral.
 */
export function auraColors(taps: EmotionTap[], heartRate: number | null): {
  a: string;
  b: string;
} {
  if (taps.length > 0) {
    const mood = moodForTap(taps[taps.length - 1]);
    return { a: mood.auraA, b: mood.auraB };
  }
  if (heartRate !== null && heartRate >= 130) {
    const intense = MOODS.find((m) => m.key === 'intense')!;
    return { a: intense.auraA, b: intense.auraB };
  }
  return NEUTRAL_AURA;
}
