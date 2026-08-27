# DEV ITEM — Expose three consent fields the server already stores

**Raised:** 2026-08-26, from the screen-13 (Health Data Vault) design review.
**Routing:** `developer` under TDD → `resilience-auditor`.
**Status:** not started.

---

## Scope this correctly: it is DTO exposure, not a data change

**Nothing new is stored. Nothing new is written. No migration.** All three values already exist on the append-only `ConsentRecord`, which has `timestamps: true` and a `status: 'withdrawn'` value. The only work is returning them from the endpoint that already reads that record, and widening the client type.

Scoping this as a storage or schema change would be wrong and would make it look far larger than it is.

## What the client can say today, and what it cannot

The client holds exactly `ConsentStatus { granted, currentVersion, staleVersion }` (`mobile/KokonadaHealth/src/health/consentApi.ts:60-64`). That supports three true statements and no others: **a grant is on file**, **what version the terms are currently at**, and **whether the grant on file is behind that version**.

The trap that makes this look solvable when it is not:

- **`currentVersion` is the server's `CURRENT_CONSENT_VERSION` constant** (`backend/app/services/privacy/consent.js:14`, returned unconditionally at `:126`). It is the version the terms are at **now** — *not* the version the user agreed to. Rendering it beside a grant reads as "you agreed to version N", which is false whenever `staleVersion` is true.
- The **granted** version is available server-internally via `getGrantedConsentVersion` (`consent.js:110-113`), and **no route exposes it**.
- `grantedAt` and `withdrawnAt` live on `ConsentRecord` (`consent.js:53`, `:72`) and are absent from `getConsentStatus`'s return (`:122-129`) — the sole payload of all three consent endpoints (`controllers/consentController.js:20`, `:29`, `:39`).

The shipped UI is honest about this constraint: `VaultConsentPanel.tsx:59` renders only *"Consent on file — personalising with your body's signals."*, with no date and no version.

## The change

Add to `getConsentStatus`'s return and to the `ConsentStatus` interface:

| Field | Source | Nullable |
|---|---|---|
| `grantedVersion` | `getGrantedConsentVersion` (`consent.js:110-113`) | yes — null when no grant on file |
| `grantedAt` | newest `status:'granted'` `ConsentRecord.grantedAt` | yes |
| `withdrawnAt` | most recent `status:'withdrawn'` record, if any | yes |

**Client-side notes:**
- `isConsentStatus` (`consentApi.ts:71`) is the one place a `ConsentStatus` enters the app and it fails closed on an unshaped payload. The three new fields must be **optional** in the guard, so an older backend does not fail the shape check and lock a user out of the health path. That guard exists because of a resilience-audit finding; do not weaken it.
- Render `grantedVersion`, never `currentVersion`, next to a grant date. If they differ, that is what `staleVersion` is for — say so rather than showing the newer number.
- All three are nullable, so the UI needs a defined first-run state. The board's "Before that — Withdrawn …" line renders only when `withdrawnAt` exists.

## Why it is wanted

Screen 13 draws the consent line as version, date, and any prior withdrawal (Daniel's `consent=history` choice). Because the record is append-only, a previous withdrawal is retrievable — which is a stronger and more honest statement than a single date: it shows the user their own history with the consent, including that they once revoked it and came back.

**Until this lands, the board shows three values the app cannot produce.** Either the fields ship before the screen, or the line degrades to the shipped sentence.

## Related

- Screen 13 review: `docs/review/13-health-data-vault.html`
- `docs/plans/DEV_GARMIN_DEREGISTRATION_ON_DELETE.md` — separate item, separate severity.
