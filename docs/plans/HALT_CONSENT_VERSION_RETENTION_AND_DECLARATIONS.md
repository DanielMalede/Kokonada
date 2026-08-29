# HALT — Consent version, retention truth, and the store declarations

**Raised:** 2026-08-26 by `compliance-auditor`, re-auditing the five screens closed without a compliance pass.
**Severity:** one item (C3) is a **live production failure**, not a redesign risk.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor` re-audit. C4 and C5 need a human (Play Console, App Store Connect, legal).
**Status:** canvas items fixed 2026-08-26 (marked DONE). Shipped items not started.

---

## C1 · The retention statement was false in either reading — canvas DONE, shipped still wrong

**Requirement** — GDPR Art. 13(2)(a): "the period for which the personal data will be stored, or if that is not possible, the criteria used to determine that period." Art. 4(11): consent must be "informed".

**Ground truth, verified file by file:**

| Thing | Retention | Survives withdrawal? |
|---|---|---|
| Readings (`BiometricLog`) | 90-day TTL — `models/BiometricLog.js:43-44` | no |
| **Physiological baseline** (`MedicalProfile`) | **no TTL index at all** | no — deleted on withdrawal |
| Music-learning coefficients (`PersonalWeights`, `RewardEvent`) | 365-day inactivity TTL — `models/PersonalWeights.js:98-99` | **yes — deliberately excluded**, `services/privacy/wearableErasure.js:62-82` |

The canvas said *"The baseline goes after a year without you. Both go if you withdraw."* Read "baseline" as the physiological profile and the first clause is false — it has no expiry. Read it as the music overlay and the second is false — it survives withdrawal by design. **There is no reading in which the sentence is true**, and it errs toward overstating deletion, which is the damaging direction. A false retention statement *inside* the Art. 9 notice contaminates the consent it collects.

**Canvas: DONE.** The KEPT row and §6 now separate the three lifetimes explicitly, say plainly that withdrawing health consent does **not** delete what the app learned about your music, and give the reason (it is learned from what you skipped and saved, not from your body). Uncomfortable and true; saying it costs less than being found out. §6 also now states the `ConsentRecord` retention, which was missing.

**Product decision, not a copy edit:** if the intent is "everything goes on withdraw", change the **code** — add `PersonalWeights` and `RewardEvent` to withdrawal erasure. That is a deliberate exclusion today, so it is the owner's call, not the developer's.

## C2 · Shipping the new copy without a version bump breaks Art. 7(1) — and the bump is booby-trapped

**Requirement** — Art. 7(1): "the controller shall be able to demonstrate that the data subject has consented." EDPB 05/2020 paras 107-108: retain consent statements, timestamps, workflow documentation, **and copies of the information presented at the time of consent**.

The shipped notice (`ConsentSheet.tsx:36-73`) is six sections. The canvas notice is eight, with different retention wording and named sub-processors. Both would record as `CONSENT_SCREEN_VERSION = 1` (`consentApi.ts:56`) against `CURRENT_CONSENT_VERSION = 1` (`consent.js:14`). **Two materially different documents under one version number destroys the proof the version number exists to carry.** The cross-package guard catches client-vs-server drift, never copy-vs-version drift.

**Fix:** bump both constants in lockstep, and archive the exact text per version as a versioned constant or fixture pinned by test, so "v2" resolves to a document.

### Read this before bumping

`GARMIN_CONSENT_MIN_VERSION = 2` (`consent.js:26`) is the gate that currently **drops** `spo2 / respiratory_rate / body_battery` at Garmin ingest. The comment at `consent.js:21-22` states the design plainly: *"It sits ABOVE CURRENT_CONSENT_VERSION on purpose: flipping the lane live means bumping CURRENT_CONSENT_VERSION."*

So bumping `CURRENT_CONSENT_VERSION` 1 → 2 **for copy reasons would flip the Garmin special-category lane live** while Garmin production approval is still pending.

`backend/tests/garminConsentVersionGate.test.js:59` asserts `GARMIN_CONSENT_MIN_VERSION > CURRENT_CONSENT_VERSION` and will fail the build. **That failure is the guard working. Do not edit the assertion.**

**Correct move — SUPERSEDED, see below.** The original prescription was `CURRENT_CONSENT_VERSION = 2` **and** `GARMIN_CONSENT_MIN_VERSION = 3`, with `CONSENT_SCREEN_VERSION = 2` client-side in the same commit.

**The owner has chosen `CURRENT_CONSENT_VERSION = 3` and `GARMIN_CONSENT_MIN_VERSION = 4`** (2026-08-29), with `CONSENT_SCREEN_VERSION = 3` client-side in the same commit. Both forms hold the invariant `min > current`, so `garminConsentVersionGate.test.js:58` passes either way; 3/4 was chosen to leave a clear gap. **The two prescriptions must not be left disagreeing** — this doc is the discoverable internal rule, and a discoverable rule contradicted by the shipped code is the posture this plan itself warns against at the Decline rule.

**Deploy hazard, added by `compliance-auditor`:** the server bump must be sequenced *behind client adoption*. `recordConsent` rejects any `clientVersion !== CURRENT_CONSENT_VERSION` with `stale_client` and writes no row (`consent.js:44-46`). On a server-only bump every existing grantor becomes `staleVersion: true`, which hard-blocks all ingestion — sockets, the Garmin webhook, and the Apple/health batch via `requireConsent` — while users on an older binary cannot re-grant, because their `clientVersion: 1` is rejected. That is a health-lane outage they cannot escape until they update. Ship the client carrying `CONSENT_SCREEN_VERSION = 3` first, then bump the server.

## C3 · LIVE — placeholder legal copy is being recorded as consent v1 right now

This predates the redesign and is the worst finding in the re-audit.

`ConsentSheet.tsx:16` and `:34` both carry the banner **`PLACEHOLDER COPY — final legal wording pending compliance-auditor + legal review`**. It is shipped. Its retention section (`:58`) reads:

> "We keep only what personalisation needs and no longer. Raw samples are minimised over time…"

**No period. No criteria.** That fails Art. 13(2)(a) in production, today, for every user who has already granted.

**This argues for accelerating the new copy, not delaying it** — with C2's version bump attached. Every day the placeholder stands is another set of grants recorded against a document that was never meant to be legally operative.

## C4 · Sentry is a real sub-processor and is absent from the declarations

`backend/package.json:18` ships `@sentry/node`; `backend/app/index.js:35` initialises it via `config/sentry.js:16-31`; and events carry an identifier — `sockets/index.js:90` and `sockets/biometricHandler.js:972` both pass `userId: String(...)` into `captureException`.

`docs/PRIVACY_DECLARATIONS.md` does **not** list Sentry in its sub-processor table, and neither store form declares a crash-log / diagnostics category. `PRIVACY_DECLARATIONS.md:63` asserts "No third-party advertising or analytics SDKs" — defensible for error monitoring, but the Play **Crash logs / Diagnostics** category is unanswered.

**The canvas was more accurate than the declarations** — but it was also wrong in its own way: it said Sentry receives crash reports *"when error monitoring is on"*, implying a user control. There is none; it is gated on the `SENTRY_DSN` env var, an operator switch. And it said "crash reports" while Sentry receives an account ID.

**Canvas: DONE** — now "receives error reports, which can include your account ID."

**Shipped/declarations fix:**
1. Add Sentry to the `PRIVACY_DECLARATIONS.md` sub-processor table, stating it receives error/stack context **plus userId**.
2. Add Play "App info and performance → Crash logs" and Apple "Diagnostics → Crash Data".
3. Re-check the Play "shared with third parties: No" answer against the added processor.
4. **Reconcile Vercel** — listed in the declarations, absent from the canvas. Either it is gone (remove it) or it is live (the notice is incomplete). The two documents currently disagree in both directions.

Misdeclared Data Safety is a routine Play takedown reason.

## C5 · No "not a medical device" disclaimer exists anywhere

**Requirement** — Play Health Content and Services: other health and medical apps "must include a clear disclaimer in their app description indicating that the app is *'not a medical device and does not diagnose, treat, cure, or prevent any medical condition.'*" Apple 1.4.1: "Apps should remind users to check with a doctor in addition to using the app and before making medical decisions."

A repo-wide search for `not a medical device` / `diagnose, treat` returns **zero matches**. The app reads HR/HRV/sleep and renders interpretations ("Wired, but running on empty", "HRV 29 ms"), so it is squarely a health app. The Play Health apps declaration is still unticked at `PRIVACY_DECLARATIONS.md:155`.

**Fix:** add the disclaimer verbatim to the Play listing description, and echo it once in-app adjacent to the reads — Pulse and the Receipt head — which also answers Apple 1.4.1.

## C6 · Art. 13(1)(f) — naming the processors created a duty that naming alone does not discharge

Naming sub-processors is **not required** — Art. 13(1)(e) accepts "categories of recipients". Naming exceeds the minimum and is a good instinct. But once named, Art. 13(1)(f) still requires the adequacy statement, the Art. 46 safeguard reference, **and the means of obtaining a copy**. The canvas named four US/unknown-region processors and stopped.

**Canvas: DONE** — one sentence now covers it: transfers outside Europe run on the European Commission's standard contractual clauses, and the reader can ask for a copy. Groq's own documentation states SCCs apply, so the safeguard exists and was simply undisclosed.

**UNVERIFIED, and it must be resolved before the notice claims anything specific:** DPF certification or SCC status for Groq, Railway, MongoDB Atlas and Sentry, per processor. The EU-US Data Privacy Framework adequacy decision stands (the General Court dismissed *Latombe v Commission* T-553/23 on 3 September 2025; appeal C-703/25 P pending), but adequacy covers **DPF-certified** organisations only.

**Also standing and unexecuted:** `PRIVACY_DECLARATIONS.md:84-90` — the **Groq DPA + Zero-Data-Retention** condition is "a business/legal action that is not yet confirmed done." The canvas now states the Groq processing relationship to users in plain language. **Stating it to users while the Art. 28 contract is unexecuted is the wrong order**, and the Play "shared with third parties: No" answer depends on it.

## C7 · The consent notice is Android-only

`Consent.dc.html` described Health Connect exclusively, while `BiometricLog.source` includes `apple_health` and `suunto` and the declarations describe HealthKit ingestion. On iOS the notice misdescribed both the data source and the flow — Art. 12/13 accuracy, and Apple 5.1.2(i).

Partially addressed: the Google-brand corrections ("Android Health Connect" → "Health Connect"; the prohibited possessive "Android's own" → "the Health Connect permission sheet") are **DONE**. **Still open:** platform-conditional copy naming the actual source on iOS. That is a board variant, and it is queued rather than done.

## What the re-audit found *right*, and must not be broken

- **Decision 1 — filled Agree vs outlined Decline: PASS.** Not a recognised per-se dark pattern on the cited authorities. The EDPB Cookie Banner Taskforce Report names two failures: absence of a reject option on any layer (para 8) and contrast "so minimal that the text is unreadable" (para 18). Neither applies: identical geometry, stroke, radius, weight, size and hit area; Decline first in reading order; **Decline's label carries the highest text contrast on the screen**; anti-confirmshaming copy present. The test is explicitly case-by-case and this case passes it.
  **Five conditions hold that PASS**, and the first is a live inconsistency: **`docs/SCREENS.md` §11 currently says the opposite** — *"Decline is exactly as easy as Accept — equal size/position/contrast."* A discoverable internal rule contradicted by the shipped UI is the worst posture in a supervisory inquiry. Update §11 with the new rule **and its reasoning**, or revert. Do not leave them disagreeing. Also: never re-tint Agree to the emotion accent; no confirm step or re-prompt loop on Decline; measure the Decline outline at 3:1 (WCAG 2.2 1.4.11) in both themes — the canvas uses `--ink` and is safe, but **shipped `ConsentSheet.tsx:233` uses `c.content.tertiary` and is unmeasured**; and file a screenshot of the rendered screen against the consent version.
  **Shipped note:** `ConsentSheet.tsx:220-224` carries a comment asserting "equal-weight Decline · Agree" while `:233-248` renders outline-vs-fill. **A false comment on a legal control is worse than none.**
- **Decision 4 — eight collapsed sections: PASS on layering.** Layered information is expressly endorsed (EDPB 05/2020 paras 71-72). **FAIL on what the first layer carried:** of the para-64 minimum, controller identity and purpose sat inside collapsed sections and the transfer statement was absent entirely. C6 fixes the transfer statement. **Still open:** promote purpose and controller identity into the always-visible summary, and allow multiple sections open at once (the accordion currently closes one to open another, while claiming "this is the whole notice").
- **Least privilege: clean.** Nothing on these boards requests a scope beyond the declared minimum. Health Connect stays at heart rate / HRV / sleep / resting HR / history; the Garmin trio is disclosed-but-dormant and *enforced* dormant.

## Related

- `docs/plans/DEV_CONSENT_FIELD_EXPOSURE.md` — correctly scoped already, and now **gating**: the Vault's "Version 1 · 12 Aug 2026" line must not ship before it. Rendering `currentVersion` beside a grant is an affirmative false statement whenever `staleVersion` is true. The shipped `VaultConsentPanel.tsx:59` is honest today; this is a canvas-only exposure.
- `docs/plans/HALT_HEALTH_CONNECT_PLAY_BLOCKERS.md` — the other half of the Play story.
