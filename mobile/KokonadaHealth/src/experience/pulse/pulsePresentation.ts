import { emotionAnchors, space, type EmotionQuadrant } from '../../design/tokens';
import type { SyncCounts } from '../../health/healthSync';
import type { BiometricSource } from '../../state/warm/warmStore';

// Presentation layer for the Pulse dashboard (§8) — pure, token-derived, and unit-tested.
// It owns the RESKIN's honesty language, never a data change: the DTO / store / sync-count
// pipeline stay sacred. Two ethics live here as testable code, not comments:
//   • the calm-fill is ALWAYS a single accent — a wellness dashboard must NOT diagnose via a
//     red-low/green-good colour ramp, so fillFraction only ever yields a magnitude, never a hue;
//   • the honest-empty SENTENCE is chosen per metric — a Garmin-proprietary metric gets a
//     source-truth note and NEVER a "try again" (re-sync can't cross a data-source boundary),
//     a Health-Connect-capable metric gets a recoverable note. There is NEVER a bare dash.

// ── The six gauges the /api/pulse/state DTO actually returns. No gauge is invented for data
//    the DTO doesn't carry. Grouped exactly as §8: Vitals · Last night · Recovery.
export type GaugeKey = 'hrv' | 'restingHeartRate' | 'deep' | 'rem' | 'bodyBattery' | 'dailyReadiness';
export type GaugeGroup = 'vitals' | 'lastNight' | 'recovery';

export interface GaugeDef {
  key: GaugeKey;
  label: string;
  unitShort?: string; // trailing display unit (Mode A)
  unitWord?: string; // full-word unit for the a11y label ("48 milliseconds")
  group: GaugeGroup;
}

export const GAUGES: readonly GaugeDef[] = [
  { key: 'hrv', label: 'HRV', unitShort: 'ms', unitWord: 'milliseconds', group: 'vitals' },
  { key: 'restingHeartRate', label: 'Resting HR', unitShort: 'bpm', unitWord: 'beats per minute', group: 'vitals' },
  { key: 'deep', label: 'Deep sleep', unitShort: 'min', unitWord: 'minutes', group: 'lastNight' },
  { key: 'rem', label: 'REM sleep', unitShort: 'min', unitWord: 'minutes', group: 'lastNight' },
  { key: 'bodyBattery', label: 'Body Battery', group: 'recovery' },
  { key: 'dailyReadiness', label: 'Readiness', group: 'recovery' },
] as const;

export const GAUGE_GROUP_LABELS: Record<GaugeGroup, string> = {
  vitals: 'Vitals',
  lastNight: 'Last night',
  recovery: 'Recovery',
};

// ── Named visual constants (exported + unit-tested, like BREATH_OPACITY). ──────────────────
// Display-normalization ranges — NOT medical thresholds. They only map a value to a fill
// magnitude 0..1; the fill's colour is fixed (calm accent), so a low or high number is never
// coloured "bad" or "good". Number carries meaning; the capsule only carries a proportion.
export const FILL_MAX_BY_METRIC: Record<GaugeKey, { min: number; max: number }> = {
  hrv: { min: 0, max: 150 },
  restingHeartRate: { min: 40, max: 100 },
  bodyBattery: { min: 0, max: 100 },
  dailyReadiness: { min: 0, max: 100 },
  deep: { min: 0, max: 120 },
  rem: { min: 0, max: 120 },
};

export const GAUGE_FILL_HEIGHT = space.sm; // 8 — the calm-fill capsule height
// Fixed so a tile is the SAME height whether it shows a value, an honest sentence, or a
// skeleton — a refresh mode-switch never reflow-jumps the grid. Derived from the field token.
export const GAUGE_TILE_MIN_H = space['4xl'] * 2; // 128
export const AURA_HERO_SCALE = 2; // the hero glow field ≈ 2× the numeral (a restrained halo)

// The hard cap for the HR aura hue: warmth rises with the body but STOPS at coral — a
// body-reading surface must never flash peak red. Only the HUE carries HR; the PERIOD is
// always the fixed calm breath (a fast heart must not make the surface breathe faster).
export const HR_AURA_HUE_CAP = emotionAnchors.coral;

// Perceptual warmth bands (bpm) — like FILL_MAX_BY_METRIC these are DISPLAY bands, not medical
// thresholds. Below warm → calm; below coral → warm; at/above → the coral cap (never peak).
const HR_WARM_BPM = 90;
const HR_CORAL_BPM = 120;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function fillFraction(metric: GaugeKey, value: number): number {
  const { min, max } = FILL_MAX_BY_METRIC[metric];
  if (Number.isNaN(value) || max === min) return 0;
  return clamp01((value - min) / (max - min));
}

export function hrAuraColor(hr: number | null): string {
  if (hr == null || !Number.isFinite(hr)) return emotionAnchors.calm;
  if (hr < HR_WARM_BPM) return emotionAnchors.calm;
  if (hr < HR_CORAL_BPM) return emotionAnchors.warm;
  return HR_AURA_HUE_CAP; // never emotionAnchors.peak
}

// ── The honest-empty sentence table. First match wins; every null metric yields a SENTENCE. ──
export interface HonestNote {
  text: string;
  subnote?: string;
  garminOnly: boolean; // true → a source-truth boundary, so the tile never offers a "try again"
}

const GARMIN_ONLY: HonestNote = { text: 'Garmin-only', subnote: 'Not shared by Health Connect', garminOnly: true };

// Which last-sync read-count keys a recoverable metric against. Deep + REM both key on sleep.
const COUNT_KEY: Record<Exclude<GaugeKey, 'bodyBattery' | 'dailyReadiness'>, keyof SyncCounts> = {
  hrv: 'hrv',
  restingHeartRate: 'restingHeartRate',
  deep: 'sleep',
  rem: 'sleep',
};

export function honestNote(metric: GaugeKey, counts: SyncCounts | null, source: BiometricSource): HonestNote {
  // Garmin-proprietary: a data-source boundary re-sync can't cross → source-truth note, no try-again.
  if (metric === 'bodyBattery' || metric === 'dailyReadiness') return GARMIN_ONLY;

  const isSleep = metric === 'deep' || metric === 'rem';
  const subnote = isSleep ? 'Sleep updates each morning' : undefined;

  if (counts == null) {
    // No sync evidence this session — point at the recoverable path.
    const text = source === 'none' ? 'Connect a wearable' : 'Pull down to sync';
    return { text, subnote, garminOnly: false };
  }

  const read = counts[COUNT_KEY[metric]];
  const text = read === 0 ? 'Not shared by your watch' : 'Not in your profile yet — pull to refresh';
  return { text, subnote, garminOnly: false };
}

// ── The body state → a decorative wash quadrant (the ONE reactive accent on Pulse). Reflects
//    the BODY, not a mood wheel. 'intense' is violet, never red — the regulator ethic lives in
//    the token, so no status can render an alarm colour. Unknown / null → the calm brand default.
export function statusQuadrant(raw?: string | null): EmotionQuadrant {
  if (raw == null) return 'calm';
  const s = String(raw).toLowerCase();
  if (s.includes('stress') || s.includes('panic')) return 'intense'; // negative + high arousal → violet
  if (s.includes('athletic') || s.includes('workout') || s.includes('activation')) return 'joyful'; // positive + high arousal
  if (s.includes('exhaust') || s.includes('focus') || s.includes('flow')) return 'reflective'; // inward / low arousal
  return 'calm'; // recovery, resting, meditative, background, balanced, unknown → the brand default
}
