import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/store';
import { addTap, clearTaps } from '@/store/slices/emotionSlice';
import { MOODS, selectedMoodKey } from '@/lib/moods';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * Primary emotion input for the Dashboard — replaces the raw valence/arousal
 * grid. Single-select preset chips; selecting one writes a single {x,y} tap so
 * the existing emotion payload and AI pipeline are unchanged.
 */
export default function MoodChips() {
  const dispatch = useDispatch<AppDispatch>();
  const taps = useSelector((s: RootState) => s.emotion.taps);
  const selected = selectedMoodKey(taps);

  const choose = (key: string) => {
    dispatch(clearTaps());
    if (!key) return; // toggled off
    const mood = MOODS.find((m) => m.key === key);
    if (mood) dispatch(addTap({ x: mood.x, y: mood.y }));
  };

  return (
    <ToggleGroup
      type="single"
      value={selected ?? ''}
      onValueChange={choose}
      spacing={8}
      className="flex flex-wrap gap-2"
      aria-label="Choose a mood"
    >
      {MOODS.map((mood) => (
        <ToggleGroupItem
          key={mood.key}
          value={mood.key}
          aria-label={mood.label}
          className="h-10 gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium ring-1 ring-foreground/5 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
        >
          <span
            className="size-2.5 rounded-full"
            style={{ background: mood.auraA }}
            aria-hidden="true"
          />
          {mood.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
