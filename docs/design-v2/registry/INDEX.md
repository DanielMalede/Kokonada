# L1 requirement registry — index

Prepared 2026-09-29 for Stage 0 step L1 of `docs/plans/DESIGN_V2_PLAN.md`, at repo HEAD `b9639c5`, and amended 2026-09-30 from the HX pre-build briefs. One file per ID sits beside this index: `docs/design-v2/registry/<ID>.md`. Decisions are in `docs/design-v2/decisions/DEC-<n>.md`, indexed in `docs/design-v2/DECISIONS.md`.

- **How the files were made.** A script copied each entry from the scratch file its author returned. The front matter names the author, the source file and line range, the preparation date and the repo HEAD. The body is the entry as written; where the scribe changed anything, the front matter lists each change under `scribe substitutions`.
- **Kinds of scribe change:** owner-decision numbers in the three source files replaced with their DEC- IDs; four QA dependencies named by topic resolved to registry IDs; one email address in a quoted agreement omitted. REG-001 to REG-089 also carry `source keys`: the full reference behind each `[Kn]` the body cites, from the key table in `reg-eu.md` §0.
- **Amendments of 2026-09-30.** The HX pre-build briefs of `compliance-auditor` and `regulatory-researcher` corrected fourteen entries (CMP-008, 022, 023, 038, 045, 086, 099, 120, 121; REG-001, 015, 034, 037, 084) and added two, `CMP-138` and `CMP-139`. Each correction is appended to the field it changes, marked "· Amended 2026-09-30:", except REG-015's guideline status, which is replaced as its author asked; the front matter lists each one under `amendments`, with its source. The scribe composed the two new entries from the compliance brief, in the field order of `cmp-compliance.md`; their front matter names the fields the brief does not state.
- **Amendments of 2026-10-02.** The `compliance-auditor`'s J1 round-1 review and its answer to amendment A1 (session scratch files outside the repo) amended five entries (CMP-018, 043, 045, 089, 107) and added one, `CMP-140`, the Play rule on encryption at rest and in transit. Each amendment is appended to the field it changes, marked "· Amended 2026-10-02:"; the front matter lists each one under `amendments`, with its source. The scribe composed `CMP-140` from the review, in the field order of `cmp-compliance.md`; its front matter names the fields the review does not state. No status line changes: `CMP-043` and `CMP-045` stay HALT, `CMP-045` now under `DAN-046`'s contingency as well, because the production job queue holds YouTube data past 30 days (TASKS `OPS-094`). Later the same day, after the OPS-094 clean, the `compliance-auditor` re-issued `CMP-045`'s status line as NEEDS OWNER and `CMP-043`'s as HALT, unchanged; both entries record its texts as amendments of 2026-10-02.
- **Amendments of 2026-10-04.** The `compliance-auditor`'s re-check of the Play organisation account (a session scratch file outside the repo) re-issued `CMP-093` from OPEN QUESTION and NEEDS OWNER to OBLIGATION and HALT, in the text the re-check gives, with its repo HEAD set to `e4743af`, and amended `CMP-092`, appended to its rule and listed under `amendments`. `CMP-093`'s former "effective September 30, 2026" and "global removal from Google Play" belong to Play package-name registration and Android developer verification, not to the organisation rule, which has bound new accounts since 17 July 2024. `CMP-093` is item 18 of the HALT items below.
- **Counts:** CMP 140 (CMP-138 and CMP-139 added on 2026-09-30, CMP-140 on 2026-10-02), REG 153 (REG-001 to REG-089 from the EU run; REG-200 to REG-263 from the worldwide run; the REG numbers 090 to 199 are reserved for the EU run and unused), QA 164. Total 457.
- **Authors:** CMP, `compliance-auditor` (`cmp-compliance.md`); REG, `regulatory-researcher` (`reg-eu.md`, `reg-world-and-dossier.md`); QA, `resilience-auditor` (`qa-resilience.md`).
- **DSN-** is reserved for design rules, which ADR-0017 mints at V1. None exist yet.
- **Status column:** the leading status word. A `+` means the entry's status line carries a qualifier; read the file.
- **Status lines behind the owner's rulings.** Five entries still carry the status their author gave before the owner ruled. The DEC entry is the ruling, and the author re-issues the status line (TASKS `OPS-076`, by the mechanism `DAN-032` settles; `CMP-125` before V1): `CMP-024` → DEC-041, `CMP-050` → DEC-043, `CMP-103` → DEC-051, `CMP-125` → DEC-052, `REG-015` → DEC-062 (the architect's L1 review, round 2).
- **Related files:** `docs/design-v2/registry/state-label-review.md` (the state-label table, `reg-eu.md` §6); `docs/design-v2/counsel/counsel-dossier-2026-09-29.md`; `docs/design-v2/counsel/hx-questions-for-counsel-2026-09-30.md` (counsel's questions from the HX pre-build briefs); `docs/design-v2/counsel/j1-questions-for-counsel-2026-10-02.md` (counsel's questions from the J1 round-1 regulatory review); `docs/design-v2/calendar.md`.

## HALT items

Seventeen CMP entries carried status HALT (sixteen since 2026-10-02, when the `compliance-auditor` re-issued `CMP-045` as NEEDS OWNER after the OPS-094 clean, and seventeen again since 2026-10-04, when it re-issued `CMP-093` as HALT): the fifteen of `cmp-compliance.md` §3, whose text is copied word for word with one scribe substitution noted below the table, two added on 2026-09-30 from the `compliance-auditor`'s HX pre-build brief (items 16 and 17), and one on 2026-10-04 from its re-check of the Play organisation account (item 18), whose text is the scribe's summary. A HALT blocks every store submission, every provider review and every release build that goes to anyone other than the owner. It closes when its fix is on main and verified on device ("on main" is the scribe's reading of DEC-097, not the owner's wording), in the HALT fix lane, which must finish before P2's G1 (the owner's rulings DEC-097 and DEC-101; TASKS `ARCH-011`). The owner's exception in DEC-097: three HALTs stay dependent on hosting the privacy policy. They are `CMP-026`, `CMP-066` and `CMP-081` (the architect's L1 review, round 2, names the three), and they wait on TASKS `DAN-015`. Where a device action exists, the fix is proved through it and the result read in the production database or logs; where none exists, integration tests and a production count of zero affected users suffice; each PR states what was proved on the device and what was not (DEC-101). That replaces `cmp-compliance.md`'s status legend, under which a HALT closed at the owning page's G12.

| # | ID | Title | Applies to | §3 text | TASKS | DEC |
|---|---|---|---|---|---|---|
| 1 | `CMP-008` | Link back to the exact Spotify content | P3, P4, P8, F10 | `mobile/KokonadaHealth/src/experience/player/spotifyLinkBack.ts:27` opens bare `spotify:`, which breaks Spotify Policy II.4.2. Risk: loss of the Spotify client. Fix: open the playing item's own URI. | MB-043 | DEC-099 |
| 2 | `CMP-021` | The YouTube library is played through Spotify | backend, P2, P3, P6 | `backend/app/services/crossPlatform.js:57-95` plays the YouTube library through Spotify (Spotify III.5). Risk: loss of the Spotify client. Fix: pin the translation off until the owner rules DEC-040. | BE-035 | DEC-040 |
| 3 | `CMP-022` | Spotify content is never stored indefinitely | backend, server plumbing, P8, P3 | `backend/app/models/PlaylistSession.js:39-53` and `workers/sessionTrim.worker.js:8,25` keep Spotify content indefinitely (Terms IV.3.1.a). Fix: a TTL on the window picked in CMP-024. | BE-021, BE-051 | DEC-041 |
| 4 | `CMP-023` | Delete Spotify personal data within 5 days of disconnect | backend, P9 | The Spotify disconnect never purges `PlaylistSession` (Terms V.8 and Appendix A §5.c, 5 days). Fix: purge on disconnect, with a test. | BE-021, MB-063 | DEC-100 |
| 5 | `CMP-026` | Privacy policy shown before sign-up (Spotify) | P11, P14, store listing | No privacy policy exists, and `SignInScreen.tsx:62-116` has no link (Spotify Terms V.12). This is a condition of the API access the app uses now. Fix: host the policy (DAN-015) and link it on sign-in. | MB-034, DAN-015 | — |
| 6 | `CMP-038` | Call it "YouTube", never "YouTube Music" | P6, P9, P13 | `providers.ts:37` says "YouTube Music". Risk: failed OAuth verification and rejected screenshots. Fix: "YouTube". | MB-037 | — |
| 7 | `CMP-043` | Disconnecting YouTube in the app revokes access at Google | P9, backend | The YouTube disconnect handler in `integrationsController.js` does not revoke the token with Google (III.D.2 item 3.1). Risk: loss of YouTube API access. Fix: call the revoke endpoint, then delete within 7 days. | BE-022 | — |
| 8 | `CMP-045` | YouTube data is kept for 30 days at most | backend, P8, server plumbing | YouTube `trackSummary` in `PlaylistSession` and in `UnclassifiedTrack.js:7-20` has no expiry (III.E.4.c, 30 days). Fix: TTLs. | BE-034, BE-021, BE-051, BE-056, BE-060, OPS-094 | DEC-041 |
| 9 | `CMP-046` | YouTube data is never given to other services | backend, P6 | YouTube data goes to Spotify search (`crossPlatform.js`) and to the LLM provider (`musicProfileService.js:654-662`) (III.E.3.b). Fix: stop both flows, or add an express, named disclosure before OAuth. | BE-035 | DEC-040 |
| 10 | `CMP-066` | The Health Connect rationale shows the Play Console privacy policy | P5, P6, store listing | `PermissionsRationaleActivity.kt:19` shows Google's documentation instead of our privacy policy. Risk: rejection at the Health Connect declaration, on any Play track. Fix: load the hosted policy URL filed in Play Console. | MB-035, DAN-015 | — |
| 11 | `CMP-067` | The Android 14+ rationale alias targets the rationale activity | P5, P6, Q1 | In `AndroidManifest.xml:90-99` the alias targets `.MainActivity`, and `:75-77` and `:84-86` declare the rationale action twice. Same rejection risk. Fix: target `.PermissionsRationaleActivity` and keep one filter. | MB-035 | — |
| 12 | `CMP-081` | Privacy policy link inside the app (Play) | P5, P9, P11, P14, F10 (LegalLinks), store listing | No privacy-policy link anywhere in the app (Play). Risk: store rejection. Fix: LegalLinks on P11, P5, P9 and P14. | MB-034, DAN-015 | — |
| 13 | `CMP-086` | No misleading health or capability claims | P2, P4, P7, P8, P10, P13, store listing | `PulseScreen.tsx:207-210` shows "N% read confidence", which presents rule coverage as accuracy (Play health claims; Apple 1.4.1 later). Risk: rejection, and the screenshots cannot be used. Fix: a word, not a number, per the plan's default, or remove it. | UI-008, UI-020 | — |
| 14 | `CMP-099` | Official Sign in with Google button | P11, F1, F2, F10 | `SignInScreen.tsx:78-97` draws a home-made Google button. Risk: failed Google app verification. Fix: the spec colours, the standard G and Google Sans, or the pre-approved assets. | MB-036 | DEC-051, DEC-104 |
| 15 | `CMP-120` | Remove General Sans (FF EULA) from the app and the repo | F6, P12, P14, Q1 | General Sans ships under the FF EULA in three `.otf` copies, next to a licence file misnamed `OFL.txt` (`tokens.ts:245`). This is a licence breach (legal P0). Fix: plan step S9, replaced by an OFL face (F6). | UI-013 | — |
| 16 | `CMP-138` | MusicProfile's Spotify content has a refresh clock | backend, P3 | Split from item 3 on 2026-09-30: for a Spotify-only profile, nothing refreshes or deletes the Spotify content in `MusicProfile.js:28-30,36-66` while the user stays connected (Terms IV.3.1.a). Fix: a refresh clock, after HX-3. | BE-052 | — |
| 17 | `CMP-139` | A disconnect made on Spotify's side deletes within 5 days | backend, P9 | Split from item 4 on 2026-09-30: a revocation on Spotify's side becomes `reconnect_required` and deletes nothing (`spotify.js:126-130`; Terms V.8 and Appendix A §5.c, 5 days). Fix: purge on `invalid_grant` only, with a day-4 re-check, a circuit breaker and a daily token-health refresh, before `SPOTIFY_BETA_CONNECT` is enabled for anyone else. | BE-053 | DEC-100 |
| 18 | `CMP-093` | Organization account for a health app | the Play account, store listing | Re-issued 2026-10-04: no personal Google Play developer account is created for Kokonada, and no build goes to any Play track from one, internal testing included (Play Console Requirements §1.2, "must register as an Organization", read with the health-app categories and the Health apps declaration). Compliant routes: an organisation account with a D-U-N-S number; a written statement from Google Play that a Health-and-fitness-only declaration is outside §1.2; or, for the Israel tester stage, no Play account, with the APK installed directly. | DAN-026, DAN-056, DAN-057 | DEC-044 |

Scribe substitution: in item 2 (`CMP-021`), the source's placeholder "(DEC-)" is written as DEC-040, the entry it stands for (the architect's L1 review, round 1, finding 14).

Splits of 2026-09-30 (the `compliance-auditor`'s HX pre-build brief): item 3 (`CMP-022`) now covers `PlaylistSession` and `ServeEvent`, and its `MusicProfile` part is item 16 (`CMP-138`); item 4 (`CMP-023`) keeps the in-app disconnect, and revocation on Spotify's side is item 17 (`CMP-139`). The text of items 16 and 17 is the scribe's summary of the brief, not `cmp-compliance.md` §3.

The TASKS and DEC columns are the scribe's cross-references, current at 2026-09-30; item 8's `OPS-094` was added on 2026-10-02 (the YouTube data in the production job queue). Item 8's status line is NEEDS OWNER since 2026-10-02, the `compliance-auditor`'s re-issue after the OPS-094 clean; the entry returns to HALT on the conditions it states.

The owner-decision items marked NEEDS OWNER are not HALTs. The Garmin surfaces stay dormant until CMP-051 is resolved.

## Merged page map

Every ID from the four page maps (`cmp-compliance.md` §2, `reg-eu.md` §5, `reg-world-and-dossier.md` PART 2, `qa-resilience.md` §3). Each cell is its source's cell with ranges expanded and bare numbers written as full IDs; the annotations are the author's. A joint source row (F2/F3, Q1–Q3) is repeated on each item it names. "—" means that map has no row for the item. The entries added on 2026-09-30 are marked "(added 2026-09-30)".

| Page / item | CMP | REG (EU, 001–089) | REG (world, 200–263) | QA |
|---|---|---|---|---|
| P1 Shell and system states | CMP-002, CMP-015, CMP-029, CMP-035, CMP-036, CMP-071, CMP-079, CMP-098, CMP-102, CMP-110, CMP-111, CMP-112, CMP-115, CMP-127, CMP-128, CMP-129, CMP-130, CMP-133 | REG-005, REG-008, REG-016, REG-017, REG-057, REG-066, REG-083 | REG-206, REG-212, REG-220, REG-222 (in-app notice path), REG-229, REG-261 | QA-006, QA-007, QA-019, QA-085, QA-086, QA-091, QA-093, QA-105, QA-106, QA-120, QA-121 |
| P2 Session: place and Genesis | CMP-001, CMP-010, CMP-015, CMP-016, CMP-021, CMP-031, CMP-032, CMP-033, CMP-034, CMP-042, CMP-053, CMP-057, CMP-063, CMP-078, CMP-079, CMP-086, CMP-087, CMP-098, CMP-110, CMP-111, CMP-112, CMP-128, CMP-130, CMP-133, CMP-134 | REG-005, REG-006, REG-008, REG-009, REG-012, REG-015, REG-016, REG-017, REG-026, REG-031, REG-032, REG-036, REG-041, REG-047, REG-057, REG-058, REG-070, REG-089 | REG-208, REG-209, REG-213, REG-218, REG-219, REG-227, REG-230 (pivot yes), REG-239, REG-244, REG-245, REG-250 (pivot yes), REG-253, REG-259, REG-262 | QA-005, QA-019, QA-020, QA-063, QA-065, QA-066, QA-067, QA-068, QA-069, QA-070, QA-087, QA-088, QA-089, QA-090, QA-091, QA-092, QA-095, QA-096, QA-098, QA-101, QA-102, QA-122, QA-123, QA-124, QA-125, QA-126, QA-127 |
| P3 Playing and Up Next | CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007, CMP-008, CMP-009, CMP-010, CMP-011, CMP-012, CMP-013, CMP-014, CMP-015, CMP-016, CMP-017, CMP-018, CMP-019, CMP-020, CMP-021, CMP-022, CMP-028, CMP-030, CMP-031, CMP-032, CMP-033, CMP-034, CMP-035, CMP-036, CMP-041, CMP-042, CMP-057, CMP-090, CMP-092, CMP-110, CMP-111, CMP-112, CMP-126, CMP-127, CMP-128, CMP-131, CMP-133, CMP-134 / (added 2026-09-30) CMP-138 | REG-012, REG-016, REG-032, REG-045, REG-059, REG-070 | REG-208, REG-218, REG-227 | QA-004, QA-005, QA-019, QA-048, QA-092, QA-094, QA-101, QA-104, QA-128, QA-129, QA-130, QA-131, QA-132, QA-133, QA-134 |
| P4 Mix receipt | CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-008, CMP-009, CMP-014, CMP-017, CMP-018, CMP-019, CMP-028, CMP-041, CMP-051, CMP-052, CMP-054, CMP-055, CMP-057, CMP-061, CMP-063, CMP-069, CMP-070, CMP-086, CMP-088, CMP-090, CMP-108, CMP-111, CMP-126, CMP-127, CMP-128, CMP-134, CMP-135 | REG-005, REG-008, REG-009, REG-013, REG-046, REG-056, REG-071, REG-074, REG-079, REG-080, REG-081, REG-082, REG-083 | REG-209, REG-211, REG-213, REG-219, REG-226, REG-246 | QA-004, QA-094, QA-095, QA-104, QA-126, QA-128, QA-130, QA-135, QA-136, QA-146 |
| P5 Consent (Art. 9) | CMP-058, CMP-062, CMP-064, CMP-066, CMP-067, CMP-068, CMP-073, CMP-075, CMP-076, CMP-078, CMP-081, CMP-087, CMP-088, CMP-107, CMP-109, CMP-110, CMP-111, CMP-134 | REG-005, REG-007, REG-010, REG-024, REG-025, REG-026, REG-027, REG-028, REG-029, REG-030, REG-031, REG-034, REG-035, REG-036, REG-037, REG-039, REG-040, REG-041, REG-042, REG-043, REG-045, REG-046, REG-047, REG-048, REG-054, REG-057, REG-062, REG-065, REG-067, REG-068, REG-069 | REG-200, REG-203, REG-214, REG-220, REG-225, REG-230, REG-231, REG-235, REG-236, REG-248, REG-250, REG-251, REG-252, REG-253, REG-257, REG-259, REG-263 | QA-019, QA-023, QA-080, QA-099, QA-107, QA-126, QA-137, QA-138, QA-139, QA-140, QA-141, QA-142 |
| P6 Connect services | CMP-001, CMP-021, CMP-025, CMP-033*, CMP-035, CMP-038, CMP-040, CMP-046, CMP-047, CMP-049, CMP-050, CMP-051, CMP-059, CMP-060, CMP-063*, CMP-066, CMP-067, CMP-068, CMP-071, CMP-073, CMP-074, CMP-076, CMP-078, CMP-079, CMP-080, CMP-087, CMP-098, CMP-102, CMP-109, CMP-113, CMP-114, CMP-126, CMP-127, CMP-130, CMP-133, CMP-136 (*context only) | REG-006, REG-007, REG-010, REG-026, REG-030, REG-033, REG-035, REG-036, REG-041, REG-048, REG-049, REG-057, REG-058, REG-065, REG-067, REG-068, REG-069, REG-085, REG-086 | REG-200, REG-206, REG-220, REG-250 | QA-019, QA-020, QA-049, QA-096, QA-098, QA-099, QA-100, QA-101, QA-107, QA-120, QA-142, QA-143, QA-144, QA-145 |
| P7 Body (Pulse) | CMP-017, CMP-051, CMP-052, CMP-053, CMP-054, CMP-055, CMP-058, CMP-059, CMP-061, CMP-062, CMP-063, CMP-069, CMP-070, CMP-071, CMP-086, CMP-087, CMP-088, CMP-108, CMP-110, CMP-112, CMP-126, CMP-127, CMP-128, CMP-130, CMP-134, CMP-135, CMP-136 | REG-002, REG-005, REG-006, REG-008, REG-009, REG-026, REG-036, REG-071, REG-075, REG-076, REG-077, REG-078, REG-079, REG-080, REG-081, REG-082, REG-083, REG-084 | REG-200, REG-208, REG-209, REG-211, REG-213, REG-218, REG-219, REG-221, REG-226, REG-227, REG-238, REG-260, REG-262 | QA-004, QA-005, QA-020, QA-063, QA-066, QA-067, QA-068, QA-069, QA-070, QA-095, QA-096, QA-097, QA-098, QA-102, QA-105, QA-126, QA-146, QA-147, QA-148 |
| P8 Archive | CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-008, CMP-014, CMP-017, CMP-018, CMP-022, CMP-024, CMP-041, CMP-045, CMP-051, CMP-052, CMP-055, CMP-086, CMP-098, CMP-128 | REG-005, REG-008, REG-031, REG-045, REG-051, REG-052, REG-078, REG-081, REG-082, REG-083, REG-084, REG-089 | REG-213, REG-253 | QA-002, QA-004, QA-090, QA-092, QA-104, QA-128, QA-149, QA-150, QA-151 |
| P9 You and Vault | CMP-023, CMP-025, CMP-040, CMP-043, CMP-044, CMP-051, CMP-052, CMP-056, CMP-059, CMP-072, CMP-081, CMP-082, CMP-087, CMP-106, CMP-110, CMP-115 / (added 2026-09-30) CMP-139 | REG-017, REG-037, REG-038, REG-039, REG-045, REG-048, REG-050, REG-051, REG-052, REG-054, REG-055, REG-056, REG-066, REG-067, REG-068, REG-069, REG-086 | REG-207, REG-214, REG-217, REG-220, REG-221, REG-233, REG-236, REG-258 | QA-019, QA-020, QA-080, QA-097, QA-098, QA-099, QA-101, QA-107, QA-120, QA-152, QA-153, QA-154, QA-155 |
| P10 Onboarding | CMP-027, CMP-037, CMP-073, CMP-079, CMP-086, CMP-094, CMP-110, CMP-111, CMP-130, CMP-134 | REG-005, REG-006, REG-008, REG-009, REG-011, REG-031, REG-036, REG-041, REG-042, REG-043, REG-058, REG-067, REG-070, REG-075 | REG-203, REG-204, REG-220, REG-224, REG-225, REG-240, REG-241, REG-244, REG-245, REG-259, REG-263 | QA-063, QA-065, QA-066, QA-067, QA-087, QA-088, QA-089, QA-090, QA-098, QA-100, QA-106, QA-126, QA-156, QA-157, QA-158 |
| P11 Sign-in | CMP-026, CMP-048, CMP-065, CMP-081, CMP-099, CMP-100, CMP-101, CMP-102, CMP-103, CMP-104, CMP-105, CMP-109, CMP-110, CMP-127, CMP-130 | REG-006, REG-024, REG-025, REG-035, REG-042, REG-043, REG-044, REG-047, REG-048, REG-055, REG-062, REG-067, REG-068, REG-069, REG-073 | REG-201, REG-202, REG-215, REG-217, REG-232, REG-252 | QA-106, QA-155, QA-159 |
| P12 Splash, mark and icon | CMP-029, CMP-039, CMP-097, CMP-110, CMP-116, CMP-120, CMP-129, CMP-137 | REG-070, REG-075 | REG-224, REG-228 | QA-010, QA-011, QA-024, QA-031, QA-034, QA-066, QA-160, QA-161 |
| P13 Store assets | CMP-001, CMP-017, CMP-027, CMP-033, CMP-037, CMP-039, CMP-051, CMP-052, CMP-077, CMP-082, CMP-083, CMP-084, CMP-085, CMP-086, CMP-088, CMP-089, CMP-090, CMP-091, CMP-092, CMP-093, CMP-094, CMP-095, CMP-096, CMP-097, CMP-107, CMP-129, CMP-132, CMP-135, CMP-137 | REG-014, REG-042, REG-047, REG-070, REG-071, REG-075, REG-076, REG-079, REG-080, REG-081, REG-084 | REG-204, REG-208, REG-209, REG-210, REG-211, REG-217, REG-218, REG-219, REG-224, REG-226, REG-227, REG-228, REG-234, REG-239, REG-241, REG-244, REG-245, REG-260, REG-262 | QA-031, QA-037, QA-162 |
| P14 About, legal, licences and support | CMP-026, CMP-048, CMP-049, CMP-060, CMP-064, CMP-065, CMP-081, CMP-082, CMP-117, CMP-119, CMP-120, CMP-130 | REG-024, REG-025, REG-044, REG-045, REG-048, REG-050, REG-053, REG-061, REG-062, REG-073, REG-074, REG-079, REG-087, REG-088, REG-089 | REG-202, REG-207, REG-211, REG-212, REG-226, REG-229, REG-232, REG-239, REG-244, REG-246, REG-254, REG-260, REG-261 | QA-013, QA-024, QA-080, QA-163, QA-164 |
| L1 Requirement and decision registry | all (this registry) | all | REG-204, REG-205 | this registry |
| V0 Taste interview | CMP-037, CMP-094, CMP-124, CMP-125, CMP-129, CMP-132 | none | — | none |
| V1 Vision frame | CMP-011, CMP-013, CMP-016, CMP-029, CMP-094, CMP-118, CMP-122, CMP-123, CMP-124, CMP-125, CMP-128, CMP-129, CMP-130, CMP-132 | REG-016, REG-057 | — | QA-029 (field proof on device), QA-034, QA-035, QA-063, QA-064, QA-065, QA-066, QA-067, QA-078 |
| F1 Tokens | CMP-006, CMP-011, CMP-029, CMP-074, CMP-099, CMP-129 | REG-009, REG-057, REG-078 | — | QA-027, QA-052, QA-053, QA-054, QA-055, QA-056, QA-057, QA-058, QA-059, QA-060, QA-061, QA-062, QA-063, QA-064, QA-065, QA-113, QA-114, QA-117 |
| F2 Themes | CMP-006, CMP-074, CMP-099, CMP-128 | (from the joint "F2/F3 (themes, motion policy)" row) REG-009, REG-016, REG-087 | — | QA-084, QA-111 |
| F3 Motion policy | CMP-013, CMP-015, CMP-016, CMP-061, CMP-127 | (from the joint "F2/F3 (themes, motion policy)" row) REG-009, REG-016, REG-087 | — | QA-011, QA-012, QA-035, QA-036, QA-071 |
| F4 Design Lab | CMP-037, CMP-132 | REG-064, REG-066 | — | QA-026, QA-031, QA-033, QA-037, QA-038, QA-077, QA-078 |
| F5 Edge-to-edge, back and keyboard | CMP-110, CMP-111, CMP-112 | REG-009, REG-037, REG-068 | — | QA-016, QA-085, QA-086 |
| F6 Fonts | CMP-103, CMP-117, CMP-118, CMP-119, CMP-120, CMP-121, CMP-122, CMP-123, CMP-124, CMP-125 | REG-009, REG-047 | — | QA-081, QA-163 |
| F7 i18n and RTL | CMP-100, CMP-103, CMP-122, CMP-127, CMP-130, CMP-131 | REG-009, REG-034, REG-043, REG-047 | REG-250, REG-251, REG-252, REG-262 | QA-014, QA-039, QA-061, QA-082, QA-088, QA-141 |
| F8 Haptics | none. No provider rule governs haptics. CMP-016 would apply only if a haptic pattern were derived from the track. | REG-016 | — | QA-070, QA-078 |
| F9 Field | CMP-013, CMP-016, CMP-128 | REG-005, REG-016, REG-057, REG-066 | — | QA-010, QA-018, QA-027, QA-029, QA-030, QA-050, QA-051, QA-063, QA-065, QA-066, QA-067, QA-068, QA-069, QA-070, QA-071, QA-072, QA-073, QA-102 |
| F10 Components | AttributionSlot CMP-002, CMP-003, CMP-005, CMP-006, CMP-007, CMP-009, CMP-061, CMP-126, CMP-127, CMP-128. CoverArt CMP-010, CMP-011, CMP-012, CMP-013. ConsentChoicePair CMP-078. LegalLinks CMP-048, CMP-049, CMP-081, CMP-082. AiDisclosure CMP-134. MedicalDisclaimer CMP-135. | `AiDisclosure` REG-005, REG-006, REG-007, REG-008, REG-009 and REG-020 (reserved line); `ConsentChoicePair` REG-027, REG-035, REG-036, REG-068, REG-069; `MedicalDisclaimer` REG-079; `LegalLinks` REG-044, REG-048; `AttributionSlot` none (it belongs to `compliance-auditor`) | ConsentChoicePair: REG-220. AiDisclosure: REG-259, REG-246. MedicalDisclaimer: REG-211, REG-226, REG-260. LegalLinks: REG-201, REG-232, REG-261 | QA-006, QA-022, QA-023, QA-028, QA-080, QA-115, QA-126, QA-128, QA-129, QA-138 |
| Q1 Contract registry and CI | CMP-008, CMP-011, CMP-015, CMP-016, CMP-017, CMP-019, CMP-020, CMP-021, CMP-022, CMP-023, CMP-038, CMP-041, CMP-043, CMP-045, CMP-047, CMP-067, CMP-068, CMP-075, CMP-076, CMP-091, CMP-097, CMP-113, CMP-115, CMP-117, CMP-118, CMP-120, CMP-122, CMP-124, CMP-126, CMP-127, CMP-130, CMP-134, CMP-135 | (from the joint "Q1–Q3 (contract registry, tests)" row) REG-034, REG-081, REG-083 | — | QA-040, QA-041, QA-116, QA-118 |
| Q2 Scoped tsc | none | (from the joint "Q1–Q3 (contract registry, tests)" row) REG-034, REG-081, REG-083 | — | QA-042, QA-043, QA-115 |
| Q3 Stateful fakes | CMP-034, CMP-035, CMP-043, CMP-078, CMP-079 | (from the joint "Q1–Q3 (contract registry, tests)" row) REG-034, REG-081, REG-083 | — | QA-044, QA-045, QA-046, QA-047, QA-048, QA-049, QA-050, QA-051, QA-103, QA-108, QA-109, QA-110, QA-111, QA-112, QA-119 |
| Server plumbing (step 14) | CMP-017, CMP-018, CMP-019, CMP-020, CMP-022, CMP-024, CMP-041, CMP-045, CMP-057, CMP-069, CMP-090 | `receipt.why` REG-082, REG-083; `affect`/`morning` REG-077, REG-083, REG-084; `playback_event`/`track_skipped`/`tzOffsetMinutes` REG-032, REG-045, REG-051, REG-052, REG-059 | — | QA-093, QA-094, QA-095, QA-096, QA-107, QA-132, QA-135, QA-140 |
| Store listing (and Data safety) | (added 2026-10-02) CMP-140 | REG-014, REG-047, REG-070, REG-071, REG-075, REG-076, REG-081, REG-084 | REG-204, REG-210, REG-217, REG-224, REG-234, REG-242 | — |
| Privacy notice (hosted) | — | REG-024, REG-025, REG-028, REG-032, REG-039, REG-044, REG-045, REG-046, REG-049, REG-055, REG-061, REG-062 | REG-200, REG-201, REG-202, REG-206, REG-207, REG-215, REG-217, REG-230, REG-231, REG-232, REG-234, REG-235, REG-236, REG-237, REG-242, REG-248, REG-249, REG-252, REG-254, REG-257 | — |
| Backend (outside pages) | CMP-019, CMP-020, CMP-021, CMP-022, CMP-023, CMP-043, CMP-044, CMP-045, CMP-046, CMP-056, CMP-059, CMP-080, CMP-115, CMP-121, CMP-136 / (added 2026-09-30) CMP-138, CMP-139 / (added 2026-10-02) CMP-140 | REG-001, REG-010, REG-013, REG-026, REG-031, REG-051, REG-052, REG-054, REG-059, REG-060, REG-061, REG-062, REG-063, REG-064, REG-066, REG-076, REG-077, REG-083 | REG-200, REG-205, REG-206, REG-215, REG-217, REG-221, REG-222, REG-223, REG-225, REG-233, REG-237, REG-238, REG-240, REG-242, REG-243, REG-247, REG-249, REG-251, REG-254, REG-255, REG-256, REG-257, REG-258 | — |
| Owner / organisation | — | REG-003, REG-021, REG-022, REG-023, REG-024, REG-059, REG-060, REG-061, REG-062 | — | — |
| Trigger gates (future pages) | — | — | REG-216, REG-243, REG-247, REG-248 | — |
| Pipeline guards | — | — | — | QA-074, QA-075, QA-076, QA-083 |
| Every page, where it applies (QA) | — | — | — | QA-010, QA-011, QA-012, QA-013, QA-014, QA-015, QA-016, QA-017, QA-018 and QA-021, QA-022, QA-023, QA-024, QA-025, QA-026, QA-027, QA-028, QA-029, QA-030, QA-031, QA-032, QA-033, QA-034, QA-035, QA-036, QA-037, QA-038, QA-039: state, motion and measurement rules. / QA-103 and QA-111, QA-112, QA-113, QA-114, QA-115, QA-116, QA-117, QA-118, QA-119: parity and false-green rules. / QA-001, QA-002, QA-003, QA-004, QA-005, QA-006, QA-007, QA-008, QA-009 on every page that reads data. / QA-040, QA-041, QA-053, QA-054 and QA-074, QA-075, QA-076: pipeline and ratchet guards. |

## All entries

| ID | Title | Kind | Status | Severity | Applies to |
|---|---|---|---|---|---|
| [CMP-001](CMP-001.md) | Public surfaces never depend on Spotify playback | PROHIBITION | SETTLED | P0 | P2, P3, P4, P6, P13, store listing |
| [CMP-002](CMP-002.md) | Spotify content always carries the Spotify brand | OBLIGATION | SETTLED | P0 | P1 (mini-player, if any), P3, P4, P8, F10 |
| [CMP-003](CMP-003.md) | Spotify attribution uses the full logo | OBLIGATION | SETTLED | P1 | P3, P4, P8, F10 |
| [CMP-004](CMP-004.md) | Spotify logo and icon minimum sizes | OBLIGATION | SETTLED | P1 | P3, P4, P8, F10 |
| [CMP-005](CMP-005.md) | Spotify logo clear space | OBLIGATION | SETTLED | P1 | P3, P4, P8, F10 |
| [CMP-006](CMP-006.md) | Spotify logo colour follows the background | OBLIGATION | SETTLED | P1 | F1, F2, P3, P4, P8 |
| [CMP-007](CMP-007.md) | Spotify marks are never altered | PROHIBITION | SETTLED | P1 | F3, F7, F10, P3 |
| [CMP-008](CMP-008.md) | Link back to the exact Spotify content | OBLIGATION | HALT | P0 | P3, P4, P8, F10 |
| [CMP-009](CMP-009.md) | Spotify link-back wording | OBLIGATION | SETTLED | P1 | P3, P4, F10 |
| [CMP-010](CMP-010.md) | Spotify never plays without cover art and metadata | OBLIGATION | SETTLED | P0 | P2 (the Genesis hand-off), P3, P1 (mini-player), F10 (CoverArt) |
| [CMP-011](CMP-011.md) | Cover art corner radius is 4 or 8 | OBLIGATION | SETTLED | P1 | F1, F10 (CoverArt), P3, P4, P8 |
| [CMP-012](CMP-012.md) | Cover art is never cropped or covered | PROHIBITION | SETTLED | P1 | F10 (CoverArt), P3, P4 |
| [CMP-013](CMP-013.md) | Cover art is never animated or distorted | PROHIBITION | SETTLED | P1 | F3, F9, F10, P3, V1 |
| [CMP-014](CMP-014.md) | Spotify metadata as provided, and always readable in full | OBLIGATION | SETTLED | P1 | P3, P4, P8 |
| [CMP-015](CMP-015.md) | No sound over Spotify audio | PROHIBITION | SETTLED | P0 | P1, P2, P3, F3, F10 |
| [CMP-016](CMP-016.md) | Visuals are never synchronised to the music | PROHIBITION | SETTLED | P0 | F3, F9, P2, P3, V1 |
| [CMP-017](CMP-017.md) | Never show analysis derived from Spotify content | PROHIBITION | SETTLED | P0 | P3, P4, P7, P8, P13, server plumbing |
| [CMP-018](CMP-018.md) | Personalising from Spotify listening data | OPEN QUESTION | NEEDS OWNER | P0 | backend, server plumbing, P3, P4, P8 |
| [CMP-019](CMP-019.md) | No Spotify content goes into ML or AI models | PROHIBITION | SETTLED | P0 | backend, server plumbing, P3, P4 |
| [CMP-020](CMP-020.md) | No Spotify content goes to third parties | PROHIBITION | SETTLED | P0 | backend, server plumbing |
| [CMP-021](CMP-021.md) | The YouTube library is played through Spotify | OPEN QUESTION | HALT | P0 | backend, P2, P3, P6 |
| [CMP-022](CMP-022.md) | Spotify content is never stored indefinitely | PROHIBITION | HALT | P0 | backend, server plumbing, P8, P3 |
| [CMP-023](CMP-023.md) | Delete Spotify personal data within 5 days of disconnect | OBLIGATION | HALT | P0 | backend, P9 |
| [CMP-024](CMP-024.md) | Retention window for provider track data | OPEN QUESTION | NEEDS OWNER | P0 | P8, backend, server plumbing |
| [CMP-025](CMP-025.md) | Spotify disconnect is easy and explained | OBLIGATION | SETTLED | P1 | P9, P6 |
| [CMP-026](CMP-026.md) | Privacy policy shown before sign-up (Spotify) | OBLIGATION | HALT | P0 | P11, P14, store listing |
| [CMP-027](CMP-027.md) | Never targeted at children | PROHIBITION | SETTLED | P0 | P10 (the reserved age-step slot), P13, store listing |
| [CMP-028](CMP-028.md) | No implied Spotify endorsement or co-branding | PROHIBITION | SETTLED | P1 | P3, P4, P13, F10 |
| [CMP-029](CMP-029.md) | App identity never resembles Spotify | PROHIBITION | SETTLED | P1 | P12, P1 (tab glyphs), F1, V1, P13 |
| [CMP-030](CMP-030.md) | No clone of Spotify's core experience | PROHIBITION | SETTLED | P1 | P3, V1 |
| [CMP-031](CMP-031.md) | No broadcasting one stream to many listeners | PROHIBITION | SETTLED | P1 | P2, P3 |
| [CMP-032](CMP-032.md) | Honour Spotify Free playback restrictions | OBLIGATION | SETTLED | P1 | P2 (the no-Premium state), P3 |
| [CMP-033](CMP-033.md) | Is App Remote playback a "Streaming SDA"? | OPEN QUESTION | NEEDS OWNER | P1 | P2, P3, P13 |
| [CMP-034](CMP-034.md) | No automated Spotify plays | PROHIBITION | SETTLED | P1 | P2, P3, Q3 |
| [CMP-035](CMP-035.md) | Spotify authorisation only when the user asks | PROHIBITION | SETTLED | P1 | P1, P3, P6, Q3 |
| [CMP-036](CMP-036.md) | Kokonada-drawn notifications carry Spotify attribution | OBLIGATION | SETTLED | P1 | P1, P3 |
| [CMP-037](CMP-037.md) | No real artists, tracks or cover art outside live playback | PROHIBITION | SETTLED | P0 | V0, V1, F4, P10, P13, store listing |
| [CMP-038](CMP-038.md) | Call it "YouTube", never "YouTube Music" | OBLIGATION | HALT | P0 | P6, P9, P13 |
| [CMP-039](CMP-039.md) | "YouTube" is never part of the app's name | PROHIBITION | SETTLED | P0 | P12, P13, store listing |
| [CMP-040](CMP-040.md) | YouTube copy stays truthful | PROHIBITION | SETTLED | P1 | P6, P9 |
| [CMP-041](CMP-041.md) | Items from YouTube carry YouTube attribution | OBLIGATION | SETTLED | P0 | P3, P4, P8, server plumbing, F10 |
| [CMP-042](CMP-042.md) | No hidden or audio-only YouTube playback | PROHIBITION | SETTLED | P0 | P2, P3 |
| [CMP-043](CMP-043.md) | Disconnecting YouTube in the app revokes access at Google | OBLIGATION | HALT | P0 | P9, backend |
| [CMP-044](CMP-044.md) | Honour revocations made on Google's side | OBLIGATION | SETTLED | P0 | backend, P9 |
| [CMP-045](CMP-045.md) | YouTube data is kept for 30 days at most | PROHIBITION | NEEDS OWNER | P0 | backend, P8, server plumbing |
| [CMP-046](CMP-046.md) | YouTube data is never given to other services | PROHIBITION | HALT | P0 | backend, P6 |
| [CMP-047](CMP-047.md) | Ask YouTube only for the scopes in use | OBLIGATION | SETTLED | P1 | P6, backend |
| [CMP-048](CMP-048.md) | Terms of use bind users to YouTube's terms | OBLIGATION | SETTLED | P0 | P14, P11, P6, store listing |
| [CMP-049](CMP-049.md) | Privacy policy covers YouTube use | OBLIGATION | SETTLED | P0 | P14, P6, store listing |
| [CMP-050](CMP-050.md) | YouTube OAuth verification and the 100-user cap | OPEN QUESTION | NEEDS OWNER | P1 | P6, store listing |
| [CMP-051](CMP-051.md) | No Garmin API surface without a signed agreement | PROHIBITION | NEEDS OWNER | P0 | P4, P6, P7, P8, P9, P13 |
| [CMP-052](CMP-052.md) | Thirty days' notice before new Garmin-data screens | OBLIGATION | NEEDS OWNER | P0 | P4, P7, P8, P9, P13 |
| [CMP-053](CMP-053.md) | "Garmin [device model]" on every primary Garmin view | OBLIGATION | SETTLED | P0 | P7, P2 (source chip), F10 |
| [CMP-054](CMP-054.md) | Garmin attribution sits with the heading, above the fold | OBLIGATION | SETTLED | P0 | P7, P4 |
| [CMP-055](CMP-055.md) | Garmin attribution on secondary and history views | OBLIGATION | SETTLED | P0 | P7, P8, P4 |
| [CMP-056](CMP-056.md) | Garmin attribution travels with exported data | OBLIGATION | SETTLED | P0 | P9 (export), backend |
| [CMP-057](CMP-057.md) | Derived results credit Garmin as a contributing source | OBLIGATION | SETTLED | P0 | P4, P2, P7, server plumbing |
| [CMP-058](CMP-058.md) | Kokonada's own metrics never carry Garmin's name | PROHIBITION | SETTLED | P1 | P7, P5 |
| [CMP-059](CMP-059.md) | Data that is not Garmin's is never labelled Garmin | PROHIBITION | SETTLED | P0 | backend, P6, P7, P9 |
| [CMP-060](CMP-060.md) | Garmin Connect named in full, shown with its tile | OBLIGATION | NEEDS OWNER | P0 | P6, P14 |
| [CMP-061](CMP-061.md) | Garmin tag logo rules, and text as the default | PROHIBITION | SETTLED | P1 | F10, P7, P4 |
| [CMP-062](CMP-062.md) | "Body Battery™": wording and scope | OBLIGATION | SETTLED | P1 | P7, P5 |
| [CMP-063](CMP-063.md) | May Garmin data drive music generation? | OPEN QUESTION | NEEDS OWNER | P0 | backend, P2, P4, P7 |
| [CMP-064](CMP-064.md) | Garmin's AI transparency statement in the privacy policy | OPEN QUESTION | NEEDS OWNER | P0 | P5, P14, store listing |
| [CMP-065](CMP-065.md) | Terms that protect Garmin, and a way to report abuse | OBLIGATION | SETTLED | P1 | P11, P14, store listing |
| [CMP-066](CMP-066.md) | The Health Connect rationale shows the Play Console privacy policy | OBLIGATION | HALT | P0 | P5, P6, store listing |
| [CMP-067](CMP-067.md) | The Android 14+ rationale alias targets the rationale activity | OBLIGATION | HALT | P0 | P5, P6, Q1 |
| [CMP-068](CMP-068.md) | Onboarding activity for connections started from Health Connect | OBLIGATION | SETTLED | P1 | P5, P6, Q1 |
| [CMP-069](CMP-069.md) | Show the source app for Health Connect data | OBLIGATION | SETTLED | P1 | P7, P4, server plumbing |
| [CMP-070](CMP-070.md) | Link data views to Health Connect's App permissions | OBLIGATION | SETTLED | P1 | P4, P7 |
| [CMP-071](CMP-071.md) | Screens for too little access and for two cancels | OBLIGATION | SETTLED | P1 | P1, P6, P7 |
| [CMP-072](CMP-072.md) | Manage-access link, sync switch, and the truth after withdrawal | OBLIGATION | SETTLED | P1 | P9 |
| [CMP-073](CMP-073.md) | Health Connect naming and verbs | PROHIBITION | SETTLED | P1 | P5, P6, P10 |
| [CMP-074](CMP-074.md) | Health Connect logo: official asset on a light ground | OBLIGATION | SETTLED | P1 | F1, F2, F10, P6 |
| [CMP-075](CMP-075.md) | Consent categories match the OS sheet exactly | OBLIGATION | SETTLED | P0 | P5, Q1 |
| [CMP-076](CMP-076.md) | Request only what a feature uses, when it is used | OBLIGATION | SETTLED | P1 | P5, P6, Q1 |
| [CMP-077](CMP-077.md) | Declare an approved Health Connect use case | OBLIGATION | SETTLED | P0 | store listing, P13 |
| [CMP-078](CMP-078.md) | Prominent disclosure before sensitive access | OBLIGATION | SETTLED | P0 | P5, P6, F10 (ConsentChoicePair), Q3 |
| [CMP-079](CMP-079.md) | Permissions only in context, only for current features | OBLIGATION | SETTLED | P0 | P1, P2, P6, P10, Q3 |
| [CMP-080](CMP-080.md) | Background collection stops, or is disclosed | OBLIGATION | SETTLED | P1 | P6, backend |
| [CMP-081](CMP-081.md) | Privacy policy link inside the app (Play) | OBLIGATION | HALT | P0 | P5, P9, P11, P14, F10 (LegalLinks), store listing |
| [CMP-082](CMP-082.md) | Account deletion in the app and on the web | OBLIGATION | SETTLED | P0 | P9, P14, store listing |
| [CMP-083](CMP-083.md) | Health apps declaration completed | OBLIGATION | SETTLED | P0 | store listing, P13 |
| [CMP-084](CMP-084.md) | The listing carries the not-a-medical-device sentence verbatim | OBLIGATION | SETTLED | P0 | P13, store listing |
| [CMP-085](CMP-085.md) | The listing states the hardware each feature needs | OBLIGATION | SETTLED | P0 | P13, store listing |
| [CMP-086](CMP-086.md) | No misleading health or capability claims | PROHIBITION | HALT | P0 | P2, P4, P7, P8, P10, P13, store listing |
| [CMP-087](CMP-087.md) | In-app health statements match what the code does | OBLIGATION | SETTLED | P0 | P5, P6, P7, P9 |
| [CMP-088](CMP-088.md) | Health data is never used for ads or marketing | PROHIBITION | SETTLED | P0 | P4, P5, P7, P13, store listing |
| [CMP-089](CMP-089.md) | Data safety form complete and consistent | OBLIGATION | SETTLED | P0 | P13, store listing, backend |
| [CMP-090](CMP-090.md) | A report control on any text an LLM wrote | OBLIGATION | SETTLED | P0 | P3, P4, server plumbing, store listing |
| [CMP-091](CMP-091.md) | Target API level 36 | OBLIGATION | SETTLED | P0 | Q1, store listing |
| [CMP-092](CMP-092.md) | Play's 12-tester closed test against Spotify's 5-user cap | OPEN QUESTION | NEEDS OWNER | P0 | store listing, P13, P3 |
| [CMP-093](CMP-093.md) | Organization account for a health app | OBLIGATION | HALT | P0 | the Play account, store listing |
| [CMP-094](CMP-094.md) | Audience excludes children, and assets do not appeal to them | OBLIGATION | NEEDS OWNER | P0 | P10 (age-step slot), P13, V0, V1, store listing |
| [CMP-095](CMP-095.md) | Title and metadata rules | OBLIGATION | SETTLED | P0 | P13, store listing |
| [CMP-096](CMP-096.md) | Screenshot and graphic rules | OBLIGATION | SETTLED | P0 | P13, store listing |
| [CMP-097](CMP-097.md) | Store icon specification | OBLIGATION | SETTLED | P1 | P12, P13 |
| [CMP-098](CMP-098.md) | No dead-end buttons or features that are not delivered | PROHIBITION | SETTLED | P1 | P1, P2, P6, P8 |
| [CMP-099](CMP-099.md) | Official Sign in with Google button | OBLIGATION | HALT | P0 | P11, F1, F2, F10 |
| [CMP-100](CMP-100.md) | Google button padding and label | OBLIGATION | SETTLED | P1 | P11, F7 |
| [CMP-101](CMP-101.md) | Google button at least as prominent as the others | OBLIGATION | SETTLED | P1 | P11 |
| [CMP-102](CMP-102.md) | OAuth never runs in an embedded WebView | PROHIBITION | SETTLED | P0 | P1 (deep link), P6, P11 |
| [CMP-103](CMP-103.md) | The Google button label in Hebrew and right-to-left | OPEN QUESTION | NEEDS OWNER | P1 | P11, F6, F7 |
| [CMP-104](CMP-104.md) | (Later, iOS) An equivalent login beside Google | OBLIGATION | SETTLED | P0 | P11 (iOS, later) |
| [CMP-105](CMP-105.md) | (Later, iOS) Sign in with Apple button specification | OBLIGATION | SETTLED | P1 | P11 (iOS, later) |
| [CMP-106](CMP-106.md) | (Later, iOS) Account deletion inside the app | OBLIGATION | SETTLED | P0 | P9 (iOS, later) |
| [CMP-107](CMP-107.md) | (Later, iOS) Health data rules | PROHIBITION | SETTLED | P0 | P5, P13 (iOS, later) |
| [CMP-108](CMP-108.md) | (Later, iOS) Accuracy claims and the doctor reminder | OBLIGATION | SETTLED | P0 | P4, P7 (iOS, later) |
| [CMP-109](CMP-109.md) | (Later, iOS) Disclose sharing with third-party AI | OBLIGATION | SETTLED | P0 | P5, P6, P11 (iOS, later) |
| [CMP-110](CMP-110.md) | Edge-to-edge: every screen handles insets | OBLIGATION | SETTLED | P0 | F5, P1–P14 |
| [CMP-111](CMP-111.md) | Predictive back | OBLIGATION | SETTLED | P1 | F5, P1, P2, P3, P4, P5, P6 |
| [CMP-112](CMP-112.md) | Large screens ignore orientation locks | OBLIGATION | SETTLED | P1 | F5, P1–P11 |
| [CMP-113](CMP-113.md) | Bluetooth permissions match the lane that is kept | OBLIGATION | SETTLED | P1 | P6, Q1 |
| [CMP-114](CMP-114.md) | The user picks the heart-rate device | OBLIGATION | SETTLED | P0 | P6 |
| [CMP-115](CMP-115.md) | No notification permission or push tokens at launch | PROHIBITION | SETTLED | P1 | P1, P9, backend, Q1 |
| [CMP-116](CMP-116.md) | System splash-screen rules | OBLIGATION | SETTLED | P1 | P12 |
| [CMP-117](CMP-117.md) | Ship each font's copyright notice and OFL text | OBLIGATION | SETTLED | P0 | F6, P14, Q1 |
| [CMP-118](CMP-118.md) | Reserved Font Names on modified fonts | PROHIBITION | SETTLED | P0 | F6, V1, Q1 |
| [CMP-119](CMP-119.md) | OFL fonts stay under the OFL | PROHIBITION | SETTLED | P1 | F6, P14 |
| [CMP-120](CMP-120.md) | Remove General Sans (FF EULA) from the app and the repo | PROHIBITION | HALT | P0 | F6, P12, P14, Q1 |
| [CMP-121](CMP-121.md) | General Sans git history is never made public | PROHIBITION | SETTLED | P1 | F6, backend (repository operations) |
| [CMP-122](CMP-122.md) | Check Hebrew coverage in each shipped file | OBLIGATION | SETTLED | P1 | F6, F7, V1, Q1 |
| [CMP-123](CMP-123.md) | IBM Plex Sans has no Hebrew | OBLIGATION | SETTLED | P1 | F6, V1 |
| [CMP-124](CMP-124.md) | Licence facts for the V0 families | OBLIGATION | SETTLED | P1 | V0, V1, F6 |
| [CMP-125](CMP-125.md) | Bellefair: licence clear, one weight, outside F6 | OPEN QUESTION | NEEDS OWNER | P1 | V0, V1, F6 |
| [CMP-126](CMP-126.md) | AttributionSlot takes only official assets | OBLIGATION | SETTLED | P0 | F10, Q1, P3, P4, P6, P7, P8, P11 |
| [CMP-127](CMP-127.md) | Marks are never altered, animated or mirrored | PROHIBITION | SETTLED | P0 | F3, F7, F10, P3, P4, P6, P7, P11 |
| [CMP-128](CMP-128.md) | Marks never sit on the field or a busy background | PROHIBITION | SETTLED | P1 | F2, F9, F10, P2, P3, P4, P7, P8 |
| [CMP-129](CMP-129.md) | Kokonada's identity never resembles provider marks | PROHIBITION | SETTLED | P1 | P1, P12, P13, F1, V1 |
| [CMP-130](CMP-130.md) | Provider names in their official form in every locale | OBLIGATION | SETTLED | P1 | F7, P1, P6, P7, P11, P14 |
| [CMP-131](CMP-131.md) | Translating Spotify's link-back label | OPEN QUESTION | NEEDS OWNER | P1 | F7, P3, P4 |
| [CMP-132](CMP-132.md) | Reference boards and other brands' designs never ship | PROHIBITION | SETTLED | P1 | V0, V1, F4, P13 |
| [CMP-133](CMP-133.md) | System copy never blames a provider or implies a tie to one | PROHIBITION | SETTLED | P1 | P1, P2, P3, P6 |
| [CMP-134](CMP-134.md) | The AI notice never names a provider | PROHIBITION | SETTLED | P0 | F10, P2, P3, P4, P5, P7, P10 |
| [CMP-135](CMP-135.md) | Medical disclaimer consistent with the listing | OBLIGATION | SETTLED | P1 | F10, P4, P7, P13 |
| [CMP-136](CMP-136.md) | No Suunto surface before an audit | PROHIBITION | SETTLED | P0 | P6, P7, backend |
| [CMP-137](CMP-137.md) | Trademark clearance for the name | OPEN QUESTION | NEEDS OWNER | P1 | P12, P13, store listing |
| [CMP-138](CMP-138.md) | MusicProfile's Spotify content has a refresh clock | OBLIGATION | HALT | P0 | backend, P3 |
| [CMP-139](CMP-139.md) | A disconnect made on Spotify's side deletes within 5 days | OBLIGATION | HALT | P0 | backend, P9 |
| [CMP-140](CMP-140.md) | Health data is encrypted at rest and in transit on every host that holds it | OBLIGATION | SETTLED | P0 | backend, store listing |
| [REG-001](REG-001.md) | Is the affect engine an emotion recognition system? | OPEN QUESTION | NEEDS COUNSEL | P0 | P1, P2, P4, P5, P7, P8, P10, P13; backend (`backend/app/agents/runtime/physiology/affectEngine.js`, `backend/app/agents/runtime/knowledge/stateTaxonomy.js`) |
| [REG-002](REG-002.md) | Is the nine-rule Pulse classifier an AI system? | OPEN QUESTION | NEEDS COUNSEL | P1 | P7 |
| [REG-003](REG-003.md) | Are AI Act duties live for today's testers? | OPEN QUESTION | NEEDS COUNSEL | P1 | all pages (timing); backend |
| [REG-004](REG-004.md) | Who is the deployer that owes the notice? | OPEN QUESTION | NEEDS COUNSEL | P1 | P2, P4, P5, P7, P8, P10 |
| [REG-005](REG-005.md) | Tell exposed people the system is operating | OBLIGATION | NEEDS COUNSEL | P0 | P1 (if any tint comes from an inferred state), P2, P4, P5 (scope-framed wording), P7, P8, P10; Stage 0 F9, F10 (`AiDisclosure`) |
| [REG-006](REG-006.md) | Notice no later than first exposure, per person | OBLIGATION | NEEDS COUNSEL | P0 | P2, P6, P10, P11; Stage 0 F10 |
| [REG-007](REG-007.md) | First exposure: start of processing or first output? | OPEN QUESTION | NEEDS COUNSEL | P0 | P2, P5, P6 |
| [REG-008](REG-008.md) | Notice clear, distinguishable, never buried | OBLIGATION | NEEDS COUNSEL | P0 | P2, P4, P7, P8, P10; Stage 0 F10 |
| [REG-009](REG-009.md) | Notice in an accessible format | OBLIGATION | NEEDS COUNSEL | P0 | P2, P4, P7, P8, P10; Stage 0 F1, F2/F3, F5, F6, F7, F10 |
| [REG-010](REG-010.md) | An emotion recognition deployer must also comply with GDPR | OBLIGATION | NEEDS COUNSEL | P0 | backend; P5, P6 |
| [REG-011](REG-011.md) | Notice to people processed before they saw it | OPEN QUESTION | NEEDS COUNSEL | P1 | P10 (a one-time notice on the next launch); backend |
| [REG-012](REG-012.md) | Does the session flow "interact directly" with people? | OPEN QUESTION | NEEDS COUNSEL | P1 | P2, P3, P4 |
| [REG-013](REG-013.md) | Machine-readable marking of LLM-written captions | OBLIGATION | NEEDS COUNSEL | P0 | P4; backend |
| [REG-014](REG-014.md) | No workplace or education deployment or marketing | PROHIBITION | NEEDS OWNER | P0 | P13, P14; store listing; any B2B channel |
| [REG-015](REG-015.md) | The user-chosen "Working" and "Focus" contexts | OPEN QUESTION | NEEDS COUNSEL | P0 | P2 |
| [REG-016](REG-016.md) | No subliminal or manipulative techniques | PROHIBITION | SETTLED | P0 | P1, P2, P3, P7; Stage 0 V1, F2/F3, F8, F9 |
| [REG-017](REG-017.md) | No message triggered by an inferred state | PROHIBITION | NEEDS OWNER | P0 | P1, P2, P9; backend (the `User.pushTokens` field exists) |
| [REG-018](REG-018.md) | Annex III high-risk classification and its date | OPEN QUESTION | NEEDS COUNSEL | P0 | backend; every inference surface; Stage 0 F10 (a reserved slot) |
| [REG-019](REG-019.md) | The Art. 6(3) way out, and per-user profiling | OPEN QUESTION | NEEDS COUNSEL | P1 | backend |
| [REG-020](REG-020.md) | Tell people they are subject to a high-risk system | OBLIGATION | NEEDS COUNSEL | P1 | P2, P4, P7; Stage 0 F10 |
| [REG-021](REG-021.md) | High-risk conformity before placing on the market | OBLIGATION | NEEDS COUNSEL | P0 | backend; the owner |
| [REG-022](REG-022.md) | Systems already on the market before the date | OPEN QUESTION | NEEDS COUNSEL | P1 | the owner (calendar) |
| [REG-023](REG-023.md) | AI literacy measures | OBLIGATION | NEEDS OWNER | P1 | the owner; no page |
| [REG-024](REG-024.md) | Name the controller and where it is established | OPEN QUESTION | NEEDS OWNER | P0 | P5, P9, P11, P14; privacy notice |
| [REG-025](REG-025.md) | An EU representative if the controller is outside the EU | OBLIGATION | NEEDS COUNSEL | P0 | P5, P11, P14; privacy notice |
| [REG-026](REG-026.md) | Explicit consent before any processing of wearable health data | OBLIGATION | SETTLED | P0 | P2, P5, P6, P7; backend |
| [REG-027](REG-027.md) | Consent is an express statement | OBLIGATION | SETTLED | P0 | P5; Stage 0 F10 (`ConsentChoicePair`) |
| [REG-028](REG-028.md) | Consent names inference and profiling as purposes | OBLIGATION | SETTLED | P0 | P5; privacy notice |
| [REG-029](REG-029.md) | Consent names the controller | OBLIGATION | SETTLED | P0 | P5 |
| [REG-030](REG-030.md) | Consent lists exactly the categories that are read | OBLIGATION | SETTLED | P0 | P5, P6 |
| [REG-031](REG-031.md) | Is mood-only input health data? | OPEN QUESTION | NEEDS COUNSEL | P0 | P2, P5, P8, P10; backend |
| [REG-032](REG-032.md) | A lawful basis for each non-health processing | OPEN QUESTION | NEEDS COUNSEL | P0 | P2, P3, P8, P9, P11; privacy notice; backend |
| [REG-033](REG-033.md) | Read only the user's own wearable | OBLIGATION | SETTLED | P0 | P6 |
| [REG-034](REG-034.md) | Proof of each consent, per version and language | OBLIGATION | SETTLED | P0 | P5; Stage 0 F7, Q1–Q3; backend (`backend/app/services/privacy/consent.js:44-58`) |
| [REG-035](REG-035.md) | Consent separate from sign-in and terms, nothing pre-ticked | OBLIGATION | SETTLED | P0 | P5, P6, P11; Stage 0 F10 |
| [REG-036](REG-036.md) | Refusing costs nothing; mood-only is a real equal | OBLIGATION | SETTLED | P0 | P2, P5, P6, P7 (empty state), P10; Stage 0 F10 |
| [REG-037](REG-037.md) | Withdrawal as easy as consent, in the same interface | OBLIGATION | SETTLED | P0 | P5, P9; Stage 0 F5 (controls above the navigation bar, MB-038) |
| [REG-038](REG-038.md) | Is a two-step withdrawal confirm "as easy"? | OPEN QUESTION | NEEDS COUNSEL | P0 | P9 |
| [REG-039](REG-039.md) | Before consent: the right to withdraw, and what stays | OBLIGATION | SETTLED | P0 | P5, P9; privacy notice |
| [REG-040](REG-040.md) | After the purpose text changes: consent again, or just be told? | OPEN QUESTION | NEEDS COUNSEL | P0 | P5; backend (`CURRENT_CONSENT_VERSION`, `consent.js:15`) |
| [REG-041](REG-041.md) | No repeated prompting after a refusal | PROHIBITION | SETTLED | P0 | P2, P5, P6, P7, P10 |
| [REG-042](REG-042.md) | Minimum age, parental permission, age checks | OPEN QUESTION | NEEDS COUNSEL | P0 | P5, P10, P11, P13 |
| [REG-043](REG-043.md) | Child-readable wording if children can use the app | OBLIGATION | NEEDS OWNER | P1 | P5, P10, P11; Stage 0 F7 |
| [REG-044](REG-044.md) | Full Art. 13 information at sign-in | OBLIGATION | SETTLED | P0 | P11; privacy notice; Stage 0 F10 (`LegalLinks`) |
| [REG-045](REG-045.md) | Retention stated per category, and true of the code | OBLIGATION | SETTLED | P0 | P3, P5, P8, P9, P14; privacy notice; backend; Stage 0 step 14 |
| [REG-046](REG-046.md) | Explain the profiling and what it does | OBLIGATION | NEEDS COUNSEL | P1 | P4, P5; privacy notice |
| [REG-047](REG-047.md) | Notices intelligible in each market's language | OPEN QUESTION | NEEDS COUNSEL | P0 | P2, P5, P7, P10, P11, P13, P14; Stage 0 F6, F7 |
| [REG-048](REG-048.md) | Privacy notice and terms reachable wherever data is asked for | OBLIGATION | SETTLED | P0 | P5, P6, P9, P11, P14; Stage 0 F10 (`LegalLinks`) |
| [REG-049](REG-049.md) | Art. 13 or Art. 14 for data from other apps | OPEN QUESTION | NEEDS COUNSEL | P1 | P6, P14; privacy notice |
| [REG-050](REG-050.md) | In-app routes to every right | OBLIGATION | SETTLED | P0 | P9, P14 |
| [REG-051](REG-051.md) | The access copy includes inferences, in readable form | OBLIGATION | SETTLED | P0 | P8, P9; backend (`backend/app/services/privacy/userDataExport.js`); Stage 0 step 14 |
| [REG-052](REG-052.md) | The P9 export in a portable format | OBLIGATION | SETTLED | P0 | P8, P9; backend; Stage 0 step 14 |
| [REG-053](REG-053.md) | Answer rights requests within a month | OBLIGATION | SETTLED | P1 | P14 (contact); the owner |
| [REG-054](REG-054.md) | Erase on withdrawal and on deletion, and say so truthfully | OBLIGATION | SETTLED | P0 | P5, P9; backend (`consent.js:71-164`, `wearableErasure.js`) |
| [REG-055](REG-055.md) | The right to object, where legitimate interests are used | OBLIGATION | NEEDS COUNSEL | P0 | P9, P11; privacy notice |
| [REG-056](REG-056.md) | Confirm that Art. 22 is not engaged | OPEN QUESTION | NEEDS COUNSEL | P1 | P4, P9 |
| [REG-057](REG-057.md) | Inferred affect never shapes choice architecture | OBLIGATION | SETTLED | P0 | P1, P2, P5, P6, P9, P11; Stage 0 V1, F1, F9, F10 |
| [REG-058](REG-058.md) | Least data by default | OBLIGATION | SETTLED | P0 | P2, P6, P10 |
| [REG-059](REG-059.md) | Record of processing activities | OBLIGATION | SETTLED | P1 | P3; backend; the owner; Stage 0 step 14 |
| [REG-060](REG-060.md) | Is a DPIA required before processing? | OPEN QUESTION | NEEDS COUNSEL | P0 | the owner; backend; every health page |
| [REG-061](REG-061.md) | A contract with every processor | OBLIGATION | SETTLED | P0 | P14; privacy notice; backend; the owner |
| [REG-062](REG-062.md) | A transfer mechanism for each recipient outside the EU | OBLIGATION | NEEDS OWNER | P0 | P5, P11, P14; privacy notice; backend |
| [REG-063](REG-063.md) | The withdrawal log line: accountability or minimisation? | OPEN QUESTION | NEEDS COUNSEL | P1 | backend |
| [REG-064](REG-064.md) | Record why each item on the phone is strictly necessary | OBLIGATION | SETTLED | P1 | backend documentation; Stage 0 F4 (no design-lab storage in release builds) |
| [REG-065](REG-065.md) | Reading heart rate from the phone under Art. 5(3) | OPEN QUESTION | NEEDS COUNSEL | P0 | P5, P6 |
| [REG-066](REG-066.md) | No new SDK, telemetry or push without a basis | PROHIBITION | SETTLED | P0 | P1, P9; backend; Stage 0 F4, F9 |
| [REG-067](REG-067.md) | The EDPB deceptive-design checklist at G5 | OBLIGATION | SETTLED | P0 | P5, P6, P9, P10, P11 |
| [REG-068](REG-068.md) | Equal prominence for refusing and accepting | OBLIGATION | SETTLED | P0 | P5, P6, P9, P11; Stage 0 F5, F10 |
| [REG-069](REG-069.md) | No confirmshaming and no emotional steering | PROHIBITION | SETTLED | P0 | P5, P6, P9, P11; Stage 0 F10 |
| [REG-070](REG-070.md) | No claims about health effects | PROHIBITION | SETTLED | P0 | P2, P3, P4, P7, P10, P12, P13, P14; store listing |
| [REG-071](REG-071.md) | No overclaiming accuracy or certainty | PROHIBITION | SETTLED | P0 | P4, P7, P13 |
| [REG-072](REG-072.md) | Does the UCPD reach a free app? | OPEN QUESTION | NEEDS COUNSEL | P1 | P13; all copy |
| [REG-073](REG-073.md) | The Consumer Rights and Digital Content Directives | OPEN QUESTION | NEEDS COUNSEL | P1 | P11, P14 |
| [REG-074](REG-074.md) | The new Product Liability Directive and software | OPEN QUESTION | NEEDS COUNSEL | P1 | P4, P7, P13, P14 |
| [REG-075](REG-075.md) | No medical purpose in any claim | PROHIBITION | SETTLED | P0 | P1–P14; store listing; site |
| [REG-076](REG-076.md) | No labels that predict a condition, anywhere | PROHIBITION | SETTLED | P0 | P7; backend; Stage 0 step 14 |
| [REG-077](REG-077.md) | No alarms from physiological monitoring | PROHIBITION | NEEDS COUNSEL | P0 | P7; backend; Stage 0 step 14 (the `morning` types) |
| [REG-078](REG-078.md) | No normal ranges and no verdicts on readings | PROHIBITION | SETTLED | P0 | P7, P8; Stage 0 F1 |
| [REG-079](REG-079.md) | The "not a medical device" statement | OPEN QUESTION | NEEDS COUNSEL | P1 | P4, P7, P13, P14; Stage 0 F10 (`MedicalDisclaimer`) |
| [REG-080](REG-080.md) | Does any feature create a medical purpose? | OPEN QUESTION | NEEDS COUNSEL | P0 | P4, P7, P13 |
| [REG-081](REG-081.md) | No clinical or diagnostic state labels | PROHIBITION | SETTLED | P0 | P4, P7, P8, P13; Stage 0 Q1–Q3, step 14 |
| [REG-082](REG-082.md) | No inferred state shown as fact | OBLIGATION | SETTLED | P0 | P4, P7, P8; Stage 0 step 14 (`receipt.why`) |
| [REG-083](REG-083.md) | Every server state string goes through a fail-closed display map | OBLIGATION | SETTLED | P0 | P1, P4, P7, P8; Stage 0 Q1–Q3, step 14 |
| [REG-084](REG-084.md) | Borderline words need counsel | OPEN QUESTION | NEEDS COUNSEL | P0 | P7, P8, P13 |
| [REG-085](REG-085.md) | Is Kokonada a Data Act third party, or a related service? | OPEN QUESTION | NEEDS COUNSEL | P1 | P6; backend |
| [REG-086](REG-086.md) | As a Data Act third party: no dark patterns, no unneeded profiling | PROHIBITION | NEEDS COUNSEL | P0 | P6, P9 |
| [REG-087](REG-087.md) | Is the app inside the European Accessibility Act? | OPEN QUESTION | NEEDS COUNSEL | P1 | P14; Stage 0 F2/F3, F5, F6, F10 |
| [REG-088](REG-088.md) | Accessibility information on P14 | OBLIGATION | NEEDS COUNSEL | P1 | P14 |
| [REG-089](REG-089.md) | DSA: only the hosting limb is in question | OPEN QUESTION | NEEDS COUNSEL | P1 | P2, P8, P14 |
| [REG-200](REG-200.md) | UK: explicit consent before any wearable health data | OBLIGATION | NEEDS COUNSEL + | P0 | P5, P6, P7, backend ingest gates, privacy notice |
| [REG-201](REG-201.md) | UK: first-layer notice at sign-in | OBLIGATION | NEEDS OWNER + | P0 | P11, privacy notice |
| [REG-202](REG-202.md) | UK: whether a UK representative is required | OPEN QUESTION | NEEDS COUNSEL | P1 | P11, P14, privacy notice |
| [REG-203](REG-203.md) | UK: minimum age and whether minors can give Art. 9 consent | OPEN QUESTION | NEEDS COUNSEL | P1 | P10, P5, backend |
| [REG-204](REG-204.md) | UK: assess and document likely access by children | OBLIGATION | NEEDS OWNER + | P1 | P10, P13 (target audience), Stage 0 L1 |
| [REG-205](REG-205.md) | UK: DPIA before launch | OBLIGATION | SETTLED + | P1 | backend, Stage 0 L1 |
| [REG-206](REG-206.md) | UK: an exemption on record for each device store or read | OBLIGATION | SETTLED | P0 | P6, P1, backend, privacy notice |
| [REG-207](REG-207.md) | UK: complaints channel with a 30-day acknowledgment | OBLIGATION | SETTLED | P0 | P9, P14, privacy notice |
| [REG-208](REG-208.md) | UK: no claims about restoring, correcting or modifying a physiological function | PROHIBITION | SETTLED + | P0 | P2, P3, P4, P7, P13, store listing |
| [REG-209](REG-209.md) | UK: no misleading claims about accuracy or confidence | PROHIBITION | SETTLED | P0 | P2, P4, P7, P13 |
| [REG-210](REG-210.md) | UK: evidence on file for objective health claims | OBLIGATION | SETTLED | P0 | P13, store listing |
| [REG-211](REG-211.md) | UK: MHRA status (software as a medical device or wellbeing product) | OPEN QUESTION | NEEDS COUNSEL | P1 | P4, P7, P13, P14 |
| [REG-212](REG-212.md) | UK: anticipatory reasonable adjustments | OBLIGATION | NEEDS COUNSEL + | P1 | P1–P14 |
| [REG-213](REG-213.md) | UK: an inferred state is shown as uncertain and drives no decision | OBLIGATION | NEEDS COUNSEL | P0 | P2, P4, P7, P8 |
| [REG-214](REG-214.md) | UK: withdrawal as easy as giving consent | OBLIGATION | NEEDS COUNSEL + | P0 | P5, P9 |
| [REG-215](REG-215.md) | UK: transfers to US recipients | OBLIGATION | NEEDS OWNER + | P0 | backend, privacy notice, P11 |
| [REG-216](REG-216.md) | UK: a sharing feature triggers the Online Safety Act | OPEN QUESTION | SETTLED + | P1 | any future page |
| [REG-217](REG-217.md) | FTC: every privacy statement is true of the code | OBLIGATION | SETTLED | P0 | privacy notice, P9, P13, backend |
| [REG-218](REG-218.md) | FTC: no health-benefit claim without scientific evidence | PROHIBITION | SETTLED | P0 | P2, P3, P7, P13 |
| [REG-219](REG-219.md) | FTC: no accuracy claim beyond the evidence; foreseeable harms assessed | OBLIGATION | NEEDS COUNSEL + | P0 | P2, P4, P7, P13 |
| [REG-220](REG-220.md) | FTC: choice architecture never obstructs a privacy choice | OBLIGATION | SETTLED | P0 | P5, P6, P9, P10, Stage 0 F10 (`ConsentChoicePair`) |
| [REG-221](REG-221.md) | FTC Health Breach Notification Rule: is Kokonada a vendor of personal health records? | OPEN QUESTION | NEEDS COUNSEL | P1 | backend, P7, P9 |
| [REG-222](REG-222.md) | HBNR: breach-notice readiness | OBLIGATION | NEEDS COUNSEL | P1 | backend, P1 (an in-app notice surface), privacy notice |
| [REG-223](REG-223.md) | HBNR: is an unauthorized disclosure a breach? | OPEN QUESTION | NEEDS COUNSEL | P1 | backend |
| [REG-224](REG-224.md) | COPPA: the service is not directed to children | OBLIGATION | NEEDS OWNER | P0 | P10, P12, P13 |
| [REG-225](REG-225.md) | COPPA: actual knowledge of a user under 13 | OBLIGATION | NEEDS COUNSEL | P1 | P10, backend |
| [REG-226](REG-226.md) | FDA: no reference to disease, clinical thresholds or clinical equivalence | PROHIBITION | NEEDS COUNSEL + | P0 | P4, P7, P13, P14 |
| [REG-227](REG-227.md) | FDA: no claim of an effect on a body function | PROHIBITION | NEEDS COUNSEL | P0 | P2, P3, P7, P13 |
| [REG-228](REG-228.md) | The app's display name "KokonadaHealth" as a claim | OPEN QUESTION | NEEDS COUNSEL | P1 | P12, P13 |
| [REG-229](REG-229.md) | ADA Title III and app accessibility | OPEN QUESTION | NEEDS COUNSEL | P1 | P1–P14 |
| [REG-230](REG-230.md) | Washington: consent before collecting consumer health data | OBLIGATION | NEEDS COUNSEL + | P0 | P5, P2 (under pivot "yes"), privacy notice |
| [REG-231](REG-231.md) | Washington: separate consent for sharing | OPEN QUESTION | NEEDS COUNSEL | P1 | P5, backend, privacy notice |
| [REG-232](REG-232.md) | Washington: consumer health data privacy policy linked from the homepage | OBLIGATION | NEEDS OWNER | P0 | P14, P11, privacy notice, the hosted website |
| [REG-233](REG-233.md) | Washington: deletion including archives and backups | OBLIGATION | NEEDS OWNER + | P0 | P9, backend (Atlas backups) |
| [REG-234](REG-234.md) | Washington: no sale without valid authorization | PROHIBITION | SETTLED | P0 | backend, privacy notice, P13 |
| [REG-235](REG-235.md) | Nevada SB 370: consent to collect and to share | OBLIGATION | NEEDS COUNSEL | P1 | P5, privacy notice |
| [REG-236](REG-236.md) | Connecticut: sensitive data in scope regardless of volume | OBLIGATION | NEEDS COUNSEL | P0 | P5, P9, privacy notice |
| [REG-237](REG-237.md) | California CCPA: whether Kokonada is a "business" | OPEN QUESTION | NEEDS OWNER | P1 | backend, privacy notice |
| [REG-238](REG-238.md) | California: is HRV "neural data"? | OPEN QUESTION | NEEDS COUNSEL | P1 | P7, backend |
| [REG-239](REG-239.md) | California CMIA: provider of health care, or mental health digital service? | OPEN QUESTION | NEEDS COUNSEL | P1 | P2, P13, P14 |
| [REG-240](REG-240.md) | California: request the age signal (operative 1 January 2027) | OBLIGATION | NEEDS COUNSEL | P1 | P10, backend |
| [REG-241](REG-241.md) | Texas SB 2420: App Store Accountability Act duties for developers | OPEN QUESTION | NEEDS COUNSEL | P1 | P10, P13 |
| [REG-242](REG-242.md) | Texas TDPSA: no sale of sensitive data without consent | PROHIBITION | SETTLED | P0 | backend, privacy notice |
| [REG-243](REG-243.md) | Illinois BIPA: gate before any face, voice, hand or eye capture | OBLIGATION | SETTLED + | P0 | any future feature (voice input, camera) |
| [REG-244](REG-244.md) | Illinois: no offering or advertising of therapy | PROHIBITION | NEEDS COUNSEL + | P0 | P2, P10, P13, P14 |
| [REG-245](REG-245.md) | Nevada AB 406: no representation of professional mental health care | PROHIBITION | NEEDS COUNSEL | P0 | P2, P10, P13 |
| [REG-246](REG-246.md) | Utah: disclose generative AI when a user asks | OBLIGATION | NEEDS COUNSEL | P1 | P4, P14 (support) |
| [REG-247](REG-247.md) | Colorado SB 26-189: no inferred state in a consequential decision | OBLIGATION | SETTLED + | P1 | backend, any B2B channel |
| [REG-248](REG-248.md) | New York S9269 (NYHIPA): watch | OPEN QUESTION | NEEDS COUNSEL | P1 | P5, privacy notice |
| [REG-249](REG-249.md) | Israel: does the Protection of Privacy Law apply? | OPEN QUESTION | NEEDS COUNSEL | P1 | backend, privacy notice |
| [REG-250](REG-250.md) | Israel: health data is "information of special sensitivity"; consent is informed and explicit | OBLIGATION | NEEDS COUNSEL | P0 | P5, P6 |
| [REG-251](REG-251.md) | Israel: a new purpose needs new consent | OBLIGATION | NEEDS COUNSEL | P0 | P5, backend (consent versioning in `consent.js:15`) |
| [REG-252](REG-252.md) | Israel: section 11 notice at the point of collection | OBLIGATION | NEEDS OWNER + | P0 | P11, P5, privacy notice |
| [REG-253](REG-253.md) | Israel: is an inferred state or profile a "personality assessment"? | OPEN QUESTION | NEEDS COUNSEL | P1 | P2, P5, P8 |
| [REG-254](REG-254.md) | Israel: whether a privacy protection officer must be appointed | OPEN QUESTION | NEEDS COUNSEL | P1 | backend, privacy notice, P14 |
| [REG-255](REG-255.md) | Israel: registration, and notice to the PPA above 100,000 people | OBLIGATION | NEEDS OWNER | P1 | backend |
| [REG-256](REG-256.md) | Israel: Data Security Regulations (at least medium level) | OBLIGATION | NEEDS COUNSEL | P0 | backend |
| [REG-257](REG-257.md) | Israel: transfers abroad (the 2001 Regulations) | OBLIGATION | NEEDS COUNSEL | P0 | backend, privacy notice, P5 |
| [REG-258](REG-258.md) | Israel: data received from the EEA (the 2023 Regulations) | OPEN QUESTION | NEEDS COUNSEL | P1 | P9, backend |
| [REG-259](REG-259.md) | Israel: the PPA's AI guidance (draft) | OPEN QUESTION | NEEDS COUNSEL | P1 | P5, P2, P10 |
| [REG-260](REG-260.md) | Israel: no claims of psychological or preventive treatment | PROHIBITION | NEEDS COUNSEL | P0 | P2, P7, P13, P14 |
| [REG-261](REG-261.md) | Israel: service accessibility, regulation 35 | OPEN QUESTION | NEEDS COUNSEL | P1 | P14 and all pages |
| [REG-262](REG-262.md) | Israel: no misleading claim about use, benefit or risk | PROHIBITION | NEEDS COUNSEL | P0 | P13, P2, P7 |
| [REG-263](REG-263.md) | Israel: minors under 18 and the age slot | OPEN QUESTION | NEEDS COUNSEL | P1 | P10, P5 |
| [QA-001](QA-001.md) | Loading shows a skeleton, never a spinner | OBLIGATION | MISSING | P1 | P1–P11; F10 |
| [QA-002](QA-002.md) | An empty result always offers a wired next action | OBLIGATION | MISSING | P1 | P3, P6, P7, P8, P9 |
| [QA-003](QA-003.md) | An error never renders as the empty state | PROHIBITION | MISSING | P1 | P3, P4, P6, P7, P8, P9, P11 |
| [QA-004](QA-004.md) | Partial data is honest per field, never a dash or zero | OBLIGATION | MISSING | P1 | P3, P4, P6, P7, P8, P9 |
| [QA-005](QA-005.md) | Stale data stays visible and shows its age | OBLIGATION | NEEDS OWNER | P1 | P2, P3, P7, P8, P9 |
| [QA-006](QA-006.md) | The offline banner appears after grace, calmly, once | OBLIGATION | MISSING | P1 | P1; F10 |
| [QA-007](QA-007.md) | Offline Retry renders and revives the connection | OBLIGATION | MISSING | P1 | P1 |
| [QA-008](QA-008.md) | Errors are inline, non-alarm and retry in place | OBLIGATION | MISSING | P1 | P2–P11 |
| [QA-009](QA-009.md) | Slow requests change state and then time out | OBLIGATION | NEEDS OWNER | P1 | P1–P11 |
| [QA-010](QA-010.md) | Reduced motion renders designed stills with zero frame work | OBLIGATION | MISSING | P1 | P1–P12; F3, F9, F10 |
| [QA-011](QA-011.md) | Battery saver switches to the low-power tier | OBLIGATION | MISSING | P1 | P1–P12; F3, F9 |
| [QA-012](QA-012.md) | Thermal status selects the field tier by a fixed table | OBLIGATION | NEEDS OWNER | P1 | P1–P12; F3, F9 |
| [QA-013](QA-013.md) | At 200% font nothing essential truncates or overlaps | OBLIGATION | MISSING | P1 | P1–P14; F6, F10 |
| [QA-014](QA-014.md) | RTL mirrors every surface except the plate and numerals | OBLIGATION | MISSING | P1 | P1–P14; F7 |
| [QA-015](QA-015.md) | Narrow 320 dp width renders without clipping | OBLIGATION | MISSING | P1 | P1–P14 |
| [QA-016](QA-016.md) | Large screens bound content width in both orientations | OBLIGATION | MISSING | P1 | P1–P14; F5, F10 |
| [QA-017](QA-017.md) | Process death restores a safe, defined state | OBLIGATION | MISSING | P1 | P1–P11 |
| [QA-018](QA-018.md) | Blur pauses all visual work and subscriptions | OBLIGATION | MISSING | P1 | P1–P11; F9 |
| [QA-019](QA-019.md) | Account switch leaves no trace of the previous account | PROHIBITION | MISSING | P0 | P1, P2, P3, P5, P6, P7, P9 |
| [QA-020](QA-020.md) | Revoked permission or consent updates the page at foreground | OBLIGATION | MISSING | P0 | P2, P6, P7, P9 |
| [QA-021](QA-021.md) | No focusable node is invisible or off-screen | PROHIBITION | MISSING | P1 | P1–P14 |
| [QA-022](QA-022.md) | Colour is never the only carrier of a state | OBLIGATION | MISSING | P1 | P1–P9; F10 |
| [QA-023](QA-023.md) | An inferred state never tints controls or legal surfaces | PROHIBITION | MISSING | P0 | P1, P2, P5, P6, P7, P9, P10, P11, P14 |
| [QA-024](QA-024.md) | Text contrast is at least 4.5:1 on captured pixels | OBLIGATION | MISSING | P0 | P1–P14; F1, F4, F9, F10 |
| [QA-025](QA-025.md) | Component contrast is at least 3:1 on captured pixels | OBLIGATION | MISSING | P0 | P1–P14; F10 |
| [QA-026](QA-026.md) | Contrast sampling is lossless, cycle-long and ink-verified | OBLIGATION | NEEDS OWNER | P0 | F4; P1–P14 |
| [QA-027](QA-027.md) | Every text over the field passes an offscreen bound first | OBLIGATION | MISSING | P0 | F1, F9, F10; P1–P14 |
| [QA-028](QA-028.md) | Touch targets measure at least 48 dp by rendered bounds | OBLIGATION | MISSING | P1 | P1–P14; F10 |
| [QA-029](QA-029.md) | The field costs at most 3 ms of GPU per frame | OBLIGATION | NEEDS OWNER | P1 | F9; P1, P2, P10 |
| [QA-030](QA-030.md) | Janky frames stay at or below 1% per scenario | OBLIGATION | NEEDS OWNER | P1 | F9; P1–P12 |
| [QA-031](QA-031.md) | Device evidence comes only from a clean release Hermes build | OBLIGATION | MISSING | P0 | F4; P1–P14 |
| [QA-032](QA-032.md) | The 50-transition leak loop plateaus | OBLIGATION | NEEDS OWNER | P1 | P1–P11 |
| [QA-033](QA-033.md) | TalkBack evidence is a text log matching the focus order | OBLIGATION | NEEDS OWNER | P1 | F4; P1–P14 |
| [QA-034](QA-034.md) | Reduced motion is proven by identical stills and zero frames | OBLIGATION | MISSING | P1 | F3, F9; P1–P12 |
| [QA-035](QA-035.md) | Battery saver is proven by the low-power still and frame count | OBLIGATION | MISSING | P1 | F3, F9; P1–P12 |
| [QA-036](QA-036.md) | Thermal is proven by forced statuses and a soak | OBLIGATION | NEEDS OWNER | P1 | F3, F9; P2 |
| [QA-037](QA-037.md) | G11 captures exactly the spec's capture list | OBLIGATION | MISSING | P1 | F4; P1–P14 |
| [QA-038](QA-038.md) | The capture harness fails closed | OBLIGATION | MISSING | P1 | F4 |
| [QA-039](QA-039.md) | On-device copy matches the keyed catalog | OBLIGATION | MISSING | P1 | F7; P1–P14 |
| [QA-040](QA-040.md) | Every contract ID has a running test | OBLIGATION | MISSING | P0 | Q1; P1–P14 |
| [QA-041](QA-041.md) | Test count falls only with a signed RETIRE entry | OBLIGATION | MISSING | P0 | Q1; P1–P14 |
| [QA-042](QA-042.md) | The jest baseline is measured and recorded | OBLIGATION | MISSING | P1 | Q2 |
| [QA-043](QA-043.md) | Focused tsc passes with no output filtering | OBLIGATION | MISSING | P1 | Q2; F1–F10; P1–P14 |
| [QA-044](QA-044.md) | Platform listener fakes keep a live registry | OBLIGATION | MISSING | P1 | Q3 |
| [QA-045](QA-045.md) | Store and socket fakes count subscriptions | OBLIGATION | MISSING | P1 | Q3 |
| [QA-046](QA-046.md) | Motion fakes observe frame callbacks and loops | OBLIGATION | MISSING | P1 | Q3; F3, F9 |
| [QA-047](QA-047.md) | A scriptable fake API and clock drive timing states | OBLIGATION | MISSING | P1 | Q3; P1–P11 |
| [QA-048](QA-048.md) | A stateful Spotify remote fake covers every player state | OBLIGATION | MISSING | P1 | Q3; P2, P3, P4, P8 |
| [QA-049](QA-049.md) | A stateful OS-permission fake covers every grant outcome | OBLIGATION | MISSING | P1 | Q3; P6, P9, P10 |
| [QA-050](QA-050.md) | A real-Skia jest project compiles every shader | OBLIGATION | MISSING | P1 | Q3, F9, F10 |
| [QA-051](QA-051.md) | Hostile uniforms render finite pixels | OBLIGATION | MISSING | P1 | F9 |
| [QA-052](QA-052.md) | Token outputs are regenerated and unchanged in CI | OBLIGATION | MISSING | P1 | F1; P1–P14 |
| [QA-053](QA-053.md) | v2 files import no v1 visual module | PROHIBITION | NEEDS OWNER | P1 | F1, F10; P1–P14 |
| [QA-054](QA-054.md) | The count of v1 importers only goes down | OBLIGATION | NEEDS OWNER | P1 | F1; P1–P14 |
| [QA-055](QA-055.md) | v2 paths hold zero design-lint violations | PROHIBITION | MISSING | P1 | F1, F10; P1–P14 |
| [QA-056](QA-056.md) | Only generated token files are exempt from design lint | PROHIBITION | MISSING | P1 | F1 |
| [QA-057](QA-057.md) | Lint bans motion literals outside tokens | PROHIBITION | MISSING | P1 | F1; P1–P14 |
| [QA-058](QA-058.md) | Lint bans named colours and colour functions outside tokens | PROHIBITION | MISSING | P1 | F1; P1–P14 |
| [QA-059](QA-059.md) | Lint bans scale values hidden behind identifiers | PROHIBITION | MISSING | P1 | F1; P1–P14 |
| [QA-060](QA-060.md) | Lint bans ID-like accessibility labels | PROHIBITION | MISSING | P1 | F1; P1–P14 |
| [QA-061](QA-061.md) | Lint bans inline UI strings in v2 JSX | PROHIBITION | MISSING | P1 | F7; P1–P14 |
| [QA-062](QA-062.md) | Lint bans Skia object creation inside worklets | PROHIBITION | MISSING | P1 | F1, F9; P2 |
| [QA-063](QA-063.md) | No emotion or field hue falls in the red band | PROHIBITION | NEEDS OWNER | P0 | F1, F9; P2, P7, P10 |
| [QA-064](QA-064.md) | Emotion hues stay at least 70° apart | OBLIGATION | MISSING | P1 | F1 |
| [QA-065](QA-065.md) | OKLab mixes between palette hues never pass through red | PROHIBITION | NEEDS OWNER | P0 | F1, F9; P2, P7, P10 |
| [QA-066](QA-066.md) | Breath period only lengthens as stress rises | PROHIBITION | MISSING | P0 | F9; P2, P7, P10, P12 |
| [QA-067](QA-067.md) | Exhale is longer than inhale within the ratified bands | OBLIGATION | MISSING | P0 | F9; P2, P7, P10 |
| [QA-068](QA-068.md) | No luminance modulation at or above 3 Hz | PROHIBITION | MISSING | P0 | F9, F10; P2, P7 |
| [QA-069](QA-069.md) | Stress dims and desaturates; confidence sets presence | OBLIGATION | MISSING | P0 | F9; P2, P7 |
| [QA-070](QA-070.md) | No haptic is synchronised to heart rate | PROHIBITION | MISSING | P0 | F8, F9; P2, P7 |
| [QA-071](QA-071.md) | The motion policy holds one native listener app-wide | OBLIGATION | MISSING | P1 | F3 |
| [QA-072](QA-072.md) | Shader failure falls back to a static frame and one report | OBLIGATION | MISSING | P1 | F9; P1, P2, P10 |
| [QA-073](QA-073.md) | Sustained frame drops step the field down a tier | OBLIGATION | NEEDS OWNER | P1 | F9; P1, P2, P10 |
| [QA-074](QA-074.md) | The gates.json CI check rejects missing or stale verdicts | OBLIGATION | MISSING | P0 | P1–P14 |
| [QA-075](QA-075.md) | Each page's row.md stays identical to the plan's table | OBLIGATION | MISSING | P1 | P1–P14 |
| [QA-076](QA-076.md) | The import-closure tool is pinned and sees platform files | OBLIGATION | MISSING | P1 | P1–P14 |
| [QA-077](QA-077.md) | The Design Lab never ships in a release build | PROHIBITION | MISSING | P1 | F4; P1–P14 |
| [QA-078](QA-078.md) | Lab captures are reproducible under the deterministic clock | OBLIGATION | MISSING | P1 | F4, F8, F10; V1 |
| [QA-079](QA-079.md) | No analytics or crash SDK enters the mobile dependencies | PROHIBITION | MISSING | P0 | F9; P1–P14 |
| [QA-080](QA-080.md) | Legal copy stays defined once across v1 and v2 | OBLIGATION | PINNED | P0 | F7, F10; P2, P4, P5, P7, P10, P14 |
| [QA-081](QA-081.md) | Every catalog string is covered by the bundled fonts | OBLIGATION | MISSING | P1 | F6, F7; P1–P14 |
| [QA-082](QA-082.md) | The pseudo-locale run passes truncation and overlap checks | OBLIGATION | MISSING | P1 | F7; P1–P14 |
| [QA-083](QA-083.md) | New CI gate jobs skip at job level, never step level | PROHIBITION | MISSING | P1 | Q1, Q2, Q3, F1 |
| [QA-084](QA-084.md) | Force-dark is off and dynamic colour is not used | PROHIBITION | MISSING | P1 | F2 |
| [QA-085](QA-085.md) | Edge-to-edge keeps controls clear of system bars and the keyboard | OBLIGATION | MISSING | P1 | F5; P1–P14 |
| [QA-086](QA-086.md) | Back and predictive back have a defined outcome everywhere | OBLIGATION | MISSING | P1 | F5; P1–P11 |
| [QA-087](QA-087.md) | screenToCircumplex geometry is unchanged | PROHIBITION | PINNED | P0 | P2, P10; F9 |
| [QA-088](QA-088.md) | The plate stays LTR under RTL | OBLIGATION | MISSING | P0 | F7; P2, P10 |
| [QA-089](QA-089.md) | A plate gesture commits exactly one tap through the real gesture path | OBLIGATION | MISSING | P0 | P2, P10; F10 |
| [QA-090](QA-090.md) | The emotion wire is at most 3 taps, byte-exact, silent per tap | PROHIBITION | PINNED | P0 | P2, P8, P10 |
| [QA-091](QA-091.md) | A replaced socket keeps no listeners (S9-1) | PROHIBITION | PINNED | P0 | P1, P2, P3, P6 |
| [QA-092](QA-092.md) | Only the latest request's playlist renders | PROHIBITION | PINNED | P0 | P2, P3, P8 |
| [QA-093](QA-093.md) | Every socket event has a declared consumer or non-consumer | OBLIGATION | MISSING | P0 | server plumbing; P1, P2, P3, P6 |
| [QA-094](QA-094.md) | playlist_ready is parsed by one fail-closed sanitiser against a shared fixture | OBLIGATION | MISSING | P0 | server plumbing; P2, P3, P4 |
| [QA-095](QA-095.md) | Server payloads to the client carry no raw vital | PROHIBITION | NEEDS OWNER | P0 | server plumbing; P2, P4, P7 |
| [QA-096](QA-096.md) | No vital reaches a client log line | PROHIBITION | MISSING | P0 | P2, P6, P7; server plumbing |
| [QA-097](QA-097.md) | No biometric value is persisted on the device | PROHIBITION | PINNED | P0 | P2, P6, P7, P9 |
| [QA-098](QA-098.md) | Live HR, whr_ and Bluetooth start only after link and current grant | PROHIBITION | PINNED | P0 | P2, P6, P7, P9, P10 |
| [QA-099](QA-099.md) | The OS health sheet opens only on ready or granted_ack | PROHIBITION | PINNED | P0 | P5, P6, P9 |
| [QA-100](QA-100.md) | Bluetooth permission is checked, never requested, before P6's disclosure | PROHIBITION | PINNED | P0 | P6, P10 |
| [QA-101](QA-101.md) | The Spotify player connects only from gated call sites | PROHIBITION | PINNED | P0 | P2, P3, P6, P9 |
| [QA-102](QA-102.md) | Heart-rate visuals read only the consent-gated warm store | PROHIBITION | MISSING | P0 | F9; P2, P7, P10 |
| [QA-103](QA-103.md) | Teardown parity holds for every route on unmount and blur (S10-1) | OBLIGATION | MISSING | P0 | Q3; P1–P11 |
| [QA-104](QA-104.md) | Playback reconciles by URI; a foreign track is not ours (S11-1) | PROHIBITION | PINNED | P0 | P3, P4, P8 |
| [QA-105](QA-105.md) | Server-socket and biometric lanes stay independent (S12-1) | PROHIBITION | PINNED | P0 | P1, P2, P7 |
| [QA-106](QA-106.md) | Logout never routes to onboarding or connect | PROHIBITION | PINNED | P0 | P1, P10, P11 |
| [QA-107](QA-107.md) | Mobile and backend consent versions stay in lockstep | OBLIGATION | MISSING | P0 | server plumbing; P5, P6, P9 |
| [QA-108](QA-108.md) | Skia behaviour is never claimed under the Skia stub | PROHIBITION | MISSING | P1 | Q3, F9, F10 |
| [QA-109](QA-109.md) | Motion behaviour is never claimed under the Reanimated mock | PROHIBITION | MISSING | P1 | Q3, F3, F9 |
| [QA-110](QA-110.md) | Gesture behaviour is never claimed under the gesture proxy | PROHIBITION | MISSING | P1 | Q3; P2, P10 |
| [QA-111](QA-111.md) | Every render test forces both faces and restores the preset | OBLIGATION | MISSING | P0 | Q3, F2; P1–P14 |
| [QA-112](QA-112.md) | No spyOn on a preset-mocked module member | PROHIBITION | MISSING | P1 | Q3; P1–P14 |
| [QA-113](QA-113.md) | Contract pins use toStrictEqual | PROHIBITION | MISSING | P1 | F1; P1–P14; server plumbing |
| [QA-114](QA-114.md) | Deep links, redirects and locked strings use exact equality | PROHIBITION | MISSING | P0 | F1, F7; P1, P5, P6, P9, P11 |
| [QA-115](QA-115.md) | v2 action callbacks are required and exercised through the navigator | OBLIGATION | MISSING | P1 | Q2, Q3, F10; P1–P14 |
| [QA-116](QA-116.md) | Every pinned production function has a production caller | OBLIGATION | MISSING | P1 | Q1; P1–P14 |
| [QA-117](QA-117.md) | Snapshot assertions are banned | PROHIBITION | MISSING | P1 | F1; P1–P14 |
| [QA-118](QA-118.md) | v1 pixel pins are retired, never re-pointed to v2 values | PROHIBITION | MISSING | P1 | Q1; P1–P14 |
| [QA-119](QA-119.md) | Contrast assertions name the rendered backdrop | OBLIGATION | MISSING | P0 | Q3, F10; P1–P14 |
| [QA-120](QA-120.md) | P1 · kokonada://integrations lands and re-pulls status | OBLIGATION | MISSING | P1 | P1, P6, P9 |
| [QA-121](QA-121.md) | P1 · connection_error maps to a calm, non-blaming state | OBLIGATION | MISSING | P1 | P1 |
| [QA-122](QA-122.md) | P2 · Spotify not installed is its own state | OBLIGATION | MISSING | P1 | P2, P3 |
| [QA-123](QA-123.md) | P2 · Spotify without Premium is its own state | OPEN QUESTION | NEEDS OWNER | P1 | P2, P3 |
| [QA-124](QA-124.md) | P2 · Another active Spotify device is its own state | OPEN QUESTION | NEEDS OWNER | P1 | P2, P3 |
| [QA-125](QA-125.md) | P2 · A Spotify disconnect mid-session degrades in place | OBLIGATION | MISSING | P1 | P2, P3 |
| [QA-126](QA-126.md) | The AI disclosure is on the first frame, reachable and untinted | OBLIGATION | MISSING | P0 | F10; P2, P4, P5, P7, P10 |
| [QA-127](QA-127.md) | P2 · The list alternative reaches every placement the plate can | OBLIGATION | MISSING | P1 | P2 |
| [QA-128](QA-128.md) | P3 · Cover art is never animated | PROHIBITION | MISSING | P0 | P3, P4, P8; F10 |
| [QA-129](QA-129.md) | P3 · A failed cover shows the fallback only while it retries | OBLIGATION | MISSING | P0 | P3; F10 |
| [QA-130](QA-130.md) | P3 · Link-back opens the exact track | OBLIGATION | MISSING | P0 | P3, P4 |
| [QA-131](QA-131.md) | P3 · The position clock is monotonic and drift-safe | OBLIGATION | MISSING | P1 | P3 |
| [QA-132](QA-132.md) | P3 · playback_event follows the contract and skips foreign tracks | OBLIGATION | MISSING | P0 | server plumbing; P3 |
| [QA-133](QA-133.md) | P3 · Transport controls disable with nothing playing | OBLIGATION | MISSING | P1 | P3 |
| [QA-134](QA-134.md) | P3 · The page renders from a provider-neutral view model | OBLIGATION | MISSING | P1 | P3, P4 |
| [QA-135](QA-135.md) | P4 · receipt.why and targets survive parsing, fail-closed | OBLIGATION | MISSING | P1 | server plumbing; P4 |
| [QA-136](QA-136.md) | P4 · Receipt attribution and disclaimer lines never truncate | PROHIBITION | MISSING | P0 | P4 |
| [QA-137](QA-137.md) | P5 · All nine consent flow states render their designed surface | OBLIGATION | MISSING | P0 | P5 |
| [QA-138](QA-138.md) | P5 · Decline comes first, with identical geometry and type | OBLIGATION | MISSING | P0 | F10; P5 |
| [QA-139](QA-139.md) | P5 · The consent document is never scroll-gated | PROHIBITION | MISSING | P0 | P5 |
| [QA-140](QA-140.md) | P5 · The server honours the version window and records the shown version | OBLIGATION | NEEDS OWNER | P0 | server plumbing; P5 |
| [QA-141](QA-141.md) | P5 · Each consent version and locale is archived and hashed | OBLIGATION | MISSING | P0 | P5; F7 |
| [QA-142](QA-142.md) | P5 · Consent categories match the OS permission set | OBLIGATION | MISSING | P0 | P5, P6 |
| [QA-143](QA-143.md) | P6 · Every OS permission outcome has a designed state | OBLIGATION | MISSING | P1 | P6 |
| [QA-144](QA-144.md) | P6 · Mood-only is as easy and as prominent as the wearable path | OBLIGATION | MISSING | P0 | P6 |
| [QA-145](QA-145.md) | P6 · profile_progress updates are scoped, monotonic and fail visibly | OBLIGATION | MISSING | P1 | P6 |
| [QA-146](QA-146.md) | P7 · Every server label passes a closed client allow-list | PROHIBITION | MISSING | P0 | P7, P4 |
| [QA-147](QA-147.md) | P7 · The Pulse payload is validated at the boundary | OBLIGATION | MISSING | P1 | P7 |
| [QA-148](QA-148.md) | P7 · Confidence shows as a word, never a percentage | PROHIBITION | MISSING | P1 | P7 |
| [QA-149](QA-149.md) | P8 · Re-tune from a row sends that moment's intent | OBLIGATION | MISSING | P1 | P8 |
| [QA-150](QA-150.md) | P8 · The archive refreshes after a new session | OBLIGATION | MISSING | P1 | P8 |
| [QA-151](QA-151.md) | P8 · The archive list is virtualised and re-renders only changed rows | OBLIGATION | MISSING | P1 | P8 |
| [QA-152](QA-152.md) | P9 · Withdrawing takes no more steps than granting | OBLIGATION | MISSING | P0 | P9 |
| [QA-153](QA-153.md) | P9 · Rights appear above preferences | OBLIGATION | MISSING | P0 | P9 |
| [QA-154](QA-154.md) | P9 · Export reaches the export route with no token in a URL | OBLIGATION | MISSING | P0 | P9 |
| [QA-155](QA-155.md) | P9 · Logout and deletion sign out of Google | OBLIGATION | MISSING | P0 | P9, P11 |
| [QA-156](QA-156.md) | P10 · No OS permission request is reachable from onboarding | PROHIBITION | MISSING | P0 | P10 |
| [QA-157](QA-157.md) | P10 · Onboarding seen-state is per account | OBLIGATION | MISSING | P1 | P10 |
| [QA-158](QA-158.md) | P10 · Onboarding reaches UI idle for dumps | OBLIGATION | MISSING | P1 | P10 |
| [QA-159](QA-159.md) | P11 · Google and Apple buttons match at every font scale | OBLIGATION | MISSING | P1 | P11 |
| [QA-160](QA-160.md) | P12 · Cold start to the first routed frame takes at most 1000 ms | OBLIGATION | NEEDS OWNER | P1 | P12 |
| [QA-161](QA-161.md) | P12 · Splash and icon exist for both faces and in monochrome | OBLIGATION | MISSING | P1 | P12 |
| [QA-162](QA-162.md) | P13 · Store images trace to hashed release captures | OBLIGATION | MISSING | P0 | P13 |
| [QA-163](QA-163.md) | P14 · Licence notices are generated from the lockfile | OBLIGATION | MISSING | P0 | P14; F6 |
| [QA-164](QA-164.md) | P14 · The shown version equals the build | OBLIGATION | MISSING | P1 | P14 |
