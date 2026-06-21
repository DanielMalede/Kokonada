'use strict';

const User   = require('../../models/User');
const garmin = require('./garmin');
const { handleBiometricReading } = require('../../sockets/biometricHandler');

const POLL_INTERVAL_MS = 30_000;

// Maps Garmin daily-summary activityType strings to the numeric IDs
// the wearable adapter's fromGarmin() function expects.
const GARMIN_ACTIVITY_TO_TYPE = {
  RUNNING:           1,
  CYCLING:           2,
  SWIMMING:          5,
  WALKING:           6,
  STRENGTH_TRAINING: 13,
};

let pollTimer = null;

async function pollOnce(io) {
  const users = await User
    .find({ wearableProvider: 'garmin', 'wearableToken.blob': { $exists: true }, deletedAt: null })
    .select('_id wearableToken');

  for (const user of users) {
    const room = io.sockets.adapter.rooms.get(`user:${user._id}`);
    if (!room || room.size === 0) continue;

    const [socketId] = room;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    try {
      const creds = user.getToken('wearableToken');
      const data  = await garmin.getDailyHeartRate(creds.accessToken, creds.accessTokenSecret);

      const summaries = data?.dailies ?? [];
      if (!summaries.length) continue;

      const latest    = summaries[summaries.length - 1];
      const heartRate = latest.averageHeartRateInBeatsPerMinute;
      if (!heartRate) continue;

      const raw = {
        heartRate,
        activityType:   GARMIN_ACTIVITY_TO_TYPE[latest.activityType] ?? 0,
        startTimeLocal: latest.startTimeLocal ?? new Date().toISOString(),
      };

      handleBiometricReading(socket, 'garmin', raw);
    } catch (err) {
      console.error(`[GarminPoller] poll failed for user ${user._id}`, err.message);
    }
  }
}

function startGarminPoller(io) {
  if (pollTimer) return;
  pollTimer = setInterval(() => pollOnce(io).catch(console.error), POLL_INTERVAL_MS);
  console.log('[GarminPoller] started — polling every 30s');
}

function stopGarminPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = { startGarminPoller, stopGarminPoller, pollOnce };
