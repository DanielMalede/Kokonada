'use strict';

/**
 * The Garmin personal lane's request cadence (compliance C12, Update 2026-10-26).
 *
 * Garmin's Connect Personal API Supplemental Terms §2 let Garmin throttle, delay, reject or suspend
 * a key without notice, and Garmin documents no rate limit, so the lane keeps a conservative one of
 * its own:
 *   · ONE request in flight. Requests queue in the order they were scheduled.
 *   · FIVE SECONDS or more from the moment a request settles to the start of the next one.
 *   · 150 requests in a UTC day at most. The 151st is refused before it is sent. A request that
 *     failed still counts: Garmin received it.
 *   · deferUntil(ms) holds EVERY later request until that moment. A backoff after a 429 or a 5xx
 *     is global: while Garmin asks the lane to wait, no request goes out, whoever sends it.
 *   · A request is admitted at ITS TURN, not when it was queued: the caller's `admit` check runs
 *     after every wait and before the request is counted or sent, so a stop that lands while a
 *     request waits (Garmin's 403 to the request ahead of it) refuses that request unsent.
 *
 * The state lives in this process only. A caller that restarts the process (a worker deploy) starts
 * a fresh count, so the caller keeps its own persisted record of a pause.
 *
 * The clock and the sleep are injectable, so tests drive time instead of waiting for it.
 */

const MIN_INTERVAL_MS = 5000;
const DAILY_REQUEST_CAP = 150;
const DAILY_CAP_CODE = 'garmin_personal_daily_cap';

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function dailyCapError() {
  return Object.assign(new Error(DAILY_CAP_CODE), { code: DAILY_CAP_CODE });
}

/**
 * @param {{now?: () => number, sleep?: (ms: number) => Promise<void>, minIntervalMs?: number, dailyCap?: number}} [options]
 */
function createRatePolicy({
  now = Date.now,
  sleep = realSleep,
  minIntervalMs = MIN_INTERVAL_MS,
  dailyCap = DAILY_REQUEST_CAP,
} = {}) {
  let queue = Promise.resolve();
  let lastSettledAt = null;
  let notBefore = -Infinity;
  let day = null;
  let requestsToday = 0;

  async function waitForTurn() {
    for (;;) {
      const earliest = Math.max(notBefore, lastSettledAt === null ? -Infinity : lastSettledAt + minIntervalMs);
      const wait = earliest - now();
      if (wait <= 0) return;
      await sleep(wait);
    }
  }

  async function run(task, admit) {
    await waitForTurn();
    // A refusal here sends nothing, counts nothing and leaves the spacing to the last request sent.
    if (admit) admit();
    const today = utcDay(now());
    if (today !== day) {
      day = today;
      requestsToday = 0;
    }
    if (requestsToday >= dailyCap) throw dailyCapError();
    requestsToday += 1;
    try {
      return await task();
    } finally {
      lastSettledAt = now();
    }
  }

  /**
   * Runs `task` (one request) when the cadence allows it; rejects with DAILY_CAP_CODE instead of
   * sending past the cap. `admit`, when given, is called at the request's turn, after every wait and
   * before the cap: whatever it throws rejects the request, which is never sent and never counted.
   */
  function schedule(task, admit) {
    const result = queue.then(() => run(task, admit));
    queue = result.catch(() => {});
    return result;
  }

  /** Holds every request not yet started until `epochMs`. Never moves a deferral earlier. */
  function deferUntil(epochMs) {
    if (Number.isFinite(epochMs) && epochMs > notBefore) notBefore = epochMs;
  }

  /** Counts only: how many requests this UTC day has seen. */
  function snapshot() {
    return { requestsToday: day === utcDay(now()) ? requestsToday : 0 };
  }

  return Object.freeze({ schedule, deferUntil, snapshot });
}

module.exports = { createRatePolicy, MIN_INTERVAL_MS, DAILY_REQUEST_CAP, DAILY_CAP_CODE };
