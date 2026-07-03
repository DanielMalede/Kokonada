import type { Store } from '@reduxjs/toolkit';
import type { SecureStore } from '../../storage/secureStore';
import {
  hydrate, resetEmotion, serializeForPersist, deserializeForPersist,
  type EmotionState,
} from './emotionSlice';

interface RootState {
  emotion: EmotionState;
}

export interface ColdPersistenceDeps {
  store: Store<RootState>;
  secure: SecureStore;
  getUserId: () => string | null | undefined;
  // Coalesce bursts of dispatches into one write. Injected for deterministic tests.
  throttleMs?: number;
}

// Persisted keys are namespaced by userId. On a shared device this is the wall
// that stops user A's committed intent from rehydrating into user B's session:
// each user reads only their own namespace, and a login with no stored namespace
// rehydrates a clean slate.
function keyFor(userId: string): string {
  return `cold.emotion.${userId}`;
}

export class ColdPersistence {
  private readonly deps: ColdPersistenceDeps;
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: ColdPersistenceDeps) {
    this.deps = deps;
  }

  // Subscribe to the store; each change schedules a (throttled) encrypted write.
  attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.store.subscribe(() => this.schedule());
  }

  detach(): void {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private schedule(): void {
    const ms = this.deps.throttleMs ?? 0;
    if (ms <= 0) { this.write(); return; }
    if (this.timer) return; // a write is already pending
    this.timer = setTimeout(() => { this.timer = null; this.write(); }, ms);
  }

  // Force any pending write immediately (app backgrounding, tests).
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.write();
  }

  private write(): void {
    const userId = this.deps.getUserId();
    if (!userId) return; // logged out — never spill intent to a global key
    // SecureStore.setItem is fail-soft (returns false on a full/interrupted
    // backend); we deliberately ignore the result so a dispatch never throws.
    this.deps.secure.setItem(keyFor(userId), serializeForPersist(this.deps.store.getState().emotion));
  }

  // Boot-time: load THIS user's namespace, or reset to a clean slate if none.
  rehydrate(): void {
    const userId = this.deps.getUserId();
    if (!userId) { this.deps.store.dispatch(resetEmotion()); return; }
    const raw = this.deps.secure.getItem(keyFor(userId));
    if (raw === null) { this.deps.store.dispatch(resetEmotion()); return; }
    this.deps.store.dispatch(hydrate(deserializeForPersist(raw)));
  }

  // Logout: wipe all persisted state and reset in-memory intent. Detach the writer
  // FIRST — otherwise the reset dispatch re-fires the subscriber and re-persists an
  // empty namespaced key, so "zero bytes after logout" would silently not hold.
  wipe(): void {
    this.detach();
    this.deps.secure.clearAll();
    this.deps.store.dispatch(resetEmotion());
  }
}
