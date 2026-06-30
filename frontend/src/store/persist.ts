import type { RootState } from './index';

const KEY = 'koko-player';

// Only the durable, restore-safe slice of player state is persisted. Everything tied
// to the LIVE Spotify Web Playback SDK / network (deviceId, sdk*, isPlaying, isOnline,
// pending*, lastErrorAt) is intentionally excluded — it's reconstructed on load, so
// persisting it would restore stale device/connection data.
type PersistedPlayer = Pick<
  RootState['player'],
  'playlist' | 'offlineBuffer' | 'currentIndex' | 'playbackMode' | 'trigger'
>;

/**
 * Read the persisted queue for app boot. Returns null when nothing is stored or the
 * payload is missing/corrupt, so the caller can fall back to the slice's initial state.
 */
export function loadPersistedPlayer(): PersistedPlayer | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PersistedPlayer>;
    if (!data || !Array.isArray(data.playlist) || data.playlist.length === 0) return null;
    return {
      playlist: data.playlist,
      offlineBuffer: Array.isArray(data.offlineBuffer) ? data.offlineBuffer : data.playlist.slice(0, 10),
      currentIndex: typeof data.currentIndex === 'number' ? data.currentIndex : 0,
      playbackMode: data.playbackMode === 'live' ? 'live' : null,
      trigger: data.trigger ?? null,
    };
  } catch {
    return null;
  }
}

// Last payload written, so a stream of non-durable updates (1s SDK position ticks)
// doesn't rewrite identical bytes to localStorage every tick.
let lastWritten = '';

/** Persist only the durable player fields. Best-effort — failures are swallowed. */
export function savePlayerState(player: RootState['player']): void {
  try {
    const data: PersistedPlayer = {
      playlist: player.playlist,
      offlineBuffer: player.offlineBuffer,
      currentIndex: player.currentIndex,
      playbackMode: player.playbackMode,
      trigger: player.trigger,
    };
    const serialized = JSON.stringify(data);
    if (serialized === lastWritten) return;
    lastWritten = serialized;
    localStorage.setItem(KEY, serialized);
  } catch {
    /* storage unavailable / quota — persistence is best-effort */
  }
}

/**
 * Minimal leading+trailing throttle so a burst of store updates (e.g. 1s SDK position
 * ticks) doesn't write to localStorage on every action. The trailing call guarantees
 * the final state is flushed.
 */
export function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (timer === null) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  }) as T;
}
