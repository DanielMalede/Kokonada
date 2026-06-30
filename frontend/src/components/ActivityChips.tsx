import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/store';
import { setActivity } from '@/store/slices/emotionSlice';
import { ACTIVITIES } from '@/lib/activities';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * "What are you doing?" — single-select activity chips that sit below the mood
 * chips on the Dashboard. Mirrors MoodChips: a wrapping ToggleGroup of pills.
 * The selected key is stored on `emotion.activity` and rides the existing
 * `emotion_update` payload to the AI engine. Re-selecting toggles it off (null).
 */
export default function ActivityChips() {
  const dispatch = useDispatch<AppDispatch>();
  const selected = useSelector((s: RootState) => s.emotion.activity);

  const choose = (key: string) => {
    dispatch(setActivity(key || null)); // empty string = toggled off
  };

  return (
    <ToggleGroup
      type="single"
      value={selected ?? ''}
      onValueChange={choose}
      spacing={8}
      className="flex flex-wrap gap-2"
      aria-label="Choose an activity"
    >
      {ACTIVITIES.map((activity) => (
        <ToggleGroupItem
          key={activity.key}
          value={activity.key}
          aria-label={activity.label}
          className="h-10 gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium ring-1 ring-foreground/5 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
        >
          <span aria-hidden="true">{activity.emoji}</span>
          {activity.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
