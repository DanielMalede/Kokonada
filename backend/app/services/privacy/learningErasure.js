'use strict';

// Erasure of the LEARNED PERSONALIZATION — the two artifacts that together are "what the app
// has learned about your taste": `RewardEvent` (per-user context-bucket aggregates, ADR-0012
// Track A) and `PersonalWeights` (the four music-ranking coefficients of §M.15).
//
// ── WHY THIS IS ITS OWN MODULE, AND NOT A STEP INSIDE `purgeWearableData` (ADR-0015) ────────
//
// Because the two actions it would then be shared by mean different things, and only one of
// them was ever promised:
//
//   WITHDRAWAL of Art.9 consent  — "I revoke the lawful basis." The consent notice states, on
//     its pinned first layer, that this "also erases what the app has learned about your taste
//     — that doesn't come back." That promise is what this module keeps.
//   PER-PROVIDER DISCONNECT      — "I unpaired one watch." Reached by BOTH the live Disconnect
//     Garmin button (integrationsController.garminDisconnect) and DELETE /integrations/
//     wearable/:provider. No notice promises that unpairing a watch destroys a taste profile,
//     and `wearableErasure.js`'s exclusion rationale is CORRECT at that scope: half of a
//     bucket's evidence is behavioural (skip / complete / save), which no wearable ever
//     touched, and a scoring weight has no `source` field to scope a delete by. Erasing these
//     on a disconnect would be over-erasure, not caution.
//
// So the objection was narrowed, not deleted. `purgeWearableData` has THREE callers and only
// one of them is a withdrawal; putting this delete there would silently wire the other two.
// The negative guards in tests/wearableErasure.test.js and .integration.test.js pin that
// boundary so the next reader cannot re-merge them by accident.
//
// Called from `consent.withdrawConsent` ONLY.
//
// Account deletion is a THIRD scope and already correct: `services/privacy/erasure.js` deletes
// both collections in its cascade (with `scripts/gdpr-delete.js` and `userDataExport.js` in
// lockstep). It deliberately does NOT delegate here — tests/shadow.qa4.crypto.test.js reads
// that file's SOURCE TEXT for `<Model>.deleteMany` as its completeness guard, so hiding the
// calls behind an import would disarm the guard that protects every future collection.
//
// Erasure is ALL-OR-NOTHING by necessity, not by preference: `rewardSum` is a scalar `$inc` of
// an already-mixed reward, and `PersonalWeights` accumulates through a non-additive `clamp`, so
// no biometric contribution can be subtracted back out. Recovering one would mean retaining
// full per-play history — strictly more personal data in order to delete less. ADR-0015 §"Why
// partial erasure was not available" carries the full argument.

const { RewardEvent } = require('../../models/RewardEvent');
const { PersonalWeights } = require('../../models/PersonalWeights');

// Delete every learned row belonging to `userId`. Scoped by user and nothing else — neither
// collection carries a provider, which is precisely why this is a withdrawal-only action.
// Concurrent because they are independent collections with no ordering between them.
// Returns the per-collection counts so the caller can DEMONSTRATE the erasure ran (Art.5(2)).
async function purgeLearnedPersonalization(userId) {
  const [weights, rewards] = await Promise.all([
    PersonalWeights.deleteMany({ userId }),
    RewardEvent.deleteMany({ userId }),
  ]);
  return { personalWeights: weights.deletedCount, rewardEvents: rewards.deletedCount };
}

module.exports = { purgeLearnedPersonalization };
