import { describe, it, expect } from 'vitest';
import playerReducer, { setSdkState } from '../store/slices/playerSlice';

describe('playerSlice — SDK state', () => {
  const base = {
    playlist: [], offlineBuffer: [], currentIndex: 0,
    isPlaying: false, isOnline: true, trigger: null, playbackMode: null,
    sdkReady: false, deviceId: null,
    sdkIsPaused: true, sdkPositionMs: 0, sdkDurationMs: 0,
  };

  it('setSdkState updates SDK fields', () => {
    const next = playerReducer(base as never, setSdkState({
      deviceId: 'dev_abc',
      isReady: true,
      isPaused: false,
      positionMs: 5000,
      durationMs: 210000,
    }));
    expect(next.deviceId).toBe('dev_abc');
    expect(next.sdkReady).toBe(true);
    expect(next.sdkIsPaused).toBe(false);
    expect(next.sdkPositionMs).toBe(5000);
    expect(next.sdkDurationMs).toBe(210000);
  });

  it('setSdkState partial update preserves other fields', () => {
    const state = { ...base, sdkPositionMs: 3000, sdkDurationMs: 180000 };
    const next = playerReducer(state as never, setSdkState({ positionMs: 4000 }));
    expect(next.sdkPositionMs).toBe(4000);
    expect(next.sdkDurationMs).toBe(180000); // unchanged
  });
});
