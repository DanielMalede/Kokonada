import { useSelector } from 'react-redux';
import { CloudOff, RefreshCw } from 'lucide-react';
import type { RootState } from '@/store';
import { reconnectSocketNow } from '@/hooks/useSocket';

/**
 * Active offline strip. While the realtime link is down it shows live reconnect status
 * (which attempt we're on, or that automatic retries are exhausted) and how many tracks
 * are still queued from the offline buffer — and offers a manual "Try now" once the
 * automatic backoff has given up, so the user is never stranded until a page reload.
 */
export default function OfflineBanner() {
  const isOnline = useSelector((s: RootState) => s.player.isOnline);
  const attempt = useSelector((s: RootState) => s.player.reconnectAttempt);
  const exhausted = useSelector((s: RootState) => s.player.reconnectExhausted);
  const buffered = useSelector((s: RootState) => s.player.offlineBuffer.length);

  if (isOnline) return null;

  const status = exhausted
    ? "Couldn't reconnect."
    : attempt > 0
      ? `Reconnecting… (attempt ${attempt}/5)`
      : 'Offline. Live updates paused.';

  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
      <CloudOff className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {status}
        {buffered > 0 && (
          <span className="text-amber-600/80 dark:text-amber-400/80">
            {' '}Playing from your saved {buffered} tracks.
          </span>
        )}
      </span>
      {exhausted && (
        <button
          type="button"
          onClick={() => reconnectSocketNow()}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 px-2 py-1 text-xs font-medium hover:bg-amber-500/15"
        >
          <RefreshCw className="size-3" /> Try now
        </button>
      )}
    </div>
  );
}
