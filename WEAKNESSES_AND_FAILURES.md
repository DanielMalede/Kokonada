# WEAKNESSES AND FAILURES — Kokonada's standing risk ledger

**Seeded 2026-09-01. Second full run 2026-10-04. Owned by the `sentinel` agent (`.claude/agents/sentinel.md`). One file, no second one, ever.**

---

## § HOW TO READ THIS FILE

**What this is.** The single place where everything that can hurt Kokonada is written down, ranked by *when it bites* rather than by how loud it is, and with a way out attached to each one. It is not a bug list, not a backlog, and not a compliance report. `TASKS.md` owns work; this file owns risk. Where a risk has a TASKS row, the entry cites the ID and stops.

**Who writes it, and when.** The `sentinel` agent, **only when someone invokes it.** The seed of 2026-09-01 claimed an autonomous Saturday-and-Tuesday schedule. No such schedule was ever wired, and that claim is withdrawn. Read the date in the run log before trusting anything below as current.

**Where this file was for a month.** It was seeded on 2026-09-01 and never committed. On 2026-09-23 it went into `stash@{0}` (untracked tree `stash@{0}^3`) with other sessions' loose files. This run recovered it read-only. Its tripwires never reached Daniel, and eight of its findings never became TASKS rows (`KW-061`). It now lives at the repository root.

**THE RULE THAT MAKES THIS FILE USEFUL.** Every finding carries either a **`SOLUTION:`** (concrete, costed, with the test that proves it worked) or **`⚠ NEEDS ATTENTION — NO KNOWN SOLUTION:`** (what was tried, what blocks it, and the one fact or decision that would unblock it). There is no third option.

**THE VERIFICATION MANDATE.** Nothing here is authoritative. Every technical claim is a hypothesis carrying its evidence. Every proposed change is a request for the build team to verify against the real tree first. **Delete nothing, change nothing, and switch off no production flag on the strength of this file alone.** Where a claim here is wrong, correct it here, with the evidence that disproved it.

**"The build team"** means the orchestrator and the developer and reviewer agents it dispatches (`.claude/agents/`). It has the final word on every technical claim here, after verifying it.

**Read `origin/main`, never the main tree's local `main`.** On 2026-10-04 the main tree's `main` stood at `4e13a49`, 20 commits behind `origin/main` (`e4743af`). Every `file:line` below is on `e4743af` unless it says otherwise.

**Statuses.** `OPEN` · `MITIGATED` (partly addressed, not closed) · `CLOSED` (re-proven this run, with evidence) · `ACCEPTED` (Daniel decided to live with it, dated, in his words) · `NEEDS ATTENTION` (no known solution) · `WITHDRAWN` (was wrong) · `SUPERSEDED-BY-KW-###`.

**Confidence.** `PROVEN` (read in the code or a primary source this run) · `INFERRED` (reasoned; the build team must confirm) · `INCONCLUSIVE` (names what would settle it).

**Tiers.** `0` existential · `1` product-breaking · `2` legal/store · `3` operational · `4` market and strategy.

**IDs** are `KW-###`, never reused, never renumbered.

---

## § IF YOU READ NOTHING ELSE — as of 2026-10-04

**The headline.** Since 2026-10-03 an agent merges to `main`. A merge to `main` is a production deploy, and nothing on GitHub or Railway can stop a bad one: the private repository on the free plan cannot have branch protection (GitHub answers 403), Railway creates the deployment one second before CI starts, and no settings file holds a single deny rule, although Daniel chose hard denies on 2026-10-03. The post-merge CI agent sees a red result only after production is already running the code. → `KW-050`

**Top 3, in order.**

1. **Before the next merge (J2 or the V1 lab), one sitting of about 30 minutes at the computer.** It needs Daniel himself, because each step is a portal action or a change to agent permissions:
   - switch on Railway **Wait for CI** for `kokonada-backend` (`KW-050`);
   - approve the deny rules he already chose in Round 12 (`KW-050`);
   - back up the release keystore and `keystore.properties` to two places and test one restore (`KW-034`);
   - remove the temporary Railway SSH key (`KW-058`);
   - create a read-only Atlas user for production snapshots (`KW-059`).

   Cost: about 30 minutes. What it buys: every later delegated merge and production read runs behind a guard instead of behind good intentions.
2. **Before J2 merges:** make J2's new orphan sweep fail safe. As planned, it erases every deleted-account orphan at the first 03:30 UTC after deploy, unless Daniel has set `ORPHAN_SWEEP_DISABLED=true` in Railway first. The orchestrator can neither set nor read that variable. Either invert the default to an enable flag, or prove the switch from the boot log before 03:30 UTC. → `KW-051`. Cost: about 1 hour of build and review.
3. **By 2026-10-20: Daniel sends counsel a one-page "gating five".** Today the counsel pack holds about 70 questions in at least seven annexes, and nothing has been sent. The first dated answer is due around 2026-11-02 (`DISCOVERY_CAPTION_LLM` against AI Act Art. 50(2) on 2026-12-02). The breath-law question under the MDR applies now, and it decides whether Play needs an organisation account. → `KW-054`, `KW-055`, `KW-062`. Cost: 1 hour of agent drafting, then a fixed-fee scoping call that only Daniel can book and pay for.

**The order of work for finishing the plan with the least risk (for the orchestrator).**

0. Prepare a click-by-click checklist for Daniel's sitting in top-3 item 1, and send it to his phone. Make no delegated merge until Wait for CI and the deny rules are in place.
1. **J2.** Finish the build. Apply `KW-051`'s fail-safe. Merge between 06:00 and 18:00 UTC, never 02:58–05:10 UTC. Run C-2, the irreversible production clean, only on Daniel's word at run time, by one tap on the phone (`KW-059`).
2. **One small "silent lies" PR before any tester build.** First add the TASKS rows (`KW-061`). The PR covers:
   - Generate shows the server's error, and never shows "Found your sound" on a failure (`KW-007`, `KW-008`);
   - the session is cleared only on a 401 (`KW-009`);
   - the Spotify February-2026 drift (`KW-052`).
3. **Captions.** Put `DISCOVERY_CAPTION_LLM=false` to Daniel as a one-variable production change, until `BE-044` and `BE-083` land (`KW-062`).
4. **Counsel.** `regulatory-researcher` drafts the gating-five page, and Daniel sends it (`KW-054`).
5. **V1.**
   - Build in the lab.
   - Decide with agent consensus, but push the boards to Daniel's phone and hold the token-branch merge for a 48-hour veto window (`KW-056`).
   - Rule `ARCH-010` (the React Native version) before F1. The latest start is about 2026-11-09.
6. **`DAN-032`.** Decide the registry re-verify rule before 2026-10-26, or every open page goes stale on 2026-11-28 (`KW-057`).
7. **Before P3's G0,** put the playback-provider question (`ARCH-005`) to Daniel. Do not build the player page to the top design bar for a sink that reaches five people without his ruling (`KW-060`).
8. **One phone evidence sitting** for every merged HALT fix (HX-1..8, BE-016, J1, J2). This is what unblocks P2's G1 (`KW-053`).
9. **In parallel, and only Daniel can do it:** five conversations with the five people the cap allows, or the n-of-5 test (`KW-042`, `KW-048`).

---

## § WHAT CHANGED SINCE THE LAST RUN (2026-09-01 → 2026-10-04)

**The frame.** 32 commits reached `origin/main` (`6a5c443`..`e4743af`):
- Track H (#192, #193) and Track HX (#200–#211);
- J1 (#212);
- Node 24, the LLM default model, the Sentry scrub;
- the design-v2 plan, the L1 registry and 127 DEC records.

The web surface is gone. On **2026-10-03 Daniel delegated** every owner gate, merges (with a post-merge CI agent) and in-plan production actions to the orchestrator. He wants the whole plan finished: J2, V1, Stage 0 and P1–P14. On 2026-10-04 he gave the go (`owner-rulings-session-fd9fc638.md`, Rounds 11–12).

**New findings: KW-050 to KW-062.**

The autonomy cluster:

| ID | What |
|---|---|
| `KW-050` | A merge is a deploy, with no gate in front of it |
| `KW-051` | J2's sweep runs before its record |
| `KW-056` | The design bar is delegated |
| `KW-057` | Reversal rights over delegated decisions exist only on paper |
| `KW-058` | The temporary production shell key is still live |
| `KW-059` | Production writes have no technical guard |

Product and platform:

| ID | What |
|---|---|
| `KW-052` | Spotify's February-2026 migration silently broke discovery paths |
| `KW-060` | P3 would be built before the provider question is decided |
| `KW-062` | One production variable carries three exposures |

Legal and process:

| ID | What |
|---|---|
| `KW-053` | The owner-only critical path |
| `KW-054` | The counsel pack is unbounded and unsent |
| `KW-055` | The purpose record is being reworded by agents |
| `KW-061` | This ledger's own month-long loss |

**Closed: `KW-006`.** The workers run in production. The proof is `W workers-in-process=yes` (DAN-048, 2026-10-02 11:21:57Z container time) and the nightly `[sessionTrim]` result line at 2026-10-02T03:30:08Z, both re-read this run from the private run files.

**Mitigated:**

| ID | By |
|---|---|
| `KW-012`, `KW-013` | H2, #193 |
| `KW-019` | The client display map, #192 and #203 |
| `KW-021` | The H1 Art. 50 notice, #192 |
| `KW-023` | The Working and Focus chips retired, #203 |
| `KW-029` | HX-5, #208 |
| `KW-033` | PRs now target `main` only, by process |
| `KW-038` | The HX-2 TTLs, #206 |

**Corrected: `KW-034`.** It is re-tiered from "irreversible" to "costly but recoverable". What misled me: I reasoned from self-signed-app semantics. New Play apps are enrolled automatically in Google-held app signing, and a lost upload key can be reset [verified 2026-10-04].

**Moved:**
- **`KW-004`'s solution path is weaker.** Spotify removed `external_ids` (ISRC) from Track objects, so the planned ISRC join to the CC0 corpus cannot work for Spotify tracks.
- **`KW-041` is worse.** The vibe-playlist calls now fail by policy.
- **`KW-047`'s numbers.** Open TASKS rows went from about 50 to 383, and open P0 rows from 11 to 25.
- **`KW-048` is NEEDS ATTENTION for a second consecutive run.**

**External facts that moved:**
- **Spotify.** The February-2026 Development-Mode migration has applied to existing apps since **2026-03-09**. It is newly found here and has been biting for seven months (`KW-052`).
- **Groq.** It shut `llama-3.1-8b-instant` (2026-08-16), then deprecated one of its own recommended replacements four weeks later (`qwen/qwen3.6-27b`, 2026-09-14). The backend already moved to `openai/gpt-oss-20b` (#197).
- **The AI Act.** The Annex III guidelines are still a draft, and they warn against circumvention by relabelling ("angry attitude" rather than "angry emotion") (`KW-055`).
- **Play.** The organisation-account rule covers "Medical apps and Human Subjects Research apps". That ties the store logistics to the MDR question (`KW-054`).

**The pre-mortem is unchanged for the second consecutive run** (see § KILL CRITERIA). One more identical run moves it to the top of this file, by rule.

---

## § THE ASSUMPTION LEDGER

| Assumption | State 2026-10-04 | Why |
|---|---|---|
| Spotify can be the playback sink for real users | **BROKEN** | 5 users in Development Mode. Extended Quota is open only to organisations with ≥250k MAU [verified 2026-10-04]. `KW-001` |
| The Spotify API surface the backend calls still exists | **BROKEN in part** | The February-2026 migration: search limit max 10, playlist items only for owned playlists, no ISRC, no batch `/artists`. `KW-052` |
| The intelligence engine has features for the tracks it serves | **BROKEN (code); production unread** | Every `spotify:` recording is dropped before the feature store. `KW-004` |
| Background workers run in production | **HOLDS** (new) | DAN-048 `W` line and the nightly `[sessionTrim]` line, 2026-10-02. `KW-006` |
| Music can move physiological stress markers | **HOLDS** | de Witte et al., unchanged since 2026-09-01. `KW-042` |
| Biometric-driven selection beats a good static playlist | **UNTESTED** | No experiment has run. `KW-042` |
| Kokonada is a wellness app, not a medical device | **UNTESTED, with an internal fact against it** | VISION §6 and DEC-015 record a physiological-regulation objective. This is counsel's question. `KW-055` |
| A merge is safe because CI runs | **BROKEN** | CI runs after the deploy has been created, and no gate exists. `KW-050` |
| Agent consensus can stand in for the owner's judgement at owner gates | **UNTESTED; one counter-example** | Round 7 Q1: Daniel chose against the agents' recommendation. `KW-056` |
| Delegation shortens the critical path | **WEAKENED** | The critical path runs through 41 open owner-only rows. `KW-053` |
| Enough people own a wearable that streams HR to Android | **UNTESTED** | Unchanged. `KW-045` |
| The product can be free forever | **WEAKENED** | Unchanged. `KW-043` |
| One person can carry this | **WEAKENED, changed in shape** | The build load moved to agents. Portals, law, money and users did not. `KW-047` |

---

## § KILL CRITERIA AND TRIPWIRES

Lines drawn in advance, while thinking is cheap. **Proposed by `sentinel`. Daniel adopts, edits or rejects each one, and his decision is recorded verbatim.** None has ever been put to him, because this file sat in a stash. A tripwire that fires is a Tier-0 headline. The sentinel reports a crossing. It never acts on one, and never suggests quitting.

| # | Tripwire | Status | Reading 2026-10-04 |
|---|---|---|---|
| T1 | App Remote is proven capped at 5 users AND no alternative sink is chosen within 60 days | awaiting Daniel | The cap test was never run (`KW-002`). `ARCH-005` has been open since 2026-09-24 |
| T2 | Three consecutive runs pass with nothing learned about any real user | awaiting Daniel | **2 of 3** (2026-09-01, 2026-10-04) |
| T3 | The n-of-5 experiment runs and the engine does not beat a static playlist | awaiting Daniel | Not run |
| T4 | A store submission is rejected twice for the same class of reason | awaiting Daniel | No submission yet |
| T5 | Open P0 count rises for four consecutive runs | awaiting Daniel | 11 → 25 (one rise; many are fixes merged and awaiting evidence) |
| T6 | Monthly infrastructure cost exceeds a ceiling Daniel names, at fewer than 100 users | awaiting Daniel | No ceiling named |
| T7 (new) | A delegated merge leaves `main` red, or a production write happens outside an approved plan → delegated merges pause until Daniel re-confirms | awaiting Daniel | Not fired |
| T8 (new) | Daniel reverses a delegated design gate (G3 or G6) → those gates return to him for the rest of the plan | awaiting Daniel | Not fired |
| T9 (new) | Open TASKS rows pass 450, or open P0 passes 30, before Stage 0 closes → a scope sitting with Daniel before any new page's G0 | awaiting Daniel | 383 / 25 |
| T10 (new) | Counsel is not engaged by 2026-11-02 → `DISCOVERY_CAPTION_LLM` is off before 2026-12-02, and no EU tester is enrolled | awaiting Daniel | Counsel not engaged |

### Lines the delegation does not cross (proposed; Daniel adopts or edits)

These stay human decisions under the 2026-10-03 delegation. Each one is either a question of law, an act in Daniel's name toward a third party, money, an account he owns, an irreversible act, or a reversal of his own ruling:

1. **Legal classification and its record.** Whether Kokonada is an emotion-recognition system (AI Act Annex III), a medical device (the MDR intended purpose), or a "health app" for Play's organisation rule. Also any rewording of the documents that record the product's purpose (VISION §5–6, DEC-015, the ADR-0017 purpose text) while counsel's Q1 is open (`KW-055`).
2. **Engaging, briefing and paying counsel** (`DAN-014`), and accepting counsel's answer as the project's position.
3. **Spending money:** GitHub Pro, Railway or Atlas plan changes, the D-U-N-S number, the Apple Developer fee, a Play organisation account, a trademark search, the owner's Spotify Premium.
4. **Accounts and credentials:**
   - creating, owning or closing any account (Railway, Atlas, Google Cloud, Spotify dashboard and allow-list, Play Console, Apple, the GitHub org `kokonada`, Garmin, the DAN-036 test accounts);
   - custody of the release keystore;
   - any change to agent permissions (agents may not widen their own).
5. **Store submission itself:**
   - every attestation signed in his name (Data safety, the Health apps declaration, the Health Connect declaration, the IARC rating);
   - the country list (`DAN-027`).
6. **Anything published under his identity:**
   - the privacy policy's controller line and contact details (`DAN-026`, `DEC-044`). Publishing the page is delegated (Round 11); who it names is not;
   - any statement to Spotify, Google or Garmin, for example "no copy remains" (`CMP-045`).
7. **Irreversible production deletes,** even inside an approved plan, at run time: C-2, any sweep that erases evidence counsel may need (Art. 33), and any erasure of his own health data. The plan approves them; he says "now" by one tap.
8. **Breach and incident decisions:** whether a finding is a personal-data breach, and whether to notify within the 72-hour clock (Art. 33 and 34).
9. **Reversing one of his own past rulings,** for example lifting DEC-122's YouTube seal, hiding the YouTube row (`ARCH-012` C), or anything DEC-097 or DEC-101 ruled.
10. **Strategy:** the playback-provider decision (`ARCH-005`), a public launch, recruiting testers (their personal data), adopting or changing these tripwires, and any stop or pivot.

### The pre-mortem — 2026-10-04

*It is October 2027 and Kokonada is dead. What killed it?*

Not a bug, and not a regulator. An autonomous build system, run to a very high standard, polished fourteen pages and a hundred and fifty decisions for a product that five people could play. Meanwhile the three things only Daniel could do sat in a queue of forty owner-only rows: choose the playback path, put the question to a lawyer, and sit with one real user. The work was excellent, and it compounded in the wrong direction.

*Same cause as 2026-09-01 (no contact with a real user), now amplified by delegation. This is the second consecutive run with this answer, and nothing has moved against it. One more run and it goes to the top of this file.*

---

## § FINDINGS

**The autonomy cluster** (new risks of operating under the 2026-10-03 delegation): `KW-050`, `KW-051`, `KW-056`, `KW-057`, `KW-058`, `KW-059`. The delegation itself is settled (§ SETTLED). These entries are about running it safely, not about whether to run it.

### TIER 0 — EXISTENTIAL / STRUCTURAL

---

### KW-001 — Spotify caps the product at 5 users, and the only exit requires an organisation with 250k users
STATUS: OPEN
TIER: 0
BITES: **already fired.** The sixth person cannot use it. It also bites **the day the owner's Premium lapses:** "the app will stop working" for everyone (`DAN-029`, renewal date still unrecorded).
OWNER: Daniel (business decision)
EVIDENCE: Spotify Quota modes: "Up to 5 authenticated Spotify users can use an app that is in development mode"; "The app owner must have a Spotify Premium account for apps in development mode to function"; Extended Quota needs an "Established Business Entity", a launched service and "at least 250k MAUs"; "As of May 15th 2025, Spotify only accepts applications from organizations (not individuals)" [verified 2026-10-04, developer.spotify.com/documentation/web-api/concepts/quota-modes]. The February-2026 migration guide: "All Development Mode apps require the app owner to have an active Spotify Premium subscription", and if it lapses, "the app will stop working" [verified 2026-10-04]. In the code: `mobile/KokonadaHealth/src/experience/connect/providers.ts:30` (`state: 'halted'`), `betaFlags.ts:19` (`SPOTIFY_BETA_CONNECT = false`).
CONFIDENCE: PROVEN
WHAT IT IS: To serve more than five people you need Extended Quota, and Extended Quota needs a company with 250,000 monthly users. The loop is closed on purpose. Nothing changed this month except that the plan now commits fourteen pages, P3 the player among them, to this sink (`KW-060`).
SOLUTION: Unchanged from the seed. It is Daniel's choice, and it is recorded in `ARCH-005`:
- **(A) Stay at five, deliberately.** A private instrument and research rig. Costs nothing.
- **(B) Change the sink.** Apple MusicKit has an Android SDK. Whether an individual account may ship it publicly is unverified. Research before committing.
- **(C) Own the audio.** Generative or CC0 audio. This abandons "your own music".

Whatever the path, two things this week: record the Premium renewal date in a calendar (`DAN-029`, 2 minutes), and run the sixth-account test when the DAN-036 Spotify test account is created (`KW-002`).
LINKED: `KW-002`, `KW-042`, `KW-046`, `KW-060`, `ARCH-005`, `DAN-029`, `DAN-036`
LAST VERIFIED: 2026-10-04

---

### KW-002 — Whether the 5-user cap governs App Remote playback is still unresolved, and nobody has run the five-minute test
STATUS: OPEN
TIER: 0
BITES: the moment a sixth person tries to play a track.
OWNER: Daniel (a 5-minute test, at the DAN-036 sitting)
EVIDENCE: The Quota-modes page "does not explicitly address whether these limits apply to SDK or App Remote usage" [verified 2026-10-04]. The February-2026 guide counts the cap per app ("5 users per app"). App Remote authorises through the same Client ID, so the cap very probably applies, but nobody has observed it. TASKS has no row for the test.
CONFIDENCE: INCONCLUSIVE (settled by one observed playback attempt from a non-allow-listed account)
WHAT IT IS: The one unknown that decides whether any version of the current architecture reaches a sixth person.
SOLUTION: When Daniel creates the DAN-036 allow-listed Spotify test account, also sign in on the phone with a second, **non**-allow-listed Spotify Premium account and try App Remote playback. Capture logcat around `SpotifyRemote.connect()`. Record the answer here and in `ARCH-005`. Cost: 5 minutes inside a sitting that is happening anyway.
LINKED: `KW-001`, `DAN-036`, `ARCH-005`
LAST VERIFIED: 2026-10-04

---

### KW-004 — The intelligence engine ranks the tracks it serves with no features, and nothing reports it
STATUS: OPEN
TIER: 0
BITES: **already, on every generation.** The body input cannot change which library tracks are chosen, which is the product's differentiator (VISION §5: "never decoration").
OWNER: Build team
EVIDENCE:
- `backend/app/services/features/featureService.js:26-38`: `_dropRestricted` removes every Spotify recording before any feature fetch or store write. It is called at `:72` and `:152`.
- `featureProvider.js:72-80`: a Spotify track's `recordingKeyOf` is `spotify:<id>`.
- `selection/pipeline.js:95,101`: features are looked up by that `recordingKey`. Nothing ever writes a `spotify:` key, so `featured` is 0 for every library track by construction.
- The code is honest about it. `sockets/biometricHandler.js:1079-1081`: when `featured=0` the receipt becomes "From your favorites". `:1297-1301` logs `pool=… featured=…`.
- New this run: Spotify removed `external_ids` from Track objects [migration guide, verified 2026-10-04], so `musicProfileService.js:202` (`track.external_ids?.isrc`) is always null now. The seed's ISRC join path is gone.
CONFIDENCE: PROVEN in code. INFERRED for production: the `featured` counts in the deploy logs were not read this run.
WHAT IT IS: Wave 4's scorer, the trajectory planner and the affect bands rank tracks that carry no acoustic features, so the "body → music" link is a receipt string rather than a selection effect. **No TASKS row exists for it.** The seed raised it, and the row was lost with the stashed file (`KW-061`).
SOLUTION:
1. **Measure first.** Read the filtered deploy logs (`railway logs <deploymentId> -d --filter "selection.v2"`, the kind of read the handoff records as allowed) and record the `featured`-to-`pool` ratio. 15 minutes.
2. If it is zero, open a TASKS row. Its fix joins served tracks to the CC0 corpus by `canonicalKey` (artist|title), not by ISRC. This is ADR-0010's "Discovery ⊥ Resolver" path, and it needs `KW-005`'s corpus in production.
3. **Do not relax the containment** (ADR-0011).

Proof: `featured>0` on library generations in the same log line.
LINKED: `KW-005`, `KW-052`, `KW-042`, ADR-0010, ADR-0011, `BE-043`
LAST VERIFIED: 2026-10-04

---

### KW-005 — The provider-agnostic discovery corpus probably does not exist in production
STATUS: OPEN
TIER: 0
BITES: already. One of the two discovery paths runs on an empty or partial corpus.
OWNER: Build team, plus Daniel for one variable value
EVIDENCE: `backend/app/workers/globalSeedIngest.worker.js:21` reads `GLOBAL_AB_DUMP_PATH`, a local file. `backend/app/index.js:192-197` schedules the ingest only when `GLOBAL_SEED_INGEST_ENABLED === 'true'`. `backend/Dockerfile` copies only `app/` and `scripts/rewardJobs.js`. `VECTOR_DISCOVERY` is present in production, but its value is unread (Round 12: Daniel will report it). `biometricHandler.js:111` parses it with `=== 'true'` (`BE-082`).
CONFIDENCE: INFERRED
WHAT IT IS: If `VECTOR_DISCOVERY` is `true`, discovery runs on this corpus, and an empty corpus means an empty discovery. If it is not, discovery runs on the Spotify search path that `KW-052` shows is broken. Either way one path is dark.
SOLUTION:
- Daniel reports the `VECTOR_DISCOVERY` value (already asked in Round 12). The build team reads `db.trackcatalogs.countDocuments()` read-only on the production snapshot route.
- If it is near zero, run the ingest once against production from a local machine as an approved, recorded plan step (the seed's option b), then re-count.
- Proof: the count before and after, and `discovery>0` in `[selection.v2]` lines.
LINKED: `KW-004`, `KW-052`, `BE-082`, ADR-0010
LAST VERIFIED: 2026-10-04

---

### KW-006 — The background workers and scheduled jobs were not known to run in production
STATUS: CLOSED (2026-10-04)
TIER: 0
BITES: n/a
OWNER: —
EVIDENCE: `Kokonada-private/session-3181c7f6/j1/dan048-result-2026-10-02.md`, step 1: `W workers-in-process=yes` at 11:21:57Z on deployment `c72c60e1`. `be016/runs/sessionTrim-nightly-2026-10-02.txt`: `[sessionTrim] trimmed=2 stripped=19 serveEvents=950 … failures=0` at 2026-10-02T03:30:08.884Z. `backend/app/workers/index.js:67` (`RUN_WORKERS_IN_PROCESS === 'true'`). Both private files were re-read this run.
CONFIDENCE: PROVEN
WHAT IT IS: The seed suspected that no worker ran. Production proves they do.
SOLUTION: None needed. The remaining instrument gap is `KW-032` (no build id on `/health`).
LINKED: `KW-032`
LAST VERIFIED: 2026-10-04

---

### TIER 1 — PRODUCT-BREAKING

---

### KW-050 — A merge to `main` is a production deploy, and nothing on GitHub or Railway can stop a bad one, now that an agent merges [autonomy]
STATUS: OPEN
TIER: 1
BITES: **the first delegated merge,** expected this week (J2 or `design/v1-lab`). It then bites on every merge after it.
OWNER: Daniel (two portal and settings actions), then the build team
EVIDENCE:
- `gh api repos/DanielMalede/Kokonada/branches/main/protection` and `…/rulesets` both answer 403, "Upgrade to GitHub Pro or make this repository public to enable this feature" [read 2026-10-04]. The repository is private on the free plan.
- Railway created deployment `43efb034` for #211 at 2026-10-02T06:49:42Z (HANDOFF §3, §6), while CI run `36975438457` on `main` started at 06:49:43Z and ran 3m31s (`gh run list`, read 2026-10-04).
- Neither `.claude/settings.json` (origin and the main tree's uncommitted copy) nor `~/.claude/settings.json` nor `.claude/settings.local.json` holds a `deny` rule. The project file on `origin/main` allows `Bash(git push *)`, `Bash(git merge *)` and `Bash(gh pr *)` (`.claude/settings.json:16-18`) and has no `ask` list. The main tree's uncommitted copy only reorders those lines and adds an empty `ask` [read 2026-10-04].
- Daniel's Round 12 ruling, verbatim: "להשאיר מיזוג, לחסום הרסני (מומלץ)". It keeps merge, and adds hard denies for force push, `reset --hard`, `git clean`, `stash drop`/`clear` and a direct push to `main`, "shown to the owner for his own approval". That change has not been made.
- Railway's "Wait for CI": "Deployments enter a `WAITING` state until all GitHub Actions check suites finish"; "A workflow that fails skips the deployment immediately"; it requires a workflow `on: push: branches: [main]`, which `.github/workflows/ci.yml:3-5` has [verified 2026-10-04, docs.railway.com/deployments/github-autodeploys].
CONFIDENCE: PROVEN (no protection, no denies). INFERRED that Wait for CI is off, from the deployment being created one second before CI started; Daniel can confirm in the service settings.
WHAT IT IS: Under the delegation, the post-merge CI agent is the only check. It runs after Railway has already started deploying, so it detects a bad merge and cannot prevent it. A mistaken `git push origin main` or a `--force` is not blocked by anything but the model's own care. A single instance serves production, so a bad deploy is an outage for its user, and a deploy restart also triggers `KW-009`.
SOLUTION: Three layers. The first two cost nothing.
1. **Daniel switches on Wait for CI** for `kokonada-backend` (Railway → service → Settings → Source). Proof: the next merge shows the deployment as `WAITING`, then `SUCCESS` after CI is green.
2. **Daniel approves the Round-12 deny list** in `.claude/settings.json` `permissions.deny`. Agents may not edit their own permissions, so he applies it or approves the exact diff. The list: `Bash(git push --force*)`, `Bash(git push -f*)`, `Bash(git push --force-with-lease*)`, `Bash(git push origin main*)`, `Bash(git push * main)`, `Bash(git push * HEAD:main*)`, `Bash(git reset --hard*)`, `Bash(git clean*)`, `Bash(git stash drop*)`, `Bash(git stash clear*)`, `Bash(gh pr merge * --admin*)`. Proof: an agent's attempt at each is refused.
3. **Optional, and it costs money (Daniel):** GitHub Pro (about $4 a month) unlocks branch protection requiring the CI check before merge.

Until 1 and 2 are done: merge only when `gh pr checks` is green on a head that is up to date with `main`, and only outside 02:58–05:10 UTC.
LINKED: `KW-009`, `KW-033`, `KW-057`, `KW-059`, T7
LAST VERIFIED: 2026-10-04

---

### KW-052 — Spotify's February-2026 Development-Mode migration silently broke parts of discovery and identity, and every failure is swallowed
STATUS: OPEN
TIER: 1
BITES: **already, since 2026-03-09.** On every generation that reaches the Spotify discovery path, it costs latency and an empty discovery set. The ISRC loss is permanent.
OWNER: Build team (developer, then compliance-auditor)
EVIDENCE: The Spotify February-2026 migration guide [verified 2026-10-04, developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide] says:
- "February 11, 2026 - New Development Mode apps…", "March 9, 2026 - Existing Development Mode apps are migrated to new restrictions";
- `GET /search` `limit` maximum changed from 50 to 10, and the default from 20 to 5;
- `GET /playlists/{id}/tracks` → `GET /playlists/{id}/items`, "Only available for playlists the user owns or collaborates on";
- `GET /tracks`, `/albums` and `/artists` (batch) are removed;
- Track `external_ids`, `popularity`, `available_markets` and `linked_from` are removed;
- `PUT`/`DELETE /me/tracks` are replaced by `/me/library`.

In the code (`backend/app/services/spotify.js`):
- `:497-499` still says "caps `limit` at 50" and sets `SEARCH_MAX = 50`, and `:517` sends `limit: per`. `biometricHandler.js:105,938` call `fetchVibeDiscovery` with `limit: 60` when `VECTOR_DISCOVERY` is not `'true'`. Via `:655` and `:484`, `per = ceil(60 / genres)` exceeds 10 whenever there are fewer than 6 genres, and each such call fails inside `catch { /* try the next query form / genre */ }`.
- `:618-640` reads `/playlists/{id}/tracks` of search-found playlists, which the user does not own, inside `catch { /* skip this playlist */ }`.
- `:401` reads the user's own playlists on the old `/tracks` path.
- `musicProfileService.js:202` reads `external_ids.isrc`.
- `:727-740` is the Like route on `/me/tracks`. No mobile caller was found, so it is unreachable.
- `:305-307` already handles `/artists` (403, cached).
- TASKS has no row that cites the migration guide.
CONFIDENCE: PROVEN (the guide and the code paths). INFERRED: whether the old `/playlists/{id}/tracks` path still answers for the user's own playlists, and how often the `per>10` case occurs (it depends on the genre count).
WHAT IT IS: A textbook silent lie. Discovery degrades to "nothing found", the code falls back, and the receipt reads normally. Each dead call can also wait out its 8-second timeout, which feeds `KW-041`. The ISRC loss also removes the identity layer's best key for every Spotify track.
SOLUTION: One developer task of about half a day, reviewed by compliance-auditor and resilience-auditor:
1. `SEARCH_MAX = 10`, with a contract test on the request shape.
2. Stop reading non-owned playlists. As an immediate zero-code mitigation, set `VIBE_PLAYLIST_SOURCING=false` (`spotify.js:654`). This is a production variable, so it needs Daniel's word or a plan line.
3. Move own-playlist reads to `/playlists/{id}/items`.
4. Treat ISRC as absent for Spotify-sourced tracks, and make `KW-004`'s join work on artist|title.
5. One test per changed call, pinned to the guide's shapes.

Proof: a deploy-log read before and after, showing fewer `[spotify] … failed`/`unavailable` lines and a non-zero discovery count in `[selection.v2]`.
LINKED: `KW-004`, `KW-005`, `KW-041`, `BE-082`
LAST VERIFIED: 2026-10-04

---

### KW-007 — A new user cannot connect any music provider, and the screen throws away the server's explanation
STATUS: OPEN
TIER: 1
BITES: on the first Generate of every new install. Today that means only an allow-listed tester who has not linked Spotify yet.
OWNER: Build team
EVIDENCE: `providers.ts:30` (Spotify `halted`), `:39` (YouTube `deferred`, sealed in code by DEC-122), `betaFlags.ts:19`. `GenerateScreen.tsx:378-381` renders the fixed "That didn't land — let's try again." and ignores the stored message.
CONFIDENCE: PROVEN
WHAT IT IS: The cap is a business constraint (`KW-001`). The swallowed message is a bug that would remain a bug at five users. **No TASKS row** (`KW-061`).
SOLUTION: Render the server's message where `GenerateScreen.tsx:378-381` hardcodes the line. Add an honest "no music provider" state, and make the CTA reflect reachability. Include it in the "silent lies" PR. Proof: a test that a `playlist_error` with "No music provider connected" shows that sentence.
LINKED: `KW-001`, `KW-008`
LAST VERIFIED: 2026-10-04

---

### KW-008 — A failed or timed-out generation is shown to the user as "Found your sound"
STATUS: OPEN
TIER: 1
BITES: on every generation that errors or times out. The user cannot report a failure they were told was a success.
OWNER: Build team
EVIDENCE:
- `mobile/KokonadaHealth/src/experience/generate/generationStatusStore.ts:8,28`: the 30-second auto-settle sets `generating:false`, `message:null`, and no error.
- `GenerateScreen.tsx:189-191`: any `generating → false` moves the overlay to `'resolving'`.
- `:404`: `'resolving'` shows `RESOLVED_COPY = 'Found your sound'` (`:45`). That includes `playlist_error`, where the error row then also appears.
CONFIDENCE: PROVEN
WHAT IT IS: The worst class in this file: a system that lies toward "everything is fine". **No TASKS row** (`KW-061`).
SOLUTION: Show `RESOLVED_COPY` only when `playlist_ready` arrived. The timeout path sets an error. Pin both with tests: the timeout renders the error and never the success copy. Include it in the "silent lies" PR.
LINKED: `KW-007`
LAST VERIFIED: 2026-10-04

---

### KW-009 — Opening the app without a network, or during a deploy, logs the user out
STATUS: OPEN
TIER: 1
BITES: on any cold start with no network, a DNS failure, or a 5xx during a Railway restart. **Delegated merges raise the frequency,** because every merge restarts the single instance (`KW-050`).
OWNER: Build team
EVIDENCE: `mobile/KokonadaHealth/src/prodBootstrap.ts:62-64` (`if (me.ok) … else await authSession.clear()`). `src/net/apiClient.ts:43-44` returns `{ok:false, error:'network error'}` for a transport failure, and `:57` does the same for any non-OK status.
CONFIDENCE: PROVEN
WHAT IT IS: A transport error wipes the stored session, and sign-in needs the same network. **No TASKS row** (`KW-061`).
SOLUTION: Clear the session only on an authoritative 401 after a failed refresh (`apiClient.ts:47-49`), never on a network error or a 5xx. Add a test for an offline cold start and one for a 502 cold start. Include it in the "silent lies" PR.
LINKED: `KW-050`, `KW-010`
LAST VERIFIED: 2026-10-04

---

### KW-010 — The offline banner promises playback that does not exist
STATUS: OPEN (tracked as `MB-027`, P2)
TIER: 1
BITES: every time the banner shows.
OWNER: Build team
EVIDENCE: `MB-027`.
CONFIDENCE: PROVEN (the seed and `MB-027`)
WHAT IT IS: See `MB-027`.
SOLUTION: Per `MB-027`: true copy now, offline queue later.
LINKED: `MB-027`, `KW-009`
LAST VERIFIED: 2026-10-04

---

### KW-011 — The Live Biometric toggle can disable Generate until logout
STATUS: OPEN (tracked as `MB-025`, P2; wording in `UI-050`)
TIER: 1
BITES: the first curious tap by a user with no heart-rate source.
OWNER: Build team
EVIDENCE: `GenerateScreen.tsx:331-347` (the toggle is ungated), `:228` (`live-tuned` disables the CTA), `generateController.ts` `ctaMode()`.
CONFIDENCE: PROVEN
WHAT IT IS: See `MB-025`.
SOLUTION: Per `MB-025`. Raise it to P1 if any tester build ships before P2 replaces Generate.
LINKED: `MB-025`, `UI-050`, `KW-045`
LAST VERIFIED: 2026-10-04

---

### KW-012 — The Bluetooth prompt appeared before the consent screen
STATUS: MITIGATED
TIER: 1
BITES: n/a on current builds. Old builds on a tester's phone still behave this way (`DAN-021`).
OWNER: Daniel (`DAN-020`), then the build team
EVIDENCE: H2 (#193, `4e13a49`) with device evidence (`Kokonada-private/evidence/h2/bba6929/`, `post-merge-4e13a49/`). `biometricsWiring.ts:14-30` gates on `isActive`. TASKS `MB-010` closes on `DAN-020`.
CONFIDENCE: PROVEN (code); evidence folder present
WHAT IT IS: Fixed in code. Closes with `MB-010`.
SOLUTION: Run `DAN-020` at the next owner sitting. Then CLOSED.
LINKED: `MB-010`, `DAN-020`, `DAN-021`
LAST VERIFIED: 2026-10-04

---

### KW-013 — The live heart-rate session leaked across re-login
STATUS: MITIGATED
TIER: 1
BITES: n/a on current builds.
OWNER: Build team
EVIDENCE: H2 (#193). `biometricsWiring.ts:24-27` stops a late start. Logout, delete and withdraw stop the lane (TASKS update of 2026-09-26, `682a138`).
CONFIDENCE: PROVEN (code)
WHAT IT IS: Fixed with H2. Closes on `DAN-020`.
SOLUTION: As for `KW-012`.
LINKED: `KW-012`
LAST VERIFIED: 2026-10-04

---

### KW-014 — History's row tap and empty-state button do nothing
STATUS: OPEN (tracked as `MB-026`, P2; P8 rebuilds the page)
TIER: 1
BITES: the first tap on a past moment.
OWNER: Build team
EVIDENCE: `navigation/RootNavigator.tsx:39` (`<HistoryScreen />`, no props). `HistoryScreen.tsx:62` (defaults `() => {}`).
CONFIDENCE: PROVEN
WHAT IT IS: See `MB-026`.
SOLUTION: Per `MB-026`, or in P8.
LINKED: `MB-026`
LAST VERIFIED: 2026-10-04

---

### KW-015 — Android has one way in, Google, and its library depends on APIs Google has removed
STATUS: OPEN
TIER: 1
BITES: the day a dependency bump pulls `play-services-auth` ≥22.0.0, most likely during the React Native upgrade (`ARCH-010`, latest start about 2026-11-09). Also any user without a usable Google account.
OWNER: Build team (P11), Daniel (the email-sign-in default)
EVIDENCE: `MB-059` (P2): `@react-native-google-signin/google-signin` `^16.1.2` (`mobile/KokonadaHealth/package.json:16`) imports the legacy `GoogleSignIn` classes that `play-services-auth` 22.0.0 removed. The design-v2 plan defers email sign-in (default, not asked).
CONFIDENCE: PROVEN (the versions). INFERRED (the coupling to the RN upgrade).
WHAT IT IS: The only door is tied to a library pinned below a removed API.
SOLUTION: Plan the Credential Manager migration (`MB-059`) in the same decision as `ARCH-010`, and add a build-time guard that fails if `play-services-auth` resolves to ≥22. The email path exists on the server (`MB-001`) if Daniel reverses the default.
LINKED: `MB-059`, `MB-001`, `ARCH-010`
LAST VERIFIED: 2026-10-04

---

### KW-016 — The tracked mobile config holds placeholder values, and evidence builds depend on a hand-copied file
STATUS: OPEN
TIER: 1
BITES: any build from a fresh clone or a new worktree.
OWNER: Build team (plan step S6)
EVIDENCE: `mobile/KokonadaHealth/src/health/config.ts` on `e4743af`: `'https://YOUR-BACKEND.up.railway.app'`, `'YOUR_WEB_CLIENT_ID…'`, `'YOUR_SPOTIFY_CLIENT_ID'`. HANDOFF §1: the real file is copied from the `h1-evidence` worktree.
CONFIDENCE: PROVEN
WHAT IT IS: The values are public identifiers, not secrets. The risk is build fragility and an "only local copy" that a worktree cleanup could remove.
SOLUTION: Plan step S6: inject at build time, and fail loudly on any value starting `YOUR_`. Until then, keep one copy of the real file outside every worktree (in `Kokonada-private`).
LINKED: `KW-034`
LAST VERIFIED: 2026-10-04

---

### KW-017 — iOS is a stub, and it is paused
STATUS: OPEN (deferred: no Mac)
TIER: 1
BITES: the first iOS submission.
OWNER: Daniel (`DAN-011`)
EVIDENCE: No `*.entitlements` file and no `Podfile.lock` under `mobile/KokonadaHealth/ios` (`git ls-tree`, 2026-10-04).
CONFIDENCE: PROVEN
WHAT IT IS: A known, bounded list, parked. Before any iOS submission, `ARCH-012` C (hide the YouTube row) needs Daniel's ruling.
SOLUTION: Unchanged: keep it visibly parked, and work the list when a Mac exists.
LINKED: `KW-027`, `DAN-011`, `ARCH-012`
LAST VERIFIED: 2026-10-04

---

### KW-018 — The learning stack has no explicit feedback input
STATUS: OPEN
TIER: 1
BITES: slowly. Personalisation cannot be told it was wrong.
OWNER: Build team
EVIDENCE: There is no `playback_event`, `track_skipped` or feedback call in `mobile/KokonadaHealth/src` (grep, 2026-10-04). The plan's Stage 0 step 14 adds `playback_event` and `track_skipped` (pipe only).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged. Stage 0 covers the implicit half.
SOLUTION: Add one "this didn't fit" control in P3, wired to reward dispatch. It doubles as the instrument for `KW-042`.
LINKED: `KW-042`, `KW-044`
LAST VERIFIED: 2026-10-04

---

### TIER 2 — LEGAL, REGULATORY, STORE

---

### KW-051 — J2's new orphan sweep erases production evidence at the first 03:30 UTC after deploy, unless a variable the orchestrator cannot set or read is already set [autonomy]
STATUS: OPEN
TIER: 2
BITES: **the first 03:30 UTC after J2 deploys.** J2 is being built now (`.claude/worktrees/j2`, 4 commits ahead of `origin/main`; T9 not yet built).
OWNER: Build team (architect plus developer), Daniel (one variable, or one tap)
EVIDENCE: `Kokonada-private/session-3181c7f6/j2/J2_PLAN_B.md` §1.1: "The first 03:30 after the deploy would erase every orphan automatically, before the owner's 'word at run time'". DT-13: a kill switch `ORPHAN_SWEEP_DISABLED`, "on by default", which "the owner sets before the merge". §7: "Set `ORPHAN_SWEEP_DISABLED=true` before the merge." HANDOFF §2.5: reading Railway variables "was refused by the permission classifier". Round 8 Q4: C-2 runs "on the owner's word at run time". Round 11 delegates "production actions in approved plans".
CONFIDENCE: PROVEN (the plan text). INFERRED (that a delegated merge could happen without the variable set).
WHAT IT IS: DEC-127's principle is "record, then clean". The counts are the facts counsel needs for an Art. 33 question. Under the delegation the orchestrator merges, but the guard that preserves that order depends on a step only Daniel can perform and nobody can verify before the merge. If it is missed, the record is erased by the app itself before anyone counts.
SOLUTION: Option (a) is preferred. About 1 hour, architect plus compliance re-check.
- **(a) Fail safe.** The new destructive sweep runs only when `ORPHAN_SWEEP_ENABLED` is set. C-2's record and clean happen first, then the enable flag is set as the plan's last production step. The "within a day" declaration becomes true at that flip, which compliance re-words.
- **(b) If the plan stays as written:** the code logs `[orphanSweep] disabled` at boot. The orchestrator merges only between 06:00 and 18:00 UTC, reads the filtered deploy log, and if the line is missing, reverts before 03:30 UTC.

Either way, the clean itself stays a one-tap word from Daniel at run time (§ Lines the delegation does not cross, item 7). Proof: the first `[sessionTrim]` line after deploy shows the sweep skipped, and DAN-050 records the flip.
LINKED: `BE-087`, `BE-094`, `DEC-127`, `DAN-050`, `KW-059`
LAST VERIFIED: 2026-10-04

---

### KW-054 — The counsel pack has grown to about 70 questions in seven-plus annexes, nothing has been sent, and the first dated answer is due in four weeks
STATUS: OPEN
TIER: 2
BITES:
- **about 2026-11-02**, the latest answer for Art. 50(2) and the LLM captions before 2026-12-02 (calendar B3);
- **2027-01-15**, the classification checkpoint before Annex III on 2027-12-02 (calendar B7);
- **now**, for the MDR breath-law pivot. The MDR is in force, and it bites at the first EU distribution, closed tests included;
- **before `DAN-015` publishes the policy**, for the controller identity.
OWNER: Daniel (send and pay), regulatory-researcher (prepare)
EVIDENCE: `DAN-014` (open since 2026-09-24) gathers:
- `brief_regulatory` Q1–Q11 and `r_regulatory` Q1–Q14;
- Q-H; BE-016 C1–C9; HX-5 CQ1–CQ9; HX-3 Q1–Q8; J1-Q3–Q5;
- the J2-Q drafts (`J2_PLAN_B.md` §8);
- V1's copy-check Q1–Q6 (`design-v2/v1/v1-regulatory-copy-check.md` §7).

Calendar: `docs/design-v2/calendar.md` B3 and B7 [the sentinel's L1 run, 2026-09-29]. Play's organisation-account rule names "Health apps, such as Medical apps and Human Subjects Research apps" [verified 2026-10-04, support.google.com/googleplay/android-developer/answer/13634885].
CONFIDENCE: PROVEN
WHAT IT IS: Every track adds questions to a pack nobody has triaged. Size drives the lawyer's cost and time, and size is why it has not been sent. The answers that gate the plan are few. Today they are buried among answers that change one sentence of a declaration.
SOLUTION: regulatory-researcher drafts a one-page "gating five" in an hour. Everything else goes in an appendix marked "answer when convenient". The five:
1. Emotion recognition and the high-risk classification (`DAN-010`).
2. The MDR intended purpose, given VISION §6, DEC-015 and the breath law (REG-080, copy-check Q1). This also decides Play's organisation account and its D-U-N-S lead time (`DAN-026`).
3. The controller identity and an EU representative: who the privacy policy names.
4. The minimum age.
5. The Art. 50 notice for already-enrolled users, and its wording.

Daniel books a fixed-fee scoping call with a technology lawyer. **The fallback if no answer comes by 2026-11-02:** set `DISCOVERY_CAPTION_LLM=false` before 2026-12-02. It is reversible, and it removes the subject of the Art. 50(2) question without answering it (`KW-062`).
LINKED: `KW-022`, `KW-055`, `KW-062`, `DAN-010`, `DAN-014`, `DAN-015`, `DAN-026`, T10
LAST VERIFIED: 2026-10-04

---

### KW-055 — The record of the product's purpose is being reworded by agents while the legal question it decides is open
STATUS: OPEN
TIER: 2
BITES: whenever counsel or a regulator reads the record. Counsel's pack includes these documents now. The internal wording is also what ADR-0017 commits at V1.
OWNER: Daniel and counsel (decision), the orchestrator (freeze)
EVIDENCE:
- `docs/VISION.md` §6: "The Ethic — a Regulator, not a Mirror… a wellness product that senses distress must help regulate it".
- `design-v2/v1/v1-regulatory-amendment-confirm.md`: "regulated breath" → "the slow-breath law"; "keeps the regulator ethic" → "keeps the never-mirror rule"; "Soft & calming" → "Soft & quiet".
- Copy-check Q1 asks whether the breath law's recorded objective counts as an intended purpose, and "Does the answer change if ADR-0017 or similar documents are published?".
- The Commission's draft Annex III guidelines warn: "the AI Act should not be circumvented by referring to an 'angry attitude' rather than an 'angry emotion'" [secondary source hlc.com, 27 May 2026, verified 2026-10-04; the guidelines are a draft].
- `DAN-010`: "Do not design around it."
CONFIDENCE: PROVEN (the edits and the quotes). Whether the wording matters legally is counsel's question, and this entry does not answer it.
WHAT IT IS: Restraint in user-facing copy is legitimate and already enforced. Rewriting the internal record of intent, while the function stays the same, decides the classification question by proxy, without counsel and now without the owner. If counsel later finds the purpose is regulatory, an edited record reads worse than an honest one.
SOLUTION: Freeze purpose-describing text until counsel answers Q1: VISION §5–6, DEC-015's verbatim record (already untouched), and ADR-0017's purpose paragraph. User-facing copy rules stay as they are. Where an internal wording changes for clarity, keep a one-line changelog of what changed and why, beside the original. Cost: none. This is a rule, not work.
LINKED: `KW-054`, `KW-022`, `DAN-010`, REG-080
LAST VERIFIED: 2026-10-04

---

### KW-062 — One production variable, `DISCOVERY_CAPTION_LLM=true`, carries three separate exposures
STATUS: OPEN
TIER: 2
BITES: **already** on the owner's own generations, and on 2026-12-02 (Art. 50(2) grace end). Any tester build multiplies it.
OWNER: Daniel (one variable), the build team (`BE-044`, `BE-083`)
EVIDENCE: The flag is `true` in production (`docs/design-v2/calendar.md`, the orchestrator's check of 2026-09-29). `backend/app/sockets/biometricHandler.js:119,1333` and `services/discovery/captionService.js:20`. The three exposures:
- **(1)** captions are validated only for type and length and rendered verbatim on Now Playing, so a model can put clinical words on screen past the H1 display map (`BE-044`);
- **(2)** the prompt carries `bpmCenter` and the heart-rate band to Groq, while the declarations say no health data reaches any LLM (`BE-083`). Groq's DPA and ZDR are unconfirmed (`DAN-035`);
- **(3)** the Art. 50(2) date (calendar B3).
CONFIDENCE: PROVEN (the rows and the code). The flag's value is as of 2026-09-29.
WHAT IT IS: Each exposure is tracked on its own row. Together they say something no single row says: the cheapest fix for all three is one reversible variable.
SOLUTION: Put `DISCOVERY_CAPTION_LLM=false` to Daniel now, as a production change outside any plan. It needs his word, and it is reversible in one edit plus a deploy. Turn it back on when `BE-044` and `BE-083` have landed and counsel has answered Art. 50(2). Proof: no `[caption]` call in the deploy logs, and Now Playing shows no caption.
LINKED: `BE-044`, `BE-083`, `BE-025`, `DAN-035`, `KW-019`, `KW-025`, `KW-054`
LAST VERIFIED: 2026-10-04

---

### KW-019 — The backend still emits "High-Stress / Pre-Panic"; only the client hides it
STATUS: MITIGATED
TIER: 2
BITES: on any build older than #192 (`DAN-021`), and through LLM captions while `KW-062` stands.
OWNER: Build team
EVIDENCE: `backend/app/services/medicalProfileService.js:18-20` (the label), `agents/runtime/knowledge/stateTaxonomy.js:574`. The client's closed display set is `mobile/KokonadaHealth/src/experience/pulse/stateDisplayVocabulary.ts:24-40` (H1 #192, HX-7 #203).
CONFIDENCE: PROVEN
WHAT IT IS: The harm half is closed on current builds. The server vocabulary is unchanged by design (H1: "server keys do not change now").
SOLUTION: Rename the server key when P7 rebuilds Pulse, and add a server-side forbidden-terms check shared with captions (`BE-044`). Proof: a test that no server label matches the forbidden list.
LINKED: `KW-020`, `KW-062`, `UI-020`, `DAN-021`
LAST VERIFIED: 2026-10-04

---

### KW-020 — The stress rule is an absolute HRV threshold with no personal baseline
STATUS: OPEN
TIER: 2
BITES: already, for any consented user with HRV data.
OWNER: Build team
EVIDENCE: `medicalProfileService.js:22` (`t.hrv < 20`).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged. RMSSD below 20 ms is ordinary in healthy adults.
SOLUTION: Unchanged. Route the rule through `baselineEngine`. With no baseline, return lower confidence and never a maximal-stress verdict. Do it at P7 or with J2's A1 work.
LINKED: `KW-019`, ADR-0013
LAST VERIFIED: 2026-10-04

---

### KW-021 — AI Act Art. 50 transparency has applied since 2 Aug 2026; the notice is built, its final wording is not
STATUS: MITIGATED
TIER: 2
BITES: already (in force). The open parts wait on counsel.
OWNER: Build team (built), Daniel and counsel (wording)
EVIDENCE: H1 (#192, `c3beeb4`): the notice on Generate, Onboarding and Pulse. `UI-005` surface 6 (already-enrolled users) and the consent-screen wording wait on `DAN-014`.
CONFIDENCE: PROVEN
WHAT IT IS: The buildable half is done.
SOLUTION: Counsel's item 5 in `KW-054`.
LINKED: `KW-054`, `UI-005`
LAST VERIFIED: 2026-10-04

---

### KW-022 — Whether Kokonada is a high-risk emotion recognition system is unresolved, and only counsel can resolve it
STATUS: NEEDS ATTENTION
TIER: 2
BITES: **2027-12-02** (Annex III). Checkpoint 2027-01-15. Earlier on an EU launch.
OWNER: Daniel and counsel
EVIDENCE:
- The Art. 50 Guidelines C(2026) 5054 para 102: "all emotion recognition systems are also classified as high-risk" (`DAN-010`, 2026-09-26).
- The Annex III guidelines are still a draft, open to consultation until 2026-06-23, with no adoption found [verified 2026-10-04, secondary].
- Their anti-circumvention language (`KW-055`).
CONFIDENCE: INCONCLUSIVE by construction
⚠ NEEDS ATTENTION — NO KNOWN SOLUTION:
- **Tried:** a build-side audit, a regulatory dossier, three annexes.
- **Blocks:** a question of law, and the dossier is unsent.
- **Unblocks:** `KW-054`'s gating-five page reaching counsel. Second consecutive run in this state.
LINKED: `KW-054`, `KW-055`, `DAN-010`
LAST VERIFIED: 2026-10-04

---

### KW-023 — Any workplace or education deployment is prohibited in the EU
STATUS: MITIGATED (a standing constraint)
TIER: 2
BITES: the day a B2B or education channel is contemplated.
OWNER: Daniel
EVIDENCE: AI Act Art. 5(1)(f), in force since 2025-02-02. HX-7 (#203) retired the Working and Focus chips end to end.
CONFIDENCE: PROVEN
WHAT IT IS: Nothing in the product points there now.
SOLUTION: Keep it as a permanent constraint: no EU employer or education channel.
LINKED: `KW-043`
LAST VERIFIED: 2026-10-04

---

### KW-024 — The privacy policy is not hosted, the app already links to the address, and who it names is undecided
STATUS: OPEN
TIER: 2
BITES: at the first build that reaches anyone but the owner, and at any Play track (closed testing included). `CMP-026`, `CMP-066` and `CMP-081` stay HALT until then.
OWNER: the orchestrator (publish, per Round 11), Daniel (the controller line)
EVIDENCE: `https://kokonada.github.io/privacy/` returns **404**, and the org `kokonada` (created 2026-10-01) has 0 public repositories [read 2026-10-04]. `mobile/KokonadaHealth/src/legal/legalLinks.ts:15,30` (`PRIVACY_POLICY_HOSTED = false`). `android/app/src/main/res/values/strings.xml:6` (the Health Connect rationale points at the same address). Round 11: "אני, אחרי בדיקת בודקים (מומלץ)". The controller identity is `DAN-026`/`DEC-044`, open.
CONFIDENCE: PROVEN
WHAT IT IS: Publishing is delegated. Its first line, who the controller is and how to contact them, is a personal and legal decision, and it is not delegated (§ Lines, item 6).
SOLUTION:
- Daniel answers the controller line, or counsel answers it via `KW-054` item 3.
- The orchestrator publishes from a separate clone that holds only the policy, never with the private repository as a remote.
- Then the `PRIVACY_POLICY_HOSTED` flip PR (DEC-121).

Proof: a 200 on the address, and compliance-auditor's sentence-by-sentence check against the code.
LINKED: `DAN-015`, `DAN-026`, `MB-034`, `KW-054`
LAST VERIFIED: 2026-10-04

---

### KW-025 — Groq's DPA and zero retention are unconfirmed, while health-derived values reach Groq
STATUS: OPEN
TIER: 2
BITES: at store submission, and now as a processor question while `KW-062` stands.
OWNER: Daniel (`DAN-035`)
EVIDENCE: `docs/PRIVACY_DECLARATIONS.md:90-95,165` ("treat this row as UNVERIFIED for launch purposes"). `BE-083` (`bpmCenter` in the caption prompt). Groq received YouTube titles, channels and genres in July (HANDOFF §4.2).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged, plus the caption path.
SOLUTION: Daniel confirms the DPA and ZDR in the Groq console (`DAN-035`, 10 minutes). Meanwhile `KW-062`'s variable removes the live part.
LINKED: `KW-062`, `DAN-035`, `DAN-047`
LAST VERIFIED: 2026-10-04

---

### KW-026 — Spotify track IDs to a third party (ReccoBeats)
STATUS: OPEN (tracked as `BE-043`, P1)
TIER: 2
BITES: if the containment ever regresses.
OWNER: compliance-auditor
EVIDENCE: `BE-043`. `featureService.js:26-38` drops Spotify recordings before the measured fetch.
CONFIDENCE: INFERRED unreachable
WHAT IT IS: See `BE-043`.
SOLUTION: Per `BE-043`. Do not delete the adapter in a cleanup batch.
LINKED: `BE-043`, `KW-004`
LAST VERIFIED: 2026-10-04

---

### KW-027 — Sign in with Apple has no entitlement
STATUS: OPEN (deferred: no Mac)
TIER: 2
BITES: the first App Store submission.
OWNER: Daniel (`DAN-011`)
EVIDENCE: No `*.entitlements` under `mobile/KokonadaHealth/ios` (2026-10-04).
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
EVIDENCE: `docs/store/play-health-connect-declaration.md:19`: "Kokonada generates music that continuously adapts to the listener's real-time physiological…".
CONFIDENCE: PROVEN
WHAT IT IS: Kokonada selects and sequences existing recordings. "Continuously adapts to physiology" is also exactly the kind of outward statement that feeds `KW-055`'s intended-purpose question.
SOLUTION: Rewrite it at P13 from the code, after counsel's item 2. Run the single-source check across the declaration, the policy, the rationale screen and the consent text.
LINKED: `KW-024`, `KW-055`
LAST VERIFIED: 2026-10-04

---

### KW-029 — Health Connect and Play blockers
STATUS: MITIGATED
TIER: 2
BITES: at any Play track.
OWNER: Build team, Daniel
EVIDENCE: HX-5 (#208) fixed the rationale constant and the privacy link. `CMP-067` closes on its evidence. `CMP-066` waits on `DAN-015` (registry INDEX, 2026-10-04).
CONFIDENCE: PROVEN
WHAT IT IS: Fixed in code. It waits on hosting and evidence.
SOLUTION: `KW-024`, then the evidence sitting (`KW-053`).
LINKED: `MB-035`, `KW-024`, `KW-053`
LAST VERIFIED: 2026-10-04

---

### KW-030 — Account deletion leaves a Garmin registration live
STATUS: OPEN (dormant)
TIER: 2
BITES: the first Garmin-linked erasure. The Garmin surfaces are dormant until `CMP-051`.
OWNER: Daniel (`DAN-009`)
EVIDENCE: Registry INDEX: "The Garmin surfaces stay dormant until CMP-051 is resolved" (2026-10-04). Not re-read in code this run.
CONFIDENCE: INFERRED
WHAT IT IS: Unchanged and dormant.
SOLUTION: Unchanged. Deregister in the delete path when Garmin is real.
LINKED: `DAN-009`
LAST VERIFIED: 2026-09-01

---

### TIER 3 — OPERATIONAL

---

### KW-053 — The plan's critical path runs through owner-only actions that the delegation cannot take
STATUS: OPEN
TIER: 3
BITES: **at P2's G1.** It cannot pass while any HALT is open (DEC-097), and the HALTs close only on evidence that needs Daniel's accounts, his phone and a hosted policy. P1 and Stage 0 can proceed. Nothing after them can.
OWNER: Daniel (sittings), the orchestrator (scheduling)
EVIDENCE: Registry INDEX: 16 HALTs, none closed, each closing "when its fix is on main and verified on device" (2026-10-04). HANDOFF §5.3: the evidence runs need the `DAN-036` throwaway accounts, "which do not exist yet". `DAN-015` is 404 (`KW-024`). 41 open `DAN-` rows in TASKS (2026-10-04). DAN-048's 24-hour recount has been owed since 2026-10-03 11:22Z and waits on the hotspot.
CONFIDENCE: PROVEN
WHAT IT IS: The delegation moved the build gates off Daniel, not the physical ones. Unscheduled, they surface one at a time as "waits for the hotspot". Each wait parks a branch, and parked branches drift.
SOLUTION: Batch them into two fixed sittings, each with a single click-list the orchestrator prepares:
- **(A) At the computer, about 30 minutes:** top-3 item 1, plus `DAN-036`, `DAN-035`, `DAN-029` and the `VECTOR_DISCOVERY` value.
- **(B) Phone evidence, about 1 hour:** every merged HALT fix in one capture run, with the lists already in each `pr-*.md`.

Proof: the HALT table's status lines re-issued by compliance-auditor.
LINKED: `ARCH-011`, `DAN-036`, `DAN-015`, `KW-024`, `KW-047`
LAST VERIFIED: 2026-10-04

---

### KW-056 — The design bar is now judged by agents whose taste has already diverged from the owner's [autonomy]
STATUS: OPEN
TIER: 3
BITES: **at V1's direction choice (DEC-128), this week,** then at every page's G6. The rework, if it comes, comes when Daniel first sees a finished page.
OWNER: the orchestrator (process), Daniel (veto)
EVIDENCE: The plan of 2026-09-23 kept exactly two gates for Daniel, G3 (direction) and G6 (prototype) (`docs/plans/DESIGN_V2_PLAN.md:32`, the "המעורבות שלך" row). Round 11 delegated both. Round 7 Q1: Daniel chose "רקע חם גם לֽC", the option not marked recommended. The owner's standard: "שבסוף אהיה מרוצה". His stated pain is "work being redone" (design-reboot memory). Round 11's mitigation is "an independent second design critic", which is the same model family as the first.
CONFIDENCE: PROVEN (the record). INFERRED (that the critics' errors are correlated).
WHAT IT IS: Taste is the one input agents cannot verify against a primary source, and the plan already has evidence that consensus and the owner can disagree. A whole direction built and merged on the wrong guess is the most expensive rework on the board.
SOLUTION: **Decide and notify, with a veto window.**
- The orchestrator decides with consensus and pushes the live board or the captures to Daniel's phone (he answers by phone, Round 12).
- Lab work continues.
- No V1 token branch and no P-page merges to `main` until 48 hours have passed without a veto. Silence counts as consent.
- Feed his recorded choices (Rounds 7 and 9, the V0 synthesis) to both critics as an explicit "owner's taste" input.

Cost: a few minutes of his time per gate. Adopting T8 makes the fallback automatic.
LINKED: `KW-057`, T8, DEC-098, DEC-128
LAST VERIFIED: 2026-10-04

---

### KW-057 — Daniel can reverse any delegated decision in principle, but not at the volume they are produced [autonomy]
STATUS: OPEN
TIER: 3
BITES: continuously. Concretely at **2026-10-26** (`CMP-050` re-verify) and **2026-11-28**, when 284 registry entries reach their re-verify date and `page.md:17`'s staleness clause marks every open page stale, owner gates included (`DAN-032`).
OWNER: the orchestrator
EVIDENCE: 127 entries in `docs/design-v2/decisions/` on `e4743af`. Round 11's reading: "the owner may reverse any of them". `DAN-032` (open). TASKS 704 KB.
CONFIDENCE: PROVEN
WHAT IT IS: Reversal rights with no digest exist only on paper. The delegation's safety depends on Daniel seeing what was decided, ranked by how costly it would be to undo.
SOLUTION:
- A weekly one-screen Hebrew digest pushed to his phone: decisions taken under delegation, each with a one-line "what undoing it costs", irreversible ones first.
- Anything on the § Lines list never enters the digest as already decided.
- Decide `DAN-032` before 2026-10-26: re-verification appends a dated line and does not rewrite the entry, so pages do not go stale wholesale.

Proof: the first digest is delivered, and no page is marked stale on 2026-11-28 for that reason alone.
LINKED: `KW-056`, `DAN-032`, T7
LAST VERIFIED: 2026-10-04

---

### KW-058 — The "temporary" production shell key is still registered and on disk, and its removal waits on a hotspot [autonomy]
STATUS: OPEN
TIER: 3
BITES: every day it stays. Any compromise of this laptop, or a mistaken agent command, gets a shell in the production container with every production secret in its environment.
OWNER: the orchestrator (in-plan), Daniel (the hotspot, if still wanted)
EVIDENCE: `C:\Users\danie\.ssh\kokonada_railway` and `.pub` exist, dated 2026-10-02 [listed 2026-10-04]. HANDOFF §0: remove after "the 24-hour recount on or after 2026-10-03 11:22Z". No recount file exists in `session-3181c7f6\j1\`. `railway ssh` runs with `dangerouslyDisableSandbox` (HANDOFF §2.5).
CONFIDENCE: PROVEN (the files exist). INFERRED (still registered; probably passphrase-less, since it is used unattended).
WHAT IT IS: The key's lifetime was tied to a step blocked on Daniel's network. So "temporary" now means "until the next hotspot".
SOLUTION: Remove it now: `railway ssh keys remove kokonada-railway-temp-2026-10-02`, then delete `~/.ssh/kokonada_railway*`. Mint a fresh temporary key at the start of the recount sitting (2 minutes) and remove it at the end of the same sitting. Proof: `railway ssh keys list` shows no `kokonada-railway-temp-*`, and the files are gone.
LINKED: `DAN-048`, `KW-059`
LAST VERIFIED: 2026-10-04

---

### KW-059 — Production writes have no technical guard, only a written rule [autonomy]
STATUS: OPEN
TIER: 3
BITES: the first wrong script run under `railway run`, or the first production write interrupted by a usage-limit stop or a hotspot drop.
OWNER: Daniel (one Atlas user), the orchestrator (procedure)
EVIDENCE:
- HANDOFF §2.5: `railway run node <script>` "runs on this machine with production env vars", and the production database is named `test` (`MONGO_DB_NAME=test`).
- The snapshot scripts use the app's own credential.
- Round 11: "Production writes: only those written in an approved plan".
- HANDOFF §2.7: agents fail with a 429 at the usage limit and are resumed later. HANDOFF §2.5: "The hotspot can drop for a minute".
CONFIDENCE: PROVEN (the route). INFERRED (that the credential is read-write; it is the app's).
WHAT IT IS: Under the delegation the rule is enforced by the same agent it binds. A read-only count and a destructive clean differ by one argument, under the same credential.
SOLUTION:
- **Daniel creates a read-only Atlas database user** (Atlas → Database Access, role `read@test`, 5 minutes). Count scripts take `MONGO_URI_READONLY`.
- The read-write URI is used only for an approved write, at run time, with his tap.
- Every production write script must be idempotent and count-gated, as `queueClean.js` is (`CLEAN_CONFIRM`), and must never start in the last 30 minutes of a usage window or on a flaky hotspot.

Proof: a count run with the read-only URI succeeds, and a write attempt with it is refused.
LINKED: `KW-050`, `KW-051`, `KW-058`, `KW-035`
LAST VERIFIED: 2026-10-04

---

### KW-061 — The risk ledger itself was lost for a month, and eight of its findings never reached TASKS
STATUS: OPEN
TIER: 3
BITES: already. `KW-004`, `KW-007`, `KW-008` and `KW-009` are live defects with no work item.
OWNER: the orchestrator
EVIDENCE: `stash@{0}^3:WEAKNESSES_AND_FAILURES.md` (676 lines, seeded 2026-09-01). It is absent from every branch (`git log --all -- WEAKNESSES_AND_FAILURES.md` is empty). A TASKS grep (2026-10-04) finds no row for `KW-002`, `KW-004`, `KW-007`, `KW-008`, `KW-009`, `KW-036`, `KW-037` or `KW-052`.
CONFIDENCE: PROVEN
WHAT IT IS: The process failure behind several product failures. The findings-go-to-tasks rule had no input, because the file was not in the tree.
SOLUTION: The orchestrator commits this file at the root, and its scribe adds TASKS rows for the eight IDs above (P1 for `KW-004`, `KW-007`, `KW-008`, `KW-009` and `KW-052`). It also puts T1–T10 and § Lines to Daniel once, by phone. When S4 (`DAN-013`) reconciles `stash@{0}`, the stash's 2026-09-01 copy of this file is superseded by this one. It must not be restored over it; keep it in the rescue branch as history. Proof: the rows exist and cite these KW IDs.
LINKED: all of the above
LAST VERIFIED: 2026-10-04

---

### KW-031 — There is no HTTP access log
STATUS: OPEN (tracked as `OPS-019`, P1)
TIER: 3
BITES: at the first incident you cannot explain.
OWNER: Build team
EVIDENCE: `backend/package.json` has no `morgan`, `pino` or `winston` (2026-10-04).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: Per `OPS-019`, mounted before `apiLimiter`.
LINKED: `OPS-019`, `KW-032`
LAST VERIFIED: 2026-10-04

---

### KW-032 — `/health` cannot say which build is running
STATUS: OPEN (tracked as `OPS-018`)
TIER: 3
BITES: on every deploy. Under the delegation it is what the post-merge agent should check first.
OWNER: Build team
EVIDENCE: `backend/app/index.js:117` (`{ status: 'ok', ts }`).
CONFIDENCE: PROVEN
WHAT IT IS: Today the deployment list is the only authority.
SOLUTION: Per `OPS-018`: the git sha on `/health` (Railway provides `RAILWAY_GIT_COMMIT_SHA`). Then the post-merge agent compares it to the merge commit.
LINKED: `OPS-018`, `KW-050`
LAST VERIFIED: 2026-10-04

---

### KW-033 — Green CI that proves nothing
STATUS: MITIGATED
TIER: 3
BITES: on a stacked PR, or on a loose assertion.
OWNER: Build team
EVIDENCE: `.github/workflows/ci.yml:3-7` (push and PR on `main` only, `OPS-011`). The current workflow merges developer branches locally, and every PR targets `main`, so CI does run. CI on `main` has been green for the last 8 pushes (2026-10-04). The bigger gap moved to `KW-050`.
CONFIDENCE: PROVEN
WHAT IT IS: Mitigated by process.
SOLUTION: `OPS-011`/`OPS-012` when convenient. `KW-050` first.
LINKED: `OPS-011`, `KW-050`
LAST VERIFIED: 2026-10-04

---

### KW-034 — The release keystore exists in one place found on disk, with no recorded backup
STATUS: OPEN (re-tiered 0→3, corrected)
TIER: 3
BITES:
- **Before the first Play upload:** loss costs re-registering the signing SHA-1 with the Google OAuth Android client and the Spotify dashboard, plus reinstalling on the phone, which loses app data and consent state.
- **After it:** an upload-key reset request, which takes days.
OWNER: Daniel
EVIDENCE: `mobile/KokonadaHealth/android/app/kokonada-release.keystore` and `android/keystore.properties` in the main tree. A search of `Videos`, `Documents`, `Desktop` and OneDrive found no other copy (2026-10-04). TASKS and the private notes record no backup. Calendar "Unverified" item 12. Play: new apps are automatically enrolled in Google-generated app signing, and "If you lose your upload key… you are not locked out of your app", with a **Request upload key reset** in Console [verified 2026-10-04, support.google.com/googleplay/android-developer/answer/9842756].
CONFIDENCE: PROVEN (one copy found; the reset path). INCONCLUSIVE (a backup outside the searched folders).
WHAT IT IS: **Correction:** the seed called this the one irreversible asset. For Play it is not. The seed reasoned from self-signed-app semantics, and Play App Signing changes that. It is still a single copy in a tree the resumed custodian plan will work in.
SOLUTION: Daniel copies both files to two places (an encrypted cloud folder and an offline drive) and test-restores one by building a release from the restored copy. 15 minutes. The custodian plan's CY-7 pre-step (a release-signing runbook) records where the copies are, never the passwords.
LINKED: `OPS-002`, `KW-016`, `KW-050` (`git clean` deny)
LAST VERIFIED: 2026-10-04

---

### KW-035 — Build and production data share one database
STATUS: OPEN
TIER: 3
BITES: the first real user's sign-in.
OWNER: Daniel
EVIDENCE: HANDOFF §2.5: production uses the database `test`. It holds the owner's real health data (BE-016 counts, 2026-10-01).
CONFIDENCE: PROVEN
WHAT IT IS: Settled as not a live hazard today (§ SETTLED). The timing risk stands. `KW-059` is the cheap half for now.
SOLUTION: Unchanged: a separate Atlas project before the first non-owner user, plus `KW-059`'s read-only user now.
LINKED: `KW-059`
LAST VERIFIED: 2026-10-04

---

### KW-036 — Live heart rate may stop when the screen locks
STATUS: OPEN
TIER: 3
BITES: the first phone in a pocket.
OWNER: Build team
EVIDENCE: There is no `FOREGROUND_SERVICE*` permission and no `<service>` in `mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml` (2026-10-04). **No TASKS row** (`KW-061`).
CONFIDENCE: INFERRED (the behaviour on lock is unmeasured)
WHAT IT IS: Unchanged.
SOLUTION: Measure first: 30 minutes screen-locked at the phone evidence sitting. If readings stop, add a connected-device foreground service and update the declaration in the same change.
LINKED: `KW-028`, `KW-053`
LAST VERIFIED: 2026-10-04

---

### KW-037 — One backend instance is the ceiling
STATUS: OPEN
TIER: 3
BITES: when a second instance is needed. Not at five users.
OWNER: Build team
EVIDENCE: No `@socket.io/redis-adapter` in `backend/app` (2026-10-04). **No TASKS row** (`KW-061`).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged, and not urgent.
SOLUTION: A TASKS row at P3, so it is written down as the ceiling.
LINKED: `KW-009`
LAST VERIFIED: 2026-10-04

---

### KW-038 — Collections that grow without bound
STATUS: MITIGATED
TIER: 3
BITES: as a bill.
OWNER: Build team
EVIDENCE: `backend/app/models/ServeEvent.js:30` now has a TTL. HX-2 (#206) removes provider track data from sessions within 30 days. The nightly `serveEvents=950` (2026-10-02).
CONFIDENCE: PROVEN
WHAT IT IS: Mostly addressed.
SOLUTION: Re-check `BiometricLog`'s "100k cap" comment at the next run.
LINKED: —
LAST VERIFIED: 2026-10-04

---

### KW-039 — A consent query on every heart-rate push
STATUS: OPEN
TIER: 3
BITES: under concurrency, not at five users.
OWNER: Build team
EVIDENCE: No cache around `getConsentStatus` (`backend/app/services/privacy/consent.js:255`).
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: Unchanged: a fail-closed Redis cache, invalidated on every consent write.
LINKED: `KW-037`
LAST VERIFIED: 2026-10-04

---

### KW-040 — A large library can exhaust the heap
STATUS: OPEN
TIER: 3
BITES: a large library, or two generations at once.
OWNER: Build team
EVIDENCE: Not re-read this run (the seed: `biometricHandler.js` comment on a 442 MB OOM).
CONFIDENCE: INFERRED
WHAT IT IS: Unchanged.
SOLUTION: Unchanged: `.lean()` on the pool path, and `--max-old-space-size`.
LINKED: —
LAST VERIFIED: 2026-09-01

---

### KW-041 — Generation latency is dominated by sequential Spotify calls, some of which now always fail
STATUS: OPEN
TIER: 3
BITES: the "magic moment" turning into a wait (VISION §4).
OWNER: Build team
EVIDENCE: `backend/app/services/spotify.js:590-608` (`searchVibePlaylists`, sequential, 8 s timeout each) and `:618-642` (`getVibePlaylistTracks`, sequential, now failing by policy, `KW-052`).
CONFIDENCE: PROVEN (the structure). INFERRED (the measured latency).
WHAT IT IS: `KW-052` removes the dead calls. Parallelising the remaining ones is the second half.
SOLUTION: Do `KW-052` first, then bounded concurrency on what remains (the existing `crossPlatform.js` pattern). Measure against the 18 s budget.
LINKED: `KW-052`
LAST VERIFIED: 2026-10-04

---

### TIER 4 — MARKET, EVIDENCE AND STRATEGY

---

### KW-060 — The plan will build the player page to the top design bar before anyone decides what it plays through
STATUS: OPEN
TIER: 4
BITES: **at P3's G0** (the player). P2's Spotify states come earlier still.
OWNER: Daniel (decision), with architect and sentinel
EVIDENCE: `ARCH-005` is P2, open since 2026-09-24, with "done when: Daniel and `architect` (with `sentinel`) settle the provider question". `docs/plans/DESIGN_V2_PLAN.md:252-253`: P2 and P3 integrate Spotify states and the player. The plan's own risk list says "the magic moment is not tested in public" and that sentinel and architect "are examining the provider question now". There is no recorded examination.
CONFIDENCE: PROVEN
WHAT IT IS: The plan's most sink-specific page will be built at the highest bar in the plan, for the sink that reaches five people, unless the fork is put to Daniel first. This is `KW-001` turned into a dated sequencing risk.
SOLUTION: Raise `ARCH-005` to P1. Put it to Daniel before P3's G0 as a decision table (A stay at five, B MusicKit research, C own the audio), with architect's cost of a provider-neutral P3 and `KW-002`'s answer. It stays a human decision (§ Lines, item 10).
LINKED: `KW-001`, `KW-002`, `ARCH-005`
LAST VERIFIED: 2026-10-04

---

### KW-042 — The product's central claim is untested
STATUS: OPEN
TIER: 4
BITES: not on a date. As months of work on an unvalidated premise.
OWNER: Daniel
EVIDENCE: Unchanged from the seed (de Witte et al.; Hides et al.; [verified 2026-09-01]). No experiment has run since.
CONFIDENCE: PROVEN (the literature). UNTESTED (the product).
WHAT IT IS: Unchanged, and now joined by `KW-004`: if the scorer has no features for served tracks, the engine is not yet capable of the differentiator the experiment would test.
SOLUTION: Unchanged: the n-of-5 within-subject test. Measure `KW-004` first, so the test compares the real engine.
LINKED: `KW-004`, `KW-018`, `KW-048`, T3
LAST VERIFIED: 2026-10-04

---

### KW-043 — There is no revenue model, and the decision that there is none is locked
STATUS: OPEN
TIER: 4
BITES: when costs exceed what a student pays, or free tiers change.
OWNER: Daniel
EVIDENCE: ADR-0001 (unchanged). The Groq, Railway and Atlas tiers are unrecorded (`DAN-035`, calendar "Unverified").
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: Unchanged: give ADR-0001 a review date and a trigger (T6).
LINKED: T6
LAST VERIFIED: 2026-09-01

---

### KW-044 — Nothing is instrumented
STATUS: OPEN
TIER: 4
BITES: continuously.
OWNER: Build team, Daniel
EVIDENCE: No analytics in the app (2026-10-04). The plan defines per-page server-side metrics (`DESIGN_V2_PLAN.md:278`), not yet built.
CONFIDENCE: PROVEN
WHAT IT IS: Planned, not built.
SOLUTION: Build the plan's server-side metrics with P1, and measure v1 now as the baseline, as the plan says.
LINKED: `KW-042`, `KW-018`
LAST VERIFIED: 2026-10-04

---

### KW-045 — The funnel is six multiplied fractions
STATUS: OPEN
TIER: 4
BITES: at launch.
OWNER: Daniel
EVIDENCE: Unchanged [verified 2026-09-01]. J2's A1 ruling: a mood-only account sees an honest empty Pulse.
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: Unchanged: mood-only is first-class, and the wearable is the upgrade.
LINKED: `KW-011`
LAST VERIFIED: 2026-09-01

---

### KW-046 — This configuration has one precedent, and it is dead
STATUS: OPEN
TIER: 4
BITES: as the context for `KW-001`.
OWNER: Daniel
EVIDENCE: Unchanged [verified 2026-09-01]. Next market refresh due by 2026-12-01.
CONFIDENCE: PROVEN
WHAT IT IS: Unchanged.
SOLUTION: Unchanged: a decision input, not a verdict.
LINKED: `KW-001`
LAST VERIFIED: 2026-09-01

---

### KW-047 — One person, university, and a backlog that grew sixfold in a month
STATUS: OPEN
TIER: 4
BITES: as the quiet cause behind the rest. The delegation moved the build load, not the owner-only load.
OWNER: Daniel
EVIDENCE: TASKS on `e4743af`: **383 open rows** (about 50 on 2026-09-01: the seed counted 59, and a mechanical count of `6a5c443` gives 48). **25 open P0** (11 then), 98 open P1, 41 open `DAN-` rows, 18 rows marked done. Many P0s are fixes merged and awaiting evidence, so the P0 count overstates live risk.
CONFIDENCE: PROVEN
WHAT IT IS: The work grew faster than it closed. Under the delegation nothing slows growth except Daniel, who is now out of the loop by design.
SOLUTION:
- Adopt T9.
- Limit work in progress to one page in build at a time.
- Before Stage 0 closes, a scope sitting: which of P1–P14 a five-tester closed beta needs, and which wait for a public path (`KW-060`).
- `KW-053`'s two sittings drain the owner queue in batches.
LINKED: `KW-053`, `KW-057`, `KW-060`, T5, T9
LAST VERIFIED: 2026-10-04

---

### KW-048 — Nothing is known about any user other than Daniel
STATUS: NEEDS ATTENTION
TIER: 4
BITES: it is the pre-mortem's answer, for the second consecutive run.
OWNER: Daniel
EVIDENCE: The production counts cover "the operator's own account only" (BE-016 counts, 2026-10-01), and Spotify-linked users number 1 (HX-2 count, 2026-10-01). The `DAN-036` test accounts do not exist. No interview, session or survey is recorded since 2026-09-01.
CONFIDENCE: PROVEN
⚠ NEEDS ATTENTION — NO KNOWN SOLUTION:
- **Tried:** naming it in the seed. The file was stashed and never read.
- **Blocks:** at scale, `KW-001`. At five, nothing but time and priority.
- **Unblocks:** five structured conversations with the five people the cap allows, which only Daniel can hold.

Second consecutive run with nothing learned (T2: 2 of 3).
LINKED: `KW-042`, `KW-044`, `KW-001`, T2
LAST VERIFIED: 2026-10-04

---

### KW-049 — Documents a reader would act on are false
STATUS: OPEN
TIER: 4
BITES: every time a new session reads one.
OWNER: Build team (custodian CY-6)
EVIDENCE:
- `UI_UX_MASTER_PLAN.md:3` still says "Status: Implemented" for the deleted web app.
- `KOKONADA_ARCHITECTURE_MASTER.md` §0 was last updated 2026-09-02, before Tracks H and HX, J1 and design v2.
- `docs/VISION.md` §8 says "5-tab UI" and "Wave 2.8".
- `Kokonada-private/HANDOFF.md` §1 still says "Never merge. Merges are Daniel's.", which Round 11 superseded on 2026-10-03.
CONFIDENCE: PROVEN
WHAT IT IS: The HANDOFF line errs safe. The others mislead.
SOLUTION: Superseded banners, never deletions (custodian CY-6). The HANDOFF §1 merge line points to Round 11. **VISION §6 is not edited** (`KW-055`).
LINKED: `KW-055`
LAST VERIFIED: 2026-10-04

---

## § HORIZON — coming, not yet findings

| # | Date | What | Why it matters |
|---|---|---|---|
| H1 | any day | Spotify restricts further | Four material changes in about 20 months (Nov 2024, May 2025, Feb–Mar 2026, Jul 2026). `KW-052` shows the last one was missed for seven months. Re-read the guide every quarter. |
| H2 | 2026-10-12 | React Native 0.88 ships; 0.86 reaches End of Cycle | `ARCH-010`. Latest upgrade start about 2026-11-09, coupled to `KW-015`. |
| H3 | 2026-10-26 | First registry re-verify date (`CMP-050`) | `KW-057`, `DAN-032`. |
| H4 | 2026-11-01 | Play's target-API-36 extension ends | The app targets 36. Watch only. |
| H5 | about 2026-11-02 | Latest counsel answer for Art. 50(2) | `KW-054`, `KW-062`, T10. |
| H6 | 2026-11-28 | 284 registry entries reach re-verify | `KW-057`. |
| H7 | 2026-12-02 | AI Act Art. 50(2) grace ends (pre-Aug-2026 systems) | `KW-062`. |
| H8 | 2026-12-07 | RN 0.89 ships; 0.86 unsupported | `ARCH-010`. |
| H9 | 2027-01-01 | California AB 1043 (age signal), if the US is on the list | `DAN-027`. |
| H10 | 2027-01-04 | Quarterly platform re-check (calendar D1) | Spotify, Play, Groq, Garmin, Android. |
| H11 | 2027-01-15 | Counsel's classification checkpoint | `KW-022`. |
| H12 | 2027-02-01 | Play 16 KB pages | Compliant today (calendar B5). |
| H13 | 2027-05-01 → Aug 2027 | Target API 37 | Calendar B6. |
| H14 | 2027-12-02 | AI Act Annex III applies | `KW-022`. |
| H15 | continuous | Groq model churn | One of its own recommended replacements was deprecated four weeks after the recommendation. `BE-046`'s model-availability check turns the next shutdown from silent into loud. |
| H16 | when adopted | The final Annex III guidelines | The draft (May 2026) carries the anti-relabelling language (`KW-055`). |

---

## § SETTLED — DO NOT RE-RAISE

**Read this section before writing anything.** To reopen an item, present **new evidence dated after the settlement**, never a re-reading of the same facts.

| Item | Settled | Why |
|---|---|---|
| `docs/plans/WAVE4_HALT` is an incident | 2026-08-26 | It is Daniel's own pause switch. It was logged as a fresh incident four times (H7, H11, H12, H17). Never delete it, and never read it as an anomaly. |
| Spotify Content containment and the Developer-Terms ML clause | 2026-08-27 | Designed and enforced (ADRs 0010, 0011, 0012). Read the ADRs before raising any Spotify or YouTube terms concern. |
| Playback can leave the Spotify SDK | settled | App Remote gives transport control, never the audio stream. |
| The 5-user dev cap is a discovery | settled | Daniel has long known it. It matters as a constraint (`KW-001`), never as news. |
| The database is a live production-data hazard today | 2026-08-29 | Daniel: the data is build-phase. The timing risk is `KW-035`. Do not re-rank it as catastrophic. |
| iOS findings are urgent | 2026-08-29 | iOS is paused (no Mac). `KW-017`, `KW-027`. |
| BE-008 cross-site WebSocket hijacking | 2026-08-28 | Closed, and verified in production by behavioural probe. |
| `watch/` still exists | 2026-08-28 | Deleted. The backend `/watch/*` lane is a different thing, and it is live. |
| Railway deployment IDs are commit shas | 2026-08-28 | They are not. Verify a deploy by behaviour or by the commit message. |
| The background workers do not run in production | **2026-10-04** | `KW-006` CLOSED on DAN-048's `W workers-in-process=yes` and the nightly `[sessionTrim]` line. |
| The backend runs on a shut-down Groq model | **2026-10-04** | `backend/app/config/llmProvider.js:13` defaults to `openai/gpt-oss-20b` (#197). Groq lists it as a replacement, not deprecated [verified 2026-10-04]. Re-raise only if Groq deprecates it, or `LLM_MODEL` is found set to a dead model. |
| YouTube compliance is live | **2026-10-02** | YouTube is sealed in code (DEC-122, #211), and the production counts are zero (DAN-046 P1). It reopens only if the seal is lifted (`ARCH-012`). |
| The 2026-10-03 delegation is itself a risk to argue against | **2026-10-03** | It is Daniel's decision. This file reports the risks of operating it and proposes guards (`KW-050`, `KW-051`, `KW-056`–`KW-059`, § Lines). It never argues for its reversal. |
| A lost keystore ends the Play listing | **2026-10-04** | Withdrawn as overstated. Play App Signing plus an upload-key reset (`KW-034`). |
| The sentinel runs on a schedule | **2026-09-01 / 2026-10-04** | It never did. It runs only when invoked. |

---

## § RUN LOG

Append-only. One row per run. Never rewrite a past row.

| Date | HEAD | Type | Phases | Headline | New | Reopened | Closed |
|---|---|---|---|---|---|---|---|
| 2026-09-01 | `6a5c443` | SEED | full review | Ledger seeded: 49 findings across 5 tiers, each with a solution or an explicit NEEDS ATTENTION. Three items are existential, and one of them (`KW-002`) is settled by a five-minute test. *(The file was never committed. It was recovered from `stash@{0}^3` on 2026-10-04.)* | KW-001…KW-049 | — | — |
| 2026-09-29 | `b9639c5` | CALENDAR (not a ledger run) | external facts only | Plan step L1: the external-dates calendar, landed as `docs/design-v2/calendar.md`. This ledger was not updated. | — | — | — |
| 2026-10-04 | `e4743af` | FULL | 0–6. Phase 3 partial: Spotify, Groq, the Play organisation rule, Play App Signing, Railway Wait for CI and the AI Act guidelines re-fetched; Apple, Health Connect and the market not refreshed | Since 2026-10-03 an agent merges, and a merge is an unguarded production deploy (no branch protection on a private free repo, deploy before CI, no deny rules). Also: Spotify's 2026-03-09 migration silently broke discovery, and this ledger had been lost in a stash for a month. | KW-050…KW-062 | — | KW-006 |

---

*This file is written by the `sentinel` agent and is not authoritative. The build team has the final word, and must verify every claim against the real tree before acting on it.*
