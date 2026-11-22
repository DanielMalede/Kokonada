'use strict';

/**
 * The Garmin Developer Program tier this app holds (BE-220). STARTER.
 *
 * Starter includes no historical data ("Historical Data: Not included"; backfill "Supported with Enterprise
 * Access only"; Agreement §5.2(f),(h)), so while this says Starter the OAuth callback asks Garmin for no
 * backfill at all, not a shorter one (BE-207's scope, superseded).
 *
 * How it may be changed, and only so: a reviewed PR that changes the one literal below from 'starter' to
 * 'enterprise', which carries (1) Garmin's written grant of the higher tier, filed with the other Garmin sources;
 * (2) compliance-auditor's reading of that grant against the Agreement; and (3) the owner's own approval quoted on
 * the PR at its head SHA. It is a code constant on purpose, like the music fence (garminMusicFence.js): not an
 * env var, a flag or a database setting, so nothing a run can flip. Only the exact literal 'enterprise' includes
 * the backfill; any other value, a look-alike or a typo, stays at Starter.
 */

const GARMIN_TIER = 'starter';

/** True only when the literal above is exactly 'enterprise'. */
function garminBackfillIncluded() {
  return GARMIN_TIER === 'enterprise';
}

module.exports = Object.freeze({
  GARMIN_TIER,
  garminBackfillIncluded,
});
