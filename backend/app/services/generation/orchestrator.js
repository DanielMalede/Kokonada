'use strict';

const MedicalProfile = require('../../models/MedicalProfile');
const { peekBaselines } = require('../biosonic/baselines');
const { translate } = require('../biosonic/translate');
const { selectPlaylist } = require('../selection/pipeline');

// THE serving path (Phase 7 sealed the flip — the legacy mixer and its rollback
// flag are gone): full biosonic inputs → translate() targets → the selection
// pipeline.

const PLAYLIST_SIZE = () => parseInt(process.env.PLAYLIST_SIZE || '50', 10);

// Assemble the biosonic targets from everything the system knows: cached
// personal baselines (never the heavy compute — request path), the profile's
// encrypted scalars (getters decrypt), last-night sleep, and the live reading.
// Every source is best-effort: translate() degrades confidence, never throws.
async function _targets({ userId, live = {}, moodKey = null, now = Date.now() }) {
  let baselines = null;
  try { baselines = await peekBaselines(userId); } catch { /* degrade */ }

  let sleep = {};
  let state = {};
  try {
    const profile = await MedicalProfile.findOne({ userId });
    if (profile) {
      if (profile.lastNightSleep && (profile.lastNightSleep.deep != null || profile.lastNightSleep.light != null)) {
        sleep = {
          lastNight: {
            deep:  profile.lastNightSleep.deep,
            light: profile.lastNightSleep.light,
            rem:   profile.lastNightSleep.rem,
          },
        };
      }
      state = {
        hrv:            profile.hrv,
        bodyBattery:    profile.bodyBattery,
        dailyReadiness: profile.dailyReadiness,
      };
    }
  } catch { /* degrade */ }

  return translate({
    live,
    baselines: baselines ?? {},
    sleep,
    state,
    hourOfDay: new Date(now).getHours(),
    moodKey,
  });
}

async function generateV2({
  userId,
  musicProfile = {},
  moodKey = null,
  provider = null,
  aiParams = {},
  discoveryTracks = [],
  live = {},
  k = PLAYLIST_SIZE(),
  now = Date.now(),
}) {
  const targets = await _targets({ userId, live, moodKey, now });
  const { tracks, telemetry } = await selectPlaylist({
    userId, musicProfile, moodKey, provider, aiParams, targets, discoveryTracks, k, now,
  });

  return {
    familiar:  tracks.filter(t => !t.isDiscovery),
    discovery: tracks.filter(t => t.isDiscovery),
    merged:    tracks,
    telemetry,
    targets,
  };
}

module.exports = { generateV2 };
