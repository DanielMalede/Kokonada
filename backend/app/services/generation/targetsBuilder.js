'use strict';

const MedicalProfile = require('../../models/MedicalProfile');
const { peekBaselines } = require('../biosonic/baselines');
const { translate } = require('../biosonic/translate');

// Assemble the biosonic targets from everything the system knows: cached personal
// baselines (never the heavy compute — request path), the profile's encrypted
// scalars (getters decrypt), last-night sleep, and the live reading. Every source is
// best-effort: translate() degrades confidence, never throws. This is the ONE place
// biosonic model I/O happens — translate()/biosonic/ stay PURE. Extracted from the
// orchestrator so the same band can be computed ONCE and shared by discovery + the
// selection pipeline (no double translate, no drift).
async function buildTargets({ userId, live = {}, moodKey = null, now = Date.now() } = {}) {
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

module.exports = { buildTargets };
