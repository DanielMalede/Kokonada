import { Disc3 } from 'lucide-react';

/** Brand load screen — used as the auth-check fallback and the splash route. */
export default function SplashScreen() {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-background">
      <div className="emotion-aura" aria-hidden="true" />
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="grid size-16 animate-pulse place-items-center rounded-2xl bg-linear-to-br from-emotion-focus to-emotion-unwind text-primary-foreground shadow-xl">
          <Disc3 className="size-8" />
        </div>
        <span className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Kokonada
        </span>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-2 animate-bounce rounded-full bg-primary"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
