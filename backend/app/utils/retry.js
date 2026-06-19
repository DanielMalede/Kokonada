'use strict';

// Retry delay is 0 in test env so tests don't hang on setTimeout
const delayMs = (ms) =>
  process.env.NODE_ENV === 'test'
    ? Promise.resolve()
    : new Promise(r => setTimeout(r, ms));

/**
 * Wraps an async function with exponential-backoff retry.
 * Specifically handles HTTP 429 responses using the Retry-After header.
 *
 * @param {() => Promise<any>} fn        - The async operation to attempt
 * @param {number}             maxRetries - Max additional attempts after first failure (default 3)
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.response?.status === 429;
      const hasRetries = attempt < maxRetries;

      if (is429 && hasRetries) {
        const retryAfterSec = parseInt(err.response.headers?.['retry-after'] || '1', 10);
        const jitter = Math.floor(Math.random() * 300);
        await delayMs(retryAfterSec * 1000 + jitter);
      } else {
        throw err;
      }
    }
  }
}

module.exports = { withRetry };
