import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../store';
import { addTap, removeTap } from '../../store/slices/emotionSlice';
import type { EmotionTap } from '../../store/slices/emotionSlice';
import { useSocket } from '../../hooks/useSocket';

interface PresetOption {
  label: string;
  x: number;
  y: number;
}

const PRESET_OPTIONS: PresetOption[] = [
  { label: 'Happy & Energetic', x: 0.7, y: 0.7 },
  { label: 'Calm & Content', x: -0.6, y: 0.6 },
  { label: 'Focused / Neutral', x: 0.0, y: 0.0 },
  { label: 'Stressed / Anxious', x: 0.7, y: -0.5 },
  { label: 'Sad & Low Energy', x: -0.5, y: -0.7 },
  { label: 'Angry / Tense', x: 0.8, y: -0.8 },
];

function findLabelForTap(tap: EmotionTap, index: number): string {
  const match = PRESET_OPTIONS.find(
    (opt) => opt.x === tap.x && opt.y === tap.y,
  );
  return match ? match.label : `Custom tap ${index + 1}`;
}

export function TextFallback() {
  const dispatch = useDispatch<AppDispatch>();
  const taps = useSelector((state: RootState) => state.emotion.taps);
  const { emitEmotionUpdate } = useSocket();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleAdd = () => {
    if (taps.length >= 3) return;
    const option = PRESET_OPTIONS[selectedIndex];
    const newTaps = [...taps, { x: option.x, y: option.y }];
    dispatch(addTap({ x: option.x, y: option.y }));
    emitEmotionUpdate(newTaps);
  };

  const handleRemove = (index: number) => {
    const newTaps = taps.filter((_, i) => i !== index);
    dispatch(removeTap(index));
    emitEmotionUpdate(newTaps);
  };

  return (
    <div className="w-full mt-6 pt-4 border-t border-white/12">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Text-based selector
      </h3>
      <div className="flex gap-2 items-center mb-3">
        <select
          className="flex-1 bg-white/5 border border-white/15 focus:border-[#e9c46a] text-gray-100 rounded-lg px-3 py-2 outline-none text-sm"
          value={selectedIndex}
          onChange={(e) => setSelectedIndex(Number(e.target.value))}
          aria-label="Select an emotion preset"
        >
          {PRESET_OPTIONS.map((opt, i) => (
            <option key={opt.label} value={i}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          className="border border-white/30 text-gray-200 hover:border-white/70 hover:text-white px-3 py-2 rounded-lg transition-colors disabled:opacity-35 disabled:cursor-default text-sm whitespace-nowrap"
          onClick={handleAdd}
          disabled={taps.length >= 3}
          aria-label="Add selected emotion tap"
        >
          Add
        </button>
      </div>
      {taps.length > 0 && (
        <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Current emotion taps">
          {taps.map((tap, i) => (
            <li key={i} className="flex items-center justify-between text-sm text-white/80">
              <span>
                Tap {i + 1}: {findLabelForTap(tap, i)}
              </span>
              <button
                className="border border-white/20 text-white/50 hover:text-gray-200 hover:border-white/50 rounded px-2 py-0.5 text-xs transition-colors"
                onClick={() => handleRemove(i)}
                aria-label={`Remove tap ${i + 1}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
