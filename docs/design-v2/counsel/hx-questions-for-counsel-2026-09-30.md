# Kokonada — HX questions for counsel — 2026-09-30

Annex to `counsel-dossier-2026-09-29.md`, next to `eu-questions-for-counsel-2026-09-29.md`. Prepared by regulatory-researcher in its pre-build brief for Track HX wave 1 (2026-09-30); verbatim from that brief's section 8, "QUESTIONS FOR COUNSEL (ordered by what they unblock)". "The list" in these questions is `eu-questions-for-counsel-2026-09-29.md`; other section numbers and labels, such as §5.1, R2 and R3, refer to the brief, which is not in the repo. The brief prepares the questions and does not decide them.

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
