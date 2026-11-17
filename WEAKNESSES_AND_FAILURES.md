# WEAKNESSES AND FAILURES — Kokonada's standing risk ledger

**Seeded 2026-09-01. Runs: 2026-10-04 (full), 2026-10-17 (manual, the owner's "where am I"). Owned by the `sentinel` agent (`.claude/agents/sentinel.md`). One file, no second one, ever.**

---

## § HOW TO READ THIS FILE

**What this is.** The single place where everything that can hurt Kokonada is written down, ranked by *when it bites* rather than by how loud it is, with a way out attached to each item. It is not a bug list, not a backlog and not a compliance report. `TASKS.md` owns work; this file owns risk. Where a risk has a TASKS row, the entry cites the ID and stops.

**Who writes it, and when.** The `sentinel` agent. `sentinel.md` describes a routine on Mondays and Fridays at 21:00 UTC, but since 2026-10-08 that routine is disabled and not linked to this computer (`DAN-069`), so **no scheduled run has happened since; the file changes only when someone invokes the agent.** Read the date in the run log before you trust anything below as current.

**This run.** Manual, written in `.claude/worktrees/sentinel`. That worktree is detached at `9ad6c66`, and its copy of this file equals `origin/main`'s (`git diff --quiet HEAD origin/main -- WEAKNESSES_AND_FAILURES.md` exits 0). The sentinel runs no git write command, so it did not move that worktree. The session files this edit through a claim and a PR (`sentinel.md` § FILING, steps 3 and 4).

**THE RULE THAT MAKES THIS FILE USEFUL.** Every finding carries either a **`SOLUTION:`** (concrete, costed, with the test that proves it worked) or **`⚠ NEEDS ATTENTION — NO KNOWN SOLUTION:`** (what was tried, what blocks it, and the one fact or decision that would unblock it). There is no third option.

**THE VERIFICATION MANDATE.** Nothing here is authoritative. Every technical claim is a hypothesis with its evidence attached, and every proposed change is a request for the build team to verify against the real tree first. **Delete nothing, change nothing and switch off no production flag on the strength of this file alone.** Where a claim here is wrong, correct it here, with the evidence that disproved it. This run corrects one of its own predecessor's claims (Spotify's ISRC field, `KW-052`).

**"The build team"** means the orchestrator and the developer and reviewer agents it dispatches (`.claude/agents/`). It has the final word on every technical claim here, after verifying it.

**Read `origin/main`.** Every `file:line` below is on `a62239a` (#245, 2026-10-10, still `main`'s head on 2026-10-17 according to GitHub) unless the entry says otherwise.

**Statuses.** `OPEN` · `MITIGATED` (partly addressed, not closed) · `CLOSED` (re-proven this run, with evidence) · `ACCEPTED` (Daniel decided to live with it; dated, in his words) · `NEEDS ATTENTION` (no known solution) · `WITHDRAWN` (was wrong) · `SUPERSEDED-BY-KW-###`.

**Confidence.** `PROVEN` (read in the code or a primary source this run) · `INFERRED` (reasoned; the build team must confirm) · `INCONCLUSIVE` (the entry names what would settle it).

**Tiers.** `0` existential · `1` product-breaking · `2` legal/store · `3` operational · `4` market and strategy.

**IDs** are `KW-###`. They are never reused and never renumbered.

---

## § IF YOU READ NOTHING ELSE — as of 2026-10-17

**The headline.** This is the third run in a row with the same pre-mortem, and by this file's rule it now comes first. Since 2026-09-01 nothing has been learned about any real user: no tester, no conversation, no test session. Over the last 13 days, open TASKS rows grew from 383 to 528 and 18 closed. Since DEC-155 (2026-10-06) and Daniel's Round 4 (2026-10-07), every merge (both partners') and every page gate goes through a session on his side. He was away nine days, and for the last seven of them nothing merged. The work is careful; the problem is not its quality. The pre-mortem is arriving on schedule: the product still reaches five Spotify accounts, and nobody has invited anyone to use them. → `KW-048`, `KW-053`, `KW-047`, tripwires T2 and T9.

**Top 3, ranked by when each one bites.**

1. **Monday 2026-10-19: CI's runner image starts moving to Ubuntu 26.04, and no workflow pins it** (`KW-065`, `OPS-191`). The move is gradual, so a job that breaks will break on some runs and not others for a month. A red `main` holds every deploy (Wait for CI) and every merge (merge-guard).
   - **SOLUTION:** before Monday, approve one small PR that pins the seven `ubuntu-latest` jobs to `ubuntu-24.04`. It is class (a), because it touches `.github/workflows/**`. About 10 minutes of Daniel's time. Proof: the next run's "Set up job" step names 24.04. Lift the pin after a branch run on 26.04 goes green.
2. **Tuesday 2026-10-20: send the counsel brief** (`KW-054`, `DAN-014`). It has been ready since 2026-10-04 (`docs/design-v2/counsel/gating-five-2026-10-04.md`, with a Hebrew cover note in private). What is left is sending it and paying, and both are Daniel's. Its Q1 (the controller and the law for the Israeli tester stage) and Q4 (the legal text the first non-owner tester sees) gate the first tester, whatever the EU answer turns out to be. Under DEC-148, every EU date depends on the country list and on counsel's answer to whether EU law reaches the Israeli stage at all.
   - **SOLUTION:** send it and book a fixed-fee scoping call. About 1 hour, plus the fee. If 2026-11-02 passes with no counsel, proposed tripwire T10 applies.
3. **This week, before the next production sitting (`DAN-070`): one 20-minute sitting at the computer, in this order** (`KW-063`, `KW-062`, `KW-059`, `KW-034`, `KW-016`). Each step is Daniel's alone.
   - **Profile → Spotify → Reconnect.** Then write the date plus six months beside the Premium renewal. Since 2026-07-20 every Spotify link expires six months after its first authorization. Nobody recorded when Daniel authorized, so his own music may stop, or may already have stopped, and the screen would show only "try again". 1 minute.
   - **Set `DISCOVERY_CAPTION_LLM=false` on Railway** and note the date it was first turned on. It removes two live exposures, and it is the privacy page's first precondition (G-1). 2 minutes.
   - **Create the read-only Atlas user**, so that `DAN-070`'s counts never run on the app's read-write credential. 5 minutes.
   - **Back up the release keystore and `keystore.properties` to an encrypted cloud folder and an offline drive**, with the passwords kept apart, in a password manager; never put both in one synced or git folder. **Copy the real `config.ts` into `Kokonada-private`.** Today it exists only as uncommitted edits in two worktrees that a routine cleanup would delete. 10 minutes.
   - **SOLUTION:** the steps above. The proof for each is in its KW entry. The last bundle of this kind (2026-10-04) got one of its five steps done in 13 days. If 20 minutes is not available, do the first two: 3 minutes.

**Also inside ten days:** `DAN-032`, the registry re-verification rule, is due by **2026-10-26**. Without it, every open page goes stale on 2026-11-28 (`KW-057`). `DAN-056` (D&B Israel) had its own date of 2026-10-11, which has passed (`KW-053`).

**The order of work, for the orchestrator.**

0. Put the Top 3 to Daniel today, in Hebrew, each with its cost.
1. Amend PR #237 so it records only item (1) of `DAN-053`, Wait for CI, and keeps items (2) to (4) open. Correct `TASKS.md:19` to match (`KW-064` item 2). 10 minutes.
2. Run `merge-guard` post-merge on #232 and #239 and post the verdicts. Widen `OPS-168` to "everything merged before #231, 2026-10-08T12:10Z" (`KW-066`).
3. Add update lines in TASKS:
   - `BE-100` and `BE-101`: Spotify reverted the Track `external_ids` removal in March 2026 (`KW-052`, `KW-064` item 4);
   - `BE-053`: `invalid_grant` now also means "six months passed" (`KW-063`);
   - `MB-095`: map a refresh failure to a reconnect sentence (`KW-063`).
4. The scribe records Round 4 as a DEC. Then one class (a) PR brings `CLAUDE.md:48` and `.claude/commands/page.md:18` in line with it (`KW-064` item 1).
5. `DAN-032` before 2026-10-26 (`KW-057`).
6. `DAN-070`:
   - build the v3 count tool;
   - hold the owner's sitting with the read-only user (`KW-059`);
   - `DAN-050` closes, which meets DEC-156's condition for the privacy page.
7. **The "silent lies" PR, still unbuilt 46 days after it was first raised:** `MB-095`, `MB-096`, `MB-019`, and `BE-101`'s `SEARCH_MAX`. It must land before any tester build (`KW-007`, `KW-008`, `KW-009`, `KW-052`, `KW-063`).
8. `ARCH-010` / `DEC-095`: rule on the React Native version before about 2026-11-09. 0.88.0 shipped on 2026-10-15 (`KW-015`).
9. **In parallel, and only Daniel can do it:** five conversations with the five people the cap allows, or the n-of-5 test (`KW-048`, `KW-042`). Link the sentinel routine on his device (`DAN-069`).

---

## § WHAT CHANGED SINCE THE LAST RUN (2026-10-04 → 2026-10-17)

**The frame.**
- **Commits.** 34 commits reached `main` (`e4743af..a62239a`). Two touched the Android user's path:
  - J2 (#217);
  - the store gate (#221).
- **Process and governance.** The rest built how changes are made:
  - the coordinator (#228–#230, #236, #239);
  - merge-guard and the committed deny list (#224, #227);
  - the instruction layer (#231);
  - the secret scan (#222);
  - the Design Lab (#216);
  - docs (#226, #233, #242–#245).
- **The partner's work.** #232 added an iOS HealthKit store while iOS is paused.
- **Incident.** The partner's account merged #218 by mistake on 2026-10-05, with its own backend check red. `main` stayed red for about 17 hours until #220. Its Pages workflow published nothing: `GET /repos/…/pages` answers 404.
- **Nothing has merged since 2026-10-10** (GitHub: `main` = `a62239a`, 08:26Z).

**Daniel's rulings in this window.**
- **DEC-155** (2026-10-06):
  - `CLAUDE.md` is binding;
  - three owner classes: (a) the instruction layer, (b) production data, (c) legal;
  - legal decisions come back to him.
- **Round 4** (2026-10-07): he holds G2, G3, G6 and G13 on every page, "הכול אצלי".
- **Round 5:** he chose the V1 direction himself, "תהום" (Abyss).
- **2026-10-10:** he lifted the `backend/**` hold.

**Production.**
- J2's orphan sweep was **armed on 2026-10-07T04:32:31Z**, after a record showing zero orphans, and only by a marker the code requires (`KW-051` closed).
- The 24-hour recount read `RESULT zero` (2026-10-08). The 48-hour recount was never taken.
- D is now `aafb05e` (#239), which carries #232's code, so J2's gates re-run under `DAN-070`.
- The nightly lines of 2026-10-08, 10-09 and 10-10 read `orphanErasures=0 … failures=0`.

**New: `KW-063` to `KW-066`.**

| ID | What |
|---|---|
| `KW-063` | Spotify now expires every refresh token six months after the user first authorizes. Nothing in the repo knows it. The planned revocation purge (`BE-053`) would fire on every expiry, and Generate hides the reconnect message |
| `KW-064` | Four written instructions a session obeys are false: CLAUDE.md overrides the owner's later page-gate ruling; PR #237 would close `DAN-053` on one of its four items; `sentinel.md` claims a schedule; `BE-100` and `BE-101` repeat a withdrawn claim |
| `KW-065` | CI's runner image moves on 2026-10-19, and the pin needs the owner's class (a) approval |
| `KW-066` | Two PRs fell into a two-day review gap, and their code is what production runs |

**Closed:**

| ID | On what evidence |
|---|---|
| `KW-051` | The arming marker is fail-safe (`backend/app/services/privacy/orphanSweep.js:21-27`). Arming refuses while any orphan exists (`:311-316`). It was armed after the zero-orphan record |
| `KW-058` | Each sitting removes its key: "Key kokonada-railway-temp-2026-10-07 removed from Railway (keys list shows 0)… 2026-10-07T04:32:56Z", and the same at 2026-10-08T08:57:44Z. `~/.ssh` holds only `known_hosts` |
| `KW-061` | This file is on `main` (#214), and its lost findings are now rows: `BE-100`, `BE-101`, `BE-106`, `MB-095`, `MB-096`, `MB-097`, `DAN-054`, `DAN-055` |
| `KW-056` | Daniel took every page gate back himself (Round 4), and he chose the direction himself (Round 5). The residue is that the binding file does not say so (`KW-064` item 1) |
| `KW-038` | `BiometricLog` has a TTL (`backend/app/models/BiometricLog.js:49`), as do `ServeEvent` and `HealthSample` |

**Mitigated: `KW-050`.**
- Daniel confirmed Wait for CI is on (2026-10-07; recorded only in open PR #237).
- The deny list is committed and was read this run.
- The merge rule and merge-guard are in force (#231).

**Correction.** The 2026-10-04 inference that Wait for CI was off was wrong. The deployment's creation time could not settle it, as that entry itself warned.

**Corrected: `KW-052` and `KW-004`.**
- Spotify's March 2026 changelog reverted the removal of `external_ids` from Track and Album objects.
- The guide marks both "(reverted" [verified 2026-10-17].
- **What misled me on 2026-10-04:** I read the February guide's list of removed fields and missed the "(reverted" marker and the March changelog it links to.
- The ISRC join path exists after all.

**Moved:**
- `KW-053`: the critical path now runs through Daniel's sessions by design, and the zero-merge week measured it.
- `KW-054`: the brief is drafted and unsent; NF-5 made its EU dates conditional.
- `KW-062`: NF-1 says the 2026-12-02 grace may not cover the captions.
- `KW-016`: worktree cleanup now threatens the only copies of the real config.
- `KW-015`: RN 0.88.0 shipped on 2026-10-15.
- `KW-047`: 528 open rows and 27 open P0.
- `KW-048` and `KW-022` are NEEDS ATTENTION for a third consecutive run.

**External facts that moved** (each verified 2026-10-17):

| Source | What moved |
|---|---|
| Spotify | Refresh tokens expire "6 months from user authorization", from 2026-07-20 for existing apps. Track `external_ids` was reverted (kept). Since July, development-mode quota is counted per developer account, and an exhausted quota answers 429 with `reason: QUOTA_EXCEEDED` |
| GitHub | `ubuntu-latest` moves to 26.04 between 2026-10-19 and 2026-11-19 |
| React Native | 0.88.0 was published on 2026-10-15 (npm registry) |
| Groq | `openai/gpt-oss-20b` is not deprecated |
| AI Act | The Annex III guidelines are still a draft; feedback closed on 2026-07-23 (secondary sources) |
| Android | Developer verification applies worldwide "in 2027". ADB installs need no verification. A free limited-distribution account covers up to 20 devices |

**Tripwires.** The lines this file proposed (none of them adopted yet):
- T2 reads 3 of 3;
- T9 is crossed (528 > 450);
- T8 is superseded by Round 4.

See § KILL CRITERIA.

---

## § THE ASSUMPTION LEDGER

| Assumption | State 2026-10-17 | Why |
|---|---|---|
| Spotify can be the playback sink for real users | **BROKEN** | 5 users in Development Mode; Extended Quota needs an organisation with ≥250k MAU [verified 2026-10-04]. `KW-001` |
| The Spotify API surface the backend calls still exists | **BROKEN in part (corrected)** | The search maximum is 10, and playlist items come only from playlists the user owns. The ISRC field (`external_ids`) was **kept**, reverted in March 2026 [verified 2026-10-17]. `KW-052` |
| A Spotify link, once made, keeps working | **BROKEN since 2026-07-20** (new) | Refresh tokens expire six months after first authorization; refreshing does not extend them [verified 2026-10-17]. `KW-063` |
| The intelligence engine has features for the tracks it serves | **BROKEN (code); production unread** | Every `spotify:` recording is dropped before the feature store. `KW-004`, `BE-100` |
| Background workers run in production | **HOLDS** | Nightly `[sessionTrim]` lines on 2026-10-08, 10-09 and 10-10 (`DAN-050`, update 2026-10-10) |
| Music can move physiological stress markers | **HOLDS** | de Witte et al. [verified 2026-09-01; due by 2026-10-31]. `KW-042` |
| Biometric-driven selection beats a good static playlist | **UNTESTED** | No experiment has run. `KW-042` |
| Kokonada is a wellness app, not a medical device | **UNTESTED, with an internal fact against it** | Counsel's Q2 is drafted and unsent. `KW-055` |
| A merge is safe because CI runs | **HOLDS for deploys, not for merges** | Wait for CI holds a red deploy (confirmed by Daniel on 2026-10-07). GitHub still lets a red PR merge (#218; `DAN-064`). `KW-050` |
| Agent consensus can stand in for the owner at owner gates | **WITHDRAWN by the owner** | Round 4: he holds every page gate. `CLAUDE.md` still says otherwise (`KW-064`) |
| Delegation shortens the critical path | **NO LONGER APPLIES** | DEC-155 and Round 4 narrowed the delegation by Daniel's choice; every merge and page gate goes through his side. Measured: no merge from 2026-10-10 to 2026-10-17. `KW-053` |
| The written record matches the real state | **WEAKENED** (new) | Four instructions a session obeys are false. `KW-064` |
| Enough people own a wearable that streams HR to Android | **UNTESTED** | Unchanged. `KW-045` |
| The product can be free forever | **WEAKENED** | Unchanged. `KW-043` |
| One person can carry this | **WEAKENED, changed in shape again** | There are two partners now, but the partner's merges also wait on the owner's side. `KW-047`, `KW-053` |

---

## § KILL CRITERIA AND TRIPWIRES

Lines drawn in advance, while thinking is cheap. **The `sentinel` proposes them. Daniel adopts, edits or rejects each one, and his decision is recorded verbatim.** None has been put to him yet (`DAN-055`, open since 2026-10-04). A tripwire that fires is a Tier-0 headline. The sentinel reports a crossing. It never acts on one, and it never suggests quitting. **Two of the proposed lines read as crossed this run.** They are not lines he drew. They are lines this file asked him to draw.

| # | Tripwire | Status | Reading 2026-10-17 |
|---|---|---|---|
| T1 | App Remote is proven capped at 5 users AND no alternative sink is chosen within 60 days | awaiting Daniel | The cap test has not run (`DAN-054`, blocked on `DAN-036`). `ARCH-005` has been open since 2026-09-24 (23 days) |
| T2 | Three consecutive runs pass with nothing learned about any real user | awaiting Daniel | **3 of 3: crossed** (2026-09-01, 2026-10-04, 2026-10-17) |
| T3 | The n-of-5 experiment runs and the engine does not beat a static playlist | awaiting Daniel | Not run |
| T4 | A store submission is rejected twice for the same class of reason | awaiting Daniel | No submission yet |
| T5 | Open P0 count rises for four consecutive runs | awaiting Daniel | 11 → 25 → 27 (two rises) |
| T6 | Monthly infrastructure cost exceeds a ceiling Daniel names, at fewer than 100 users | awaiting Daniel | No ceiling named |
| T7 | A delegated merge leaves `main` red, or a production write happens outside an approved plan → delegated merges pause until Daniel re-confirms | awaiting Daniel | Not fired by its letter. #218 was the partner's mistaken merge, not a delegated one, and it left `main` red for about 17 hours. The merge rule since #231 binds both partners |
| T8 | Daniel reverses a delegated design gate → those gates return to him | **superseded** | He took every page gate back himself (Round 4, 2026-10-07). `CLAUDE.md` does not yet say so (`KW-064`) |
| T9 | Open TASKS rows pass 450, or open P0 passes 30, before Stage 0 closes → a scope sitting with Daniel before any new page's G0 | awaiting Daniel | **528 open rows: crossed.** 27 open P0 |
| T10 | Counsel is not engaged by 2026-11-02 → `DISCOVERY_CAPTION_LLM` is off before 2026-12-02, and no EU tester is enrolled | awaiting Daniel | 16 days left. The brief is drafted and unsent |

### Lines the delegation does not cross (proposed; Daniel adopts or edits)

**What happened to this list.** DEC-155 (2026-10-06) adopted much of it in substance as owner classes:
- **(c)** every DEC- entry on law, privacy, consent or counsel, and every publication of the privacy policy (items 1, 2 and 6);
- **(b)** production data operations outside an approved plan (most of item 7);
- **(a)** the instruction layer and agent permissions (part of item 4).

Round 4 returned the page gates to him. The list was never ruled on as a list (`DAN-055`). The items DEC-155 does not name are items 3, 5, 8 and 10.

1. **Legal classification and its record:** the AI Act Annex III, the MDR intended purpose, Play's "health app". Also any rewording of the purpose record while counsel's Q2 is open (`KW-055`).
2. **Engaging, briefing and paying counsel** (`DAN-014`), and accepting counsel's answer as the project's position.
3. **Spending money:** GitHub Pro, Railway or Atlas plans, the D-U-N-S number, the Apple fee, a Play organisation account, a trademark search, the owner's Spotify Premium.
4. **Accounts and credentials:**
   - creating, owning or closing any account;
   - custody of the release keystore;
   - any change to agent permissions.
5. **Store submission:**
   - every attestation signed in his name;
   - the country list (`DAN-027`).
6. **Anything published under his identity:**
   - the privacy policy's controller line;
   - any statement to Spotify, Google or Garmin.
7. **Irreversible production deletes,** even inside an approved plan, at run time.
8. **Breach and incident decisions** (Art. 33 and 34).
9. **Reversing one of his own past rulings.**
10. **Strategy:**
    - the playback-provider decision (`ARCH-005`);
    - a public launch;
    - recruiting testers;
    - adopting these tripwires;
    - any stop or pivot.

### The pre-mortem — 2026-10-17

*It is October 2027 and Kokonada is dead. What killed it?*

The same thing, for the third run: the people it was for never met it. A careful two-person build system spent the autumn hardening how changes are made: a coordinator, a merge guard, an instruction layer with twenty jurisdiction rows, a security agent. Each one fixed a real hazard. Meanwhile the audience stayed at five Spotify accounts, none of them invited. The three decisions only Daniel can make (the playback path, the lawyer, one real user) queued behind all the other decisions that had also come back to him.

*Third consecutive run with this answer. Nothing has moved against it. By rule it now heads this file.*

---

## § FINDINGS

### TIER 0 — EXISTENTIAL / STRUCTURAL

---

### KW-001 — Spotify caps the product at 5 users, and the only exit requires an organisation with 250k users
STATUS: OPEN
TIER: 0
BITES:
- **Already fired:** the sixth person cannot use it.
- **The day the owner's Premium lapses:** "the app will stop working" for everyone (`DAN-029`; the renewal date is still unrecorded).
- **Since 2026-07-20, also six months after each user's authorization** (`KW-063`).

OWNER: Daniel (business decision)
EVIDENCE:
- **Quota modes:**
  - "Up to 5 authenticated Spotify users can use an app that is in development mode";
  - Extended Quota needs an organisation with "at least 250k MAUs" [verified 2026-10-04, developer.spotify.com/documentation/web-api/concepts/quota-modes].
- **The February-2026 guide, re-read 2026-10-17:**
  - "All Development Mode apps require the app owner to have an active Spotify Premium subscription";
  - new apps get 5 users per app.
- **In the code:**
  - `mobile/KokonadaHealth/src/experience/connect/providers.ts:30` (`state: 'halted'`);
  - `betaFlags.ts:19` (`SPOTIFY_BETA_CONNECT = false`).

CONFIDENCE: PROVEN
WHAT IT IS: Serving more than five people needs Extended Quota, and Extended Quota needs a company with 250,000 monthly users. Spotify built this loop closed on purpose. It is a constraint, not news (§ SETTLED).
SOLUTION: It is Daniel's choice, recorded in `ARCH-005`:
- **(A) Stay at five, deliberately:** a private instrument and research rig.
- **(B) Change the sink:** research Apple MusicKit's Android SDK and its individual-account terms.
- **(C) Own the audio:** generative or CC0. This abandons "your own music".

Whatever the path, two minutes this week: record the Premium renewal date and the Spotify re-authorization date (`DAN-029`, `KW-063`).
LINKED: `KW-002`, `KW-042`, `KW-046`, `KW-060`, `KW-063`, `ARCH-005`, `DAN-029`
LAST VERIFIED: 2026-10-17

---

### KW-002 — Whether the 5-user cap governs App Remote playback is still unresolved
STATUS: OPEN (tracked as `DAN-054`, blocked on `DAN-036`)
TIER: 0
BITES: the moment a sixth person tries to play a track.
OWNER: Daniel (a 5-minute test at the `DAN-036` sitting)
EVIDENCE: The quota-modes page "does not explicitly address whether these limits apply to SDK or App Remote usage" [verified 2026-10-04]. `DAN-036`'s throwaway accounts do not exist yet (no update since 2026-10-04).
CONFIDENCE: INCONCLUSIVE (settled by one playback attempt from an account that is not on the allow-list)
WHAT IT IS: The one unknown that decides whether any version of today's architecture can reach a sixth person.
SOLUTION: per `DAN-054`: at the `DAN-036` sitting, try App Remote playback with a second Premium account that is not on the allow-list, and capture logcat around `SpotifyRemote.connect()`. 5 minutes.
LINKED: `KW-001`, `DAN-036`, `DAN-054`, `ARCH-005`
LAST VERIFIED: 2026-10-17

---

### KW-004 — The intelligence engine ranks the tracks it serves with no features, and nothing reports it
STATUS: OPEN (tracked as `BE-100`, P1)
TIER: 0
BITES: **already, on every generation.** The body input cannot change which library tracks are chosen, and that choice is the differentiator (VISION §5).
OWNER: Build team
EVIDENCE:
- `backend/app/services/features/featureService.js:26-38` drops every Spotify recording before any feature fetch or store write.
- `featureProvider.js:72-80` gives a Spotify track the key `spotify:<id>`.
- `selection/pipeline.js:95,101` looks features up by that key. Nothing writes a `spotify:` key, so `featured` is 0 by construction.
- **Corrected this run:** the ISRC remains available. Spotify reverted the Track `external_ids` removal in March 2026 [verified 2026-10-17, developer.spotify.com/documentation/web-api/references/changes/march-2026]. So `musicProfileService.js:202` (`track.external_ids?.isrc`) can be populated.

CONFIDENCE: PROVEN in code. INFERRED for production: no deploy log was read.
WHAT IT IS: The scorer, the trajectory planner and the affect bands rank tracks that carry no acoustic features. The "body → music" link is a receipt string, not a selection effect.
SOLUTION:
1. Measure: read the filtered `[selection.v2]` deploy lines and record `featured` against `pool`. 15 minutes.
2. If the ratio is zero, join served tracks to the CC0 corpus by ISRC where Spotify supplies one, and by `canonicalKey` (artist|title) otherwise. This needs `KW-005`'s corpus in production.
3. Do not relax the containment (ADR-0011).

Proof: `featured>0` on library generations.
LINKED: `KW-005`, `KW-052`, `KW-042`, `BE-100`, ADR-0010, ADR-0011
LAST VERIFIED: 2026-10-17

---

### KW-005 — The provider-agnostic discovery corpus probably does not exist in production
STATUS: OPEN
TIER: 0
BITES: already. One of the two discovery paths runs on an empty or partial corpus.
OWNER: Build team, plus Daniel for one variable value
EVIDENCE:
- `backend/app/workers/globalSeedIngest.worker.js:21` reads a local dump path.
- `backend/app/sockets/biometricHandler.js:111,926` (`VECTOR_DISCOVERY === 'true'`).
- The production value is still unreported (`Kokonada-private/OWNER_ACTIONS_2026-10-04.md` item 6).

CONFIDENCE: INFERRED
WHAT IT IS: Either discovery runs on an empty corpus, or it runs on the Spotify search path that `KW-052` shows is degraded.
SOLUTION: Daniel reports `VECTOR_DISCOVERY`; the build team counts `trackcatalogs` read-only. If the count is near zero, ingest once as an approved plan step (class (b)). Proof: the counts before and after, and `discovery>0` in `[selection.v2]`.
LINKED: `KW-004`, `KW-052`, `BE-082`, ADR-0010
LAST VERIFIED: 2026-10-17

---

### KW-006 — The background workers were not known to run in production
STATUS: CLOSED (2026-10-04)
TIER: 0
BITES: n/a
OWNER: —
EVIDENCE: DAN-048's `W workers-in-process=yes`, and the nightly `[sessionTrim]` lines. Further lines were recorded on 2026-10-08, 10-09 and 10-10.
CONFIDENCE: PROVEN
WHAT IT IS: Closed. The remaining gap is `KW-032`.
SOLUTION: None needed.
LINKED: `KW-032`
LAST VERIFIED: 2026-10-17

---

### TIER 1 — PRODUCT-BREAKING

---

### KW-063 — Spotify now expires every refresh token six months after the user's first authorization: nothing in the repo knows it, the planned revocation purge would fire on every expiry, and Generate hides the reconnect message
STATUS: OPEN (new)
TIER: 1
BITES:
- **Six months after each allow-listed user's original authorization.** For the owner, on a date nobody recorded; it may already have passed.
- **At the build of `BE-053`,** whose design reads `invalid_grant` as a revocation.

OWNER: Daniel (one tap and one calendar line), the build team (`BE-053`, `MB-095`), compliance-auditor (whether an expiry obliges any deletion)
EVIDENCE:
- **Spotify for Developers, "Introducing refresh token expiration" (2026-06-18):**
  - "6 months from user authorization";
  - "The lifetime is measured from the moment of the user's original authorization";
  - "Refreshing an access token does not reset or extend the refresh token's 6-month lifetime";
  - existing apps are "affected from July 20, 2026";
  - at expiry the token endpoint returns "a `400 Bad Request` response with an `invalid_grant` error";
  - "Do not retry the refresh — discard the stored token and redirect the user to sign in again" [verified 2026-10-17, developer.spotify.com/blog/2026-06-18-refresh-token-expiration].
- **The server:**
  - `backend/app/services/spotify.js:126-131` turns any 400 or 401 into `reconnect_required` ("Spotify session expired — reconnect Spotify") and keeps the stored token;
  - `backend/app/sockets/biometricHandler.js:968` emits it as free text, `playlist_error` `Token refresh failed: …`, with no machine-readable code.
- **The client:**
  - `mobile/KokonadaHealth/src/experience/generate/GenerateScreen.tsx:378-381` shows the fixed "That didn't land — let's try again." for every `playlist_error` (`MB-095`);
  - `ProfileScreen.tsx:325-327` offers Reconnect while a token is stored.
- **What is not recorded anywhere:**
  - `backend/app/models/User.js:22-33` stores no authorization date;
  - `BE-053` (P0, a HALT fix row, `CMP-139`) plans to "purge only on `invalid_grant`… re-check it after 4 days before purging";
  - `docs/` and `TASKS.md` contain no mention of the expiry rule.

CONFIDENCE: PROVEN (the rule, the code paths, the BE-053 design). INCONCLUSIVE (the owner's authorization date, which one Reconnect settles).
WHAT IT IS: Since 2026-07-20 a Spotify link dies on a fixed date. When it does, the server's message says the right thing, and the screen throws it away. The user sees "try again" indefinitely, while the fix is one tap away in Profile. And `invalid_grant` no longer means only "the user revoked us". Built as designed, `BE-053` would treat every six-month expiry as a revocation, and purge a consenting user's library data four days later.
SOLUTION:
1. **Daniel, today, 1 minute:** Profile → Spotify → Reconnect. Write the date plus six months in his calendar beside the Premium renewal (`DAN-029`). Proof: the next generation plays.
2. **A line on `BE-053`, before it is built:** `invalid_grant` has two causes. Record `spotifyAuthorizedAt` at every OAuth callback. Route an `invalid_grant` at or after six months to "reconnect" only. Whether an expiry still obliges any deletion is the compliance-auditor's ruling, not this file's. Tests: an `invalid_grant` at six months plus one day purges nothing; one at three months follows the revocation path.
3. **In the "silent lies" PR (`MB-095`):** the server adds `reason: 'reconnect_required'` to that `playlist_error`, and the screen shows "Reconnect Spotify in Profile", from a closed set, never raw text (`BE-080`). The test is pinned to that reason.

Cost: 1 minute, plus about 2 hours of build inside work already planned.
LINKED: `KW-007`, `KW-001`, `BE-053`, `CMP-139`, `MB-095`, `BE-080`, `DAN-029`
LAST VERIFIED: 2026-10-17

---

### KW-052 — Spotify's February-2026 Development-Mode migration silently broke parts of discovery, and every failure is swallowed
STATUS: OPEN (tracked as `BE-101`, P1; corrected 2026-10-17)
TIER: 1
BITES: **already, since 2026-03-09,** on every generation that reaches the Spotify discovery path.
OWNER: Build team (developer, then compliance-auditor)
EVIDENCE:
- **The February-2026 migration guide** [re-read 2026-10-17, developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide]:
  - the `GET /search` `limit` maximum is now 10, and the default is 5;
  - "Playlist contents (`items`) are only returned for playlists the user owns or collaborates on";
  - Track `popularity`, `available_markets` and `linked_from` are removed;
  - **correction:** Track and Album `external_ids` are marked "(reverted", per the March 2026 changelog: the field "will continue to be available".
- **The July 2026 changelog:**
  - development-mode quota is counted per developer account;
  - an exhausted quota answers 429 with `reason: "QUOTA_EXCEEDED"` [verified 2026-10-17].
- **In the code:**
  - `backend/app/services/spotify.js:498` still sets `SEARCH_MAX = 50`;
  - the non-owned playlist reads still sit inside `catch { /* skip this playlist */ }`;
  - a 429 would be swallowed the same way.

CONFIDENCE: PROVEN (the guide and the code). INFERRED (how often `per > 10` occurs).
WHAT IT IS: A silent lie. Discovery degrades to "nothing found", the code falls back, and the receipt reads normally. **What misled me on 2026-10-04:** I took the guide's list of removed fields at face value and missed its "(reverted" marker. `BE-100` and `BE-101` repeat that error (`KW-064` item 4).
SOLUTION: per `BE-101`, about half a day:
1. `SEARCH_MAX = 10`, with a contract test.
2. Stop reading non-owned playlists. The zero-code interim is `VIBE_PLAYLIST_SOURCING=false`, a production variable that needs Daniel's word.
3. Move to `/playlists/{id}/items`.
4. Log a 429's `reason` instead of swallowing it.
5. Drop step 4 of the 2026-10-04 solution ("treat ISRC as absent"). It was wrong.

Proof: fewer swallowed failures in the deploy logs, and `discovery>0`.
LINKED: `KW-004`, `KW-005`, `KW-041`, `KW-064`, `BE-101`
LAST VERIFIED: 2026-10-17

---

### KW-007 — A new user cannot connect any music provider, and the screen throws away the server's explanation
STATUS: OPEN (tracked as `MB-095`, P1)
TIER: 1
BITES:
- on the first Generate of every new install;
- **and now on every user's Spotify expiry** (`KW-063`).

OWNER: Build team
EVIDENCE:
- `providers.ts:30` (Spotify `halted`) and `:39` (YouTube `deferred`).
- `betaFlags.ts:19`.
- `GenerateScreen.tsx:378-381` shows a fixed line. It is unchanged since `e4743af`: no commit touched `src/experience/generate`.

CONFIDENCE: PROVEN
WHAT IT IS: The cap is a business constraint (`KW-001`). The discarded message is a bug that would stay a bug at five users.
SOLUTION: per `MB-095`: a closed set of known reasons ("No music provider connected", "Reconnect Spotify"), never raw text (`BE-080`), in the "silent lies" PR. Proof: a test per reason.
LINKED: `KW-001`, `KW-008`, `KW-063`, `MB-095`, `BE-080`
LAST VERIFIED: 2026-10-17

---

### KW-008 — A failed or timed-out generation is shown to the user as "Found your sound"
STATUS: OPEN (tracked as `MB-096`, P1)
TIER: 1
BITES: on every generation that errors or times out.
OWNER: Build team
EVIDENCE:
- `mobile/KokonadaHealth/src/experience/generate/generationStatusStore.ts:8,24-28,33`: the 30-second auto-settle sets `generating:false`, `message:null`.
- `GenerateScreen.tsx:45,404`: `RESOLVED_COPY = 'Found your sound'` on `'resolving'`.
- Unchanged since 2026-10-04.

CONFIDENCE: PROVEN
WHAT IT IS: A system that lies toward "everything is fine", the worst class in this file.
SOLUTION: per `MB-096`: show `RESOLVED_COPY` only after `playlist_ready`; the timeout sets an error; pin both with tests.
LINKED: `KW-007`, `MB-096`
LAST VERIFIED: 2026-10-17

---

### KW-009 — Opening the app without a network, or during a deploy, logs the user out
STATUS: OPEN (tracked as `MB-019`, P1)
TIER: 1
BITES: any cold start with no network, a DNS failure, or a 5xx during a Railway restart.
OWNER: Build team
EVIDENCE: `mobile/KokonadaHealth/src/prodBootstrap.ts:62-64` (`if (me.ok) … else await authSession.clear()`). Unchanged since 2026-10-04.
CONFIDENCE: PROVEN
WHAT IT IS: A transport error wipes the stored session.
SOLUTION: per `MB-019`: clear the session only on an authoritative 401 after a failed refresh. Test an offline cold start and a 502 cold start. In the "silent lies" PR.
LINKED: `KW-050`, `KW-010`, `MB-019`
LAST VERIFIED: 2026-10-17

---

### KW-010 — The offline banner promises playback that does not exist
STATUS: OPEN (tracked as `MB-027`, P2)
TIER: 1
BITES: every time the banner shows.
OWNER: Build team
EVIDENCE: `MB-027`.
CONFIDENCE: PROVEN
WHAT IT IS: See `MB-027`.
SOLUTION: per `MB-027`: true copy now, an offline queue later.
LINKED: `MB-027`, `KW-009`
LAST VERIFIED: 2026-10-04

---

### KW-011 — The Live Biometric toggle can disable Generate until logout
STATUS: OPEN (tracked as `MB-025`, P2)
TIER: 1
BITES: the first curious tap by a user with no heart-rate source.
OWNER: Build team
EVIDENCE: `GenerateScreen.tsx:331-347`, `:228`; `generateController.ts` `ctaMode()`.
CONFIDENCE: PROVEN
WHAT IT IS: See `MB-025`.
SOLUTION: per `MB-025`. Raise it to P1 if any tester build ships before P2 replaces Generate.
LINKED: `MB-025`, `UI-050`, `KW-045`
LAST VERIFIED: 2026-10-04

---

### KW-012 — The Bluetooth prompt appeared before the consent screen
STATUS: MITIGATED
TIER: 1
BITES: n/a on current builds. Old builds on a tester's phone still behave this way (`DAN-021`).
OWNER: Daniel (`DAN-020`)
EVIDENCE: H2 (#193) with device evidence. `MB-010` closes on `DAN-020`.
CONFIDENCE: PROVEN (code)
WHAT IT IS: Fixed in code.
SOLUTION: Run `DAN-020` at the phone evidence sitting.
LINKED: `MB-010`, `DAN-020`, `DAN-021`
LAST VERIFIED: 2026-10-04

---

### KW-013 — The live heart-rate session leaked across re-login
STATUS: MITIGATED
TIER: 1
BITES: n/a on current builds.
OWNER: Build team
EVIDENCE: H2 (#193).
CONFIDENCE: PROVEN (code)
WHAT IT IS: Fixed with H2.
SOLUTION: As for `KW-012`.
LINKED: `KW-012`
LAST VERIFIED: 2026-10-04

---

### KW-014 — History's row tap and empty-state button do nothing
STATUS: OPEN (tracked as `MB-026`, P2; P8 rebuilds the page)
TIER: 1
BITES: the first tap on a past moment.
OWNER: Build team
EVIDENCE: `navigation/RootNavigator.tsx:39`; `HistoryScreen.tsx:62`.
CONFIDENCE: PROVEN
WHAT IT IS: See `MB-026`.
SOLUTION: per `MB-026`, or in P8.
LINKED: `MB-026`
LAST VERIFIED: 2026-10-04

---

### KW-015 — Android has one way in, Google, its library depends on removed APIs, and the React Native version under it reached End of Cycle on 2026-10-15
STATUS: OPEN
TIER: 1
BITES:
- **now:** 0.86 is at End of Cycle;
- **about 2026-11-09:** the latest start for the upgrade (`ARCH-010`);
- **2026-12-07:** 0.89 ships and 0.86 is unsupported;
- **the upgrade itself is likely to pull `play-services-auth` ≥22,** which `@react-native-google-signin/google-signin` `^16.1.2` cannot use (`MB-059`).

OWNER: Build team (P11), Daniel (`DEC-095`)
EVIDENCE:
- `react-native@0.88.0` was published on 2026-10-15T14:08Z ("latest" on the npm registry, read 2026-10-17).
- `mobile/KokonadaHealth/package.json:22` is `"react-native": "0.86.0"`.
- `:16` is google-signin `^16.1.2`.
- `:31` is Reanimated `^4.5.1` (0.87+ needs 4.6+, per `ARCH-010`).

CONFIDENCE: PROVEN (versions, publish date). INFERRED (the coupling between the RN upgrade and `play-services-auth`).
WHAT IT IS: The only sign-in door is tied to a library pinned below a removed API, and the upgrade that would force the issue now has a clock.
SOLUTION: Rule `DEC-095` before about 2026-11-09, and plan the Credential Manager migration (`MB-059`) in the same decision. Add a build-time guard that fails if `play-services-auth` resolves to ≥22.
LINKED: `MB-059`, `MB-001`, `ARCH-010`, `DEC-095`
LAST VERIFIED: 2026-10-17

---

### KW-016 — The tracked mobile config holds placeholders, and the only real copies are uncommitted edits in two worktrees that the cleanup rule invites someone to delete
STATUS: OPEN
TIER: 1
BITES: **the first `git worktree remove --force` of `h1-evidence` or `hx3-evidence`.** `CLAUDE.md` § Every task now says to remove a task's worktree after its merge, and 31 worktrees sit on disk. Also any build from a fresh clone.
OWNER: Daniel (copy, 2 minutes), the build team (plan step S6)
EVIDENCE:
- `mobile/KokonadaHealth/src/health/config.ts:2,7,14` hold `YOUR-BACKEND`, `YOUR_WEB_CLIENT_ID` and `YOUR_SPOTIFY_CLIENT_ID`.
- `git status` shows that file modified only in `.claude/worktrees/h1-evidence` and `hx3-evidence`, and the `h1-evidence` copy holds no `YOUR_` value (read 2026-10-17; values not printed).
- `Kokonada-private` has no `secrets/` folder: owner action 15 of 2026-10-04 is not done.

CONFIDENCE: PROVEN
WHAT IT IS: The values are public identifiers, not secrets. The risk is that every evidence build depends on a copy a routine cleanup can erase.
SOLUTION: Copy the file into `Kokonada-private` now. Then plan step S6: inject the values at build time, and fail on any value that starts with `YOUR_`. Proof: the copy exists outside every worktree.
LINKED: `KW-034`
LAST VERIFIED: 2026-10-17

---

### KW-017 — iOS is a stub, and it is paused
STATUS: OPEN (deferred: no Mac)
TIER: 1
BITES: the first iOS submission.
OWNER: Daniel (`DAN-011`)
EVIDENCE: No `*.entitlements` file and no `Podfile.lock` (2026-10-04). The partner's iOS HealthKit server store merged as #232 (`MB-900`). Its device phases need a real iPhone.
CONFIDENCE: PROVEN
WHAT IT IS: A known, bounded list, parked. Server-side HealthKit work now exists ahead of any iOS client.
SOLUTION: Keep it visibly parked. Before more iOS work, decide whether iOS stays paused (`KW-047`, scope).
LINKED: `KW-027`, `KW-066`, `DAN-011`, `MB-900`
LAST VERIFIED: 2026-10-17

---

### KW-018 — The learning stack has no explicit feedback input
STATUS: OPEN
TIER: 1
BITES: slowly. Personalisation cannot be told it was wrong.
OWNER: Build team
EVIDENCE: There is no `playback_event`, `track_skipped` or feedback call in `mobile/KokonadaHealth/src` (2026-10-04).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged. Stage 0 step 14 covers the implicit half.
SOLUTION: One "this didn't fit" control in P3, wired to reward dispatch. It doubles as the instrument for `KW-042`.
LINKED: `KW-042`, `KW-044`
LAST VERIFIED: 2026-10-04

---

### TIER 2 — LEGAL, REGULATORY, STORE

---

### KW-054 — The counsel brief has been ready since 2026-10-04, and it has not been sent
STATUS: OPEN
TIER: 2
BITES:
- **The first non-owner tester:** the brief's Q1 (the controller and the law for the Israeli stage) and Q4 (the legal text that tester sees) gate it, whatever the EU answer.
- **2026-10-20:** the send date that leaves counsel two weeks before 2026-11-02.
- **EU dates:**
  - **about 2026-11-02 and 2026-12-02** (Art. 50(2)) and **2027-01-15** (the classification checkpoint) apply **only if** the country list (`DEC-056`, `DAN-027`) includes the EU, or counsel finds that EU law reaches the Israeli stage (NF-5);
  - the MDR question applies at the first EU distribution.

OWNER: Daniel (send and pay), regulatory-researcher (prepared)
EVIDENCE:
- `docs/design-v2/counsel/gating-five-2026-10-04.md`:
  - Q1, the controller and the law for the Israeli tester stage;
  - Q2, wellness or a medical intended purpose;
  - Q3, the minimum age of 16;
  - Q4, the legal text the first non-owner tester sees;
  - Q5, high-risk emotion recognition;
  - everything else in Appendix A, "answer when convenient".
- The post-J2 annex (`post-j2-privacy-questions-2026-10-06.md`, PJ2).
- `DAN-014` has no send recorded.
- DEC-148: testers in Israel only.
- NF-5 (`DAN-014`, update 2026-10-04): "every EU date depends on the country list… and on counsel's answer to the brief's hinge, whether the EU instruments reach that stage at all".

CONFIDENCE: PROVEN
WHAT IT IS: The sentinel's 2026-10-04 solution was half done in the same hour: the brief exists. The half only Daniel can do has waited 13 days.
SOLUTION: Daniel sends the brief with the Hebrew cover note and books a fixed-fee scoping call with a technology lawyer, by 2026-10-20. **Fallback if no answer by 2026-11-02:** `DISCOVERY_CAPTION_LLM=false` stays off (`KW-062`), and no EU tester is enrolled (T10). Proof: a send date in `DAN-014`.
LINKED: `KW-022`, `KW-055`, `KW-062`, `DAN-010`, `DAN-014`, `DAN-015`, `DEC-148`, T10
LAST VERIFIED: 2026-10-17

---

### KW-062 — One production variable, `DISCOVERY_CAPTION_LLM=true`, carries three separate exposures
STATUS: OPEN
TIER: 2
BITES:
- **Already:** exposures (1) and (2), on the owner's generations.
- **It also blocks the privacy page:** turning it off is the page's G-1 condition.
- The Art. 50(2) date applies only under `KW-054`'s EU condition. NF-1 says the 2026-12-02 grace may not cover the captions at all.

OWNER: Daniel (one variable; `DAN-053` item 2, `DEC-146`), the build team (`BE-044`, `BE-083`)
EVIDENCE:
- The flag read true on 2026-09-29. No change is recorded since: `DAN-053` (2) is unproven, and PR #237 does not claim it.
- `backend/app/sockets/biometricHandler.js:119,1333`.
- `services/discovery/captionService.js:20`.
- NF-1 (`DAN-053`, update 2026-10-04): Art. 111(4) (a reproduction) limits the grace to systems "placed on the market before 2 August 2026". Whether that covers the captions is counsel's question.

The exposures:
- **(1)** captions are rendered verbatim (`BE-044`);
- **(2)** `bpmCenter` and the heart-rate band reach Groq, against the declarations (`BE-083`);
- **(3)** the Art. 50(2) date.

CONFIDENCE: PROVEN (code). The flag's value is as of 2026-09-29.
WHAT IT IS: The cheapest fix for three exposures is one reversible variable. Daniel ordered it on 2026-10-04 (DEC-146), and it has not happened.
SOLUTION: Daniel sets `DISCOVERY_CAPTION_LLM=false` and records the date it was first set to true (NF-1). 2 minutes. Proof: no `[caption]` call in the deploy logs, and Now Playing shows no caption.
LINKED: `BE-044`, `BE-083`, `DAN-035`, `DAN-053`, `DEC-146`, `KW-019`, `KW-025`, `KW-054`, `KW-024`
LAST VERIFIED: 2026-10-17

---

### KW-055 — The record of the product's purpose is being reworded by agents while the legal question it decides is open
STATUS: OPEN (tracked as `UI-082`, P1)
TIER: 2
BITES: whenever counsel or a regulator reads the record. ADR-0017 commits the wording at V1, and the V1 close-out for Abyss is next.
OWNER: Daniel and counsel (decision), the orchestrator (freeze)
EVIDENCE:
- `docs/VISION.md` §6.
- The V1 amendment ("regulated breath" → "the slow-breath law").
- The draft Annex III guidelines' anti-relabelling language. They are still a draft [secondary, verified 2026-10-17]: "What a provider declares as the purpose, across manuals, technical files, and sales copy, anchors the analysis" (secondary summary of the draft).

CONFIDENCE: PROVEN (the edits). Whether the wording matters legally is counsel's question.
WHAT IT IS: Restraint in user-facing copy is legitimate. Rewriting the internal record of intent while the function stays the same decides the classification by proxy.
SOLUTION: Freeze purpose-describing text until counsel answers Q2: VISION §5–6, DEC-015, and ADR-0017's purpose paragraph. Keep a one-line changelog beside any clarity edit. Cost: none.
LINKED: `KW-054`, `KW-022`, `DAN-010`, `UI-082`
LAST VERIFIED: 2026-10-17

---

### KW-019 — The backend still emits "High-Stress / Pre-Panic"; only the client hides it
STATUS: MITIGATED
TIER: 2
BITES: on any build older than #192 (`DAN-021`), and through LLM captions while `KW-062` stands.
OWNER: Build team
EVIDENCE: `backend/app/services/medicalProfileService.js:18-20`; `agents/runtime/knowledge/stateTaxonomy.js:574`; the client display set `stateDisplayVocabulary.ts:24-40`.
CONFIDENCE: PROVEN
WHAT IT IS: The harm half is closed on current builds.
SOLUTION: Rename the server key when P7 rebuilds Pulse, and add a server-side forbidden-terms check shared with the captions (`BE-044`).
LINKED: `KW-020`, `KW-062`, `UI-020`, `DAN-021`
LAST VERIFIED: 2026-10-04

---

### KW-020 — The stress rule is an absolute HRV threshold with no personal baseline
STATUS: OPEN (tracked as `BE-103`)
TIER: 2
BITES: already, for any consented user with HRV data.
OWNER: Build team
EVIDENCE: `medicalProfileService.js:22` (`t.hrv < 20`).
CONFIDENCE: PROVEN
WHAT IT IS: RMSSD below 20 ms is ordinary in healthy adults.
SOLUTION: Route the rule through `baselineEngine`. With no baseline, return lower confidence and never a maximal-stress verdict. Do it at P7.
LINKED: `KW-019`, ADR-0013
LAST VERIFIED: 2026-10-04

---

### KW-021 — AI Act Art. 50 transparency has applied since 2 Aug 2026; the notice is built, its final wording is not
STATUS: MITIGATED
TIER: 2
BITES: in force for EU users. Under DEC-148 there are none yet (`KW-054`).
OWNER: Build team (built), Daniel and counsel (wording)
EVIDENCE: H1 (#192). The final wording is the brief's Q4 (2026-10-04).
CONFIDENCE: PROVEN
WHAT IT IS: The buildable half is done.
SOLUTION: Counsel's Q4 (`KW-054`).
LINKED: `KW-054`, `UI-005`
LAST VERIFIED: 2026-10-17

---

### KW-022 — Whether Kokonada is a high-risk emotion recognition system is unresolved, and only counsel can resolve it
STATUS: NEEDS ATTENTION (third consecutive run)
TIER: 2
BITES: **2027-12-02** (Annex III), under `KW-054`'s EU condition. The checkpoint is 2027-01-15.
OWNER: Daniel and counsel
EVIDENCE:
- The Annex III guidelines are still a draft. Feedback ran to 2026-07-23; forecasts for adoption range from late 2026 to early 2027 [secondary sources, verified 2026-10-17].
- The Omnibus dates stand (Reg. 2026/1744: Annex III from 2027-12-02).

CONFIDENCE: INCONCLUSIVE by construction
⚠ NEEDS ATTENTION — NO KNOWN SOLUTION:
- **Tried:** a build-side audit, a regulatory dossier, and a one-page brief (2026-10-04).
- **Blocks:** a question of law, and the brief has not been sent.
- **Unblocks:** Daniel sending `KW-054`'s brief. Open in this state for three runs.

LINKED: `KW-054`, `KW-055`, `DAN-010`
LAST VERIFIED: 2026-10-17

---

### KW-023 — Any workplace or education deployment is prohibited in the EU
STATUS: MITIGATED (a standing constraint)
TIER: 2
BITES: the day a B2B or education channel is contemplated.
OWNER: Daniel
EVIDENCE: AI Act Art. 5(1)(f). HX-7 (#203) retired the Working and Focus chips.
CONFIDENCE: PROVEN
WHAT IT IS: Nothing in the product points there now.
SOLUTION: Keep it as a permanent constraint.
LINKED: `KW-043`
LAST VERIFIED: 2026-10-04

---

### KW-024 — The privacy policy is not hosted, the app already links to the address, and it waits on the owner's facts and on J2's evidence
STATUS: OPEN
TIER: 2
BITES: the first build that reaches anyone but the owner, and any Play track.
OWNER: the orchestrator (publish), Daniel (facts, and class (c) for every publication)
EVIDENCE:
- `https://kokonada.github.io/privacy/` returns **404** (read 2026-10-17).
- The page is built and reviewed in a local repository with no remote (`C:\Users\danie\Videos\kokonada.github.io`; the private handoff §0.5).
- It waits on:
  - the owner facts (`Kokonada-private/OWNER_ACTIONS_2026-10-04.md` items 1–6: the legal name, the privacy mailbox, hosting facts);
  - the captions-off proof (G-1, `KW-062`);
  - DEC-156: "published only after DAN-050 records the sweep armed and one armed `[sessionTrim]` line that meets its closure rule". That record waits on `DAN-070`.

CONFIDENCE: PROVEN
WHAT IT IS: Three independent waits, each one Daniel's.
SOLUTION: The Top 3's item 3 clears G-1; `DAN-070` clears DEC-156; the owner facts clear the rest. Then publish from the separate clone (class (c)), and flip `PRIVACY_POLICY_HOSTED` (DEC-121). Proof: a 200 on the address.
LINKED: `DAN-015`, `DAN-026`, `DAN-070`, `DEC-156`, `KW-054`, `KW-062`
LAST VERIFIED: 2026-10-17

---

### KW-025 — Groq's DPA and zero retention are unconfirmed, while health-derived values reach Groq
STATUS: OPEN
TIER: 2
BITES: at store submission, and now while `KW-062` stands.
OWNER: Daniel (`DAN-035`)
EVIDENCE:
- `docs/PRIVACY_DECLARATIONS.md:90-95,165`.
- `BE-083`.
- The model `openai/gpt-oss-20b` is not deprecated [verified 2026-10-17, console.groq.com/docs/deprecations].

CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: Daniel confirms the DPA and ZDR in the Groq console (`DAN-035`, 10 minutes). `KW-062`'s variable removes the live part.
LINKED: `KW-062`, `DAN-035`, `DAN-047`
LAST VERIFIED: 2026-10-17

---

### KW-026 — Spotify track IDs to a third party (ReccoBeats)
STATUS: OPEN (tracked as `BE-043`, P1)
TIER: 2
BITES: if the containment ever regresses.
OWNER: compliance-auditor
EVIDENCE: `BE-043`; `featureService.js:26-38`.
CONFIDENCE: INFERRED unreachable
WHAT IT IS: See `BE-043`.
SOLUTION: per `BE-043`. Do not delete the adapter in a cleanup batch.
LINKED: `BE-043`, `KW-004`
LAST VERIFIED: 2026-10-04

---

### KW-027 — Sign in with Apple has no entitlement
STATUS: OPEN (deferred: no Mac)
TIER: 2
BITES: the first App Store submission.
OWNER: Daniel (`DAN-011`)
EVIDENCE: No `*.entitlements` file (2026-10-04).
CONFIDENCE: PROVEN
WHAT IT IS: Parked with `KW-017`.
SOLUTION: Unchanged.
LINKED: `KW-017`
LAST VERIFIED: 2026-10-04

---

### KW-028 — The Play declaration describes a product that generates music
STATUS: OPEN
TIER: 2
BITES: at submission.
OWNER: Build team (P13)
EVIDENCE: `docs/store/play-health-connect-declaration.md:19`.
CONFIDENCE: PROVEN
WHAT IT IS: Kokonada selects and sequences existing recordings. The declaration's outward claim also feeds `KW-055`.
SOLUTION: Rewrite it at P13 from the code, after counsel's Q2.
LINKED: `KW-024`, `KW-055`
LAST VERIFIED: 2026-10-04

---

### KW-029 — Health Connect and Play blockers
STATUS: MITIGATED
TIER: 2
BITES: at any Play track.
OWNER: Build team, Daniel
EVIDENCE: HX-5 (#208); the store gate (#221). `CMP-066` waits on `DAN-015`.
CONFIDENCE: PROVEN
WHAT IT IS: Fixed in code. It waits on hosting and evidence.
SOLUTION: `KW-024`, then the evidence sitting (`KW-053`).
LINKED: `MB-035`, `KW-024`, `KW-053`
LAST VERIFIED: 2026-10-04

---

### KW-030 — Account deletion leaves a Garmin registration live
STATUS: OPEN (dormant)
TIER: 2
BITES: the first Garmin-linked erasure.
OWNER: Daniel (`DAN-009`)
EVIDENCE: The Garmin surfaces are dormant until `CMP-051`.
CONFIDENCE: INFERRED
WHAT IT IS: Unchanged and dormant.
SOLUTION: Deregister in the delete path when Garmin is real.
LINKED: `DAN-009`
LAST VERIFIED: 2026-09-01

---

### KW-051 — J2's new orphan sweep would erase production evidence at the first 03:30 UTC after deploy
STATUS: CLOSED (2026-10-17)
TIER: 2
BITES: n/a
OWNER: —
EVIDENCE:
- `backend/app/services/privacy/orphanSweep.js:21-27`: "The nightly run erases only while the marker document `opsmarkers/_id: 'orphan-sweep'` exists… Only armOrphanSweep writes it", and `ORPHAN_SWEEP_DISABLED` "can only DISARM".
- `:311-316`: arming refuses while any orphan exists.
- **The sequence in production:**
  - T16a recorded 0 orphans (2026-10-06);
  - the sweep was armed at 2026-10-07T04:32:31Z (`Kokonada-private/session-3181c7f6/j2/runs/t16b-T9-arm-2026-10-07.txt`);
  - the 24-hour recount read `RESULT zero` (2026-10-08);
  - the nightly lines read `orphanErasures=0 … failures=0` (2026-10-08 to 2026-10-10).

CONFIDENCE: PROVEN
WHAT IT IS: Option (a) of the 2026-10-04 solution, record first and then arm, was built and run. The remaining evidence chain is `DAN-070` (`KW-066`).
SOLUTION: None needed.
LINKED: `DAN-050`, `DAN-070`, `KW-066`
LAST VERIFIED: 2026-10-17

---

### TIER 3 — OPERATIONAL

---

### KW-065 — CI's runner image moves to Ubuntu 26.04 from Monday, nothing is pinned, and the pin needs the owner's approval
STATUS: OPEN (new; tracked as `OPS-191`, P2)
TIER: 3
BITES: **2026-10-19**, gradually until 2026-11-19. A red job on `main` holds the deploy (Wait for CI) and every merge (merge-guard needs CI green).
OWNER: Daniel (class (a): `.github/workflows/**` is jurisdiction row J16), the build team
EVIDENCE:
- **GitHub changelog, 2026-09-17:**
  - the move "will roll out gradually between October 19 and November 19, 2026";
  - "pin your workflows to `ubuntu-24.04` to stay on the current image";
  - it "may break builds" [verified 2026-10-17, github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration].
- **Seven jobs run on `ubuntu-latest`:** `.github/workflows/ci.yml:23,117,134,181,264`, `coordination.yml:32` and `secret-scan-history.yml:21`. `OPS-191` lists six and misses the last one.
- **The distribution-specific dependency:** the backend job downloads a MongoDB binary through `mongodb-memory-server` `^11.2.0` (`backend/package.json:50`), which chooses it by the runner's distribution. Node, Java, the Android SDK and gitleaks are downloaded by version.

CONFIDENCE: PROVEN (the dates, the labels). INFERRED (which job, if any, breaks).
WHAT IT IS: A gradual rollout makes failures intermittent, one run on the old image and the next on the new. That pattern looks exactly like flakiness, which `CLAUDE.md` forbids claiming without evidence. So it costs diagnosis time, and while it lasts nothing merges or deploys.
SOLUTION: **(a) Preferred, 10 minutes:** one PR pins the seven jobs to `ubuntu-24.04`, and Daniel approves it under class (a) before Monday. Later, a branch run on `ubuntu-26.04` goes green and the pin is lifted. **(b) If he declines:** before calling any red run flaky, read the image name in the job's "Set up job" log. Proof: the next run's "Set up job" names 24.04.
LINKED: `OPS-191`, `KW-050`, `KW-033`
LAST VERIFIED: 2026-10-17

---

### KW-064 — Four written instructions a session obeys say something false today
STATUS: OPEN (new)
TIER: 3
BITES:
- **(1)** at P1's G2, or at any page a session starts before then;
- **(2)** the moment PR #237 merges;
- **(3)** every Monday and Friday at 21:00 UTC that passes without a run;
- **(4)** when anyone builds `BE-100` or `BE-101` from their text.

OWNER: Daniel (class (a) for items 1 and 3), the orchestrator (items 2 and 4)
EVIDENCE:
1. **The page gates.**
   - Daniel's Round 4, 2026-10-07 ~05:20Z, answer verbatim "הכול אצלי". The outcome: "the owner gives the V1 direction and, on every page P1–P14, G2 (forks), G3 (direction) and G6 (prototype), and G13 (merge)… To be recorded as a DEC by the next scribe" (`Kokonada-private/design-v2/rulings/owner-rulings-session-8df5ce10.md:24-28`).
   - No DEC records it: no file under `docs/design-v2` holds the phrase.
   - `CLAUDE.md:48`, merged on 2026-10-08, a day after the ruling: "Under DEC-142 the orchestrator rules design gates (G2, G3, G6), the V1 direction and pin reversals with the agents' recorded consensus".
   - `.claude/commands/page.md:18`: owner gates are recorded from his message "or, under my delegation (DEC-142), from the orchestrator's decision".
   - `DEC-155.md:80`: "`CLAUDE.md` wins over a conflicting ruling until the owner edits it".
2. **`DAN-053`.**
   - PR #237 (open since 2026-10-07, head `27ab066`) flips `DAN-053` to `[x]` "CLOSED ON EVIDENCE 2026-10-07", on one item: "the owner confirmed in the Railway service settings that 'Wait for CI' is on".
   - Items (2) captions off, (3) the keystore backup and (4) the read-only Atlas user carry no evidence.
   - Meanwhile `main`'s `TASKS.md:19` still says "until Railway's Wait for CI is on, a merge deploys before CI ends".
3. **The sentinel's schedule.**
   - `.claude/agents/sentinel.md`, INVOCATION: the routine "runs every Monday and Friday at 21:00 UTC".
   - `DAN-069` (2026-10-08): the new routine is disabled and not linked to this computer; "Until then no scheduled sentinel run happens".
   - The sentinel worktree holds no run since then: its status is clean, and its ledger equals `origin/main`'s.
4. **`BE-100` and `BE-101`** repeat this file's own 2026-10-04 claim that Spotify removed Track `external_ids`. Spotify reverted that in March 2026 (`KW-052`).

CONFIDENCE: PROVEN
WHAT IT IS:
- **(1)** By its own precedence rule, the binding file wins over Daniel's later word until he edits it. So a session that does exactly what it is told would decide his design gates.
- **(2)** A closure in flight would drop three live owner actions from the queue on the evidence for one.
- **(3)** Readers believe this ledger refreshes twice a week.
- **(4)** A build would start from a premise that is false.

SOLUTION:
1. The scribe records Round 4 as a DEC. One class (a) PR changes `CLAUDE.md:48` and `page.md:18` to "the owner rules G2, G3, G6 and G13 on every page (Round 4)", and Daniel approves it in his words. 20 minutes of build and 2 minutes of his.
2. A session amends #237 so `DAN-053` keeps items (2)–(4) open and records item (1) with its date, and updates `TASKS.md:19`. 10 minutes.
3. Daniel links and enables the routine on his device (`DAN-069`), 2 minutes; or `sentinel.md` says "manual until linked" (class (a)).
4. One update line each on `BE-100` and `BE-101`, citing the March 2026 changelog.

Proof: at the next run, the four texts read true.
LINKED: `KW-056`, `KW-050`, `KW-052`, `DAN-053`, `DAN-069`, `DEC-155`, `BE-100`, `BE-101`, T8
LAST VERIFIED: 2026-10-17

---

### KW-066 — Two PRs fell into a two-day review gap, and their code is what production runs
STATUS: OPEN (new)
TIER: 3
BITES: already. Production deployment `14098fe1` at `aafb05e` (#239) carries #232's `backend/app` (`DAN-050`, update 2026-10-10).
OWNER: the orchestrator (merge-guard, security-auditor)
EVIDENCE:
- **The gap.** #232 (merged 2026-10-08T08:54Z) and #239 (11:35Z), both the partner's, merged after 2026-10-06 and before #231 (12:10Z). `OPS-168` covers "Nothing that merged before 2026-10-06". Session start step 6 covers "#231 and every PR merged after it". Neither PR carries a `MERGE-GUARD post-merge` comment (read 2026-10-17).
- **What #232 added:**
  - an encrypted health-sample store (`backend/app/models/HealthSample.js`; `services/wearable/health*.js`; 587 lines in `healthSampleReconciliation.js`);
  - a repeatable job that runs every five minutes in production (`backend/app/index.js:172-178`, `HEALTH_SAMPLE_RECONCILE_CRON || '*/5 * * * *'`);
  - a new queue (`queues/definitions.js`);
  - `HealthSample` in the erasure cascade and in the armed sweep (`services/privacy/orphanSweep.js:62-63`).
- **Its reviews.** The compliance review is recorded (`OPS-174`). No security review is recorded, because the security agent did not exist yet.
- **Reach.** The v2 path is reached only with `schemaVersion === 2` (`integrationsController.js:710-719`), which no shipped client sends. Atlas holds its four indexes, the TTL among them (`MB-900`, update 2026-10-07).
- **The deploy timing.** GitHub's deployment status for `aafb05e` went `success` at 18:39:40Z, seven hours after CI passed at 11:41:04Z, which fits a manual approval. The 24-hour sitting's owner note (2026-10-08T08:57Z) had asked to wait for the 48-hour recount, and that re-run is now `DAN-070`.

CONFIDENCE: PROVEN (the gap, the missing verdicts, the code). INFERRED (that the seven-hour gap was an approval).
WHAT IT IS: The new guardrails cover everything before 2026-10-06 and everything after #231, and miss the two days between. The code in that window is the health-data path, and production runs it. No harm is known: no shipped client reaches the path, and the nightly lines read zero.
SOLUTION: Run `merge-guard` post-merge on #232 and #239 and post the verdicts. Widen `OPS-168` to "before #231 (2026-10-08T12:10Z)", so the security agent's first pass includes #232's surfaces. About 1 hour of agents and no time from Daniel. Proof: two verdict comments and the new `OPS-168` line.
LINKED: `OPS-168`, `OPS-174`, `DAN-070`, `DAN-050`, `MB-900`, `KW-051`, `KW-017`
LAST VERIFIED: 2026-10-17

---

### KW-050 — A merge to `main` is a production deploy
STATUS: MITIGATED (was OPEN)
TIER: 3 (re-tiered from 1: the deploy now waits for CI)
BITES:
- **On a merge:** GitHub itself still lets a red PR merge into `main`.
- **Every deploy is a restart of the single instance** (`KW-009`).

OWNER: Daniel (`DAN-064`, which is money), the build team
EVIDENCE:
- **Wait for CI.** Daniel confirmed in Railway's settings on 2026-10-07 that it is on. That is recorded only in open PR #237 (`KW-064` item 2). The private handoff §0.2: "#217… Railway waited for CI first".
- **The deny list.** It is committed in `.claude/settings.json` on `origin/main`, read this run: force pushes, pushes to `main`, `reset --hard`, `clean`, `stash drop`/`clear` and `--admin` merges, each for Bash, for PowerShell and for `git -C`.
- **The merge rule and merge-guard** have been in force since #231.
- **The residue.** #218 merged on 2026-10-05 with its own backend check red, and `main` stayed red until #220. A GitHub ruleset needs a paid plan (`DAN-064`).
- **Correction.** The 2026-10-04 inference that Wait for CI was off was wrong. The deployment's creation time could not settle it, as that entry itself said.

CONFIDENCE: PROVEN (the deny list, the merge rule). PROVEN by Daniel's own statement (Wait for CI).
WHAT IT IS: The two free layers the 2026-10-04 run asked for are in place, plus a process gate that binds both partners. What remains is GitHub's own refusal, which costs money.
SOLUTION: Optional, and it is Daniel's money: GitHub Pro and a ruleset that requires CI (`DAN-064`). Until then the merge rule is the gate.
LINKED: `KW-009`, `KW-033`, `KW-064`, `KW-065`, `DAN-053`, `DAN-064`, T7
LAST VERIFIED: 2026-10-17

---

### KW-053 — The critical path runs through the owner's sessions and hands, by design, and nothing schedules them
STATUS: OPEN
TIER: 3
BITES:
- **Every week Daniel is away:** measured, there was no merge from 2026-10-10 to 2026-10-17.
- **At P2's G1:** the HALTs close only on evidence that needs his accounts and phone.
- **At the first tester:** the privacy page, counsel, and `DAN-036`.

OWNER: Daniel (sittings), the orchestrator (scheduling)
EVIDENCE:
- **Every PR passes through Daniel's side.**
  - DEC-155 (2026-10-06): owner classes (a), (b), (c).
  - Round 4 (2026-10-07): every page gate is his.
  - `CLAUDE.md` § The merge rule: "Bedrack's PRs meet the same rule: the owner side runs `/review-pr <n>`".
  - The partner's #246 and #241 have been open since 2026-10-10 and 2026-10-08.
- **The owner queue.**
  - 54 open `DAN-` rows (41 on 2026-10-04).
  - `DAN-036`'s accounts do not exist.
  - `DAN-056` passed its own date (2026-10-11).
  - `DAN-053` has one item of four done.

CONFIDENCE: PROVEN
WHAT IT IS: The delegation of 2026-10-03 moved the build gates off Daniel. His own later rulings moved many back, for good reasons recorded in DEC-155. The consequence is plain: the project moves at the speed of his sessions. That is a choice, not a defect, but unscheduled it shows up as weeks without a merge.
SOLUTION: Three options, and the choice is his:
- **(A) Accept it,** and record it as ACCEPTED in his words.
- **(B) A fixed weekly owner hour,** in which a session runs `/review-pr` on the partner's PRs, the merges and any gate. The orchestrator prepares one Hebrew click-list for it.
- **(C) A narrower class for the partner's low-risk PRs** (tests and docs outside every owner class). That is a `CLAUDE.md` change, so it is class (a).

The two sittings proposed on 2026-10-04 still stand (at the computer; phone evidence). Proof: merges happen in a week he is away, or the ACCEPTED line exists.
LINKED: `ARCH-011`, `DAN-036`, `DAN-015`, `KW-024`, `KW-047`, `KW-064`
LAST VERIFIED: 2026-10-17

---

### KW-057 — Daniel can reverse any delegated decision in principle, but not at the volume they are produced
STATUS: OPEN
TIER: 3
BITES:
- **2026-10-26:** the first registry re-verify date, `CMP-050`;
- **2026-11-28:** 284 registry entries reach re-verify, and `page.md`'s staleness clause marks every open page stale, owner gates included (`DAN-032`).

OWNER: the orchestrator, Daniel (`DAN-032`)
EVIDENCE:
- 146 entries in `docs/design-v2/decisions/` (127 on 2026-10-04).
- `DAN-032` is open with no update.
- No digest has been built.
- Since DEC-155 and Round 4, fewer decisions are delegated, which shrinks the volume problem. The staleness clause does not shrink.

CONFIDENCE: PROVEN
WHAT IT IS: Reversal rights with no digest exist only on paper. And the 2026-11-28 date stales every page wholesale.
SOLUTION: Decide `DAN-032` before 2026-10-26: a re-verification appends a dated line and does not rewrite the entry. A weekly one-screen Hebrew digest remains the cheap guard. Proof: no page is marked stale on 2026-11-28 for that reason alone.
LINKED: `KW-064`, `DAN-032`
LAST VERIFIED: 2026-10-17

---

### KW-059 — Production writes have no technical guard, only a written rule
STATUS: OPEN
TIER: 3
BITES: **`DAN-070`'s next production sitting,** whose counts would run on the app's read-write credential.
OWNER: Daniel (one Atlas user; `DAN-053` item 4), the orchestrator (procedure)
EVIDENCE:
- The private handoff §2.5: `railway run` and `railway ssh` run with the production environment.
- The database is named `test`.
- `DAN-053` (4) has no record.
- DEC-155 class (b) now requires Daniel for writes outside a plan, which is a process guard and not a technical one.

CONFIDENCE: PROVEN (the route). INFERRED (that the app's credential is read-write).
WHAT IT IS: A read-only count and a destructive clean differ by one argument, under the same credential.
SOLUTION: Daniel creates a read-only Atlas user (role `read@test`, 5 minutes). Count scripts take `MONGO_URI_READONLY`. Every write script is idempotent and count-gated. Proof: a count with the read-only URI succeeds, and a write with it is refused (`OPS-111`).
LINKED: `KW-035`, `KW-050`, `DAN-053`, `DAN-070`, `OPS-111`
LAST VERIFIED: 2026-10-17

---

### KW-034 — The release keystore exists in one place found on disk, with no recorded backup
STATUS: OPEN
TIER: 3
BITES:
- **Before the first Play upload:** a loss means re-registering the signing SHA-1 with Google OAuth and Spotify, and reinstalling, which loses app data.
- **After it:** an upload-key reset that takes days.
- **Any cleanup of the main checkout's ignored files.**

OWNER: Daniel (`DAN-053` item 3)
EVIDENCE:
- `mobile/KokonadaHealth/android/app/kokonada-release.keystore` and `android/keystore.properties` are in the main checkout.
- No other copy was found under the user profile to depth six (2026-10-17).
- No backup is recorded.
- Play App Signing allows an upload-key reset [verified 2026-10-04].

CONFIDENCE: PROVEN (one copy found). INCONCLUSIVE (a backup outside the searched folders).
WHAT IT IS: Costly but recoverable (corrected 2026-10-04). It is still one copy.
SOLUTION: Copy both files to two places (an encrypted cloud folder and an offline drive), with the passwords held apart in a password manager, and test one restore by building a release from it. 15 minutes. A runbook records where the copies are, never the passwords.
LINKED: `OPS-002`, `KW-016`, `DAN-053`
LAST VERIFIED: 2026-10-17

---

### KW-031 — There is no HTTP access log
STATUS: OPEN (tracked as `OPS-019`, P1)
TIER: 3
BITES: at the first incident you cannot explain.
OWNER: Build team
EVIDENCE: `backend/package.json` has no `morgan`, `pino` or `winston` (2026-10-17).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: per `OPS-019`.
LINKED: `OPS-019`, `KW-032`
LAST VERIFIED: 2026-10-17

---

### KW-032 — `/health` cannot say which build is running
STATUS: OPEN (tracked as `OPS-018`)
TIER: 3
BITES: on every deploy. D moved twice in three days without anyone intending it (`DAN-050`).
OWNER: Build team
EVIDENCE: `backend/app/index.js:117` (`{ status: 'ok', ts }`).
CONFIDENCE: PROVEN
WHAT IT IS: Today the Railway deployment list is the only authority.
SOLUTION: per `OPS-018`: report `RAILWAY_GIT_COMMIT_SHA` on `/health`, and post-merge checks compare it to the merge commit.
LINKED: `OPS-018`, `KW-050`, `KW-066`
LAST VERIFIED: 2026-10-17

---

### KW-033 — Green CI that proves nothing
STATUS: MITIGATED
TIER: 3
BITES: on a stacked PR, on a loose assertion, or on a mixed-image run (`KW-065`).
OWNER: Build team
EVIDENCE:
- The last 12 CI runs on `main` are green (2026-10-17).
- The Coordination check runs in warn mode.
- PRs target `main`.

CONFIDENCE: PROVEN
WHAT IT IS: Mitigated by process.
SOLUTION: `OPS-011` and `OPS-012` when convenient. `KW-065` first.
LINKED: `OPS-011`, `KW-050`, `KW-065`
LAST VERIFIED: 2026-10-17

---

### KW-035 — Build and production data share one database
STATUS: OPEN
TIER: 3
BITES: the first real user's sign-in.
OWNER: Daniel
EVIDENCE: Production uses the database `test`, and it holds the owner's health data.
CONFIDENCE: PROVEN
WHAT IT IS: Settled as not a live hazard today (§ SETTLED). The timing risk stands.
SOLUTION: A separate Atlas project before the first non-owner user, and `KW-059`'s read-only user now.
LINKED: `KW-059`
LAST VERIFIED: 2026-10-04

---

### KW-036 — Live heart rate may stop when the screen locks
STATUS: OPEN (tracked as `MB-097`, P2)
TIER: 3
BITES: the first phone in a pocket.
OWNER: Build team
EVIDENCE: `MB-097`.
CONFIDENCE: INFERRED
WHAT IT IS: Unmeasured.
SOLUTION: per `MB-097`: measure 30 minutes screen-locked at the phone evidence sitting.
LINKED: `KW-028`, `KW-053`, `MB-097`
LAST VERIFIED: 2026-10-04

---

### KW-037 — One backend instance is the ceiling
STATUS: OPEN (tracked as `BE-106`, P3)
TIER: 3
BITES: when a second instance is needed. Not at five users.
OWNER: Build team
EVIDENCE: `BE-106`.
CONFIDENCE: PROVEN
WHAT IT IS: Written down as the ceiling.
SOLUTION: per `BE-106`.
LINKED: `KW-009`, `BE-106`
LAST VERIFIED: 2026-10-04

---

### KW-038 — Collections that grow without bound
STATUS: CLOSED (2026-10-17)
TIER: 3
BITES: n/a
OWNER: —
EVIDENCE:
- `backend/app/models/BiometricLog.js:49`: a TTL index on `recordedAt`.
- `ServeEvent.js:30`: a TTL.
- `HealthSample.js:87`: a TTL on `expiresAt`, built in Atlas (`MB-900`, update 2026-10-07).
- The new five-minute job uses `removeOnComplete: true` (`backend/app/queues/queue.js:16`), and its event stream is capped by BullMQ's default.

CONFIDENCE: PROVEN
WHAT IT IS: The last open item, `BiometricLog`, has a TTL.
SOLUTION: None needed. Re-open if a new model holds user data with no clock.
LINKED: —
LAST VERIFIED: 2026-10-17

---

### KW-039 — A consent query on every heart-rate push
STATUS: OPEN
TIER: 3
BITES: under concurrency, not at five users.
OWNER: Build team
EVIDENCE: `backend/app/services/privacy/consent.js:255`.
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: A fail-closed Redis cache, invalidated on every consent write.
LINKED: `KW-037`
LAST VERIFIED: 2026-10-04

---

### KW-040 — A large library can exhaust the heap
STATUS: OPEN
TIER: 3
BITES: a large library, or two generations at once.
OWNER: Build team
EVIDENCE: Not re-read since the seed.
CONFIDENCE: INFERRED
WHAT IT IS: Unchanged.
SOLUTION: `.lean()` on the pool path, and `--max-old-space-size`.
LINKED: —
LAST VERIFIED: 2026-09-01

---

### KW-041 — Generation latency is dominated by sequential Spotify calls, some of which always fail
STATUS: OPEN
TIER: 3
BITES: the "magic moment" turning into a wait.
OWNER: Build team
EVIDENCE: `backend/app/services/spotify.js` `searchVibePlaylists` and `getVibePlaylistTracks` (sequential, 8 s timeouts).
CONFIDENCE: PROVEN (the structure). INFERRED (the latency).
WHAT IT IS: `KW-052` removes the dead calls. Parallelising the rest is the second half.
SOLUTION: `KW-052` first, then bounded concurrency.
LINKED: `KW-052`
LAST VERIFIED: 2026-10-04

---

### KW-056 — The design bar was being judged by agents whose taste had diverged from the owner's
STATUS: CLOSED (2026-10-17)
TIER: 3
BITES: n/a
OWNER: —
EVIDENCE:
- Round 4 (2026-10-07): "הכול אצלי". The owner gives G2, G3, G6 and G13 on every page.
- Round 5: he chose the V1 direction himself, "בוחר ב-'תהום'" (`owner-rulings-session-8df5ce10.md`).

CONFIDENCE: PROVEN
WHAT IT IS: Daniel resolved it himself. The residue is that `CLAUDE.md` still says the orchestrator rules those gates (`KW-064` item 1).
SOLUTION: None here. See `KW-064`.
LINKED: `KW-064`, T8
LAST VERIFIED: 2026-10-17

---

### KW-058 — The "temporary" production shell key stayed registered and on disk
STATUS: CLOSED (2026-10-17)
TIER: 3
BITES: n/a
OWNER: —
EVIDENCE:
- `t16b-sitting-2026-10-07.txt`: "Key kokonada-railway-temp-2026-10-07 removed from Railway (keys list shows 0) and the two local key files deleted, 2026-10-07T04:32:56Z".
- `t16b-sitting-24h-2026-10-08.txt`: "Key removed from Railway and locally, 2026-10-08T08:57:44Z".
- `~/.ssh` holds only `known_hosts` (listed 2026-10-17).

CONFIDENCE: PROVEN
WHAT IT IS: The solution of 2026-10-04 became the procedure: a fresh key per sitting, removed at its end.
SOLUTION: None. Re-open if a sitting record lacks its removal line.
LINKED: `DAN-070`
LAST VERIFIED: 2026-10-17

---

### KW-061 — The risk ledger itself was lost for a month, and eight of its findings never reached TASKS
STATUS: CLOSED (2026-10-17)
TIER: 3
BITES: n/a
OWNER: —
EVIDENCE:
- This file is on `main` (#214, 2026-10-04).
- The rows exist: `BE-100` (KW-004), `BE-101` (KW-052), `BE-106` (KW-037), `MB-095` (KW-007), `MB-096` (KW-008), `MB-097` (KW-036), `DAN-054` (KW-002), `DAN-055` (the tripwires).

CONFIDENCE: PROVEN
WHAT IT IS: Closed. Its successor risk is that the file goes stale while the routine is unlinked (`KW-064` item 3).
SOLUTION: None.
LINKED: `KW-064`
LAST VERIFIED: 2026-10-17

---

### TIER 4 — MARKET, EVIDENCE AND STRATEGY

---

### KW-048 — Nothing is known about any user other than Daniel
STATUS: NEEDS ATTENTION (third consecutive run)
TIER: 4
BITES: it is the pre-mortem's answer for the third consecutive run. Proposed tripwire T2 reads 3 of 3.
OWNER: Daniel
EVIDENCE:
- The production counts cover the operator's own account only.
- `DAN-036`'s accounts do not exist.
- `DAN-055` item (2), five conversations or the n-of-5 test, has no update.
- No interview, session or survey is recorded since 2026-09-01.

CONFIDENCE: PROVEN
⚠ NEEDS ATTENTION — NO KNOWN SOLUTION:
- **Tried:** naming it in the seed (2026-09-01), then ranking it in the pre-mortem (2026-10-04), then a TASKS row (`DAN-055`).
- **Blocks:** at scale, `KW-001`. At five people, nothing but time and priority. Since 2026-10-06 the same person also holds every gate and merge path (`KW-053`).
- **Unblocks:** one conversation with one person who would use it. Only Daniel can hold it, and it needs no build, no counsel and no store.

Open in this state for three runs.
LINKED: `KW-042`, `KW-044`, `KW-001`, `KW-053`, `DAN-055`, T2
LAST VERIFIED: 2026-10-17

---

### KW-047 — The owner's limited time, and a backlog that grows eight rows for every one that closes
STATUS: OPEN
TIER: 4
BITES: as the quiet cause behind the rest. Proposed tripwire T9 is crossed.
OWNER: Daniel
EVIDENCE:
- **TASKS on `a62239a`:**
  - **528 open rows** (383 on 2026-10-04; about 50 on 2026-09-01);
  - **27 open P0** (25);
  - 142 open P1 (98);
  - 54 open `DAN-` rows (41);
  - 36 rows marked done (18).
- 146 DEC records (127).
- 31 worktrees on disk.
- A new surface on a paused platform: an iOS HealthKit server store (#232) shipped to production while the Android path to a first tester is unfinished.

CONFIDENCE: PROVEN (counts by `grep` on `^- \[ \]`)
WHAT IT IS: In 13 days, 145 rows opened and 18 closed. Much of the growth is careful bookkeeping of real findings. The total is still more than one person can see.
SOLUTION:
- Adopt T9, and hold the scope sitting it calls for: which of P1–P14 a five-tester closed beta needs.
- Keep one page in build at a time.
- Decide whether iOS work continues while iOS is paused.
- `KW-053` option (B) drains the owner queue weekly.

LINKED: `KW-053`, `KW-057`, `KW-060`, `KW-017`, T5, T9
LAST VERIFIED: 2026-10-17

---

### KW-060 — The plan will build the player page to the top design bar before anyone decides what it plays through
STATUS: OPEN
TIER: 4
BITES: **at P3's G0.** P2's Spotify states come earlier.
OWNER: Daniel (decision), with architect and sentinel
EVIDENCE: `ARCH-005` is still P2, open since 2026-09-24. The six-month token rule (`KW-063`) adds a recurring cost to the Spotify sink.
CONFIDENCE: PROVEN
WHAT IT IS: `KW-001` turned into a dated sequencing risk.
SOLUTION: Raise `ARCH-005` to P1. Put it to Daniel before P3's G0 as a decision table (A, B, C), with the architect's cost of a provider-neutral P3 and `KW-002`'s answer.
LINKED: `KW-001`, `KW-002`, `KW-063`, `ARCH-005`
LAST VERIFIED: 2026-10-17

---

### KW-042 — The product's central claim is untested
STATUS: OPEN
TIER: 4
BITES: not on a date. Months of work accumulate on an unvalidated premise.
OWNER: Daniel
EVIDENCE: de Witte et al.; Hides et al. [verified 2026-09-01; re-fetch by 2026-10-31]. No experiment has run.
CONFIDENCE: PROVEN (the literature). UNTESTED (the product).
WHAT IT IS: Joined by `KW-004`: the scorer has no features for the tracks it serves.
SOLUTION: The n-of-5 within-subject test. Measure `BE-100` first.
LINKED: `KW-004`, `KW-018`, `KW-048`, T3
LAST VERIFIED: 2026-10-04

---

### KW-043 — There is no revenue model, and the decision that there is none is locked
STATUS: OPEN
TIER: 4
BITES: when costs exceed what the owner can pay, or free tiers change.
OWNER: Daniel
EVIDENCE: ADR-0001. The tiers are unrecorded (owner action 4).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: Give ADR-0001 a review date and a trigger (T6).
LINKED: T6
LAST VERIFIED: 2026-09-01

---

### KW-044 — Nothing is instrumented
STATUS: OPEN
TIER: 4
BITES: continuously.
OWNER: Build team, Daniel
EVIDENCE: No analytics in the app. The plan's server-side metrics are not built.
CONFIDENCE: PROVEN
WHAT IT IS: Planned, not built.
SOLUTION: Build the plan's server-side metrics with P1.
LINKED: `KW-042`, `KW-018`
LAST VERIFIED: 2026-10-04

---

### KW-045 — The funnel is six multiplied fractions
STATUS: OPEN
TIER: 4
BITES: at launch.
OWNER: Daniel
EVIDENCE: [verified 2026-09-01]. Under J2's A1, a mood-only account sees an honest empty Pulse.
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: Mood-only stays first-class; the wearable is the upgrade.
LINKED: `KW-011`
LAST VERIFIED: 2026-09-01

---

### KW-046 — This configuration has one precedent, and it is dead
STATUS: OPEN
TIER: 4
BITES: as the context for `KW-001`.
OWNER: Daniel
EVIDENCE: [verified 2026-09-01]. Market refresh due by 2026-12-01.
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: A decision input, not a verdict.
LINKED: `KW-001`
LAST VERIFIED: 2026-09-01

---

### KW-049 — Documents a reader would act on are false
STATUS: OPEN
TIER: 4
BITES: every time a new session reads one.
OWNER: Build team (custodian CY-6)
EVIDENCE:
- `UI_UX_MASTER_PLAN.md:3`: "Status: Implemented", for the deleted web app.
- `docs/VISION.md:61`: "a 5-tab UI" and "Wave 2.8".
- `KOKONADA_ARCHITECTURE_MASTER.md` §0 is dated 2026-09-02.
- The instruction-text cases moved to `KW-064`.

CONFIDENCE: PROVEN
WHAT IT IS: Low-stakes history that misleads.
SOLUTION: Superseded banners, never deletions. **VISION §6 is not edited** (`KW-055`).
LINKED: `KW-055`, `KW-064`
LAST VERIFIED: 2026-10-17

---

## § HORIZON — coming, not yet findings

| # | Date | What | Why it matters |
|---|---|---|---|
| H1 | any day | Spotify changes its terms again | Five changes in about 20 months: Nov 2024, May 2025, Feb–Mar 2026, Jun 2026 (token expiry), Jul 2026 (quota counting). Re-read the changelog every quarter. |
| H2 | **fired 2026-10-15** | RN 0.88.0 published; 0.86 at End of Cycle | `KW-015`. Latest upgrade start about 2026-11-09. |
| H3 | **2026-10-19 → 2026-11-19** | `ubuntu-latest` moves to 26.04 | `KW-065`. |
| H4 | 2026-10-26 | First registry re-verify (`CMP-050`) | `KW-057`, `DAN-032`. |
| H5 | 2026-11-01 | Play's target-API-36 extension ends | The app targets 36. Watch only. |
| H6 | about 2026-11-02 | Latest counsel answer for Art. 50(2), under the EU condition | `KW-054`, T10. |
| H7 | 2026-11-28 | 284 registry entries reach re-verify | `KW-057`. |
| H8 | 2026-12-02 | AI Act Art. 50(2) grace ends, for EU users only | `KW-062`; NF-1 says it may not cover the captions. |
| H9 | 2026-12-07 | RN 0.89; 0.86 unsupported | `KW-015`. |
| H10 | 2027-01-01 | California AB 1043 (age signal), if the US is on the list | `DAN-027`. |
| H11 | 2027-01-04 | Quarterly platform re-check | Spotify, Play, Groq, Garmin, Android. |
| H12 | 2027-01-15 | Counsel's classification checkpoint | `KW-022`. |
| H13 | 2027 (month unannounced) | Android developer verification applies worldwide | "Apps installed using ADB won't require verification". A free limited-distribution account covers "up to 20 specific devices" [verified 2026-10-17, developer.android.com/developer-verification/guides/faq]. It bears on sideloaded tester builds in Israel. |
| H14 | 2027-02-01 | Play 16 KB pages | Compliant today. |
| H15 | 2027-05-01 → Aug 2027 | Target API 37 | Calendar B6. |
| H16 | 2027-12-02 | AI Act Annex III applies (under the EU condition) | `KW-022`. |
| H17 | continuous | Groq model churn | `openai/gpt-oss-20b` is not deprecated [verified 2026-10-17]. `BE-046`'s check makes the next shutdown loud. |
| H18 | when adopted | The final Annex III guidelines | Still a draft [secondary, verified 2026-10-17]. |
| H19 | six months after each Spotify authorization | A tester's Spotify link expires | `KW-063`. Record each date at link time. |

---

## § SETTLED — DO NOT RE-RAISE

**Read this section before writing anything.** To reopen an item, present **new evidence dated after the settlement**, never a re-reading of the same facts.

| Item | Settled | Why |
|---|---|---|
| `docs/plans/WAVE4_HALT` is an incident | 2026-08-26 | It is Daniel's own pause switch. It was logged as a fresh incident four times. Never delete it, and never read it as an anomaly. |
| Spotify Content containment and the Developer-Terms ML clause | 2026-08-27 | Designed and enforced (ADRs 0010, 0011, 0012). |
| Playback can leave the Spotify SDK | settled | App Remote gives transport control, never the audio stream. |
| The 5-user dev cap is a discovery | settled | Daniel has long known it. It matters as a constraint (`KW-001`), never as news. |
| The database is a live production-data hazard today | 2026-08-29 | Daniel: the data is build-phase. The timing risk is `KW-035`. |
| iOS findings are urgent | 2026-08-29 | iOS is paused (no Mac). `KW-017`, `KW-027`. |
| BE-008 cross-site WebSocket hijacking | 2026-08-28 | Closed, and verified in production. |
| `watch/` still exists | 2026-08-28 | Deleted. The backend `/watch/*` lane is a different thing. |
| Railway deployment IDs are commit shas | 2026-08-28 | They are not. |
| The background workers do not run in production | 2026-10-04 | `KW-006`. |
| The backend runs on a shut-down Groq model | 2026-10-04 | `openai/gpt-oss-20b` (#197). Not deprecated [re-verified 2026-10-17]. |
| YouTube compliance is live | 2026-10-02 | Sealed in code (DEC-122). It reopens only if the seal is lifted. |
| The 2026-10-03 delegation, or DEC-155's narrowing of it, is a risk to argue against | 2026-10-03 / **2026-10-17** | Both are Daniel's decisions. This file reports the costs of running them and proposes options (`KW-053`), never their reversal. |
| A lost keystore ends the Play listing | 2026-10-04 | Play App Signing and an upload-key reset (`KW-034`). |
| The sentinel runs on a schedule | **2026-10-17** | A routine exists, but since 2026-10-08 it is disabled and not linked to this computer (`DAN-069`). No scheduled run has happened. Re-raise only with a run-log row a routine wrote. |
| J2's sweep erases before its record | **2026-10-17** | The arming marker is fail-safe, and the sweep was armed after a zero-orphan record (`KW-051`). |
| The temporary Railway SSH key is still live | **2026-10-17** | Each sitting removes its key (`KW-058`). |
| Spotify removed ISRC (`external_ids`) from tracks | **2026-10-17, WITHDRAWN** | Reverted in Spotify's March 2026 changelog [verified 2026-10-17]. |
| #218's Pages workflow published the project | **2026-10-17** | `GET /repos/…/pages` answers 404, and #220 reverted the workflow. |
| Wait for CI is off | **2026-10-17** | Daniel confirmed it on in Railway's settings (2026-10-07). |

---

## § RUN LOG

Append-only. One row per run. Never rewrite a past row.

| Date | HEAD | Type | Phases | Headline | New | Reopened | Closed |
|---|---|---|---|---|---|---|---|
| 2026-09-01 | `6a5c443` | SEED | full review | Ledger seeded: 49 findings across 5 tiers, each with a solution or an explicit NEEDS ATTENTION. Three items are existential, and one of them (`KW-002`) is settled by a five-minute test. *(The file was never committed. It was recovered from `stash@{0}^3` on 2026-10-04.)* | KW-001…KW-049 | — | — |
| 2026-09-29 | `b9639c5` | CALENDAR (not a ledger run) | external facts only | Plan step L1: the external-dates calendar, landed as `docs/design-v2/calendar.md`. This ledger was not updated. | — | — | — |
| 2026-10-04 | `e4743af` | FULL | 0–6. Phase 3 partial: Spotify, Groq, the Play organisation rule, Play App Signing, Railway Wait for CI and the AI Act guidelines re-fetched; Apple, Health Connect and the market not refreshed | Since 2026-10-03 an agent merges, and a merge is an unguarded production deploy (no branch protection on a private free repo, deploy before CI, no deny rules). Also: Spotify's 2026-03-09 migration silently broke discovery, and this ledger had been lost in a stash for a month. | KW-050…KW-062 | — | KW-006 |
| 2026-10-17 | `a62239a` | MANUAL (the owner's "where am I", in `.claude/worktrees/sentinel`, detached at `9ad6c66`, ledger equal to `origin/main`) | 0–6. Phase 3 partial: Spotify (refresh-token expiry, the March and July changelogs, the migration guide), GitHub runner images, Groq deprecations, React Native on npm, Android developer verification, and the Annex III guidelines' status (secondary); Play, Apple, Health Connect and the market not refreshed | Third run with the same pre-mortem: nothing learned about a real user, 528 open rows (+145 in 13 days, 18 closed), and since DEC-155 and Round 4 every merge and page gate goes through the owner's side, so seven days passed without a merge while he was away. The 2026-10-04 guards held: Wait for CI confirmed, deny list committed, the J2 sweep armed fail-safe, the shell key removed. New: Spotify refresh tokens now expire six months after authorization (unrecorded anywhere; it collides with `BE-053`'s purge design). CLAUDE.md overrides the owner's later page-gate ruling. CI's runner image moves on 2026-10-19. One correction: Spotify kept ISRC. | KW-063…KW-066 | — | KW-038, KW-051, KW-056, KW-058, KW-061 |

---

*This file is written by the `sentinel` agent and is not authoritative. The build team has the final word, and must verify every claim against the real tree before acting on it.*
