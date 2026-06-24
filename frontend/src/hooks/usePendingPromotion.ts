import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../store';
import { promotePendingPlaylist } from '../store/slices/playerSlice';

/** True only when the current track changed to a new one while a pending playlist waits. */
export function shouldPromote(
  prevUri: string | null,
  currentUri: string | null,
  pendingCount: number,
): boolean {
  return pendingCount > 0 && prevUri !== null && currentUri !== null && currentUri !== prevUri;
}

/**
 * Watches the Spotify current-track URI. At the first track boundary after a
 * pending (HR-driven) playlist arrives, promotes it to active — AppShell's play
 * effect then starts it from track 1.
 */
export function usePendingPromotion(): void {
  const dispatch = useDispatch<AppDispatch>();
  const currentUri = useSelector((s: RootState) => s.player.sdkCurrentTrackUri);
  const pendingCount = useSelector((s: RootState) => s.player.pendingPlaylist.length);
  const prevUriRef = useRef<string | null>(null);

  useEffect(() => {
    if (shouldPromote(prevUriRef.current, currentUri, pendingCount)) {
      dispatch(promotePendingPlaylist());
    }
    prevUriRef.current = currentUri;
  }, [currentUri, pendingCount, dispatch]);
}
