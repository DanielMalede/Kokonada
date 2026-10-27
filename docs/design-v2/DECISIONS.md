# Decisions — index

The DEC- entries of design v2. One file per entry: `docs/design-v2/decisions/DEC-<n>.md`. This index is never a gate input (`.claude/commands/page.md`, G2). Prepared 2026-09-29 for Stage 0 step L1, at repo HEAD `b9639c5`.

- **DECIDED, DEC-001 to DEC-038.** DEC-001 to DEC-020 are the rows of the decisions table in `docs/plans/DESIGN_V2_PLAN.md` (section "ההחלטות שלך"); DEC-021 to DEC-034 are its defaults not asked (section "ברירות מחדל שלא נשאלו"); all dated 2026-09-23. DEC-035 to DEC-038 are the owner's answers of 2026-09-29, given by selecting an option in the session; each entry quotes his selection, and the designer's V0 synthesis §7 (`Kokonada-private/design-v2/v0/synthesis-2026-09-29.md`, outside the repo) is the designer's record of it. The four mood names of plan line 41 are in DEC-013, the row that carries them.
- **Opened 2026-09-29, DEC-039 to DEC-096.** Every owner question in `cmp-compliance.md` §4, `reg-eu.md` §8, `reg-world-and-dossier.md` PART 4 and `qa-resilience.md` §5, and five of the sentinel's proposals. Where several sources ask the same question, one entry quotes each of them. The owner ruled DEC-052, DEC-055, DEC-062 and DEC-066 on 2026-09-29 (one ruling covers DEC-055 and DEC-066, and rules DEC-066 for P2 only), and DEC-040, DEC-041, DEC-043, DEC-051 and DEC-091 on 2026-09-30; the rest are OPEN.
- **Added after the architect's L1 review (round 1), DEC-097 and DEC-098.** DEC-097 is the HALT closure rule (the review's Fork C), ruled by the owner on 2026-09-29. DEC-098 is the dark re-sample from the V0 synthesis §7 item 5, asked on 2026-09-29 and OPEN.
- **From the architect's Track HX plan, DEC-099 to DEC-101** (its DT-4, DT-8 and DT-9), asked and ruled by the owner on 2026-09-30. DEC-101 is read together with DEC-097: it says what "verified on device" means for a fix with no device path.
- **From the HX pre-build briefs, DEC-102 to DEC-104** (`briefs-wave1.md`, a session scratch file: the HX-1 production count, HX-7(b) and the HX-6 label), asked and ruled by the owner on 2026-09-30. Each entry also quotes the orchestrator's record of the ruling from the same file.
- **From the Track HX builds and reviews, DEC-105 to DEC-114** (the HX plan, the review files, the handoff and the PR drafts, all session scratch files outside the repo), asked and ruled by the owner on 2026-09-30: free-text "focus", the Apple button, the chip door, production Sentry, the History relabel and replay hint, the withdrawal erasure, the Spotify link-back, the review check after round 2 and the Spotify notification question. DEC-106, DEC-107, DEC-109, DEC-110 and DEC-112 sign pin reversals that DEC-091 did not pre-approve. In DEC-108 the owner chose the option not marked recommended. DEC-114 rules the preparation only; whether to notify Spotify stays open. Where a PR draft or the handoff records a ruling, the entry quotes that record too.
- **From the HX-2 round-3 verification, DEC-115** (the review files, session scratch files outside the repo), asked on 2026-09-30 and ruled by the owner on 2026-10-01: the H1 production count. The entry also quotes PR #206's body, which applies the ruling.
- **From the HX-5 and BE-016 pre-build briefs, DEC-116 to DEC-119** (the compliance and regulatory briefs, the BE-016 plan and the designer's direction, all session scratch files outside the repo), asked and ruled by the owner on 2026-10-01: the privacy-policy host, the privacy link on the consent sheet, the BE-016 scope and two BE-016 pin reversals. DEC-116 rests on two question rounds. In DEC-116's first question and in DEC-117 the owner chose the option not marked recommended. DEC-119 signs pin reversals that DEC-091 did not pre-approve.
- **From the HX-5 round-1 regulatory review, DEC-120 and DEC-121** (`hx5-r1-regulatory.md`, a session scratch file outside the repo), asked and ruled by the owner on 2026-10-01: what a consent grant stores as its language, and when the build number rises. In DEC-121 the owner chose the option not marked recommended. The same review corrected DEC-117's dating of the readings it closes, recorded in that entry on 2026-10-01.
- **From the HX-3 brief, plan and build, DEC-122 to DEC-124** (`hx3-brief-compliance.md`, `HX3_PLAN_B.md` and the HX-3 mobile developer's build report, all session scratch files outside the repo), asked and ruled by the owner on 2026-10-01: YouTube sealed on the server in code, five HX-3 pin reversals, and the app's YouTube disconnect test. DEC-122 refines DEC-040 and DEC-043, and each of those entries points to it. DEC-123 and DEC-124 sign pin reversals that DEC-091 did not pre-approve; DEC-123's fifth counts only if the resilience-auditor calls the moved fixtures pins. DEC-124's signed text is quoted from the orchestrator's record, since the question refers to it as written above. The HX-3 round-1 reviews (`hx3-r1-compliance.md` and `hx3-r1-resilience-fc62215.md`, session scratch files outside the repo) changed the record on 2026-10-01, each change recorded in its entry: the compliance-auditor corrected DEC-122's notes, since hiding the row before the first iOS submission is not part of the ruling but an open owner decision (`ARCH-012`), and DEC-124's "built on" field; and the resilience-auditor called the moved fixtures fixtures, not pins, so DEC-123's fifth reverses nothing.
- **From the J1 plan, build and round-1 reviews, DEC-125 to DEC-127** (`J1_PLAN.md`, the J1 developer's build report and the round-1 compliance and regulatory reviews, all session scratch files outside the repo), asked and ruled by the owner on 2026-10-01 (DEC-125, three questions in two rounds) and 2026-10-02 (DEC-126 and DEC-127): J1's full scope, three of its pin reversals and the one script the production image ships; J2, a separate task, for the state-vector job; and a count recorded before the one-off clean, which then runs straight after the deploy. DEC-125 signs pin reversals that DEC-091 did not pre-approve. The read-only production snapshot of 2026-10-02T07:57Z then found no learning job and no job counter in the reward queue, so DEC-127's record is first used by the count after the deploy (TASKS `DAN-048`). Each entry also quotes the orchestrator's record of the round-1 reconciliation, where it has one.
- **From the J2 plans, briefs and reconciliation, DEC-128 and DEC-129** (`J2_PLAN.md`, `J2_PLAN_B.md`, the compliance and regulatory briefs and `j2-reconciliation.md`, all session scratch files outside the repo), asked and ruled by the owner on 2026-10-02 (Rounds 8 and 10 of session fd9fc638): J2's scope and product rulings, and its twelve pin reversals and the sweep switch. DEC-129 signs pin reversals that DEC-091 did not pre-approve. On 2026-10-04 its switch was replaced by an arming marker, and P10's widening and P13 to P16 were signed, by the orchestrator under DEC-142 with the agents' recorded consensus (`J2_DT13_revised.md`, FINAL DT-13, and `j2-P13-consent-order-decision.md`, session scratch files outside the repo). DEC-129 records that part under its own heading, and quotes each agreement on record, saying where only the orchestrator's record holds it.
- **From the later rounds of session fd9fc638, DEC-135 to DEC-149** (the V1 build plan, the designer's V1 directions and its addendum, the regulatory V1 copy check and the designer's amendment to it, and the DAN-015 dossier and its compliance check, all session scratch files outside the repo, and the sentinel's ledger, `WEAKNESSES_AND_FAILURES.md`), asked and ruled by the owner on 2026-10-02 (DEC-135 to DEC-141, Rounds 6, 7 and 9), 2026-10-03 (DEC-142 to DEC-144, Rounds 11 and 12) and 2026-10-04 (DEC-145 to DEC-149, Rounds 12 to 14): the V1 build plan, four V1 design forks and two V1 copy-check forks; the delegation to the orchestrator of the owner gates, and of merges, in-plan production actions and publishing the privacy policy; every agent that bears on the work put to work; the deny rules; the owner's four Round-13 actions; and the privacy policy's controller line, the tester countries and the minimum age. DEC-145 rests on one question in each of Rounds 12 and 13. In DEC-136 and DEC-149 the owner chose the option not marked recommended. DEC-142, DEC-143 and DEC-144 rest partly on the owner's own messages, quoted in full, and DEC-143's answer on merges is in his own words. For Rounds 11 to 14 the private excerpt records each question by its subject, not its full text. Round 5, a sequencing answer that started V1 alongside J2, is not a DEC (DEC-135 quotes it). Rounds 8 and 10 rule on J2, whose branch records them as DEC-128 and DEC-129 (the bullet above); DEC-130 to DEC-134 are reserved for the V1 branches.
- **From session 9ae174f7, the instruction-layer overhaul, DEC-155** (the owner's brief, pasted into the session with its decisions D1–D8, and the session's thirteen question rounds), decided and ruled by the owner on 2026-10-06: `CLAUDE.md` as the one binding source, the merge rule and its three owner-approval classes, the `security-auditor` and its terminal BLOCK, `AGENTS.md` for Codex, one session start, the Next up queue in `TASKS.md`, the sentinel's schedule and worktree, legal DEC- entries back to the owner, the privacy policy's publication and custodian's evidence on every deletion. Round 5 is partly in his own words; Round 9 corrects the premise of Round 3. Its primary record is `Kokonada-private/design-v2/rulings/owner-rulings-session-9ae174f7.md`. DEC-150 to DEC-154 stay reserved. The owner refined it on 2026-10-18 (`OPS-244`, #259): a session whose L check exits non-zero may go on, on his waiver under `CLAUDE.md` session start step 2; the entry quotes those answers, each with its question, from the session transcripts.
- **From the post-J2 privacy re-check, DEC-156** (`dan015-post-j2-regulatory-recheck.md` and the regulatory-researcher's DEC-113 verification of it, session scratch files outside the repo), decided by the orchestrator on 2026-10-06 under DEC-142 and DEC-143 and not put to the owner, then ratified by the owner on 2026-10-08 ("מאשר את DEC-156", `DAN-068`): the privacy page goes live only after DAN-050 records the sweep armed (branch (a)). The re-check prepared both branches and chose neither; the entry quotes what each agent put on record, and says that no compliance-auditor statement after the re-check is on record.
- **From session 9ae174f7, after Bedrack stopped working on the repository, DEC-185** (`OPS-196`, filed by #247), decided by the owner on 2026-10-18 by option selection: the two-partner machinery stays on main, dormant, while the partner is not working; the same day the owner kept him as a partner.
- **From the owner's message of 2026-10-25 that opened the Garmin Connect Developer Program access request, DEC-186 to DEC-189** (his own five decisions, not an option selection; `DAN-007`, `DAN-009`, `DAN-015`, `DAN-103`, `DAN-104`), decided by the owner on 2026-10-25, with three answers by option selection on 2026-10-27 in the session that reviewed #272 (the policy moves to the domain, no one but him has installed a build with the old address, and DEC-188 is only "free"): the domain `kokonada.com`, which supersedes DEC-116's address on his answer of 2026-10-27; the company name "Kokonada" with no legal entity (DEC-044 stays OPEN); a business model free for now (DEC-068 stays OPEN); and the landing page and the privacy policy, the policy page published only on his quoted approval (the landing page likewise by the scribe's reading, not his ruling).
- **Reserved, not yet written:** DEC-157 to DEC-164 are held by the reservation of the scribe branch `docs/scribe-2026-10-06`; DEC-165 to DEC-176 by the V1 B4 branch; DEC-177 to DEC-184 by the V1 Abyss session package of 2026-10-17.
- **The private primary record** of the rulings made by option selection is three verbatim excerpts outside the repo, each holding one session's question rounds, with their questions, their options and the answers: `Kokonada-private/design-v2/rulings/owner-rulings-session-3181c7f6.md`, `Kokonada-private/design-v2/rulings/owner-rulings-session-5c0b8fe9.md` and `Kokonada-private/design-v2/rulings/owner-rulings-session-fd9fc638.md`. The first holds the five rounds of 2026-09-23 (twenty questions) behind the plan's decisions table. When DEC-102 to DEC-104 were recorded it stopped at the round answered at 2026-09-29T21:35:39Z, so those entries quote the session transcript for their round, answered at 2026-09-29T22:06:50Z. It was completed on 2026-09-30 and now holds every round of that session through the one answered at 2026-09-30T13:32:01Z (DEC-105), DEC-108 to DEC-111 included. The second holds the rounds of the next session, behind DEC-106, DEC-107 and DEC-112 to DEC-125, and quotes DEC-105's round as well; DEC-125 rests on two of its rounds, asked at 2026-10-01T17:52:51Z and 19:26:03Z, and the second was appended to the file on 2026-10-02. The third, new on 2026-10-02, holds the rounds of session fd9fc638: DEC-126 and DEC-127, and the owner's go-aheads that are not DECs (the read-only production reads, the deferral of `DAN-046`'s P2, the read-only snapshot of the job queues, the temporary SSH key and the phone hotspot, and the clean of the old job payloads), each recorded in the TASKS row it concerns; it gives each round's date, not an answer timestamp. It was extended through 2026-10-04 and now also holds Rounds 5 to 14, behind DEC-135 to DEC-149 and J2's rulings. The timestamps are UTC, and the entries carry the date at UTC+3, so a round answered after 21:00 UTC is dated the next day.
- **Titles** are the scribe's English labels. The quoted text in each file is the record.
- **A ruling** is recorded only from the owner's own message (`.claude/commands/page.md`, owner gates). From 2026-10-03, a ruling may also be recorded from the orchestrator's decision under the owner's delegation (DEC-142), only with the agents' recorded consensus; such an entry cites DEC-142 and quotes each agent's agreement. From 2026-10-06 (DEC-155) that never applies to a DEC- entry that touches law, privacy, consent or counsel, which only the owner rules.

| DEC | Title | Status | Date | Sources | Registry IDs named |
|---|---|---|---|---|---|
| [DEC-001](decisions/DEC-001.md) | Reset scope: a new visual language | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:29` | — |
| [DEC-002](decisions/DEC-002.md) | Approval surface: live HTML boards | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:30` | — |
| [DEC-003](decisions/DEC-003.md) | Languages: full right-to-left readiness, later two or three languages | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:31` | — |
| [DEC-004](decisions/DEC-004.md) | The owner's involvement: direction and prototype | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:32` | — |
| [DEC-005](decisions/DEC-005.md) | Markets: worldwide | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:33` | — |
| [DEC-006](decisions/DEC-006.md) | Repository and fonts: a private repository and open fonts | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:34` | — |
| [DEC-007](decisions/DEC-007.md) | The old canvas: full deletion | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:35` | — |
| [DEC-008](decisions/DEC-008.md) | Urgent legal fix: now, in parallel (Track H) | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:36` | — |
| [DEC-009](decisions/DEC-009.md) | Display mode: follows the phone; both faces equal | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:37` | — |
| [DEC-010](decisions/DEC-010.md) | Navigation: three destinations | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:38` | — |
| [DEC-011](decisions/DEC-011.md) | The field: one Skia shader system | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:39` | — |
| [DEC-012](decisions/DEC-012.md) | Palette: distant OKLCH hues | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:40` | — |
| [DEC-013](decisions/DEC-013.md) | Feel: all four moods | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:41` | — |
| [DEC-014](decisions/DEC-014.md) | Fonts: a "voice" serif and a UI face | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:42` | — |
| [DEC-015](decisions/DEC-015.md) | Breath: regulated breathing | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:43` | — |
| [DEC-016](decisions/DEC-016.md) | Button colour: only from the user's choice | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:44` | — |
| [DEC-017](decisions/DEC-017.md) | Tools: a React Native toolkit | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:45` | — |
| [DEC-018](decisions/DEC-018.md) | Agent permissions: narrow them; the owner applies the change | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:46` | — |
| [DEC-019](decisions/DEC-019.md) | Worldwide law: extend the existing agent | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:47` | — |
| [DEC-020](decisions/DEC-020.md) | Test device: Play's pre-launch report only | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:48` | — |
| [DEC-021](decisions/DEC-021.md) | Default: the app speaks in the second person | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:52` | — |
| [DEC-022](decisions/DEC-022.md) | Default: physical and energetic state names, subject to counsel; "Pre-Panic" is removed | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:53` | — |
| [DEC-023](decisions/DEC-023.md) | Default: confidence as a word on screen, the number only in the receipt | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:54` | — |
| [DEC-024](decisions/DEC-024.md) | Default: a new brand mark derived from the plate, designed last | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:55` | — |
| [DEC-025](decisions/DEC-025.md) | Default: onboarding per account, not per device | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:56` | — |
| [DEC-026](decisions/DEC-026.md) | Default: email sign-in deferred; Google and Apple at launch | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:57` | — |
| [DEC-027](decisions/DEC-027.md) | Default: History re-tunes from the moment; no replay | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:58` | — |
| [DEC-028](decisions/DEC-028.md) | Default: no push notifications at launch; a purge path for stored FCM tokens | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:59` | — |
| [DEC-029](decisions/DEC-029.md) | Default: no earcons and no album-art animation | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:60` | — |
| [DEC-030](decisions/DEC-030.md) | Default: no mobile analytics kit; a static fallback and a declared server report | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:61` | — |
| [DEC-031](decisions/DEC-031.md) | Default: portrait lock on phones; layouts that fit large screens | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:62` | — |
| [DEC-032](decisions/DEC-032.md) | Default: the home screen reveals itself progressively | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:63` | — |
| [DEC-033](decisions/DEC-033.md) | Default: StyleSheet with our own tokens and primitives; Tamagui and Moti out; ADR-0017 replaces ADR-0009 | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:64` | — |
| [DEC-034](decisions/DEC-034.md) | Default: dark when the phone reports no display mode | DECIDED | 2026-09-23 | `docs/plans/DESIGN_V2_PLAN.md:65` | — |
| [DEC-035](decisions/DEC-035.md) | The plate dot: a bead with a small halo | DECIDED | 2026-09-29 | `Kokonada-private/design-v2/v0/synthesis-2026-09-29.md:206` (the owner's session answer is quoted in the entry) | — |
| [DEC-036](decisions/DEC-036.md) | The rim words: the axis ends | DECIDED | 2026-09-29 | `Kokonada-private/design-v2/v0/synthesis-2026-09-29.md:207` (the owner's session answer is quoted in the entry) | — |
| [DEC-037](decisions/DEC-037.md) | Pebble: kept for the warm look as a whole | DECIDED | 2026-09-29 | `Kokonada-private/design-v2/v0/synthesis-2026-09-29.md:208` (the owner's session answer is quoted in the entry) | — |
| [DEC-038](decisions/DEC-038.md) | Hue set B is out; set A is used everywhere | DECIDED | 2026-09-29 | `Kokonada-private/design-v2/v0/synthesis-2026-09-29.md:209` (the owner's session answer is quoted in the entry) | — |
| [DEC-039](decisions/DEC-039.md) | Is the Spotify-derived taste model "building profiles of users"? | OPEN | 2026-09-29 | cmp-compliance.md §4 item 1 | CMP-018 |
| [DEC-040](decisions/DEC-040.md) | Drop the YouTube → Spotify translation path, or ask Spotify | DECIDED (ruled 2026-09-30) | 2026-09-30 | cmp-compliance.md §4 item 2 | CMP-021 |
| [DEC-041](decisions/DEC-041.md) | The retention window for provider track data | DECIDED (ruled 2026-09-30) | 2026-09-30 | cmp-compliance.md §4 item 3 | CMP-024 |
| [DEC-042](decisions/DEC-042.md) | Is App Remote playback a Spotify "Streaming SDA"? | OPEN | 2026-09-29 | cmp-compliance.md §4 item 4 | CMP-033 |
| [DEC-043](decisions/DEC-043.md) | A domain and Google OAuth verification for youtube.readonly, or YouTube stays deferred | DECIDED (ruled 2026-09-30) | 2026-09-30 | cmp-compliance.md §4 item 5 | CMP-050 |
| [DEC-044](decisions/DEC-044.md) | Legal entity, controller and D-U-N-S number | OPEN | 2026-09-29 | cmp-compliance.md §4 item 6; reg-eu.md §8 D-03; reg-world-and-dossier.md PART 4 DEC-W01; sentinel-calendar.md C2 and proposed row | CMP-051, CMP-093, REG-024, REG-025, REG-201, REG-202, REG-249, REG-252, REG-254, REG-257 |
| [DEC-045](decisions/DEC-045.md) | Which Garmin agreement variant applies, and when to serve the 30-day notice | OPEN | 2026-09-29 | cmp-compliance.md §4 item 7 | CMP-052 |
| [DEC-046](decisions/DEC-046.md) | How to obtain the Garmin Connect tile | OPEN | 2026-09-29 | cmp-compliance.md §4 item 8 | CMP-060 |
| [DEC-047](decisions/DEC-047.md) | Garmin's written permission to use Health API data as a generation input | OPEN | 2026-09-29 | cmp-compliance.md §4 item 9 | CMP-063 |
| [DEC-048](decisions/DEC-048.md) | Adopt Garmin's §15.10 AI transparency statement in the privacy policy | OPEN | 2026-09-29 | cmp-compliance.md §4 item 10 | CMP-064 |
| [DEC-049](decisions/DEC-049.md) | The route through Play's 12-tester closed test given Spotify's 5-user cap | OPEN | 2026-09-29 | cmp-compliance.md §4 item 11 | CMP-092 |
| [DEC-050](decisions/DEC-050.md) | Minimum age, the age check and the Play target audience | OPEN | 2026-09-29 | cmp-compliance.md §4 item 12; reg-eu.md §8 D-06; reg-world-and-dossier.md PART 4 DEC-W04 | CMP-094, REG-042, REG-043, REG-203, REG-204, REG-224, REG-225, REG-240, REG-241, REG-263 |
| [DEC-051](decisions/DEC-051.md) | The Google button label in Hebrew and right-to-left | DECIDED (ruled 2026-09-30) | 2026-09-30 | cmp-compliance.md §4 item 13 | CMP-103 |
| [DEC-052](decisions/DEC-052.md) | May Bellefair replace F6's serif voice face? | DECIDED (ruled 2026-09-29) | 2026-09-29 | cmp-compliance.md §4 item 14 | CMP-125 |
| [DEC-053](decisions/DEC-053.md) | Translate Spotify's link-back labels, or keep English | OPEN | 2026-09-29 | cmp-compliance.md §4 item 15 | CMP-131 |
| [DEC-054](decisions/DEC-054.md) | Trademark clearance on "Kokonada" | OPEN | 2026-09-29 | cmp-compliance.md §4 item 16; sentinel-calendar.md C4 and proposed row | CMP-137 |
| [DEC-055](decisions/DEC-055.md) | Keep the Art. 50 notice on every inferred-state surface under every option | DECIDED (ruled 2026-09-29) | 2026-09-29 | reg-eu.md §8 D-01 | REG-005, REG-006, REG-007, REG-008, REG-009, REG-012 |
| [DEC-056](decisions/DEC-056.md) | Launch markets, the Play country list and launch languages | OPEN | 2026-09-29 | reg-eu.md §8 D-02; reg-world-and-dossier.md PART 4 DEC-W02; reg-world-and-dossier.md PART 4 DEC-W07; sentinel-calendar.md C3 and proposed row | REG-034, REG-042, REG-047, REG-204, REG-230, REG-231, REG-232, REG-233, REG-234, REG-235, REG-236, REG-237, REG-238, REG-239, REG-240, REG-241, REG-242, REG-243, REG-244, REG-245, REG-246, REG-247, REG-248, REG-250, REG-251, REG-252, REG-261 |
| [DEC-057](decisions/DEC-057.md) | Hosting regions, the sub-processor set and processor contracts | OPEN | 2026-09-29 | reg-eu.md §8 D-04; reg-eu.md §8 D-05; reg-world-and-dossier.md PART 4 DEC-W03 | REG-061, REG-062, REG-215, REG-217, REG-223, REG-233, REG-257 |
| [DEC-058](decisions/DEC-058.md) | The Pulse vocabulary | OPEN | 2026-09-29 | reg-eu.md §8 D-07 | REG-076, REG-081, REG-082, REG-083, REG-084 |
| [DEC-059](decisions/DEC-059.md) | Confidence display: a word on screen, the number only in the receipt | OPEN | 2026-09-29 | reg-eu.md §8 D-08 | REG-071 |
| [DEC-060](decisions/DEC-060.md) | Whether taxonomy names and explain lines render, and the rewording pattern | OPEN | 2026-09-29 | reg-eu.md §8 D-09 | REG-082, REG-083 |
| [DEC-061](decisions/DEC-061.md) | The LLM captions: ship them or not, and how they are marked | OPEN | 2026-09-29 | reg-eu.md §8 D-10 | REG-013, REG-062 |
| [DEC-062](decisions/DEC-062.md) | The "Working" and "Focus" chips | DECIDED (ruled 2026-09-29) | 2026-09-29 | reg-eu.md §8 D-11 | REG-015 |
| [DEC-063](decisions/DEC-063.md) | No employer, team or education channel, and no marketing to them | OPEN | 2026-09-29 | reg-eu.md §8 D-12 | REG-014 |
| [DEC-064](decisions/DEC-064.md) | No push at launch, the stored FCM tokens, and no message triggered by an inferred state | OPEN | 2026-09-29 | reg-eu.md §8 D-13; reg-world-and-dossier.md PART 4 DEC-W13 | REG-017, REG-217 |
| [DEC-065](decisions/DEC-065.md) | The shader-failure report: whether it is sent and what it carries | OPEN | 2026-09-29 | reg-eu.md §8 D-14 | REG-066 |
| [DEC-066](decisions/DEC-066.md) | A consent-step slot before the first tap on P2 and P10 | DECIDED for P2 (ruled 2026-09-29); P10 not ruled | 2026-09-29 | reg-eu.md §8 D-15 | REG-031 |
| [DEC-067](decisions/DEC-067.md) | P9 export contents and file format | OPEN | 2026-09-29 | reg-eu.md §8 D-16 | REG-051, REG-052 |
| [DEC-068](decisions/DEC-068.md) | No in-app purchases: the free-forever confirmation | OPEN | 2026-09-29 | reg-eu.md §8 D-17; reg-world-and-dossier.md PART 4 DEC-W10 | REG-072, REG-087, REG-237, REG-261, REG-262 |
| [DEC-069](decisions/DEC-069.md) | An accessibility statement on P14 even where the law does not require one | OPEN | 2026-09-29 | reg-eu.md §8 D-18; reg-world-and-dossier.md PART 4 DEC-W09 | REG-088, REG-212, REG-229, REG-261 |
| [DEC-070](decisions/DEC-070.md) | AI-literacy measures, and where they are recorded | OPEN | 2026-09-29 | reg-eu.md §8 D-19 | REG-023 |
| [DEC-071](decisions/DEC-071.md) | Whether to prepare a DPIA before counsel answers | OPEN | 2026-09-29 | reg-eu.md §8 D-20 | REG-060 |
| [DEC-072](decisions/DEC-072.md) | The drift flags are never shown | OPEN | 2026-09-29 | reg-eu.md §8 D-21 | REG-077 |
| [DEC-073](decisions/DEC-073.md) | The step count of the withdrawal flow | OPEN | 2026-09-29 | reg-eu.md §8 D-22 | REG-038 |
| [DEC-074](decisions/DEC-074.md) | The consent button fill | OPEN | 2026-09-29 | reg-eu.md §8 D-23 | REG-068 |
| [DEC-075](decisions/DEC-075.md) | The display name: "KokonadaHealth" or "Kokonada" | OPEN | 2026-09-29 | reg-world-and-dossier.md PART 4 DEC-W05 | REG-228 |
| [DEC-076](decisions/DEC-076.md) | The consumer health data policy page and homepage | OPEN | 2026-09-29 | reg-world-and-dossier.md PART 4 DEC-W06 | REG-232 |
| [DEC-077](decisions/DEC-077.md) | The breach-response owner and runbook | OPEN | 2026-09-29 | reg-world-and-dossier.md PART 4 DEC-W08 | REG-222, REG-256 |
| [DEC-078](decisions/DEC-078.md) | The scope of counsel's engagement | OPEN | 2026-09-29 | reg-world-and-dossier.md PART 4 DEC-W11 | — |
| [DEC-079](decisions/DEC-079.md) | Who owns the DPIA and the Israeli database definition document | OPEN | 2026-09-29 | reg-world-and-dossier.md PART 4 DEC-W12 | REG-205, REG-256 |
| [DEC-080](decisions/DEC-080.md) | ADR-0005 against the pinned raw vitals | OPEN | 2026-09-29 | qa-resilience.md §5 D1 | QA-095 |
| [DEC-081](decisions/DEC-081.md) | The v2 never-red definition | OPEN | 2026-09-29 | qa-resilience.md §5 D2 | QA-063, QA-065 |
| [DEC-082](decisions/DEC-082.md) | Frame-budget details | OPEN | 2026-09-29 | qa-resilience.md §5 D3 | QA-029, QA-030 |
| [DEC-083](decisions/DEC-083.md) | Leak-loop thresholds | OPEN | 2026-09-29 | qa-resilience.md §5 D4 | QA-032 |
| [DEC-084](decisions/DEC-084.md) | The tier tables | OPEN | 2026-09-29 | qa-resilience.md §5 D5 | QA-012, QA-036, QA-073 |
| [DEC-085](decisions/DEC-085.md) | Who judges TalkBack at G12 | OPEN | 2026-09-29 | qa-resilience.md §5 D6 | QA-033 |
| [DEC-086](decisions/DEC-086.md) | The contrast sampling statistic | OPEN | 2026-09-29 | qa-resilience.md §5 D7 | QA-026 |
| [DEC-087](decisions/DEC-087.md) | State thresholds | OPEN | 2026-09-29 | qa-resilience.md §5 D8 | QA-005, QA-009, QA-015, QA-016 |
| [DEC-088](decisions/DEC-088.md) | The v1 module set for the import ban and the importer ratchet | OPEN | 2026-09-29 | qa-resilience.md §5 D9 | QA-053, QA-054 |
| [DEC-089](decisions/DEC-089.md) | The consent transition window | OPEN | 2026-09-29 | qa-resilience.md §5 D10 | QA-140 |
| [DEC-090](decisions/DEC-090.md) | Where P12's 1000 ms budget ends | OPEN | 2026-09-29 | qa-resilience.md §5 D11 | QA-160 |
| [DEC-091](decisions/DEC-091.md) | Who signs a RETIRE entry | DECIDED (ruled 2026-09-30) | 2026-09-30 | qa-resilience.md §5 D12 | QA-041, QA-118 |
| [DEC-092](decisions/DEC-092.md) | The Spotify "no Premium" and "another device active" states | OPEN | 2026-09-29 | qa-resilience.md §5 D13 | QA-123, QA-124 |
| [DEC-093](decisions/DEC-093.md) | Required status checks on main | OPEN | 2026-09-29 | qa-resilience.md §5 D14 | QA-074 |
| [DEC-094](decisions/DEC-094.md) | Touch-target exemptions | OPEN | 2026-09-29 | qa-resilience.md §5 D15 | QA-028 |
| [DEC-095](decisions/DEC-095.md) | The React Native version at T1 | OPEN | 2026-09-29 | sentinel-calendar.md B2 and proposed row | — |
| [DEC-096](decisions/DEC-096.md) | The owner's Spotify Premium renewal date | OPEN | 2026-09-29 | sentinel-calendar.md A4, Unverified 8 and proposed row | — |
| [DEC-097](decisions/DEC-097.md) | HALT closure: a fix lane now, and a HALT closes on main | DECIDED (ruled 2026-09-29) | 2026-09-29 | architect-review-r1.md §3 Fork C | CMP-008, CMP-021, CMP-022, CMP-023, CMP-026, CMP-043, CMP-045, CMP-046, CMP-066, CMP-081, CMP-086 |
| [DEC-098](decisions/DEC-098.md) | The dark re-sample: F1, D2 and B8 re-voted in the board's dark mode | OPEN | 2026-09-29 | Kokonada-private/design-v2/v0/synthesis-2026-09-29.md §5 question 5 and §7 item 5 | — |
| [DEC-099](decisions/DEC-099.md) | Up Next until P3, whose Spotify rows carry no link to each track (DT-4) | DECIDED (ruled 2026-09-30) | 2026-09-30 | HX_PLAN.md DT-4 | — |
| [DEC-100](decisions/DEC-100.md) | The Spotify disconnect in the current app (DT-8) | DECIDED (ruled 2026-09-30) | 2026-09-30 | HX_PLAN.md DT-8 | — |
| [DEC-101](decisions/DEC-101.md) | What 'verified on device' means for a fix with no device path (DT-9) | DECIDED (ruled 2026-09-30) | 2026-09-30 | HX_PLAN.md DT-9 | — |
| [DEC-102](decisions/DEC-102.md) | When the HX-1 production survivor count runs (HX-1, A8) | DECIDED (ruled 2026-09-30) | 2026-09-30 | briefs-wave1.md HX-1 A8 | — |
| [DEC-103](decisions/DEC-103.md) | Work and study words in free text, and the retired chip keys old builds still send (HX-7(b)) | DECIDED (ruled 2026-09-30) | 2026-09-30 | briefs-wave1.md HX-7 7b | — |
| [DEC-104](decisions/DEC-104.md) | The Google button's accessible name: the words drawn on the official asset (HX-6, M2) | DECIDED (ruled 2026-09-30) | 2026-09-30 | briefs-wave1.md HX-6 M2 | — |
| [DEC-105](decisions/DEC-105.md) | Free-text "focus" derives no activity (HX-7) | DECIDED (ruled 2026-09-30) | 2026-09-30 | HX_PLAN.md §1 HX-7, Also; hx78-review-designer.md HX-7 regulatory, round 1 | — |
| [DEC-106](decisions/DEC-106.md) | Apple's sign-in button on the light face is White with outline (HX-6) | DECIDED (ruled 2026-09-30) | 2026-09-30 | HANDOFF.md §9, HX-6 | — |
| [DEC-107](decisions/DEC-107.md) | The emotion_update door admits only the six chips the app offers (HX-7) | DECIDED (ruled 2026-09-30) | 2026-09-30 | HANDOFF.md §9, HX-7 | — |
| [DEC-108](decisions/DEC-108.md) | Production Sentry stays as it is until the scrub fix merges | DECIDED (ruled 2026-09-30) | 2026-09-30 | TASKS.md BE-020 (update 2026-09-30); pr-sentry.md | — |
| [DEC-109](decisions/DEC-109.md) | The server relabels old "Working" rows in every app version (HX-7) | DECIDED (ruled 2026-09-30) | 2026-09-30 | briefs-wave1.md HX-7 7c | — |
| [DEC-110](decisions/DEC-110.md) | The dead History replay hint is removed (HX-7) | DECIDED (ruled 2026-09-30) | 2026-09-30 | briefs-wave1.md HX-7 SHOULD | — |
| [DEC-111](decisions/DEC-111.md) | Withdrawal also erases each session's heart-rate snapshot and the values derived from it (BE-016) | DECIDED (ruled 2026-09-30) | 2026-09-30 | hx2-review-reg-compliance.md For TASKS (Regulatory) | — |
| [DEC-112](decisions/DEC-112.md) | GET SPOTIFY FREE opens the item's page, not the download page (HX-4) | DECIDED (ruled 2026-09-30) | 2026-09-30 | hx4-r2-compliance.md B2 | — |
| [DEC-113](decisions/DEC-113.md) | After round 2, a short verification check by each reviewer that required a blocking fix | DECIDED (ruled 2026-09-30) | 2026-09-30 | HANDOFF.md §2 Review protocol | — |
| [DEC-114](decisions/DEC-114.md) | Spotify Developer Terms Appendix A §4.e: the notification question is prepared for counsel | DECIDED for the preparation (ruled 2026-09-30); whether to notify is not ruled | 2026-09-30 | hx2-r2-compliance.md NF-6 | — |
| [DEC-115](decisions/DEC-115.md) | The H1 refresh race gets its own production count, a baseline before merge and a second reading after E2 (HX-2) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx2-r3-regulatory.md F1 and NEW-FINDING; hx2-r3-compliance.md Handback 3 | — |
| [DEC-116](decisions/DEC-116.md) | The privacy policy lives at `https://kokonada.github.io/privacy/`, under a free GitHub organization named `kokonada` (HX-5, DAN-015) (the address superseded by DEC-186: the domain 2026-10-25, the move confirmed by the owner 2026-10-27) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx5-brief-compliance.md OD-1 and OD-2 | — |
| [DEC-117](decisions/DEC-117.md) | The privacy link also goes on the consent sheet in HX-5, with each grant's build and language recorded (O2) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx5-brief-regulatory.md §5 Table 1 | — |
| [DEC-118](decisions/DEC-118.md) | BE-016's protected scope: valence and any activity the watch may have detected go too, old sessions included; the free text and the tracks keep their clocks | DECIDED (ruled 2026-10-01) | 2026-10-01 | BE016_PLAN.md §8 G0; be016-brief-regulatory.md §10 | — |
| [DEC-119](decisions/DEC-119.md) | Two BE-016 pin reversals outside DEC-091 are signed: the nightly job's log line, and "A moment" for a session with no title | DECIDED (ruled 2026-10-01) | 2026-10-01 | BE016_PLAN.md §6; designer-direction-be016-hx5.md A2 | — |
| [DEC-120](decisions/DEC-120.md) | A consent grant stores the device's language only, without the region, and names it as the device's setting, not the consent screen's language (MB-062, HX-5) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx5-r1-regulatory.md R1 and OQ2 | — |
| [DEC-121](decisions/DEC-121.md) | The build number rises once, at the build that turns on the consent sheet's privacy link, above every earlier build (HX-5) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx5-r1-regulatory.md §2, R2 and OQ3 | — |
| [DEC-122](decisions/DEC-122.md) | YouTube is sealed on the server in code, with no switch that can turn it on, and its code is deleted later (HX-3) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx3-brief-compliance.md answer 3 and §5, OD-1 | — |
| [DEC-123](decisions/DEC-123.md) | Five HX-3 pin reversals outside DEC-091 are signed: no YouTube artist name to the LLM, the sealed YouTube disconnect, the new YouTube reason line, and the translate fixtures if they are pins | DECIDED (ruled 2026-10-01) | 2026-10-01 | HX3_PLAN_B.md §4 Signatures | — |
| [DEC-124](decisions/DEC-124.md) | The app's YouTube disconnect test stops expecting a library rebuild, and the result type drops it (HX-3) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx3m-developer-report.md NEW-FINDING (P3) | — |
| [DEC-125](decisions/DEC-125.md) | J1 builds the plan's full scope, three of its pin reversals are signed, and only `scripts/rewardJobs.js` ships in the production image (BE-074) | DECIDED (ruled 2026-10-01) | 2026-10-01 | J1_PLAN.md §4 T0 and §5; j1-developer-report.md §7 commands | — |
| [DEC-126](decisions/DEC-126.md) | The state-vector job is fixed in J2, a separate task after J1, and J1 is not widened (BE-087, BE-084) | DECIDED (ruled 2026-10-02) | 2026-10-02 | j1-r1-compliance.md HALT-B and NEW-FINDING (BE-087) | — |
| [DEC-127](decisions/DEC-127.md) | Before the one-off clean of the learning jobs, the count records the jobs per day and those of deleted or withdrawn accounts, counts only; then the clean runs straight after the deploy, without waiting for counsel (BE-074) | DECIDED (ruled 2026-10-02) | 2026-10-02 | j1-r1-regulatory.md §5 J1-Q2; §6 NEW-FINDING (update DAN-048) | — |
| [DEC-128](decisions/DEC-128.md) | J2 also takes the nightly job and a daily sweep of deleted accounts' data (BE-094); the state job runs only for an account with a current health grant (A1); account deletion records a withdrawal first (M1′); and production's leftovers are recorded before the merge and cleaned after the deploy, on the owner's word (BE-087) | DECIDED (ruled 2026-10-02) | 2026-10-02 | J2_PLAN.md §2 DT-4, DT-6, DT-11 and DT-12 | — |
| [DEC-129](decisions/DEC-129.md) | J2's twelve pin reversals, P1 to P12, are signed, and the sweep's first run waits behind a switch set before the merge; on 2026-10-04 the switch gave way to an arming marker that only the clean can write, and P10's widening and P13 to P16 were signed by agent consensus under DEC-142 (BE-087, BE-084, BE-094) | DECIDED (ruled 2026-10-02); the switch replaced, and five pin texts signed, under DEC-142 on 2026-10-04 | 2026-10-02 | J2_PLAN_B.md §5 and §2 DT-13; j2-reconciliation.md P10–P12 | — |
| [DEC-135](decisions/DEC-135.md) | The V1 build plan is approved as written: the Design Lab merges first as its own app, "Kokonada Lab", which never reaches the store, and the tokens, field, fonts, session screen and boards merge only after a direction is chosen (ARCH-006) | DECIDED (ruled 2026-10-02) | 2026-10-02 | V1_BUILD_PLAN.md §6 P0-1; §11 item 1 | — |
| [DEC-136](decisions/DEC-136.md) | Direction C (Basin) takes a warm ground like B's Linen, not the cool sage-green N5, so B and C share a ground and differ as a raised dish against a recessed basin (V1) | DECIDED (ruled 2026-10-02) | 2026-10-02 | V1_DIRECTIONS_DESIGNER.md §8 owner fork 1 | — |
| [DEC-137](decisions/DEC-137.md) | On the session screen the navigation bar is present from the first frame, not only after the first point on the plate (DEC-032, V1) | DECIDED (ruled 2026-10-02) | 2026-10-02 | V1_DIRECTIONS_DESIGNER.md §8 owner fork 3 | — |
| [DEC-138](decisions/DEC-138.md) | Direction B's voice face is Bellefair, as in A and C, not V0's Frank Ruhl Libre 500 (DEC-052, V1) | DECIDED (ruled 2026-10-02) | 2026-10-02 | V1_DIRECTIONS_DESIGNER.md §8 owner fork 4 | — |
| [DEC-139](decisions/DEC-139.md) | The voice line describes a placement in the user's own axis words, and adds no new vocabulary (DEC-036, V1) | DECIDED (ruled 2026-10-02) | 2026-10-02 | V1_DIRECTIONS_DESIGNER.md §8 owner fork 5 | — |
| [DEC-140](decisions/DEC-140.md) | On the session screen the AI notice line is pinned above the scroll region, so at large font sizes it never scrolls away while an inferred result shows (REG-008, V1 copy check C1) | DECIDED (ruled 2026-10-02) | 2026-10-02 | v1-regulatory-copy-check.md §3c C1 | REG-008 |
| [DEC-141](decisions/DEC-141.md) | The field's response to an inferred state is made switchable and disclosed: a "Living background" switch with an explanation on the You screen, and the explanation's wording goes to counsel (REG-016, V1 copy check C5) | DECIDED (ruled 2026-10-02) | 2026-10-02 | v1-regulatory-copy-check.md §3c C5 | REG-016 |
| [DEC-142](decisions/DEC-142.md) | Every former owner gate is decided by the orchestrator once the relevant agents agree, and is recorded as a DEC with its reasons and the agents' verdicts, through to the end of the whole plan; the owner may reverse any of them (the orchestrator's reading of Round 11) (refined by DEC-155) | DECIDED (ruled 2026-10-03) | 2026-10-03 | the owner's message and Round 11 of session fd9fc638 | — |
| [DEC-143](decisions/DEC-143.md) | The orchestrator merges, and a post-merge agent checks CI on main after every merge; it runs production actions only where an approved plan writes them; it publishes the privacy policy after the reviewers check every sentence against the code; and steps that need the hotspot or the phone wait, with a push notification and a chat line to the owner (Round 11) (refined by DEC-155) | DECIDED (ruled 2026-10-03) | 2026-10-03 | Round 11 of session fd9fc638 | — |
| [DEC-144](decisions/DEC-144.md) | Every agent in `.claude/agents/` that bears on the work is put to work; only this session works on the repository; and an urgent question may reach the owner by phone (Round 12; the orchestrator reads it as resuming the custodian's paused cleanup plan after a fresh survey) | DECIDED (ruled 2026-10-03) | 2026-10-03 | Round 12 of session fd9fc638 | — |
| [DEC-145](decisions/DEC-145.md) | Merging stays allowed, and destructive git commands are hard-denied: the orchestrator adds deny rules only, without widening any permission or touching the owner's own edit, and the owner approves the change (Rounds 12 and 13) | DECIDED (ruled 2026-10-04) | 2026-10-04 | Round 12 and Round 13 of session fd9fc638; WEAKNESSES_AND_FAILURES.md KW-050 | — |
| [DEC-146](decisions/DEC-146.md) | Four owner actions on the sentinel's autonomy findings: Wait for CI on the backend service, with no deploying merge until it is confirmed; `DISCOVERY_CAPTION_LLM` set to false in production; a backup of the release keystore; and a read-only Atlas user whose password never reaches the orchestrator (Round 13; KW-050, KW-062, KW-034, KW-059) | DECIDED (ruled 2026-10-04) | 2026-10-04 | WEAKNESSES_AND_FAILURES.md KW-050, KW-062, KW-034, KW-059 | — |
| [DEC-147](decisions/DEC-147.md) | The privacy policy names the owner, as a natural person in Israel, as the interim controller, with no postal address, and gives a dedicated privacy mailbox that the owner opens and supplies; the page waits for both (DEC-044 interim; DAN-015, Round 14) | DECIDED (ruled 2026-10-04) | 2026-10-04 | dan015-regulatory-dossier.md D2 O1 and O2 | — |
| [DEC-148](decisions/DEC-148.md) | At the tester stage the app is distributed in Israel only; the privacy policy is still written to meet EU requirements, and it widens when more countries open (DEC-056 for the tester stage; Round 14) | DECIDED (ruled 2026-10-04) | 2026-10-04 | dan015-regulatory-dossier.md D2 O4 | — |
| [DEC-149](decisions/DEC-149.md) | The minimum age is 16 and over, to be confirmed by counsel; the owner chose this over the recommended 18 (DEC-050; Round 14) | DECIDED (ruled 2026-10-04) | 2026-10-04 | dan015-regulatory-dossier.md D2 O11 | — |
| [DEC-155](decisions/DEC-155.md) | `CLAUDE.md` is the one binding source; a session merges on its jurisdiction approvals and a GREEN merge-guard, except three classes that wait for the owner; a `security-auditor`; `AGENTS.md` for Codex; one session start; a Next up queue; sentinel scheduled and manual; legal DEC- entries back to the owner (brief D1–D8; Rounds 1–13) (refined 2026-10-18 by the owner's L-check waiver, OPS-244) | DECIDED (ruled 2026-10-06) | 2026-10-06 | the owner's brief; owner-rulings-session-9ae174f7.md Rounds 1–13 | — |
| [DEC-156](decisions/DEC-156.md) | The privacy page is published only after DAN-050 records the sweep armed and one armed `[sessionTrim]` line that meets its closure rule, with no interim version (branch (a)); the declarations' interim amendment D-3 is not needed (DAN-015) | DECIDED (2026-10-06, by the orchestrator under DEC-142; ratified by the owner on 2026-10-08) | 2026-10-06 | dan015-post-j2-regulatory-recheck.md §2 and §4 | — |
| [DEC-185](decisions/DEC-185.md) | Bedrack has stopped working on the repository; the two-partner machinery stays on main, dormant, while the partner is not working | DECIDED | 2026-10-18 | TASKS.md OPS-196; the closing comments of #246 and #238 | — |
| [DEC-186](decisions/DEC-186.md) | The owner buys the domain `kokonada.com` at Cloudflare Registrar, and it replaces DEC-116's policy address: the privacy policy moves to `https://kokonada.com/privacy/`; the purchase is his Pause & Guide, with no DNS before his DONE (DAN-007, DAN-104) | DECIDED | 2026-10-25 | the owner's message of 2026-10-25, decision 1; his answers of 2026-10-27 by option selection (the move, the builds) | — |
| [DEC-187](decisions/DEC-187.md) | For the Garmin Connect Developer Program application the company name is "Kokonada": one person builds everything, and there is no legal entity for now (DEC-044 interim; DEC-044 stays OPEN; DAN-103) | DECIDED | 2026-10-25 | the owner's message of 2026-10-25, decision 2 | — |
| [DEC-188](decisions/DEC-188.md) | The business model is completely free for now (the Garmin application's answer; DEC-068 stays OPEN; DAN-103) | DECIDED | 2026-10-25 | the owner's message of 2026-10-25, decision 3; his answer of 2026-10-27 by option selection (only free) | — |
| [DEC-189](decisions/DEC-189.md) | A quick static landing page, built by the orchestrator, explains the app's idea; the privacy policy is prepared with the owner under DAN-015, and the policy page is published only on his approval quoted word for word (DAN-104) | DECIDED | 2026-10-25 | the owner's message of 2026-10-25, decisions 4 and 5 | — |

## Source numbers and their DEC- entries

The source files number their owner questions themselves. The registry bodies and TASKS use the DEC- ID; the counsel dossier keeps its own `DEC-Wnn` numbers.

| Source | Its number | DEC |
|---|---|---|
| cmp-compliance.md §4 | item 1 | DEC-039 |
| cmp-compliance.md §4 | item 2 | DEC-040 |
| cmp-compliance.md §4 | item 3 | DEC-041 |
| cmp-compliance.md §4 | item 4 | DEC-042 |
| cmp-compliance.md §4 | item 5 | DEC-043 |
| cmp-compliance.md §4 | item 6 | DEC-044 |
| reg-eu.md §8 | D-03 (cited as `DEC D-03`) | DEC-044 |
| reg-world-and-dossier.md PART 4 | `DEC-W01` | DEC-044 |
| sentinel-calendar.md | C2 and proposed row | DEC-044 |
| cmp-compliance.md §4 | item 7 | DEC-045 |
| cmp-compliance.md §4 | item 8 | DEC-046 |
| cmp-compliance.md §4 | item 9 | DEC-047 |
| cmp-compliance.md §4 | item 10 | DEC-048 |
| cmp-compliance.md §4 | item 11 | DEC-049 |
| cmp-compliance.md §4 | item 12 | DEC-050 |
| reg-eu.md §8 | D-06 (cited as `DEC D-06`) | DEC-050 |
| reg-world-and-dossier.md PART 4 | `DEC-W04` | DEC-050 |
| cmp-compliance.md §4 | item 13 | DEC-051 |
| cmp-compliance.md §4 | item 14 | DEC-052 |
| cmp-compliance.md §4 | item 15 | DEC-053 |
| cmp-compliance.md §4 | item 16 | DEC-054 |
| sentinel-calendar.md | C4 and proposed row | DEC-054 |
| reg-eu.md §8 | D-01 (cited as `DEC D-01`) | DEC-055 |
| reg-eu.md §8 | D-02 (cited as `DEC D-02`) | DEC-056 |
| reg-world-and-dossier.md PART 4 | `DEC-W02` | DEC-056 |
| reg-world-and-dossier.md PART 4 | `DEC-W07` | DEC-056 |
| sentinel-calendar.md | C3 and proposed row | DEC-056 |
| reg-eu.md §8 | D-04 (cited as `DEC D-04`) | DEC-057 |
| reg-eu.md §8 | D-05 (cited as `DEC D-05`) | DEC-057 |
| reg-world-and-dossier.md PART 4 | `DEC-W03` | DEC-057 |
| reg-eu.md §8 | D-07 (cited as `DEC D-07`) | DEC-058 |
| reg-eu.md §8 | D-08 (cited as `DEC D-08`) | DEC-059 |
| reg-eu.md §8 | D-09 (cited as `DEC D-09`) | DEC-060 |
| reg-eu.md §8 | D-10 (cited as `DEC D-10`) | DEC-061 |
| reg-eu.md §8 | D-11 (cited as `DEC D-11`) | DEC-062 |
| reg-eu.md §8 | D-12 (cited as `DEC D-12`) | DEC-063 |
| reg-eu.md §8 | D-13 (cited as `DEC D-13`) | DEC-064 |
| reg-world-and-dossier.md PART 4 | `DEC-W13` | DEC-064 |
| reg-eu.md §8 | D-14 (cited as `DEC D-14`) | DEC-065 |
| reg-eu.md §8 | D-15 (cited as `DEC D-15`) | DEC-066 |
| reg-eu.md §8 | D-16 (cited as `DEC D-16`) | DEC-067 |
| reg-eu.md §8 | D-17 (cited as `DEC D-17`) | DEC-068 |
| reg-world-and-dossier.md PART 4 | `DEC-W10` | DEC-068 |
| reg-eu.md §8 | D-18 (cited as `DEC D-18`) | DEC-069 |
| reg-world-and-dossier.md PART 4 | `DEC-W09` | DEC-069 |
| reg-eu.md §8 | D-19 (cited as `DEC D-19`) | DEC-070 |
| reg-eu.md §8 | D-20 (cited as `DEC D-20`) | DEC-071 |
| reg-eu.md §8 | D-21 (cited as `DEC D-21`) | DEC-072 |
| reg-eu.md §8 | D-22 (cited as `DEC D-22`) | DEC-073 |
| reg-eu.md §8 | D-23 (cited as `DEC D-23`) | DEC-074 |
| reg-world-and-dossier.md PART 4 | `DEC-W05` | DEC-075 |
| reg-world-and-dossier.md PART 4 | `DEC-W06` | DEC-076 |
| reg-world-and-dossier.md PART 4 | `DEC-W08` | DEC-077 |
| reg-world-and-dossier.md PART 4 | `DEC-W11` | DEC-078 |
| reg-world-and-dossier.md PART 4 | `DEC-W12` | DEC-079 |
| qa-resilience.md §5 | D1 (cited as `DEC:D1`) | DEC-080 |
| qa-resilience.md §5 | D2 (cited as `DEC:D2`) | DEC-081 |
| qa-resilience.md §5 | D3 (cited as `DEC:D3`) | DEC-082 |
| qa-resilience.md §5 | D4 (cited as `DEC:D4`) | DEC-083 |
| qa-resilience.md §5 | D5 (cited as `DEC:D5`) | DEC-084 |
| qa-resilience.md §5 | D6 (cited as `DEC:D6`) | DEC-085 |
| qa-resilience.md §5 | D7 (cited as `DEC:D7`) | DEC-086 |
| qa-resilience.md §5 | D8 (cited as `DEC:D8`) | DEC-087 |
| qa-resilience.md §5 | D9 (cited as `DEC:D9`) | DEC-088 |
| qa-resilience.md §5 | D10 (cited as `DEC:D10`) | DEC-089 |
| qa-resilience.md §5 | D11 (cited as `DEC:D11`) | DEC-090 |
| qa-resilience.md §5 | D12 (cited as `DEC:D12`) | DEC-091 |
| qa-resilience.md §5 | D13 (cited as `DEC:D13`) | DEC-092 |
| qa-resilience.md §5 | D14 (cited as `DEC:D14`) | DEC-093 |
| qa-resilience.md §5 | D15 (cited as `DEC:D15`) | DEC-094 |
| sentinel-calendar.md | B2 and proposed row | DEC-095 |
| sentinel-calendar.md | A4, Unverified 8 and proposed row | DEC-096 |
| architect-review-r1.md §3 | Fork C | DEC-097 |
| Kokonada-private/design-v2/v0/synthesis-2026-09-29.md | §5 question 5 and §7 item 5 | DEC-098 |
| HX_PLAN.md | DT-4 | DEC-099 |
| HX_PLAN.md | DT-8 | DEC-100 |
| HX_PLAN.md | DT-9 | DEC-101 |
| briefs-wave1.md | HX-1 A8 | DEC-102 |
| briefs-wave1.md | HX-7 7b | DEC-103 |
| briefs-wave1.md | HX-6 M2 | DEC-104 |
| HX_PLAN.md | §1 HX-7, Also | DEC-105 |
| hx78-review-designer.md | HX-7 regulatory, round 1, required edit 1 | DEC-105 |
| HANDOFF.md | §9, HX-6 (owner signature needed) | DEC-106 |
| HANDOFF.md | §9, HX-7 (owner signature needed) | DEC-107 |
| hx2-review-reg-compliance.md | For TASKS, Regulatory: the consent-copy conflict | DEC-111 |
| hx4-r2-compliance.md | B2 | DEC-112 |
| hx2-r2-compliance.md | NF-6 | DEC-114 |
| hx5-brief-compliance.md | OD-1 and OD-2 | DEC-116 |
| hx5-brief-regulatory.md §5 | Table 1, option O2 | DEC-117 |
| BE016_PLAN.md §8 | G0: DT-1b, DT-1c, DT-1e and "such sessions" | DEC-118 |
| be016-brief-regulatory.md §10 | DT-1a, DT-1b, DT-1b′, DT-1c, DT-1e, DT-1f and "Such sessions" | DEC-118 |
| BE016_PLAN.md §6 | Pin reversals (`sessionTrim.worker.test.js:281`) | DEC-119 |
| designer-direction-be016-hx5.md | Part 1, A2 (`sessionLabels.test.js:40`) | DEC-119 |
| hx5-r1-regulatory.md | OQ2 | DEC-120 |
| hx5-r1-regulatory.md | OQ3 | DEC-121 |
| hx3-brief-compliance.md §5 | OD-1 | DEC-122 |
| HX3_PLAN_B.md §4 | Signatures, items 1–5 | DEC-123 |
| hx3m-developer-report.md | NEW-FINDING (P3, needs an owner signature) | DEC-124 |
| J1_PLAN.md §4 and §5 | T0, "Sign the pin reversals in §5 as DEC-125"; §5 items 1–3 | DEC-125 |
| j1-developer-report.md | §7 commands, Blocker; NEW-FINDING (P1, OPS; blocks T10 as written) | DEC-125 |
| j1-r1-compliance.md | HALT-B; NEW-FINDING (BE-087, P1) | DEC-126 |
| j1-r1-regulatory.md | §5 J1-Q2; §6 NEW-FINDING (update DAN-048, P1) | DEC-127 |
| J2_PLAN.md §2 | DT-4, DT-6, DT-11 and DT-12 | DEC-128 |
| J2_PLAN_B.md §5 | P1–P9 | DEC-129 |
| j2-reconciliation.md | P10–P12 | DEC-129 |
| J2_PLAN_B.md §2 | DT-13 | DEC-129 |
| J2_DT13_revised.md | FINAL DT-13, §D (P10's widened tail) | DEC-129 |
| j2-P13-consent-order-decision.md | P13, P14, P15 and P16 | DEC-129 |
| V1_BUILD_PLAN.md | §6 P0-1; §11 item 1 | DEC-135 |
| V1_DIRECTIONS_DESIGNER.md §8 | Owner fork 1 | DEC-136 |
| V1_DIRECTIONS_DESIGNER.md §8 | Owner fork 3 | DEC-137 |
| V1_DIRECTIONS_DESIGNER.md §8 | Owner fork 4 | DEC-138 |
| V1_DIRECTIONS_DESIGNER.md §8 | Owner fork 5 | DEC-139 |
| v1-regulatory-copy-check.md §3c | C1 | DEC-140 |
| v1-regulatory-copy-check.md §3c | C5 | DEC-141 |
| WEAKNESSES_AND_FAILURES.md | KW-050, SOLUTION item 2 (the deny list) | DEC-145 |
| WEAKNESSES_AND_FAILURES.md | KW-050, SOLUTION item 1 (Wait for CI); KW-062; KW-034; KW-059 | DEC-146 |
| dan015-regulatory-dossier.md D2 | O1 and O2 | DEC-147 |
| dan015-regulatory-dossier.md D2 | O4 | DEC-148 |
| dan015-regulatory-dossier.md D2 | O11 | DEC-149 |
| dan015-post-j2-regulatory-recheck.md | §2, THE PIVOT; §4, branch (a) | DEC-156 |

## Merged questions

- **DEC-044** (Legal entity, controller and D-U-N-S number): cmp-compliance.md §4 item 6; reg-eu.md §8 D-03; reg-world-and-dossier.md PART 4 DEC-W01; sentinel-calendar.md C2 and proposed row.
- **DEC-050** (Minimum age, the age check and the Play target audience): cmp-compliance.md §4 item 12; reg-eu.md §8 D-06; reg-world-and-dossier.md PART 4 DEC-W04.
- **DEC-054** (Trademark clearance on "Kokonada"): cmp-compliance.md §4 item 16; sentinel-calendar.md C4 and proposed row.
- **DEC-056** (Launch markets, the Play country list and launch languages): reg-eu.md §8 D-02; reg-world-and-dossier.md PART 4 DEC-W02; reg-world-and-dossier.md PART 4 DEC-W07; sentinel-calendar.md C3 and proposed row.
- **DEC-057** (Hosting regions, the sub-processor set and processor contracts): reg-eu.md §8 D-04; reg-eu.md §8 D-05; reg-world-and-dossier.md PART 4 DEC-W03.
- **DEC-064** (No push at launch, the stored FCM tokens, and no message triggered by an inferred state): reg-eu.md §8 D-13; reg-world-and-dossier.md PART 4 DEC-W13.
- **DEC-068** (No in-app purchases: the free-forever confirmation): reg-eu.md §8 D-17; reg-world-and-dossier.md PART 4 DEC-W10.
- **DEC-069** (An accessibility statement on P14 even where the law does not require one): reg-eu.md §8 D-18; reg-world-and-dossier.md PART 4 DEC-W09.

## Rulings recorded

Each was selected by the owner in the session, on the date shown, from the options of a question; the entry quotes the question, the selected option and, where the option carried one, its description.

- **DEC-035** (2026-09-29; The plate dot: a bead with a small halo): "חרוז עם הילה קטנה (מומלץ)".
- **DEC-036** (2026-09-29; The rim words: the axis ends): "קצוות הצירים (מומלץ)".
- **DEC-037** (2026-09-29; Pebble: kept for the warm look as a whole): "המראה החם כולו".
- **DEC-038** (2026-09-29; Hue set B is out; set A is used everywhere): "על הצבעים עצמם".
- **DEC-052** (2026-09-29; May Bellefair replace F6's serif voice face?): "כן, Bellefair לקול (מומלץ)".
- **DEC-055** (2026-09-29; Keep the Art. 50 notice on every inferred-state surface under every option): "גילוי קבוע ומקום שמור (מומלץ)"; the same ruling as DEC-066.
- **DEC-062** (2026-09-29; The "Working" and "Focus" chips): "להסיר (מומלץ)".
- **DEC-066** (2026-09-29; A consent-step slot before the first tap on P2 and P10): "גילוי קבוע ומקום שמור (מומלץ)"; the same ruling as DEC-055. The question named only the Session screen, so P10 is not ruled.
- **DEC-097** (2026-09-29; HALT closure: a fix lane now, and a HALT closes on main): "מסלול תיקון עכשיו (מומלץ)".
- **DEC-040** (2026-09-30; Drop the YouTube → Spotify translation path, or ask Spotify): "לכבות (מומלץ)".
- **DEC-041** (2026-09-30; The retention window for provider track data): "30 יום (מומלץ)".
- **DEC-043** (2026-09-30; A domain and Google OAuth verification for youtube.readonly, or YouTube stays deferred): "להשאיר דחוי (מומלץ)".
- **DEC-051** (2026-09-30; The Google button label in Hebrew and right-to-left): "אנגלית עד F7 (מומלץ)".
- **DEC-091** (2026-09-30; Who signs a RETIRE entry): "אני, מראש לתוכנית (מומלץ)".
- **DEC-099** (2026-09-30; Up Next until P3, whose Spotify rows carry no link to each track (DT-4)): "להסתיר עד P3 (מומלץ)".
- **DEC-100** (2026-09-30; The Spotify disconnect in the current app (DT-8)): "כפתור ניתוק בפרופיל (מומלץ)".
- **DEC-101** (2026-09-30; What 'verified on device' means for a fix with no device path (DT-9)): "מכשיר או בדיקה בייצור (מומלץ)".
- **DEC-102** (2026-09-30; When the HX-1 production survivor count runs (HX-1, A8)): "לספור אחרי התיקון (מומלץ)".
- **DEC-103** (2026-09-30; Work and study words in free text, and the retired chip keys old builds still send (HX-7(b))): "להסיר ולחסום בשרת (מומלץ)".
- **DEC-104** (2026-09-30; The Google button's accessible name: the words drawn on the official asset (HX-6, M2)): "כן, לפי הכתוב על הכפתור (מומלץ)".
- **DEC-105** (2026-09-30; Free-text "focus" derives no activity (HX-7)): "להסיר גם אותה (מומלץ)".
- **DEC-106** (2026-09-30; Apple's sign-in button on the light face is White with outline (HX-6)): "לבן עם מסגרת (מומלץ)".
- **DEC-107** (2026-09-30; The emotion_update door admits only the six chips the app offers (HX-7)): "רשימה סגורה של שש (מומלץ)".
- **DEC-108** (2026-09-30; Production Sentry stays as it is until the scrub fix merges): "להשאיר כמו שהוא"; not the option marked recommended.
- **DEC-109** (2026-09-30; The server relabels old "Working" rows in every app version (HX-7)): "כן, להפוך (מומלץ)".
- **DEC-110** (2026-09-30; The dead History replay hint is removed (HX-7)): "כן, להסיר (מומלץ)".
- **DEC-111** (2026-09-30; Withdrawal also erases each session's heart-rate snapshot and the values derived from it (BE-016)): "שהביטול ימחק גם אותם (מומלץ)".
- **DEC-112** (2026-09-30; GET SPOTIFY FREE opens the item's page, not the download page (HX-4)): "לחתום (מומלץ)".
- **DEC-113** (2026-09-30; After round 2, a short verification check by each reviewer that required a blocking fix): "בדיקת אימות קצרה (מומלץ)".
- **DEC-114** (2026-09-30; Spotify Developer Terms Appendix A §4.e: the notification question is prepared for counsel): "להכין לעורך הדין (מומלץ)"; it rules the preparation only.
- **DEC-115** (2026-10-01; The H1 refresh race gets its own production count, a baseline before merge and a second reading after E2 (HX-2)): "להוסיף ספירה (מומלץ)".
- **DEC-116** (2026-10-01; The privacy policy lives at `https://kokonada.github.io/privacy/`, under a free GitHub organization named `kokonada` (HX-5, DAN-015)): "כתובת חינם ב־github.io", not the option marked recommended; then "ארגון kokonada (מומלץ)".
- **DEC-117** (2026-10-01; The privacy link also goes on the consent sheet in HX-5, with each grant's build and language recorded (O2)): "כן, עם רישום גרסה"; not the option marked recommended.
- **DEC-118** (2026-10-01; BE-016's protected scope: valence and any activity the watch may have detected go too, old sessions included; the free text and the tracks keep their clocks): "ההיקף המוגן (מומלץ)".
- **DEC-119** (2026-10-01; Two BE-016 pin reversals outside DEC-091 are signed: the nightly job's log line, and "A moment" for a session with no title): "לחתום על שתיהן (מומלץ)".
- **DEC-120** (2026-10-01; A consent grant stores the device's language only, without the region, and names it as the device's setting, not the consent screen's language (MB-062, HX-5)): "שפה בלבד (מומלץ)".
- **DEC-121** (2026-10-01; The build number rises once, at the build that turns on the consent sheet's privacy link, above every earlier build (HX-5)): "רק ביום ההפעלה"; not the option marked recommended.
- **DEC-122** (2026-10-01; YouTube is sealed on the server in code, with no switch that can turn it on, and its code is deleted later (HX-3)): "לנעול בקוד (מומלץ)".
- **DEC-123** (2026-10-01; Five HX-3 pin reversals outside DEC-091 are signed: no YouTube artist name to the LLM, the sealed YouTube disconnect, the new YouTube reason line, and the translate fixtures if they are pins): "לחתום על כולם (מומלץ)".
- **DEC-124** (2026-10-01; The app's YouTube disconnect test stops expecting a library rebuild, and the result type drops it (HX-3)): "לחתום (מומלץ)".
- **DEC-125** (2026-10-01; J1 builds the plan's full scope, three of its pin reversals are signed, and only `scripts/rewardJobs.js` ships in the production image (BE-074)): "ההיקף המלא של התוכנית (מומלץ)" and "לחתום על שלושתם (מומלץ)" in one round; then, in the next, "להוסיף רק אותו לתמונה (מומלץ)".
- **DEC-126** (2026-10-02; The state-vector job is fixed in J2, a separate task after J1, and J1 is not widened (BE-087, BE-084)): "משימה נפרדת אחרי J1 (מומלץ)".
- **DEC-127** (2026-10-02; Before the one-off clean of the learning jobs, the count records the jobs per day and those of deleted or withdrawn accounts, counts only; then the clean runs straight after the deploy, without waiting for counsel (BE-074)): "לתעד ואז לנקות (מומלץ)".
- **DEC-128** (2026-10-02; J2 also takes the nightly job and a daily sweep of deleted accounts' data (BE-094), A1, M1′, and record-then-clean): "לכלול ב־J2 (מומלץ)", "רק עם הסכמה בתוקף (מומלץ)", "לרשום ביטול קודם (מומלץ)" and "לתעד, ואז לנקות אחרי הפריסה (מומלץ)".
- **DEC-129** (2026-10-02; J2's twelve pin reversals and the sweep switch): "לחתום על כולם (מומלץ)" and "כן, מתג שמוגדר לפני המיזוג (מומלץ)"; on 2026-10-04 the switch was replaced, and P10's widening and P13 to P16 signed, under DEC-142, not by the owner.
- **DEC-135** (2026-10-02; The V1 build plan is approved as written (ARCH-006)): "לאשר כמו שהיא (מומלץ)".
- **DEC-136** (2026-10-02; Direction C (Basin) takes a warm ground like B's Linen, not N5 (V1)): "רקע חם גם לֽC"; not the option marked recommended.
- **DEC-137** (2026-10-02; On the session screen the navigation bar is present from the first frame (DEC-032, V1)): "מופיע מההתחלה (מומלץ)".
- **DEC-138** (2026-10-02; Direction B's voice face is Bellefair (DEC-052, V1)): "Bellefair, כמו בשאר (מומלץ)".
- **DEC-139** (2026-10-02; The voice line uses the user's own axis words (DEC-036, V1)): "מילות הצירים שלך (מומלץ)".
- **DEC-140** (2026-10-02; The AI notice line is pinned above the scroll region (REG-008, V1 copy check C1)): "לנעוץ את השורה למעלה (מומלץ)".
- **DEC-141** (2026-10-02; A "Living background" switch with an explanation on the You screen (REG-016, V1 copy check C5)): "מתג והסבר במסך האישי (מומלץ)".
- **DEC-142** (2026-10-03; Every former owner gate is decided by the orchestrator once the relevant agents agree (the orchestrator's reading of Round 11)): "הכול אצלך, בהסכמת סוכנים (מומלץ)" and "כל התוכנית עד הסוף (מומלץ)", with the owner's message quoted in the entry; in force from his go of 2026-10-04.
- **DEC-143** (2026-10-03; The orchestrator merges, runs in-plan production actions and publishes the privacy policy (Round 11)): on merges, in the owner's own words, "אתה תמזג אבל אתה חייב להתשמש בסוכן שאחראי על לבדוק שה-CI ירוק והכל תיקן בסוף כל מיזוג"; then "כל מה שבתוכניות שאושרו (מומלץ)", "נקודה חמה וחיבור כשאוכל", "אני, אחרי בדיקת בודקים (מומלץ)" and "התראה לטלפון ושורה בצ'אט (מומלץ)".
- **DEC-144** (2026-10-03; Every agent that bears on the work is put to work (Round 12)): the owner's message, quoted in the entry, and "לא, רק הסשן הזה (מומלץ)".
- **DEC-145** (2026-10-03 and 2026-10-04; Merging stays allowed and destructive git commands are hard-denied (Rounds 12 and 13)): "להשאיר מיזוג, לחסום הרסני (מומלץ)"; then "תוסיף אתה, אני מאשר (מומלץ)".
- **DEC-146** (2026-10-04; Four owner actions on the sentinel's autonomy findings (Round 13)): "אפעיל עכשיו (מומלץ)", "אכבה עכשיו ב־Railway (מומלץ)" and "אגבה ואצור משתמש קריאה (מומלץ)".
- **DEC-147** (2026-10-04; The owner, as a natural person in Israel, is the interim controller, with a dedicated privacy mailbox (DEC-044 interim)): "אני, כאדם פרטי (מומלץ)" and "אפתח כתובת ייעודית (מומלץ)".
- **DEC-148** (2026-10-04; Israel only at the tester stage (DEC-056)): "ישראל בלבד בשלב הבודקים (מומלץ)".
- **DEC-149** (2026-10-04; The minimum age is 16 and over (DEC-050)): "16 ומעלה"; not the option marked recommended.
- **DEC-155** (2026-10-06; The instruction-layer overhaul (brief D1–D8; Rounds 1–13)): "א. AGENTS.md מפנה (מומלץ)", "א. סוכן אבטחה חדש (מומלץ)", "1. שכבת ההוראות (מומלץ),3. נתוני פרודקשן (מומלץ),4. טקסט משפטי והחלטות פתוחות (מומלץ)", "א. הסוכנים שלך בודקים אותו (מומלץ)", in his own words "אפשרות א ולהגיד לו שהוא צריך להסיר את השימוש בRTL בסקילה הזה", "א. תור קצר בראש TASKS (מומלץ)", "א. מתחילים עכשיו, משלימים אחריהן (מומלץ)", "א. משימה ברורה, אחרת ממליצה (מומלץ)", "א. עיצוב אצלו, משפט אצלך (מומלץ)", "א. ענף עבודה קבוע לריצה (מומלץ)", "א. חסימה סופית (מומלץ)", "א. גם היא מחכה לך (מומלץ)" and "א. ראיות על כל מחיקה (מומלץ)".
- **DEC-155, refined** (2026-10-18 and 2026-10-19 at UTC+3; The L-check waiver (OPS-244, #259)): "רשימת מותרים (מומלץ)", "קשורה למצב ברגע האישור (מומלץ)" and "סבב שלישי ממוקד (מומלץ)"; the owner's own words that there be a waiver at all, and each question, are in DEC-155's "Refined 2026-10-18" section.
- **DEC-185** (2026-10-18; The two-partner machinery stays dormant (OPS-196)): "להשאיר רדום (מומלץ)"; then, on its update of 2026-10-18, "להשאיר כמו שהוא (מומלץ)" (DEC-185.md:38).
- **DEC-186** (2026-10-25; The domain `kokonada.com`, which replaces DEC-116's address; his own message, not an option selection): "אני קונה kokonada.com ב-Cloudflare Registrar (בערך $10.46 לשנה, auto-renew)" and "הקנייה שלי (Pause & Guide). אל תיגע ב-DNS עד שאגיד DONE."; then, selected on 2026-10-27 in the session that reviewed #272, the source of the address move, "כן, המדיניות עוברת", and, on who installed a build with the old address, "לא, רק אני" (DEC-186.md).
- **DEC-187** (2026-10-25; The company name on the Garmin application, with no legal entity; his own message, not an option selection): "Company Name: Kokonada. אני בונה הכול לבד, העסק והאפליקציה שלי, ואין ישות משפטית כרגע. רשום את זה מול `DEC-044` (השאלה על ישות ו-D-U-N-S נשארת פתוחה)." (DEC-187.md).
- **DEC-188** (2026-10-25; The business model, free for now; his own message, not an option selection): "מודל עסקי: חינמי לגמרי בינתיים."; then, selected on 2026-10-27 in the session that reviewed #272, on whether it includes no advertising and no sale of data, "רק חינמי" (DEC-188.md).
- **DEC-189** (2026-10-25; The landing page and the privacy policy; his own message, not an option selection): "Website: דף נחיתה מהיר שאתה בונה ומסביר את הרעיון של האפליקציה.", "מדיניות פרטיות: אתה מכין אותה איתי (`DAN-015`, עם כל הדרישות שכבר רשומות בשורה הזו). פרסום הדף הוא owner class (c): לא מפרסמים בלי האישור שלי, מצוטט מילה במילה." and "הדפים צריכים להיות סטטיים, בלי cookies, בלי analytics ובלי צד שלישי (`DAN-015`)." (DEC-189.md).
