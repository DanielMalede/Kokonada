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
- **The private primary record** of the rulings made by option selection is two verbatim excerpts outside the repo, each holding one session's question rounds, with their questions, their options and the answers: `Kokonada-private/design-v2/rulings/owner-rulings-session-3181c7f6.md` and `Kokonada-private/design-v2/rulings/owner-rulings-session-5c0b8fe9.md`. The first holds the five rounds of 2026-09-23 (twenty questions) behind the plan's decisions table. When DEC-102 to DEC-104 were recorded it stopped at the round answered at 2026-09-29T21:35:39Z, so those entries quote the session transcript for their round, answered at 2026-09-29T22:06:50Z. It was completed on 2026-09-30 and now holds every round of that session through the one answered at 2026-09-30T13:32:01Z (DEC-105), DEC-108 to DEC-111 included. The second holds the rounds of the next session, behind DEC-106, DEC-107 and DEC-112 to DEC-121, and quotes DEC-105's round as well. The timestamps are UTC, and the entries carry the date at UTC+3, so a round answered after 21:00 UTC is dated the next day.
- **Titles** are the scribe's English labels. The quoted text in each file is the record.
- **A ruling** is recorded only from the owner's own message (`.claude/commands/page.md`, owner gates).

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
| [DEC-116](decisions/DEC-116.md) | The privacy policy lives at `https://kokonada.github.io/privacy/`, under a free GitHub organization named `kokonada` (HX-5, DAN-015) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx5-brief-compliance.md OD-1 and OD-2 | — |
| [DEC-117](decisions/DEC-117.md) | The privacy link also goes on the consent sheet in HX-5, with each grant's build and language recorded (O2) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx5-brief-regulatory.md §5 Table 1 | — |
| [DEC-118](decisions/DEC-118.md) | BE-016's protected scope: valence and any activity the watch may have detected go too, old sessions included; the free text and the tracks keep their clocks | DECIDED (ruled 2026-10-01) | 2026-10-01 | BE016_PLAN.md §8 G0; be016-brief-regulatory.md §10 | — |
| [DEC-119](decisions/DEC-119.md) | Two BE-016 pin reversals outside DEC-091 are signed: the nightly job's log line, and "A moment" for a session with no title | DECIDED (ruled 2026-10-01) | 2026-10-01 | BE016_PLAN.md §6; designer-direction-be016-hx5.md A2 | — |
| [DEC-120](decisions/DEC-120.md) | A consent grant stores the device's language only, without the region, and names it as the device's setting, not the consent screen's language (MB-062, HX-5) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx5-r1-regulatory.md R1 and OQ2 | — |
| [DEC-121](decisions/DEC-121.md) | The build number rises once, at the build that turns on the consent sheet's privacy link, above every earlier build (HX-5) | DECIDED (ruled 2026-10-01) | 2026-10-01 | hx5-r1-regulatory.md §2, R2 and OQ3 | — |

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
