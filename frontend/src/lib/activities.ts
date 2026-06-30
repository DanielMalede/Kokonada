/**
 * Activity presets for the "Activity & Emotion Context" section on the Dashboard.
 * The selected activity is stored on the emotion slice (`emotion.activity`, the
 * preset `key`) and travels with the `emotion_update` socket payload so the AI
 * engine can weigh what the user is physically doing against their stated mood
 * and last-24h biometrics when choosing tempo / genre / mood.
 *
 * `label` is the human text shown on the chip AND sent to the LLM as the activity
 * description, so keep it natural-language (the backend prompt prints it verbatim).
 */
export interface Activity {
  key: string;
  label: string;
  emoji: string;
}

export const ACTIVITIES: Activity[] = [
  { key: 'sleep',     label: 'Preparing for sleep',     emoji: '🛌' },
  { key: 'cooking',   label: 'Cooking',                 emoji: '🍳' },
  { key: 'running',   label: 'Running',                 emoji: '🏃‍♂️' },
  { key: 'cleaning',  label: 'Cleaning',                emoji: '🧹' },
  { key: 'reading',   label: 'Reading a book',          emoji: '📖' },
  { key: 'going_out', label: 'Getting ready to go out', emoji: '🪩' },
  { key: 'studying',  label: 'Studying / Working',      emoji: '💻' },
  { key: 'driving',   label: 'Driving',                 emoji: '🚗' },
  { key: 'workout',   label: 'Working out / Gym',       emoji: '🏋️‍♂️' },
  { key: 'meditate',  label: 'Meditating / Relaxing',   emoji: '🧘‍♂️' },
  { key: 'commuting', label: 'Commuting',               emoji: '🚌' },
];

/** Resolve the natural-language label for an activity key (for prompts/history). */
export function activityLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return ACTIVITIES.find((a) => a.key === key)?.label ?? null;
}
