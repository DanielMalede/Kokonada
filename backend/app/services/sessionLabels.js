'use strict';

// Human-readable labels for a PlaylistSession's moodKey, for the History feed (defect D-3).
// Manual/emotion sessions carry a preset key (focus|energize|calm|unwind|uplift|intense);
// Live/heart sessions carry a synthetic bio key `bio:<band>:<activity>`. Both are mapped to a
// friendly title + a source ('manual'|'live') so the raw engine key is NEVER shown, and the
// chosen activity is surfaced separately as activityLabel.

const PRESET_TITLES = {
  focus:    'Focus',
  energize: 'Peak Energy',
  calm:     'Calm',
  unwind:   'Unwind',
  uplift:   'Uplift',
  intense:  'Intense',
};

// bio band → title (bands from moodDescriptors.bandFromHeartRate: resting/active/peak).
const BAND_TITLES = { resting: 'Resting', active: 'Active', peak: 'Peak Energy' };

const titleCase = (s) =>
  String(s).replace(/[_:]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * @param {string|null} moodKey
 * @param {string|null} activity  the persisted activity (the chosen chip for manual,
 *                                 watch-detected motion for live)
 * @returns {{ title: string, source: 'manual'|'live', activityLabel: string|null }}
 */
function sessionLabel(moodKey, activity) {
  const key = String(moodKey ?? '').trim();
  const chosen = activity ? titleCase(activity) : null;

  if (key.startsWith('bio:')) {
    const [, band = '', act = ''] = key.split(':');
    const title = BAND_TITLES[band] || (band ? titleCase(band) : 'Live');
    const bioActivity = act && act !== 'unknown' ? titleCase(act) : chosen;
    return { title, source: 'live', activityLabel: bioActivity };
  }

  if (PRESET_TITLES[key]) {
    return { title: PRESET_TITLES[key], source: 'manual', activityLabel: chosen };
  }

  // Unknown/empty key — never surface a raw string. Prefer the activity, else a neutral title.
  const title = key ? titleCase(key) : (chosen || 'Session');
  return { title, source: 'manual', activityLabel: chosen };
}

module.exports = { sessionLabel, PRESET_TITLES, BAND_TITLES };
