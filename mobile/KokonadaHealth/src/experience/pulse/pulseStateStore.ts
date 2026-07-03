import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ApiResult } from '../../net/apiClient';
import { fetchPulseState, type PulseState } from './pulseApi';

// Ephemeral holder for the owner's physiological snapshot (state-vector vitals). NEVER
// persisted — these decrypted vitals live only in memory, consistent with the warm
// lane. Fetch is SINGLE-FLIGHT and stale-while-revalidate: a failed/duplicate refresh
// keeps the last good data on screen rather than blanking the gauges.

export interface PulseStoreState {
  data: PulseState | null;
  loading: boolean;
  fetchedAt: number | null;
  refresh(): Promise<void>;
}

export type PulseStateStore = StoreApi<PulseStoreState>;

type Fetcher = () => Promise<ApiResult<PulseState>>;

export function createPulseStateStore(fetcher: Fetcher = fetchPulseState): PulseStateStore {
  return createStore<PulseStoreState>((set, get) => ({
    data: null,
    loading: false,
    fetchedAt: null,
    async refresh() {
      if (get().loading) return; // single-flight — a foreground burst fires one fetch
      set({ loading: true });
      let res: ApiResult<PulseState>;
      try {
        res = await fetcher();
      } catch {
        set({ loading: false });
        return;
      }
      if (res.ok) set({ data: res.data, fetchedAt: Date.now(), loading: false });
      else set({ loading: false }); // keep last good data (stale-while-revalidate)
    },
  }));
}

export const pulseStateStore = createPulseStateStore();
