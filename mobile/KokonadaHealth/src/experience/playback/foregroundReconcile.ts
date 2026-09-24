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
  // Optional: refresh the state-vector Pulse snapshot on foreground (A11). Guarded
  // and fire-and-forget — a fetch failure must not break the reconcile.
  refreshPulse?: () => void;
  // Optional (H2-8, DT-H2-5 F1): re-check the health lane. It can only STOP a running live-HR
  // feed (a withdrawal whose response was lost, a grant revoked in Settings), never start one.
  // Guarded and fire-and-forget like refreshPulse.
  reevaluateHealth?: () => void;
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

  // Health lane: the server-side truth behind the OS grants — is the Art.9 grant still current?
  try {
    deps.reevaluateHealth?.();
  } catch {
    /* a broken re-check must never break the reconcile */
  }

  // Pulse snapshot: refresh the state-vector vitals on foreground (best-effort). The
  // pulse store is single-flight, so a rapid AppState flap coalesces to one fetch.
  try {
    deps.refreshPulse?.();
  } catch {
    /* a broken refresh must never break the reconcile */
  }
}
