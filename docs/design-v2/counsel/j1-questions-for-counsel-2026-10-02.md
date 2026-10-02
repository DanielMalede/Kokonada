# Kokonada — J1 (BE-074) questions for counsel — 2026-10-02

Annex to `counsel-dossier-2026-09-29.md`, next to `hx-questions-for-counsel-2026-09-30.md`. Prepared by regulatory-researcher in its J1 round-1 review (2026-10-02); verbatim from that review's section 5, "QUESTIONS FOR COUNSEL", with the corrections the researcher asked for the same day, after the read-only production snapshot of 2026-10-02T07:57Z (its answer to amendment A1): J1-Q1 and J1-Q2 are withdrawn before filing and keep their numbers; J1-Q4's last bullet is struck; and J1-Q3 stands as written, since its facts name no kept-job backlog. Q-A, Q-B and Q-G are in `hx-questions-for-counsel-2026-09-30.md`; the BE-016 brief's C2, DT-9 G1 and the plan's T8 refer to review and plan files that are not in the repo. Ordered by what each answer unblocks. The researcher prepares these questions and does not decide them.

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
