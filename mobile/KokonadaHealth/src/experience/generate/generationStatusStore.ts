import { createStore } from 'zustand/vanilla';

// Is a playlist generation in flight? Drives the Neural-Analysis Loader's `active`.
// begin() on send, settle() on playlist_ready / playlist_error. A safety auto-settle
// guarantees the loader can never spin forever if a response is lost (socket churn,
// backend timeout that never emits) — a stuck loader is worse than a missed exit.

const AUTO_SETTLE_MS = 30_000;

export interface GenerationStatus {
  generating: boolean;
  // Optional loader copy. Manual generation leaves it null; a Live-mode cold-buffer
  // recalibration sets "assembling your live biometric soundscape" so the wait is never silent.
  message: string | null;
  begin(message?: string): void;
  settle(): void;
}

export function createGenerationStatusStore(autoSettleMs: number = AUTO_SETTLE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  return createStore<GenerationStatus>((set) => ({
    generating: false,
    message: null,
    begin(message?: string) {
      clearTimer();
      timer = setTimeout(() => { timer = null; set({ generating: false, message: null }); }, autoSettleMs);
      set({ generating: true, message: message ?? null });
    },
    settle() {
      clearTimer();
      set({ generating: false, message: null });
    },
  }));
}

export const generationStatusStore = createGenerationStatusStore();
