'use strict';

// Provider track data windows (HX-2), in one place so the model's TTL, the job's cutoff and the
// ledger's read window cannot drift apart. 30 days is the promise (YouTube API Policy III.E.4.c;
// Spotify Developer Terms IV.3.1.a); the daily job cuts at 29 so a once-a-day run never overshoots
// it, and the TTL at 30 is only the backstop.

const PROVIDER_CONTENT_MAX_DAYS = 29;
const SERVE_EVENT_TTL_DAYS = 30;
const SERVE_EVENT_TTL_SECONDS = SERVE_EVENT_TTL_DAYS * 24 * 3600; // 2592000

module.exports = { PROVIDER_CONTENT_MAX_DAYS, SERVE_EVENT_TTL_DAYS, SERVE_EVENT_TTL_SECONDS };
