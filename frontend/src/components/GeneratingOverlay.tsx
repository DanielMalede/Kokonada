import { useEffect, useState, type CSSProperties } from 'react';
import { HeartPulse, Activity, Music, Check, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const STEPS = [
  { icon: HeartPulse, label: 'Reading your heart rate' },
  { icon: Activity, label: 'Matching your mood' },
  { icon: Music, label: 'Curating your tracks' },
];

/**
 * The "magic moment". A full-bleed branded overlay shown while the AI builds a
 * playlist from the user's mood + live biometrics. Purely presentational — the
 * Dashboard dismisses it when `playlist_ready` arrives (or on timeout).
 */
export default function GeneratingOverlay({ open, moodLabel }: { open: boolean; moodLabel?: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) {
      setStep(0);
      return;
    }
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1100);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const pct = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-background/85 backdrop-blur-xl">
      <div className="emotion-aura" style={{ '--aura-opacity': 0.5 } as CSSProperties} aria-hidden="true" />
      <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-7 px-6 text-center">
        <div className="size-20 animate-pulse rounded-full bg-linear-to-br from-(--aura-a) to-(--aura-b) shadow-2xl" />
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Composing your session
          </h2>
          {moodLabel && <p className="mt-1 text-sm text-muted-foreground">Tuned for {moodLabel.toLowerCase()}</p>}
        </div>

        <ul className="flex w-full flex-col gap-3">
          {STEPS.map(({ icon: Icon, label }, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li
                key={label}
                className={cn(
                  'flex items-center gap-3 text-sm transition-opacity',
                  i > step ? 'opacity-40' : 'opacity-100',
                )}
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full',
                    done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {done ? (
                    <Check className="size-4" />
                  ) : active ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <span className="text-foreground">{label}</span>
              </li>
            );
          })}
        </ul>

        <Progress value={pct} className="h-1.5 w-full" />
      </div>
    </div>
  );
}
