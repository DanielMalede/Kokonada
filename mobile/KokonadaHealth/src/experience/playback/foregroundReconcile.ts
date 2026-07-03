import type { WarmStore, Grant } from '../../state/warm/warmStore';

// Called on every app foreground. Reads the two external truths — the native
// Spotify player state and the OS permission grants — and reconciles both lanes.
// Each read is independently guarded so a dead remote or a rejected permission
// read still leaves a consistent app; this function never throws.

export interface RemotePlayback {
  isPlaying: boolean;
  uri?: string;
}

export interface ForegroundReconcileDeps {
  orchestrator: { reconcile: (state: RemotePlayback | 'disconnected') => void };
  warmStore: WarmStore;
  readPlayback: () => Promise<RemotePlayback | 'disconnected'>;
  readPermissions: () => Promise<{ bluetooth: Grant; health: Grant }>;
}

export async function reconcileOnForeground(deps: ForegroundReconcileDeps): Promise<void> {
  // Playback truth: a foreign track or an external pause/play is reflected; a dead
  // or unreadable remote reconciles as disconnected.
  try {
    const playback = await deps.readPlayback();
    deps.orchestrator.reconcile(playback);
  } catch {
    deps.orchestrator.reconcile('disconnected');
  }

  // Biometric truth: a permission revoked while backgrounded (Bluetooth off) severs
  // the live-HR lane via the warm-store reconciler; an unreadable permission state
  // fails closed to denied.
  try {
    const perms = await deps.readPermissions();
    deps.warmStore.getState().setPermissions(perms);
  } catch {
    deps.warmStore.getState().setPermissions({ bluetooth: 'denied', health: 'denied' });
  }
}
