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

// HX-7(c), DEC-062: the Working chip is retired, but rows saved with it keep their stored activity (no
// stored-data change). Installed builds render title and activityLabel verbatim, so the label is
// relabelled here. The word must equal the app's RETIRED_ACTIVITY_LABEL (historyFormat.ts); a mobile
// drift test runs this file to hold them together.
const RETIRED_ACTIVITY_LABEL = 'General';
const RELABELLED_ACTIVITIES = new Set(['working']);
const activityLabelOf = (s) =>
  (RELABELLED_ACTIVITIES.has(String(s).trim().toLowerCase()) ? RETIRED_ACTIVITY_LABEL : titleCase(s));

/**
 * @param {string|null} moodKey
 * @param {string|null} activity  the persisted activity (the chosen chip for manual,
 *                                 watch-detected motion for live)
 * @returns {{ title: string, source: 'manual'|'live', activityLabel: string|null }}
 */
function sessionLabel(moodKey, activity) {
  const key = String(moodKey ?? '').trim();
  const chosen = activity ? activityLabelOf(activity) : null;

  if (key.startsWith('bio:')) {
    const [, band = '', act = ''] = key.split(':');
    const title = BAND_TITLES[band] || (band ? titleCase(band) : 'Live');
    const bioActivity = act && act !== 'unknown' ? activityLabelOf(act) : chosen;
    return { title, source: 'live', activityLabel: bioActivity };
  }

  if (PRESET_TITLES[key]) {
    return { title: PRESET_TITLES[key], source: 'manual', activityLabel: chosen };
  }

  // Unknown/empty key — never surface a raw string. Prefer the activity, else a neutral title.
  const title = key ? titleCase(key) : (chosen || 'Session');
  return { title, source: 'manual', activityLabel: chosen };
}

module.exports = { sessionLabel, PRESET_TITLES, BAND_TITLES, RETIRED_ACTIVITY_LABEL };
