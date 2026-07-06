import { createStore } from 'zustand/vanilla';

// Is a playlist generation in flight? Drives the Neural-Analysis Loader's `active`.
// begin() on send, settle() on playlist_ready / playlist_error. A safety auto-settle
// guarantees the loader can never spin forever if a response is lost (socket churn,
// backend timeout that never emits) — a stuck loader is worse than a missed exit.

const AUTO_SETTLE_MS = 30_000;

export interface GenerationStatus {
  generating: boolean;
  begin(): void;
  settle(): void;
}

export function createGenerationStatusStore(autoSettleMs: number = AUTO_SETTLE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  return createStore<GenerationStatus>((set, get) => ({
    generating: false,
    begin() {
      clearTimer();
      timer = setTimeout(() => { timer = null; set({ generating: false }); }, autoSettleMs);
      if (!get().generating) set({ generating: true });
    },
    settle() {
      clearTimer();
      if (get().generating) set({ generating: false });
    },
  }));
}

export const generationStatusStore = createGenerationStatusStore();
