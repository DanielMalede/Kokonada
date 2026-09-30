// Activity presets for the Context Suite. `key` is stored on emotion.activity and
// travels in the emotion_update payload; the backend prints the natural-language
// key verbatim into the Groq prompt, so keep keys human-readable.
export interface Activity {
  key: string;
  label: string;
  emoji: string;
}

export const ACTIVITIES: Activity[] = [
  { key: 'running', label: 'Running', emoji: '🏃' },
  { key: 'resting', label: 'Resting', emoji: '🛋️' },
  { key: 'walking', label: 'Walking', emoji: '🚶' },
  { key: 'commuting', label: 'Commuting', emoji: '🚆' },
  { key: 'workout', label: 'Workout', emoji: '🏋️' },
  { key: 'winding down', label: 'Winding down', emoji: '🌙' },
];

// DEC-062: the work and study contexts are no longer offered. An older build stored and sent these
// keys, so every place a choice enters the cold lane (setActivity, rehydrate) clears them to null.
export const RETIRED_ACTIVITY_KEYS: readonly string[] = ['working', 'focus'];

export function isRetiredActivity(key: unknown): boolean {
  return typeof key === 'string' && RETIRED_ACTIVITY_KEYS.includes(key.trim().toLowerCase());
}
