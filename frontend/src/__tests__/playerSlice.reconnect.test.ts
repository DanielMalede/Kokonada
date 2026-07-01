import { describe, it, expect } from 'vitest';
import reducer, {
  setReconnectState,
  setIsOnline,
  setPlaylist,
  OFFLINE_BUFFER_SIZE,
} from '../store/slices/playerSlice';

describe('playerSlice — offline / reconnect', () => {
  it('records the current reconnect attempt and exhausted flag', () => {
    const s = reducer(undefined, setReconnectState({ attempt: 3, exhausted: false }));
    expect(s.reconnectAttempt).toBe(3);
    expect(s.reconnectExhausted).toBe(false);
  });

  it('clears reconnect telemetry once back online', () => {
    let s = reducer(undefined, setReconnectState({ attempt: 5, exhausted: true }));
    s = reducer(s, setIsOnline(true));
    expect(s.isOnline).toBe(true);
    expect(s.reconnectAttempt).toBe(0);
    expect(s.reconnectExhausted).toBe(false);
  });

  it(`mirrors up to ${OFFLINE_BUFFER_SIZE} leading tracks into the offline buffer`, () => {
    expect(OFFLINE_BUFFER_SIZE).toBe(20);
    const tracks = Array.from({ length: 30 }, (_, i) => ({
      id: String(i), title: 't', artist: 'a', uri: `u${i}`,
    }));
    const s = reducer(undefined, setPlaylist({ tracks, trigger: 'emotion' }));
    expect(s.offlineBuffer).toHaveLength(OFFLINE_BUFFER_SIZE);
    expect(s.offlineBuffer[0].uri).toBe('u0');
  });
});
