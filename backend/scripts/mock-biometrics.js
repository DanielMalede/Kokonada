'use strict';

const { io } = require('socket.io-client');

const PRESETS = {
  resting: { heartRate: 65,  activityType: 0 },
  walking: { heartRate: 90,  activityType: 6 },
  running: { heartRate: 145, activityType: 1 },
  panic:   { heartRate: 158, activityType: 0 },
  sleep:   { heartRate: 52,  activityType: 0 },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    host:     'http://localhost:5000',
    token:    null,
    preset:   'resting',
    hr:       null,
    duration: 60,
    interval: 5,
  };

  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    const val = args[i + 1];
    if (key === 'host')     { opts.host     = val; i++; }
    if (key === 'token')    { opts.token    = val; i++; }
    if (key === 'preset')   { opts.preset   = val; i++; }
    if (key === 'hr')       { opts.hr       = Number(val); i++; }
    if (key === 'duration') { opts.duration = Number(val); i++; }
    if (key === 'interval') { opts.interval = Number(val); i++; }
  }

  return opts;
}

function jitter() {
  return Math.round((Math.random() * 6) - 3);
}

function main() {
  const opts = parseArgs();

  if (!opts.token) {
    console.error('[mock] --token is required');
    process.exit(1);
  }

  if (!PRESETS[opts.preset]) {
    console.error(`[mock] Unknown preset "${opts.preset}". Valid: ${Object.keys(PRESETS).join(', ')}`);
    process.exit(1);
  }

  const preset = PRESETS[opts.preset];
  const baseHr = opts.hr != null ? opts.hr : preset.heartRate;

  const socket = io(opts.host, { auth: { token: opts.token } });

  socket.on('connect_error', (err) => {
    console.error(`[mock] connect_error: ${err.message}`);
    process.exit(1);
  });

  socket.on('connect', () => {
    console.log(`[mock] Connected. Sending ${opts.preset} preset every ${opts.interval}s for ${opts.duration}s.`);

    const pushOnce = () => {
      const raw = {
        heartRate:      baseHr + jitter(),
        activityType:   preset.activityType,
        startTimeLocal: new Date().toISOString(),
      };
      socket.emit('biometric_push', { source: 'garmin', raw });
    };

    pushOnce();
    const pushTimer = setInterval(pushOnce, opts.interval * 1000);

    const doneTimer = setTimeout(() => {
      clearInterval(pushTimer);
      socket.disconnect();
      process.exit(0);
    }, opts.duration * 1000);

    function cleanExit() {
      clearInterval(pushTimer);
      clearTimeout(doneTimer);
      socket.disconnect();
      process.exit(0);
    }

    process.on('SIGINT', cleanExit);
  });

  socket.on('biometric_ack', ({ normalized }) => {
    console.log(`[mock] ack: HR=${normalized.heartRate} activity=${normalized.activity}`);
  });

  socket.on('recalibration_pending', ({ secondsRemaining }) => {
    console.log(`[mock] recalibration pending — ${secondsRemaining}s remaining`);
  });

  socket.on('playlist_recalibration', ({ trigger }) => {
    console.log(`[mock] playlist_recalibration triggered (${trigger})`);
  });
}

main();
