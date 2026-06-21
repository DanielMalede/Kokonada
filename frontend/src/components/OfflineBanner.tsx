import { useSelector } from 'react-redux';
import { CloudOff } from 'lucide-react';
import type { RootState } from '@/store';

/** Non-blocking strip shown when the realtime link drops. */
export default function OfflineBanner() {
  const isOnline = useSelector((s: RootState) => s.player.isOnline);
  if (isOnline) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
      <CloudOff className="size-4 shrink-0" />
      <span>Offline — playing from your saved playlist. Live updates paused.</span>
    </div>
  );
}
