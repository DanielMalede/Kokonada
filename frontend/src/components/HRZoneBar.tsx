import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { Heart, HeartPulse } from 'lucide-react';
import type { RootState } from '@/store';
import { cn } from '@/lib/utils';
import GarminAttribution from '@/components/GarminAttribution';

interface Zone {
  label: string;
  min: number;
  max: number;
  color: string;
}

const ZONES: Zone[] = [
  { label: 'Sleep', min: 0, max: 49, color: 'var(--emotion-calm)' },
  { label: 'Resting', min: 50, max: 79, color: 'var(--emotion-focus)' },
  { label: 'Walking', min: 80, max: 99, color: 'var(--emotion-unwind)' },
  { label: 'Running', min: 100, max: 149, color: 'var(--emotion-energize)' },
  { label: 'Intense', min: 150, max: 999, color: 'var(--emotion-intense)' },
];

function activeZone(hr: number): number {
  return ZONES.findIndex((z) => hr >= z.min && hr <= z.max);
}

/** Live heart-rate readout + 5-zone activity bar (replaces the old ActivityPanel). */
export default function HRZoneBar() {
  const { heartRate, calibrationState, secondsUntilRecalibration } = useSelector(
    (s: RootState) => s.biometrics,
  );

  if (heartRate === null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Heart className="size-5" />
          <span className="text-sm">No biometric data yet</span>
        </div>
        <Link to="/integrations" className="text-sm font-medium text-primary hover:underline">
          Connect a wearable →
        </Link>
      </div>
    );
  }

  const active = activeZone(heartRate);
  const zone = ZONES[active] ?? ZONES[1];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1.5">
          <HeartPulse className="size-5 translate-y-1 text-coral" />
          <span className="font-mono text-3xl font-bold leading-none text-foreground">{heartRate}</span>
          <span className="text-sm text-muted-foreground">BPM</span>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{ background: 'color-mix(in oklch, var(--card), var(--foreground) 4%)', color: zone.color }}
        >
          {zone.label}
        </span>
      </div>

      <div className="flex gap-1.5" role="img" aria-label={`Heart rate zone: ${zone.label}`}>
        {ZONES.map((z, i) => (
          <div
            key={z.label}
            className={cn(
              'h-2 flex-1 rounded-full transition-all',
              i === active ? 'opacity-100' : 'opacity-25',
            )}
            style={{
              background: z.color,
              boxShadow: i === active ? `0 0 12px ${z.color}` : undefined,
            }}
          />
        ))}
      </div>

      {calibrationState === 'pending' && secondsUntilRecalibration !== null && (
        <p className="text-sm text-muted-foreground">
          Recalibrating in <span className="font-mono text-foreground">{secondsUntilRecalibration}s</span>…
        </p>
      )}
      {calibrationState === 'recalibrating' && (
        <p className="text-sm text-muted-foreground">Recalibrating your playlist…</p>
      )}
      {/* Garmin API Brand Guidelines: required on every screen showing Garmin-sourced
          biometrics. No-ops for non-Garmin sources (Apple Health / Health Connect). */}
      <GarminAttribution />
    </div>
  );
}
