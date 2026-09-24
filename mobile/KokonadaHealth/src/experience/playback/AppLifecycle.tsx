import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { reconcileOnForeground } from './foregroundReconcile';
import { orchestrator, player } from './playbackServices';
import { warmStore } from '../../state/store';
import { readCurrentPermissions } from '../../health/currentPermissions';
import { pulseStateStore } from '../pulse/pulseStateStore';
import { recheckHealthOnForeground } from '../../health/healthLaneServices';

// Mounts the foreground reconciliation: every time the app becomes active, read the
// real Spotify player state and the OS permissions and reconcile both lanes. The
// reconcile LOGIC is unit-tested (foregroundReconcile); this hook is the on-device
// AppState wiring. Renders nothing.
export function AppLifecycle() {
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status !== 'active') return;
      void reconcileOnForeground({
        orchestrator,
        warmStore,
        readPlayback: () => player.getPlaybackState(),
        readPermissions: readCurrentPermissions,
        refreshPulse: () => { void pulseStateStore.getState().refresh(); },
        // H2-8 (DT-H2-5 F1): stop-only — a foreground can end a live-HR feed, never start one.
        reevaluateHealth: () => { void recheckHealthOnForeground(); },
      });
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  return null;
}
