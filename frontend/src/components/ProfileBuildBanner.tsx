import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { RootState, AppDispatch } from '@/store';
import { setProfileProgress } from '@/store/slices/integrationsSlice';

/**
 * Floating banner showing the live progress of the post-connect library analysis
 * (#2). Driven by the socket `profile_progress` events the backend emits as it
 * builds the MusicProfile. Auto-dismisses a couple of seconds after it completes.
 */
export default function ProfileBuildBanner() {
  const dispatch = useDispatch<AppDispatch>();
  const progress = useSelector((s: RootState) => s.integrations.profileProgress);

  useEffect(() => {
    if (progress && progress.pct >= 100) {
      const t = setTimeout(() => dispatch(setProfileProgress(null)), 2500);
      return () => clearTimeout(t);
    }
  }, [progress, dispatch]);

  if (!progress) return null;
  const { pct, label, error } = progress;
  const done = pct >= 100 && !error;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-2xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur md:bottom-6"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {error ? <AlertCircle className="size-4 text-destructive" />
          : done ? <CheckCircle2 className="size-4 text-primary" />
          : <Loader2 className="size-4 animate-spin text-primary" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${error ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}
