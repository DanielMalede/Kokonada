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
  { key: 'working', label: 'Working', emoji: '💼' },
  { key: 'resting', label: 'Resting', emoji: '🛋️' },
  { key: 'walking', label: 'Walking', emoji: '🚶' },
  { key: 'commuting', label: 'Commuting', emoji: '🚆' },
  { key: 'workout', label: 'Workout', emoji: '🏋️' },
  { key: 'focus', label: 'Focus', emoji: '🎯' },
  { key: 'winding down', label: 'Winding down', emoji: '🌙' },
];
