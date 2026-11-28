// C7 (B1 P11 charter §2; DEC-196 F-WAIT B; DEC-197): how long the server asks the phone to wait after
// a 429 on the sign-in exchange. The unit is seconds. The server's wait is carried unclamped up to
// 900 s, the auth limiter's 15-minute window (backend/app/middleware/rateLimiter.js). A missing or
// garbage value (0, negative, not an integer, an HTTP-date) gives no number and a 60 s hold; a value
// above 900 gives no number, since a number would promise a wait shorter than the server's, and a
// 900 s hold. The two holds are DEC-087 values recorded by DEC-196 and DEC-197.

export const SERVER_WAIT_MAX_SEC = 900;
export const SERVER_WAIT_DEFAULT_HOLD_SEC = 60;

export interface ServerWait {
  /** The server's wait, shown as whole minutes rounded up; absent when it names no usable number. */
  retryAfterSec?: number;
  /** How long the Google step is held, in seconds. Always present. */
  holdSec: number;
}

export function parseRetryAfter(value: unknown): ServerWait {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(text)) return { holdSec: SERVER_WAIT_DEFAULT_HOLD_SEC };
  const seconds = Number(text);
  if (seconds < 1) return { holdSec: SERVER_WAIT_DEFAULT_HOLD_SEC };
  if (seconds > SERVER_WAIT_MAX_SEC) return { holdSec: SERVER_WAIT_MAX_SEC };
  return { retryAfterSec: seconds, holdSec: seconds };
}

// C1 (RA-119) and C7 (RA-170): holds run on a monotonic source, never the wall clock, which the person
// or a network time sync can move. React Native's Hermes and jest both provide performance.now().
export function monotonicNow(): number {
  return globalThis.performance.now();
}

// C7 (RA-170): the sign-in wait after a 429, one monotonic deadline in memory. It holds no personal data
// and is not age state; a new process starts without it. Its owner (the v2 sign-in adapter) keeps one at
// module level and exposes waitUntil() read-only. A hold whose remaining time exceeds its own length is
// over, so a clock that stepped back can never stretch it.
export class WaitHold {
  private until = 0;
  private length = 0;

  constructor(private readonly now: () => number = monotonicNow) {}

  start(wait: ServerWait): void {
    this.length = wait.holdSec * 1000;
    this.until = this.now() + this.length;
  }

  isHeld(): boolean {
    if (this.length === 0) return false;
    const remaining = this.until - this.now();
    return remaining > 0 && remaining <= this.length;
  }

  /** The monotonic time the wait ends, or null when none holds. */
  waitUntil(): number | null {
    return this.isHeld() ? this.until : null;
  }
}
