'use strict';

// The activity chips the app offers (mobile src/experience/generate/activities.ts, ACTIVITIES). The
// emotion_update door admits only these keys; anything else, including the retired "working" and
// "focus" chips (DEC-062), is dropped. A mobile drift test runs this file and holds the two lists
// equal, so it must stay free of imports.
const CHIP_ACTIVITY_KEYS = Object.freeze(['running', 'resting', 'walking', 'commuting', 'workout', 'winding down']);

module.exports = { CHIP_ACTIVITY_KEYS };
