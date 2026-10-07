// QA-047: the fake clock for loading, slow, timeout, error and stale tests.
//
// It is jest's modern fake timers with a documented split that matches a device: the wall clock
// (Date.now) can jump either way, as when the user changes the time or NTP corrects it, while the
// monotonic clock (performance.now) and the pending timers do not move with it. Verified in this repo:
// after jest.setSystemTime(now - 1 h), performance.now is unchanged and a 500 ms timeout still fires
// at 500 ms (pinned in __tests__/api.test.tsx). restore() returns to real timers and the preset's performance.now.

export interface FakeClock {
  /** The wall clock (Date.now). */
  now(): number;
  /** Move both clocks forward, firing due timers. */
  advance(ms: number): void;
  /** As advance(), flushing promise callbacks between timers (for async code under test). */
  advanceAsync(ms: number): Promise<void>;
  /** Jump the wall clock by ms (negative = back). The monotonic clock and pending timers stay. */
  jumpWall(ms: number): void;
  restore(): void;
}

export function installFakeClock(options: { now?: number } = {}): FakeClock {
  jest.useFakeTimers(options.now != null ? { now: options.now } : {});
  return {
    now: () => Date.now(),
    advance: (ms) => { jest.advanceTimersByTime(ms); },
    advanceAsync: async (ms) => { await jest.advanceTimersByTimeAsync(ms); },
    jumpWall: (ms) => { jest.setSystemTime(Date.now() + ms); },
    restore: () => { jest.useRealTimers(); },
  };
}

const NEGATIVE_AGO = /-\s*\d+(?:[.,]\d+)?\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hrs?|hours?|d|days?)\s+ago/i;
const FUTURE_AGE = /\bin\s+\d+(?:[.,]\d+)?\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hrs?|hours?|d|days?)\b/i;

/** The displayed strings that state a negative age ("-55m ago") or a future one ("in 55 minutes"). */
export function negativeAges(texts: string[]): string[] {
  return texts.filter((t) => NEGATIVE_AGO.test(t) || FUTURE_AGE.test(t));
}
