---
status: living
verified: 2026-10-18
owner: regulatory-researcher
---

# Questions for counsel — the annexes

The four question annexes to `counsel-dossier-2026-09-29.md`, in the order they were filed, each kept verbatim with its headings one level down. `gating-five-2026-10-04.md` Appendix A cites them by the keys in the first column. New questions for counsel are new sections here, never new files.

| Key | Annex | Was |
|---|---|---|
| **EU** | [Kokonada — EU questions for counsel — 2026-09-29](#eu) | `eu-questions-for-counsel-2026-09-29.md` |
| **HX** | [Kokonada — HX questions for counsel — 2026-09-30](#hx) | `hx-questions-for-counsel-2026-09-30.md` |
| **J1** | [Kokonada — J1 (BE-074) questions for counsel — 2026-10-02](#j1) | `j1-questions-for-counsel-2026-10-02.md` |
| **PJ2** | [Kokonada — post-J2 privacy-page questions for counsel — 2026-10-06](#pj2) | `post-j2-privacy-questions-2026-10-06.md` |

---

<a id="eu"></a>
## Kokonada — EU questions for counsel — 2026-09-29
_Was `docs/design-v2/counsel/eu-questions-for-counsel-2026-09-29.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path. Key **EU** in `gating-five-2026-10-04.md` Appendix A._

Annex to `counsel-dossier-2026-09-29.md`. Prepared by regulatory-researcher for Stage 0 step L1; verbatim from its EU registry run (section 7). Each question cites the REG- entries in `docs/design-v2/registry/`.

EU only, ordered by how much each answer unblocks.

1. **Controller** (REG-024, 025, 053, 062).
   - Which entity is the controller, and is it established in the EU?
   - If it is not, does Art. 3(2) apply from launch?
   - Is the Art. 27(2)(a) exemption closed off by the Art. 9 processing?
   - *This unblocks the WHO line on P5, P9, P11 and P14, and the privacy notice.*
2. **The mood-only lane** (REG-031, 032, 055).
   - Are wheel taps, free text and inferred states Art. 9 data (C-21/23 paras 83 and 90)?
   - Which Art. 6 basis covers each non-health processing? Does any rest on legitimate interests?
   - *This unblocks the P2 and P10 layout (a consent step before the first tap).*
3. **Consent v3** (REG-026, 028, 030, 040, 065).
   - Is a live heart rate of an identified user data concerning health?
   - Must v1 grantors consent again once inference and profiling are named?
   - Are grants given over placeholder copy valid in the meantime?
   - Can one text serve as both the Art. 9 consent and the ePrivacy Art. 5(3) consent?
4. **Vocabulary** (REG-071, 076–079, 081–084).
   - Approve or reject the section 6 proposals.
   - Rule on "stress", "recovery", "readiness", "sleep debt", "balanced", "vitals", "flow" and "focus".
   - Rule on "100% read confidence", on showing the drift flags, and on the not-a-medical-device wording and where it goes.
5. **Minimum age** (REG-042, 043): the age, how it is checked, and whether a minor can give explicit Art. 9 consent.
6. **Art. 50 timing and addressee** (REG-003, 004, 006, 007, 011).
   - Is the current use Art. 2(8) testing, or putting into service?
   - Is Kokonada the deployer?
   - Is first exposure the start of processing or the first output?
   - May a notice on the Connect card sit outside the versioned consent?
   - Does the cohort processed ex-post need notice?
7. **Withdrawal and prominence** (REG-037, 038, 068): the two-step confirm, and the filled-versus-outlined buttons.
8. **Classification** (REG-001, 002, 018–022).
   - ER-Y or ER-N, weighing Recital 14's link to GDPR Art. 4(14) against its "recognition of emotions".
   - Is the nine-rule classifier an AI system?
   - Annex III 1(c); Art. 6(3) and profiling.
   - Does Art. 26(11)'s "decisions… related to natural persons" reach music selection?
   - Art. 111(2) as amended.
9. **Medical purpose** (REG-075, 080): does any feature or claim tip the product into MD-Y?
10. **DPIA** (REG-060): is one required, and which authority's list applies?
11. **Transfers and processors** (REG-061, 062): can the US recipients be relied on through the Data Privacy Framework while C-703/25 P is pending, or are standard contractual clauses needed?
12. **Language** (REG-047): is English-only acceptable for EU users, including for the Art. 50 line?
13. **Art. 50(1) and 50(2)** (REG-012, 013): does the session flow "interact directly", and is Kokonada the provider that must mark the captions?
14. **Art. 5(1)(f)** (REG-014, 015): the "Working" and "Focus" chips, and inference without biometric input.
15. **Consumer law** (REG-072, 073, 074): the UCPD for a free app; the Consumer Rights and Digital Content Directives; the Product Liability Directive.
16. **Data Act** (REG-085, 086).
17. **European Accessibility Act** (REG-087, 088): scope, the microenterprise status, and any national extensions.
18. **DSA** (REG-089): are stored prompts and history "hosting"?
19. **Art. 13 versus 14** (REG-049), **Art. 22** (REG-056), the profiling notice hook (REG-046), and the withdrawal log line (REG-063).

---

<a id="hx"></a>
## Kokonada — HX questions for counsel — 2026-09-30
_Was `docs/design-v2/counsel/hx-questions-for-counsel-2026-09-30.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path. Key **HX** in `gating-five-2026-10-04.md` Appendix A._

Annex to `counsel-dossier-2026-09-29.md`, next to `docs/design-v2/counsel/questions-annex.md#eu`. Prepared by regulatory-researcher in its pre-build brief for Track HX wave 1 (2026-09-30); verbatim from that brief's section 8, "QUESTIONS FOR COUNSEL (ordered by what they unblock)". "The list" in these questions is `docs/design-v2/counsel/questions-annex.md#eu`; other section numbers and labels, such as §5.1, R2 and R3, refer to the brief, which is not in the repo. The brief prepares the questions and does not decide them.

The owner ruled on 2026-09-30 to run the HX-1 production count after the fix merges, and to put Q-B to counsel (`docs/design-v2/decisions/DEC-102.md`).

**Q-A (HX-1, P0):** A write lands after a withdrawal row, for a reading admitted while the grant was current.
- Is that write protected by Art. 7(3), with Art. 17(1)(b) "without undue delay" as the duty?
- Or is it a new operation (Art. 4(2)) that needs an Art. 9(2) condition?
- If the first: is a compensating delete two round trips after the insert "without undue delay"?
- If the second: must a fence (R3) exist before any non-owner user? Is R2 acceptable as a documented interim under Art. 25(1)?

**Q-B (Art. 33):** Is a row that survived an erasure it should have been part of a "personal data breach" (Art. 4(12))? Assume the row was never read, never disclosed, and encrypted, and read EDPB 9/2022 para 14 alongside.
- Does a post-withdrawal read change the answer (BE-023's Pulse read, a recompute, an export)?
- Should this be answered **before** the §5.1 production count runs, given para 31's awareness clock under the breach branch?

**Q-C (supersedes the second half of the list's Q14):** On C(2025) 5052 paras 245, 251 and 253-255:
- Does Art. 5(1)(f) reach a consumer's own use of a heart-rate-driven consumer app while working or studying, with no employer or institution involved, including a self-employed user (para 254)?
- Does the product's detection of that context from free text (para 41; "for this specific purpose") change the answer?
- Is "inference without biometric input" now answered by paras 245 and 251?

**Q-D (HX-5, with the list's Q3 and Q6):** Is a navigational link on the consent sheet part of "the information that was presented" (EDPB 05/2020 para 108)?
- Would a per-grant build identifier plus archived screenshots suffice instead of a version bump?
- May the link render before its page is hosted (DAN-015)?

**Q-E (HX-2):**
- Must a "removed after N days" statement mention backup copies held for the Atlas snapshot period?
- Does a field-level trim, with the row kept, satisfy a per-category retention statement for that category?

**Q-F (HX-7c):** If Q-C's answer puts past "Working" sessions in scope, should those records be preserved as they are? If so, an in-place data migration would be inadvisable.

**Q-G (REG-063, with the list's Q19):**
- A raw user id or a pseudonym in the withdrawal line and the compensating-delete line?
- What retention period for these log lines as a declared category (EDPB 9/2022 fn 26)?

<a id="j1"></a>
## Kokonada — J1 (BE-074) questions for counsel — 2026-10-02
_Was `docs/design-v2/counsel/j1-questions-for-counsel-2026-10-02.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path. Key **J1** in `gating-five-2026-10-04.md` Appendix A._

Annex to `counsel-dossier-2026-09-29.md`, next to `docs/design-v2/counsel/questions-annex.md#hx`. Prepared by regulatory-researcher in its J1 round-1 review (2026-10-02); verbatim from that review's section 5, "QUESTIONS FOR COUNSEL", with the corrections the researcher asked for the same day, after the read-only production snapshot of 2026-10-02T07:57Z (its answer to amendment A1): J1-Q1 and J1-Q2 are withdrawn before filing and keep their numbers; J1-Q4's last bullet is struck; and J1-Q3 stands as written, since its facts name no kept-job backlog. Q-A, Q-B and Q-G are in `docs/design-v2/counsel/questions-annex.md#hx`; the BE-016 brief's C2, DT-9 G1 and the plan's T8 refer to review and plan files that are not in the repo. Ordered by what each answer unblocks. The researcher prepares these questions and does not decide them.

The owner ruled on 2026-10-02 to fix the state-vector job in a separate task, J2 (`docs/design-v2/decisions/DEC-126.md`), and to record a count before the one-off clean of the learning jobs and run the clean straight after the deploy, without waiting for counsel (`DEC-127`).

**J1-Q1 (Art. 33; a sibling of Q-B and the BE-016 brief's C2).** Withdrawn before filing, 2026-10-02. Its premise was finished learning jobs kept in Redis for deleted accounts. The read-only production snapshot of 2026-10-02T07:57Z, on commit `30978d9`, found the learning queue holding no job and no record that one had ever been added (its job counter did not exist), so no such job was kept up to then; the count after J1's deploy covers the time between (TASKS `DAN-048`). The general question stays before counsel as Q-B and the BE-016 brief's C2. It is to be refiled under TASKS `BE-087`, the delayed state-vector job that re-creates a `MedicalProfile` after an account is deleted, once J2 has a production count.

**J1-Q2 (Art. 33(5) and Art. 5(2) before the one-off `apply`).** Withdrawn before filing, 2026-10-02, with J1-Q1: with no kept job, the record before `apply` holds nothing (`DEC-127`). It is refiled with J1-Q1 if that is refiled.

**J1-Q3 (the in-flight write; extends Q-A).** After J1, some learning writes still land after the erasure:
- a job already running when an account is deleted or consent is withdrawn;
- a job queued by a play that ends during the request;
- a job left waiting because the queue did not answer in time.

Each writes `RewardEvent` and `PersonalWeights` after the erasure, and nothing removes those rows. There is no write-side check (BE-028, DT-9 G1) and no sweep. For a deleted account the rows expire 365 days after the play.
- Is naming this in the declarations enough (Art. 5(1)(a), 12(1), 13(2)(a))? Or does Art. 17(1) ("without undue delay") require erasing the rows, so that the declaration only describes a gap?
- If Q-A's first reading holds, can a residual with no compensating delete, bounded only by a 365-day TTL, meet that standard? If not, must the BE-028 check or an orphan sweep exist before any non-owner user?
- For a deleted account, is a row keyed to an ID with no User document still personal data (Recital 26)? Logs keep `user=<id>`, the gdpr-delete audit file keeps the ID, and backups may keep the User document.

**J1-Q4 (Art. 15 and Art. 20; the plan's T8 question 3).** The export reads Mongo only. It includes `RewardEvent` and `PersonalWeights`, and nothing from Redis: neither a waiting job nor the user-scoped cache (2 hours to 8 days).
- Does Art. 15(3)'s "copy of the personal data undergoing processing" reach a queue item that lives milliseconds when the workers run, and indefinitely when they do not? Read it with EDPB 01/2022 para 37 ("all data available at that point in time") and para 38 ("in the case of short retention periods…"). Does it reach the cache?
- Or is exporting the stores the job writes to, together with the Art. 15(1)(d) criterion "until the job has run", enough?
- Art. 20: WP242 rev.01 says "inferred data and derived data are not personal data 'provided by' the data subject". The job's play event (which recording, when, and a skip, completion or save) is "observed" data, and no store keeps it except the job and the aggregates. Is it in scope?

**J1-Q5 (Art. 5(2) against Art. 5(1)(c); extends Q-G and REG-063).** The withdrawal line prints `learningJobs=` with the removed count and drops the in-flight count. The deletion path logs one fixed line with no ID and discards both counts.
- Must the controller record that a job was in flight? That is the only case in which a write lands after the erasure.
- Is "no ID" on the deletion line the right balance? An orphan query can later find a deleted account's rows without it, but cannot tell an in-flight write after a withdrawal from a lawful later write.

<a id="pj2"></a>
## Kokonada — post-J2 privacy-page questions for counsel — 2026-10-06
_Was `docs/design-v2/counsel/post-j2-privacy-questions-2026-10-06.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path. Key **PJ2** in `gating-five-2026-10-04.md` Appendix A._

Annex to `counsel-dossier-2026-09-29.md`, next to `docs/design-v2/counsel/questions-annex.md#j1`, and filed in Appendix A of `gating-five-2026-10-04.md` as **PJ2**. Prepared by regulatory-researcher in its re-check of the privacy page after J2 (2026-10-06); verbatim from that re-check's section 7, "QUESTIONS FOR COUNSEL (ordered by what each unblocks)". Ordered by what each answer unblocks. The researcher prepares these questions and does not decide them.

J2 (`BE-087`, `BE-084`, `BE-094`) was deployed on 2026-10-06; the daily sweep of deleted accounts' data is built and deployed, and is not yet armed (TASKS `DAN-050`). The page is rewritten for J2 and is not published. The orchestrator decided, under the owner's delegation, that it goes live only after `DAN-050` records the sweep armed (`docs/design-v2/decisions/DEC-156.md`, branch (a)).

1. **DAN015-Q8, now concrete.** The sweep is built and deployed but not armed. Is publishing "can stay … with no time limit" for a deleted account's residual acceptable under Art. 5(1)(a), 5(1)(e), 13(2)(a) and 17(1)? Or should the first version wait for the armed sweep? This is the only legal input on (a) versus (b).
2. **NF-A (DAN015-Q3).** J2-1 now says publicly that a state estimate made from mood taps is kept for 2 hours for users without health-data consent, and it shapes their music. Is that data concerning health (Art. 9(1)), or "מידע בעל רגישות מיוחדת"? If yes, J2 did not touch its lawfulness: the generation path has no consent check, and disclosure is not a basis.
3. **NF-K.** A profile that survives a withdrawal (NF-B, or J2's stopped job) keeps being processed every night and can shape mood playlists, with no consent check. Is disclosure enough under Art. 7(3) and 9(2)(a), or must the processing stop? This joins the earlier Q4 (NEW-FINDING 3).
4. **Stale consent version** (next to CQ5). While a grant under an earlier consent version is not current, ingest is refused, but stored health data is still processed every night and read on the mood path. The page says nothing about this state.

### Notes for the reader (the scribe's, 2026-10-06)

- **Question 1 and the branch taken.** The researcher's verification of the applied texts, the same day: "As framed, it concerned publishing the unarmed deletion text, and branch (a) does not publish that text. Its withdrawal-side counterpart (NF-K, earlier Q4) stays open with counsel. I am not answering either." Question 1 is kept as the researcher filed it. Under `DEC-156` the first version does not publish the "no time limit" text, so the answer no longer decides the first version; it still bears on any later version published while the sweep is disarmed, since a disarm forces a new version (`DEC-156`).
- **Question 2.** "J2-1 now says publicly" refers to the rewritten page, which is not yet published. The declarations will state the same fact in the user-scoped cache row of `docs/PRIVACY_DECLARATIONS.md` (the re-check's D-1), which lands in a follow-up docs PR before the page is published.
- **The labels.** DAN015-Q8 is question 8 of the DAN-015 dossier (filed under J1-Q3 and `BE-087`). In question 2, "DAN015-Q3" is question 3 of the page re-check of 2026-10-04 (NF-A), not the dossier's own DAN015-Q3, which asks about the target tempo sent to the AI provider (`BE-083`). In question 3, "the earlier Q4 (NEW-FINDING 3)" is question 4 of that page re-check: whether a withdrawal confirmed while parts of the erasure failed is acceptable if disclosed. In question 4, CQ5 is the HX-5 question on which policy changes need a consent-version bump (Appendix A of `gating-five-2026-10-04.md`, item 18, H5-CQ5 and PP-Q5).
- **The rows behind them:** question 1, `DAN-015` and `DAN-050`; question 2, `BE-029` (the generation path reads with no consent check, `targetsBuilder.js`) and `BE-019`, and D-1, the declarations text in the follow-up docs PR; question 3, `BE-123` (NF-K) and `BE-122` (NF-B); question 4, `UI-091` (NF-P).
- The re-check and the verification are session files outside the repo (`Kokonada-private/session-3181c7f6/dan015/dan015-post-j2-regulatory-recheck.md` and `dan015-post-j2-regulatory-verification.md`).
