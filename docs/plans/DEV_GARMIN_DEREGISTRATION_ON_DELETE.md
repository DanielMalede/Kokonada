# HALT — Account deletion leaves the Garmin registration live

**Raised:** 2026-08-26. **Escalated to HALT 2026-08-26** after `compliance-auditor` returned the governing clause.
**Severity:** GDPR Art. 17 failure in shipped code **and** a direct breach of a documented Garmin Application Requirement, which §9.4 makes an immediate automatic-termination trigger with no notice and no cure period.
**Routing:** `developer` under TDD, then `resilience-auditor`. The compliance question is now answered — see below.
**Status:** not started. **Not a canvas item.** Surfaced during the screen-13 design review; it is a backend defect and belongs in the backlog on its own terms.

Verified at high confidence by an independent adversarial pass. Every claim below carries file:line.

---

## The obligation is explicit, and "Delete My Account" is the exact trigger it names

> **Delete User Registration** — `DELETE https://apis.garmin.com/wellness-api/rest/user/registration`
> This endpoint **must be called if the partner website or application provides a "Delete My Account" or "Disconnect" mechanism outside of the normal Garmin Connect consent removal process**, or **in any case where the user would reasonably believe the partner program is allowing them to remove their consent to share Garmin data**.
> — Garmin OAuth2.0 PKCE Specification, doc Last-Modified 2025-07-23, fetched 2026-08-26

Supporting contract clauses (Developer Program Agreement FRM-0952 Rev. B):
- **§5.1(a)** — Licensee shall "follow all Application Requirements, including all upload and user experience guidelines and instructions".
- **§5.1(e)** — Process data "in a manner consistent with any End Users' consent".
- **§9.4** — "This Agreement will terminate **immediately and automatically, without any notice by either Party**, if Licensee violates any of the terms and conditions of this Agreement."

This is also the kind of defect Garmin's production-approval review exists to catch. It is likely to cost the approval outright, not merely earn a warning.

## Three aggravators found in the same pass

1. **The defect is irreversible.** `authController.js:229` `User.deleteOne` destroys `wearableToken`, `garminUserId` and `garminUserIdHmac`. Once the account is gone **there is no credential left with which the deregistration could ever be performed** — not by a retry, not by a backfill script, not by hand. The Garmin-side registration is orphaned permanently, and Garmin keeps pushing that person's health summaries to a webhook for a user who no longer exists.
2. **Even the two paths that do call it are no-ops today.** `wearableErasure.js:135` — `if (process.env.GARMIN_DEREGISTER_ENABLED !== 'true') return { attempted: false };`. Default off. So **right now, zero code paths in Kokonada ever deregister a Garmin user** — not withdrawal, not disconnect, not deletion.
3. **The go-live checklist is decoupled from the flag.** `consentApi.ts:39` names go-live as "`GARMIN_WEBHOOK_SECRET` + Garmin production approval". `GARMIN_DEREGISTER_ENABLED` is not in that sentence. Following the comment literally switches ingestion on while deregistration stays off — the worst possible ordering.

**Why this is HALT-before-ship rather than remediate-now:** the Garmin server-to-server lane is pre-production (`consentApi.ts:32-41`), so no live user is currently orphaned. That is the only mitigation.

---

## The defect

`DELETE /api/auth/account` (`backend/app/routes/auth.js:22` → `controllers/authController.js:220-245`) performs a full hard delete: `deleteMany` across 13 user-keyed collections plus Redis (`services/privacy/erasure.js:37-68`), removes the `User` document last (`authController.js:229`), kills sockets and revokes the JWT. There is no queue, timer, tombstone or undo anywhere — confirmed by `grep -riE "deletionQueue|scheduleDeletion|deleteAfter|purge"`.

**It never deregisters the user from Garmin.**

`maybeDeregisterGarmin` (`services/privacy/wearableErasure.js:134-144`) is reachable **only** through `eraseWearableProvider` (`:149`). `erasure.js` never requires `wearableErasure` — its only privacy-adjacent import is `ConsentRecord` (`erasure.js:21`).

So the two erasure paths differ **bidirectionally**, and deletion is *not* a superset of withdrawal:

| | Withdraw consent | Delete account |
|---|---|---|
| Biometric rows, MedicalProfile, MorningState, bio Redis keys | erased | erased |
| Wearable credentials on the User doc | cleared (`clearWearableCredentials`, `:107-126`) | User doc deleted |
| RewardEvent, PersonalWeights, MusicProfile, PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack, ConsentRecord | **kept** (deliberate, `wearableErasure.js:62-82`) | erased |
| **Garmin server-side registration** | **deregistered** | **LEFT LIVE** |

The user's account and every row keyed to it are gone, and Garmin remains registered to push data for a user that no longer exists. The more total action does less.

## Why this is a compliance item, not a tidy-up

Under GDPR Art. 17 an erasure request should stop third-party processing initiated on the controller's behalf. A live registration after deletion means:

1. **Continuing third-party processing** for a data subject who has exercised erasure.
2. **Inbound webhooks for a deleted user.** `compliance-auditor` should establish what `garminIngest` does with a payload whose `userId` no longer resolves — specifically whether that path can error-loop, or whether any upsert could **resurrect** a record for a deleted account. A resurrection would turn a registration leak into a data-recreation defect.
3. A **retention question at the processor**: whether Garmin holds anything keyed to the registration after we stop consuming it.

## Fix direction

The deletion cascade must perform the same deregistration the withdrawal path does, **before** the `User` document is removed — the credentials it needs (`garminUserId`, `garminUserIdHmac`, `wearableToken`) live on that document, so ordering is not optional.

Deregistration is a network call to a third party, so it must not be able to strand the delete: if it fails, the cascade still has to complete and the failure has to be recorded for retry. A user must never be left half-deleted because Garmin was unreachable.

## The guard test — name it, do not leave it implied

**`backend/tests/erasureParity.test.js`** — a parity test whose single job is to stop the two paths drifting apart again.

It must assert:
- `eraseAccount` calls `maybeDeregisterGarmin` for a user with a Garmin registration, exactly as `eraseWearableProvider` does.
- Deregistration is invoked **before** the `User` document is deleted.
- A failing deregistration does not abort the cascade, and the failure is recorded.
- The collection list in `erasure.js` is a **superset** of the withdrawal path's, so any future collection added to one is caught if it is missing from the other.

That last assertion is the one that matters. This bug exists because one path was written later and quietly diverged; a test that only checks today's behaviour would not have caught it and will not catch the next one.

## Two more requirements the same pass added to the fix

- **Make `GARMIN_DEREGISTER_ENABLED=true` a blocking line item on the same go-live checklist as `GARMIN_WEBHOOK_SECRET`**, and update the comment at `consentApi.ts:39` to say so. Better: derive the deregistration behaviour from the same switch that enables ingestion, so they cannot diverge.
- **Record the deregistration outcome to an audit trail before the user row disappears.** Compliance must be demonstrable to Garmin, and after `User.deleteOne` there is no evidence left.
- **Extend it to every provider the user actually has**, not just Garmin, so the same class of bug does not recur for Suunto.

## Root cause, named

`wearableErasure.js:5-7` records the deferral: *"account-wide erasure stays owned by Wave 1; consolidation happens later."* **That deferral is what produced this defect.** Two erasure modules with different obligations and no shared test is the root cause; the missing call is the symptom. The parity assertion below is the fix for the cause.

## Related

- Surfaced by: `docs/review/13-health-data-vault.html`
- **Independently rated a pre-submission blocker by the sign-in audit** (`docs/plans/DEV_SIGNIN_BRAND_ASSETS.md`): Apple requires deletion of the account record "along with associated personal data", Play says "and associated data", and a live Garmin registration pushing biometrics for a deleted user fails both, as well as GDPR Art. 17.
- `docs/plans/HALT_GARMIN_BRAND_AND_ATTRIBUTION.md` — the other Garmin blocker.
- `docs/plans/DEV_CONSENT_FIELD_EXPOSURE.md` — separate, and much smaller.
