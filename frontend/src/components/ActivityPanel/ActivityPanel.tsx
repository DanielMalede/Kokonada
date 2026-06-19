import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import './ActivityPanel.css';

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
    <div className="activity-panel">
      <ul className="activity-panel__bands" role="list">
        {BANDS.map((band) => {
          const active = heartRate !== null && band.isActive(heartRate);
          return (
            <li
              key={band.label}
              role="listitem"
              aria-label={band.ariaLabel}
              className={`activity-panel__band${active ? ' activity-panel__band--active' : ''}`}
            >
              <span className="activity-panel__emoji">{band.emoji}</span>
              <span className="activity-panel__label">{band.label}</span>
              {active && heartRate !== null && (
                <span className="activity-panel__bpm">{heartRate} bpm</span>
              )}
            </li>
          );
        })}
      </ul>

      {calibrationState === 'pending' && secondsUntilRecalibration !== null && (
        <p className="activity-panel__calibration">
          Recalibration in {secondsUntilRecalibration}s…
        </p>
      )}
      {calibrationState === 'recalibrating' && (
        <p className="activity-panel__calibration">Recalibrating playlist…</p>
      )}
    </div>
  );
}
