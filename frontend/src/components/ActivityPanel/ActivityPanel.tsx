import { useSelector } from 'react-redux';
import type { RootState } from '../../store';

interface Band {
  emoji: string;
  label: string;
  ariaLabel: string;
  isActive: (hr: number) => boolean;
}

const BANDS: Band[] = [
  { emoji: '😴', label: 'Sleep',    ariaLabel: 'Sleep, heart rate below 50',         isActive: (hr) => hr < 50 },
  { emoji: '🛋',  label: 'Resting', ariaLabel: 'Resting, heart rate 50 to 79',       isActive: (hr) => hr >= 50 && hr <= 79 },
  { emoji: '🚶', label: 'Walking',  ariaLabel: 'Walking, heart rate 80 to 99',       isActive: (hr) => hr >= 80 && hr <= 99 },
  { emoji: '🏃', label: 'Running',  ariaLabel: 'Running, heart rate 100 to 149',     isActive: (hr) => hr >= 100 && hr <= 149 },
  { emoji: '🔥', label: 'Intense',  ariaLabel: 'Intense, heart rate 150 and above',  isActive: (hr) => hr >= 150 },
];

export default function ActivityPanel() {
  const { heartRate, calibrationState, secondsUntilRecalibration } = useSelector(
    (state: RootState) => state.biometrics,
  );

  return (
    <div className="bg-[#16213e] rounded-xl p-6 shadow-lg">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Activity</h2>
      <ul className="flex flex-col gap-1 list-none m-0 p-0" role="list">
        {BANDS.map((band) => {
          const active = heartRate !== null && band.isActive(heartRate);
          return (
            <li
              key={band.label}
              role="listitem"
              aria-label={band.ariaLabel}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded border-l-[3px] transition-colors ${
                active
                  ? 'bg-white/10 border-[#e63946]'
                  : 'border-transparent'
              }`}
            >
              <span className="text-xl leading-none">{band.emoji}</span>
              <span className="flex-1 text-gray-200 text-sm">{band.label}</span>
              {active && heartRate !== null && (
                <span className="text-4xl font-bold text-white leading-none">{heartRate}</span>
              )}
              {active && heartRate !== null && (
                <span className="text-gray-400 text-sm">bpm</span>
              )}
            </li>
          );
        })}
      </ul>

      {calibrationState === 'pending' && secondsUntilRecalibration !== null && (
        <p className="mt-3 text-gray-400 text-sm italic">
          Recalibration in {secondsUntilRecalibration}s…
        </p>
      )}
      {calibrationState === 'recalibrating' && (
        <p className="mt-3 text-gray-400 text-sm italic">Recalibrating playlist…</p>
      )}
    </div>
  );
}
