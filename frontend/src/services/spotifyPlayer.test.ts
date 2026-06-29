import { describe, it, expect } from 'vitest';
import { clampSeekMs } from './spotifyPlayer';

describe('clampSeekMs', () => {
  it('clamps negative positions to 0', () => {
    expect(clampSeekMs(-500, 200_000)).toBe(0);
  });

  it('clamps positions past the duration to the duration', () => {
    expect(clampSeekMs(999_999, 200_000)).toBe(200_000);
  });

  it('returns an in-range position rounded to a whole ms (e.g. seek to 3:38)', () => {
    expect(clampSeekMs(218_000.6, 240_000)).toBe(218_001);
  });

  it('clamps non-finite input to 0 (never NaN to the SDK)', () => {
    expect(clampSeekMs(NaN, 200_000)).toBe(0);
  });

  it('does not clamp upward when duration is unknown (0)', () => {
    expect(clampSeekMs(5_000, 0)).toBe(5_000);
  });
});
