# ADR-0015 — Withdrawing Art. 9 consent erases the learned personalization

**Status:** Accepted · 2026-08-29
**Supersedes:** the exclusion rationale in `backend/app/services/privacy/wearableErasure.js` **at withdrawal scope only** (it stands, unchanged, at per-provider-disconnect scope)
**Amends:** `docs/plans/HALT_CONSENT_VERSION_RETENTION_AND_DECLARATIONS.md` §C1

## Context

The Art. 9 consent notice states, in its **pinned first layer** — the layer a reader
cannot avoid — that withdrawing health consent *"also erases what the app has learned
about your taste — that doesn't come back."* It repeats the claim in three more places.

The code did not do this. `RewardEvent` and `PersonalWeights` were **documented deliberate
exclusions** from `purgeWearableData`, removed only by account deletion. The exclusion had
a real argument behind it, and it is worth restating because it was not wrong:

> A bucket's evidence is half behavioural — skip, complete, save — which no wearable ever
> touched. The taxonomy resolves a state DEGRADED from mood taps and the clock alone. A
> scoring weight has no `source` field to scope a delete by. Dropping a listener's whole
> learned ranking because they unpaired one watch would erase data that is not
> wearable-derived: over-erasure, not caution.

`compliance-auditor` raised this as a **HALT**: an affirmative false statement about the
effect of exercising the Art. 7(3) right to withdraw, inside the document that collects
Art. 9(2)(a) explicit consent, erring toward **overstating** deletion — the damaging
direction. A user who withdraws expecting erasure and does not get it has a concrete
Art. 17 grievance plus a demonstrably misleading notice. Under Art. 7(1) the para-108
archived copy would then be evidence *against* the controller rather than for it.

## Decision

**Withdrawal of Art. 9 health consent erases `RewardEvent` and `PersonalWeights` in full.**

Two options were put to the owner — change the copy to match the code, or change the code
to match the promise. **The owner chose to change the code**, on 2026-08-29, with the
over-erasure cost stated explicitly at the time of the decision.

The erasure lives in a **new** `backend/app/services/privacy/learningErasure.js`, called
from `consent.withdrawConsent` **only** — deliberately *not* inside `purgeWearableData`.

## Why not inside `purgeWearableData`

Because it has **three** callers, not one:

| caller | meaning |
|---|---|
| `consent.js` withdrawal | "I revoke the lawful basis" |
| `integrationsController.js` — the live **Disconnect Garmin** button | "I unpaired one watch" |
| `wearableErasureController.js` | "erase this one provider" |

Putting the erasure there would mean **unpairing a watch destroys the taste profile**. No
notice promises that, and it is precisely the over-erasure the original rationale argued
against. So the objection is **narrowed, not deleted**: it remains correct at disconnect
scope, and is overruled only at withdrawal scope, where the promise was made.

A regression guard pins this. Without it, the next reader puts the delete in
`purgeWearableData` and the disconnect button quietly starts destroying taste profiles.

## Why partial erasure was not available

This is the part that must survive, because it converts *"we chose over-erasure"* into
*"over-erasure was the only option"* — and stops the decision being re-litigated.

1. **The split is destroyed at write time.** `RewardEvent` stores `rewardSum` as a scalar
   `$inc`. The stored value is `Σᵢ rᵢ`. No component survives.
2. **The mixing weight is not even constant.** `combineReward` is `0.6·bio + 0.4·beh` only
   when *both* instruments are usable; otherwise it is one or the other at weight 1.0. So
   `rewardSum` sums terms drawn from three different compositions. Un-mixing would need
   per-source sums *and* three separate counts — a materially wider row, with **no backfill
   possible**.
3. **For `PersonalWeights` it is impossible even with a perfect schema.** Each step is
   `δ ← clamp(δ·decay + 0.02·r·∂, ±0.4)`. **`clamp` is not additive**, so a biometric
   contribution cannot be subtracted out of a clamped, decayed accumulator. Recovering it
   would require retaining full per-play event history and replaying it — **retaining
   strictly more personal data in order to delete less**, which inverts data minimisation.

## Consequences

**Accepted cost.** Some erased evidence was behavioural and never touched a wearable. That
is real, and it is the price of the promise. The reasoning: a promise made on the layer a
user cannot avoid reading is the one that must be kept. A false retention statement inside
the notice contaminates the consent it collects; over-erasing data the user asked us to
erase does not.

**Blast radius: none at the readers.** Absence is a first-class, already-tested state —
`readWeights` returns `null`, `_resolveOverlay` reports `cold-start` and the scorer uses its
own defaults, `overlay(table, null)` returns the caller's object by identity, and
`planNovelty` ABSTAINs. Writers are `upsert: true` and recreate on the next observation.

**A known gap this exposes rather than creates.** Withdrawing mid-track leaves
pre-withdrawal HR samples in socket-scoped memory; `playback_event` is not consent-gated,
so a fresh `RewardEvent` can be upserted seconds after withdrawal, from special-category
data. That is a live Art. 7(3) gap that predates this decision. It is being fixed in the
same wave, separately, by stripping the biometric half at play close while keeping the
behavioural half — a blanket consent gate is **disqualified**, because it would stop
mood-only users learning and falsify *"mood-only is identical in every other way."*

**A residual the code change does not fix.** `MusicProfile` survives withdrawal, and
`docs/PRIVACY_DECLARATIONS.md` describes that row in our own words as *"Music profile &
listening-derived taste."* Erasing it is not available — `MusicProfile.library` is what
makes playback work, and destroying it would falsify the mood-only promise. The notice must
therefore **name what goes and what stays**. `designer` owns that wording.

**The reversal must be legible in every place that argues the old position** — the module
comment, both model registration paragraphs, `PRIVACY_DECLARATIONS.md`, and the HALT plan.
A reversal recorded in one place leaves the others arguing against shipped behaviour.

## Not decided here

Whether the corrected copy legally requires **re-consent** or only **re-informing** is a
question of law. It belongs to counsel, prepared by `regulatory-researcher`. It determines
whether a consent-version bump is needed at all; it does not affect this decision, because
over-delivering deletion before the notice claims it is not a false statement.
