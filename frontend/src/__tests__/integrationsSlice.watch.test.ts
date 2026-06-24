import { describe, it, expect } from 'vitest';
import type { RootState } from '../store';
import integrationsReducer, {
  setWatchToken,
  setWatchConnection,
  markWatchSeen,
  clearWatchToken,
  selectWatchLiveness,
  WATCH_STALE_MS,
} from '../store/slices/integrationsSlice';

const base = {
  musicProvider: null,
  biometricProvider: null,
  moodOnly: false,
  status: 'idle' as const,
  watchToken: null,
  watchConnected: false,
  watchLastSeenAt: null,
  watchStatus: 'idle' as const,
};

describe('integrationsSlice — watch', () => {
  it('setWatchToken stores the plaintext token', () => {
    const state = integrationsReducer(base, setWatchToken('whr_abc'));
    expect(state.watchToken).toBe('whr_abc');
  });

  it('setWatchConnection sets connected + lastSeenAt', () => {
    const state = integrationsReducer(base, setWatchConnection({ connected: true, lastSeenAt: '2026-06-24T17:00:00.000Z' }));
    expect(state.watchConnected).toBe(true);
    expect(state.watchLastSeenAt).toBe('2026-06-24T17:00:00.000Z');
  });

  it('markWatchSeen marks connected and stamps lastSeenAt to ~now', () => {
    const before = Date.now();
    const state = integrationsReducer(base, markWatchSeen());
    expect(state.watchConnected).toBe(true);
    expect(Date.parse(state.watchLastSeenAt!)).toBeGreaterThanOrEqual(before);
  });

  it('clearWatchToken resets all watch fields', () => {
    const populated = { ...base, watchToken: 'whr_abc', watchConnected: true, watchLastSeenAt: '2026-06-24T17:00:00.000Z' };
    const state = integrationsReducer(populated, clearWatchToken());
    expect(state.watchToken).toBeNull();
    expect(state.watchConnected).toBe(false);
    expect(state.watchLastSeenAt).toBeNull();
  });

  it('selectWatchLiveness returns "connected" when seen within WATCH_STALE_MS', () => {
    const now = 1_000_000_000_000;
    const rootState = { integrations: { ...base, watchConnected: true, watchLastSeenAt: new Date(now - 60_000).toISOString() } } as unknown as RootState;
    expect(selectWatchLiveness(rootState, now)).toBe('connected');
  });

  it('selectWatchLiveness returns "offline" when last seen exceeds WATCH_STALE_MS', () => {
    const now = 1_000_000_000_000;
    const rootState = { integrations: { ...base, watchConnected: true, watchLastSeenAt: new Date(now - WATCH_STALE_MS - 1000).toISOString() } } as unknown as RootState;
    expect(selectWatchLiveness(rootState, now)).toBe('offline');
  });

  it('selectWatchLiveness returns "offline" when not connected', () => {
    const rootState = { integrations: { ...base } } as unknown as RootState;
    expect(selectWatchLiveness(rootState, Date.now())).toBe('offline');
  });
});
