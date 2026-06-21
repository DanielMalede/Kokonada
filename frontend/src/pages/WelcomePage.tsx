import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, HeartPulse, Disc3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Panel {
  icon: LucideIcon;
  title: string;
  body: string;
  from: string;
  to: string;
}

const PANELS: Panel[] = [
  {
    icon: Sparkles,
    title: 'Your mood, your music',
    body: 'Tell us how you want to feel and we score the perfect soundtrack for this exact moment.',
    from: 'var(--emotion-focus)',
    to: 'var(--emotion-unwind)',
  },
  {
    icon: HeartPulse,
    title: 'Your body leads',
    body: 'Live heart rate from Garmin or Apple Health re-tunes the playlist as your energy shifts.',
    from: 'var(--emotion-energize)',
    to: 'var(--emotion-intense)',
  },
  {
    icon: Disc3,
    title: 'Music that knows you',
    body: 'Every track is curated for right now — and saved so you can relive any session.',
    from: 'var(--emotion-unwind)',
    to: 'var(--emotion-calm)',
  },
];

export default function WelcomePage() {
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const panel = PANELS[i];
  const last = i === PANELS.length - 1;

  const finish = () => {
    localStorage.setItem('koko-onboarded', '1');
    navigate('/');
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background px-6 py-8">
      <div className="emotion-aura" aria-hidden="true" />

      <div className="relative z-10 flex justify-end">
        {!last && (
          <button onClick={finish} className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Skip
          </button>
        )}
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center text-center">
        <div
          className="mb-10 grid size-44 place-items-center rounded-full text-white shadow-2xl"
          style={{ background: `linear-gradient(135deg, ${panel.from}, ${panel.to})` }}
        >
          <panel.icon className="size-20" />
        </div>
        <h1 className="max-w-sm font-display text-3xl font-semibold tracking-tight text-foreground">
          {panel.title}
        </h1>
        <p className="mt-3 max-w-xs text-muted-foreground">{panel.body}</p>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="flex gap-2">
          {PANELS.map((_, idx) => (
            <span
              key={idx}
              className={cn(
                'h-2 rounded-full transition-all',
                idx === i ? 'w-6 bg-primary' : 'w-2 bg-border',
              )}
            />
          ))}
        </div>
        <Button
          onClick={() => (last ? finish() : setI((n) => n + 1))}
          className="h-13 w-full max-w-sm rounded-full text-base"
        >
          {last ? 'Get started' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
