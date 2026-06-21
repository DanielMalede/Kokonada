#!/usr/bin/env node
'use strict';

/**
 * Biometric Mock Engine — developer tool for testing the biometric→AI→playlist loop
 * without physical wearable hardware.
 *
 * Usage:
 *   node scripts/biometric-mock.js --token <jwt> --scenario running --duration 5m
 *
 * Get your JWT token from the browser: DevTools → Application → Cookies → kokonada_token
 *
 * Options:
 *   --token <jwt>        Required. JWT from browser cookie.
 *   --scenario <name>    Scenario name (default: running). See SCENARIOS below.
 *   --duration <time>    How long to run, e.g. 30s, 5m, 1h (default: 5m).
 *   --interval <secs>    Seconds between pushes (default: 30).
 *   --url <url>          Backend URL (default: http://localhost:5000 or BACKEND_URL env).
 */

const SCENARIOS = {
  resting:  { heartRate: 60,  activityType: 0, label: 'Resting'  },
  walking:  { heartRate: 90,  activityType: 6, label: 'Walking'  },
  running:  { heartRate: 145, activityType: 1, label: 'Running'  },
  spike:    { heartRate: 165, activityType: 1, label: 'HR Spike' },
  cooldown: { heartRate: 100, activityType: 6, label: 'Cooldown' },
};

function parseDurationMs(str) {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) throw new Error(`Invalid duration: "${str}" — use e.g. 30s, 5m, 1h`);
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000 };
  return parseInt(match[1], 10) * multipliers[match[2]];
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { scenario: 'running', duration: '5m', interval: '30', token: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scenario') opts.scenario = argv[i + 1];
    if (argv[i] === '--duration') opts.duration = argv[i + 1];
    if (argv[i] === '--interval') opts.interval = argv[i + 1];
    if (argv[i] === '--token')    opts.token    = argv[i + 1];
    if (argv[i] === '--url')      opts.url      = argv[i + 1];
  }
  return opts;
}

function run() {
  const opts     = parseArgs();
  const scenario = SCENARIOS[opts.scenario];

  if (!scenario) {
    console.error(`[Mock] Unknown scenario: "${opts.scenario}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }
  if (!opts.token) {
    console.error('[Mock] --token <jwt> is required. Copy it from browser cookies (DevTools → Application → Cookies).');
    process.exit(1);
  }

  let durationMs;
  try {
    durationMs = parseDurationMs(opts.duration);
  } catch (err) {
    console.error(`[Mock] ${err.message}`);
    process.exit(1);
  }

  const { io } = require('socket.io-client');
  const backendUrl  = opts.url || process.env.BACKEND_URL || 'http://localhost:5000';
  const intervalMs  = parseInt(opts.interval, 10) * 1_000;

  console.log(`[Mock] Connecting to ${backendUrl}`);
  console.log(`[Mock] Scenario: ${scenario.label} | HR: ${scenario.heartRate} bpm | Interval: ${opts.interval}s | Duration: ${opts.duration}`);

  const socket = io(backendUrl, {
    auth:          { token: opts.token },
    reconnection:  false,
    transports:    ['websocket'],
  });

  socket.on('connect', () => {
    console.log(`[Mock] ✓ Connected (socket ${socket.id})`);

    const startedAt = Date.now();
    let count = 0;

    function push() {
      const raw = {
        heartRate:      scenario.heartRate,
        activityType:   scenario.activityType,
        startTimeLocal: new Date().toISOString(),
      };
      socket.emit('biometric_push', { source: 'garmin', raw });
      count += 1;
      console.log(`[Mock] → push #${count}: HR=${raw.heartRate} bpm, activityType=${raw.activityType}`);
    }

    push(); // Immediate first push

    const interval = setInterval(() => {
      if (Date.now() - startedAt >= durationMs) {
        clearInterval(interval);
        console.log(`[Mock] Duration complete (${opts.duration}, ${count} pushes). Disconnecting.`);
        socket.disconnect();
        process.exit(0);
      }
      push();
    }, intervalMs);
  });

  socket.on('biometric_ack', (data) => {
    console.log(`[Mock] ← ack: ${JSON.stringify(data.normalized)}`);
  });

  socket.on('recalibration_pending', (data) => {
    console.log(`[Mock] ⏳ Recalibration pending — delta ${data.delta} bpm, ${data.secondsRemaining}s`);
  });

  socket.on('recalibration_cancelled', (data) => {
    console.log(`[Mock] ↩  Recalibration cancelled: ${data.reason}`);
  });

  socket.on('playlist_ready', (data) => {
    console.log(`[Mock] 🎵 Playlist ready! ${data.tracks?.length ?? 0} tracks (trigger: ${data.trigger}${data.fallback ? ', fallback' : ''})`);
  });

  socket.on('playlist_error', (data) => {
    console.error(`[Mock] ✗ Playlist error: ${data.message}`);
  });

  socket.on('connect_error', (err) => {
    console.error(`[Mock] ✗ Connection failed: ${err.message}`);
    process.exit(1);
  });

  socket.on('disconnect', () => {
    console.log('[Mock] Disconnected');
  });
}

// Export for tests; only auto-run when invoked directly
module.exports = { SCENARIOS, parseDurationMs };

if (require.main === module) {
  run();
}
