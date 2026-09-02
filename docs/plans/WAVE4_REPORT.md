# WAVE 4 — RUNTIME INTELLIGENCE: CLOSEOUT REPORT

**For:** Daniel, on returning.
**Written by:** W4-015, session 79, 2026-09-02.
**Scope:** everything the Wave-4 autonomous run did between 2026-08-18T22:56 local and this session.
**Companion files:** `docs/plans/WAVE4_STATE.md` (the live run state — task table, HITL queue, per-session
evidence, discovered backlog), `docs/plans/WAVE4_ARCHIVE.md` (verbatim archived evidence),
`docs/GROUND_TRUTH_2026-09-02.md` (the measured-facts snapshot), `docs/plans/WAVE4_SOAK_2026-09-02.md`
(the raw soak instrument output), `docs/plans/WAVE4_INTELLIGENCE_MISSION.md` (the directive this run executed).

---

## 0. THE ONE THING TO READ

**The wave is done and it is already in `main`.** Every task in the mission's §3 queue — the whole MUST
tier, the whole SHOULD tier and both STRETCH tasks — is `done`, and PR #180 was merged into `main` as
`0e19ad8`. Verified by content rather than by PR status:
`git diff origin/main feat/intelligence-wave -- backend/app/agents/runtime backend/sim backend/app/models`
is **empty**. All twenty confirmed ground-truth defects (D1–D20) are addressed; D19's fix ships dark
behind two flags awaiting one Atlas portal action (H13).

**Nothing is blocked on you today.** Six HITL items are open, none of them urgently. The one worth five
minutes is **H16**, and this report takes its documented default (§8).

---

## 1. FIRST 30 MINUTES BACK

1. **Confirm the merge is what you think it is** (2 min):
   `git fetch origin && git log --oneline -5 origin/main` — `0e19ad8` is "Wave4 W4-007+W4-008" (PR #180),
   which carried every cluster from W4-007 through W4-D78.
2. **Read §8, the HITL decision matrix** (10 min). Six open items, one of them a two-minute chore.
3. **Answer H16 or accept its default** (5 min). "Every taxonomy state hit" cannot be satisfied; §6
   reports measured floors and per-state reasons instead. If you say nothing, that IS the answer, and
   the mission file was deliberately not rewritten to hide the gap.
4. **Decide H13** (5 min): whether the embedding-v2 read cutover happens at all. It ships dark; doing
   nothing costs nothing.
5. **Two minutes of credential hygiene** (H15 / W4-D83): a path-mangled duplicate of your Android
   release `keystore.properties` is untracked and *not* ignored. Nothing has leaked. Fix the glob.
6. **Note that the run's own state files are now in `main`** (~470 KB of `WAVE4_STATE.md` +
   `WAVE4_ARCHIVE.md`). That was H8's open question and your own merge settled it.

---

## 2. WHAT LANDED, PER TASK

Test evidence is the suite figure recorded at that task's close-out. The suite grew from **163 suites /
1767 tests** (W4-000's clean baseline) to **232 suites / 3866 tests**, re-measured this session on a
clean tree (`exit 0`, `475.4 s`, zero `FAIL` lines over the complete 869 KB log).

| Task | Tier | What it closed | Evidence at close-out |
|---|---|---|---|
| **W4-000** Bootstrap, review pass, ADR-0012 | MUST | Fixed a real-connection leak in `worker.test.js` (a unit test opening an ioredis socket against a fake host) so the baseline was deterministic; wrote `docs/adr/0012-learning-compliance.md` and its grep tripwire; resolved all six of the mission's flagged unknowns against the full repo. | 163/1767 green, `d1db088` |
| **W4-001** Surgical bug backlog | MUST | D5, D9, D7, D8, D11 (interim), D4, D14, D3, D17, plus W8/W9 hygiene. Shared HR predicate extracted to `wearable/hrRange.js`. | 164/1802, +34 pins, 3 deliberate re-pins |
| **W4-002** Synthetic-human simulator | MUST | `sim/{rng,personas,generator,replay,soak}.js` — seeded, deterministic personas, artifact injector, both-lane replay against `mongodb-memory-server`. Holdout personas with a different noise family from day one, to avoid circular validation. | 170/2028, +84 pins, **zero re-pins** |
| **W4-003** A0 signal integrity + live persistence | MUST | **D6** (the live lane had *zero* filtering — no EWMA, Kalman, median or artifact rejection) and **D10** (live samples were never persisted, so live data fed no baseline and no history). Hampel → slew gate → irregular-Δt Kalman → per-reading confidence, consumed by every debounce/trigger decision. | +82 core pins, +14 wiring pins |
| **W4-004** Baselines & chronobiology v2 | MUST | **D1** — the personal HRV baseline was never computed, so every user was scored against the population constant `{45, 8}` — plus D2, D13, D14, D15. `VitalSample` with full S5 registration across all five erasure/export surfaces. A cosinor circadian model replaces one binary `hour>=21` step on server-local time. | 179/2357, 136 new pins |
| **W4-005** A3 affect engine core | MUST | Six evidence axes that can each say *I do not know* (explicit `{value, mass}`); Karvonen exertion replacing `(HR−60)/100`; declared-mood fusion over **all** taps rather than the last one; the §M.5 HMM forward pass with four-gate hysteresis. A soft rest gate kills D3 structurally. | 1173-line pure module, 300-round seeded fuzz |
| **W4-006** Taxonomy + regulator + seam | MUST | **D12** — the 9-rule classifier with ~4 structurally unreachable rules becomes a data-driven **34-state / 6-domain** table with enter/exit thresholds, dwell priors, music policy and explain templates. `wellbeingRegulator` adds the iso-principle `meet-then-lower` trajectory. Targets stay a strict superset of the 13 legacy keys. | 67 new pins, **zero re-pins**; reachability is a hard DoD |
| **W4-007** B2 scoring & similarity rebuild | MUST | **D18** — four structural defects (§4). Plus the golden-set harness, the S12 shadow-compare and the S10 latency budget, which caught a real 2.18× regression and forced it back to 1.28–1.35×. | 196/2860 green twice, +110 pins, 3 re-pins |
| **W4-008** B4 trajectory planner | MUST | Playlists finally have an **arc**: 7 archetype curves solved by dominant-axis rank-match (beam-8 when flat) then ≤3 swap sweeps. Order-only invariant pinned — same set in, same set out. | landed in one session, both halves |
| **W4-016** LLM band from the real state source | MUST | Added by you mid-run, outside the original queue. The LLM that *generates the candidate pool* never saw personal baselines or taxonomy state, because both of `biometricBand`'s callers fell through to the hardcoded 90/120 ladder. | `docs/plans/WAVE4_TASK_W4-016.md` |
| **W4-009** Live analysis + state-triggered recalibration | SHOULD | **D11's full fix**: recalibration fires on confirmed taxonomy-state transitions whose band or music policy differs, not on ±10/±25 bpm deltas measured against band-keyed buffers. Redis-down degrades to W4-001 behaviour. | plus the W4-D34/D41 serve-latch repairs |
| **W4-010** B1 taste profile v2 | SHOULD | Recency decay (`affinity·e^(−Δdays/90d)`) — affinity had been frozen at build time, so a genre abandoned two years ago outranked this month's obsession until the next full rebuild. Log-saturated provider weights kill the 2000-item-playlist dominance. One ranking algorithm instead of two. | one commit, `f10305a` |
| **W4-011** B6 feedback loop + RewardEvent | SHOULD | Two-track learning per ADR-0012: state-space bucket aggregates for everyone, CC0 `mbid:`-only Beta posteriors behind a fail-closed schema validator. **A sign defect in §M.12 itself was found and corrected** during implementation rather than copied. | split across two sessions |
| **W4-012** A6 daily analysis + MorningState | SHOULD | Nightly consolidation with §M.13 CUSUM over a **frozen** reference window — a rolling reference drifts along with an emerging shift and erases its own signal. | plus H12's index tutorial |
| **W4-013** B5+B7 bandit + PersonalWeights | STRETCH | Thompson novelty per context bucket and a bounded trust-region weight overlay, both dormant by construction: with no reward data, selection is byte-identical to before. | dormancy invariant pinned |
| **W4-014** B3 embedding v2 dual-write | STRETCH | **D19**. Separately normalised audio (7-dim) and IDF-weighted genre (128-dim) blocks, so tag count can no longer crush the audio dims. Ships **dark** — `EMBEDDING_V2_WRITE`/`_READ` both unset, v1 path byte-identical. | ADR-0014; cutover is H13 |
| **W4-015** Soak, closeout & package | MUST | This report, `docs/GROUND_TRUTH_2026-09-02.md`, the `KOKONADA_ARCHITECTURE_MASTER.md` §0 refresh, both gated soak lanes (§6), the HITL matrix (§8) and the on-device checklist (§10). | this session |

Beyond the queue, **38 discovered-backlog rows** were found and closed by the 15 reflection passes —
including seven `class: repair` rows that jumped ahead of committed scope, three CI jobs that had been
red for days, and four encryption-binding defects (W4-D74/D75/D76: unbound AAD on `User`, unbound
encrypted leaves under a whole-array `$set`, and plaintext written by an aggregation-pipeline update).

---

## 3. WHAT DID **NOT** LAND, AND WHY

| Not done | Why | Where it lives now |
|---|---|---|
| Embedding v2 **read cutover** | Atlas `numDimensions` is immutable per index, so v2 needs a second index — a portal action an agent must never perform. It also needs a `DISCOVERY_MIN_COSINE` retune, because v1's all-positive geometry made the 0.3 floor nearly inert and v2's centred geometry makes it bite. | **H13** |
| **Every taxonomy state reachable in the soak** (W4-015 DoD 1) | Measured, not guessed. The serving lane reaches 21/34 with **zero** structural blind spots — every miss is a contest a neighbouring state wins. The live lane reaches 13/34 with **7** structural blind spots, because no mood tap, sleep, HRV, body-battery or readiness signal crosses the socket seam. More simulated time changes neither number. | **H16**, and W4-D69 / W4-D70 |
| **Mobile anything** | Backend-only by the mission's own §0.3. `tzOffsetMinutes`, `playback_event` and Pulse/MorningState rendering all need a client that does not emit or render them yet. | §10, and W4-D50 |
| **Consent v2 metrics** | §0.2.3 forbids widening collection this wave. Respiration, SpO₂, body battery, stress level and steps are built and **dormant**. | `WAVE4_CONSENT_V2_METRICS` |
| **Taxonomy display vocabulary** | State ids are internal vocabulary — encrypted at rest, never in prompts or logs. Any user-facing wording needs compliance review before it reaches a screen. | **H6** |
| **46 open `improve` rows** | The mission's own precedence rule: committed §3 scope ships before discovered `improve`/`extend` work. **No `repair`-class row is open.** Exactly one is MUST-tier: W4-D83, the keystore glob. | STATE §Discovered backlog |
| **The full Borbély two-process sleep model** | Deliberately cut; a single-process sleep-debt accumulator (§M.6) shipped instead and the cut formula is pinned in ADR-0013. | ADR-0013 |
| **Mid-session playlist replanning** | Needs a client signal that does not exist. | **H10** (on-device) |

---

## 4. DELIBERATE BEHAVIOUR CHANGES (before → after)

Everything here is a change a listener could notice. Every one has an env kill-switch (§7).

1. **Stress no longer forces cheerful music (D4).** Before: `valenceTarget = max(moodValence, 0.6)` — the
   more distressed the reading, the more forcibly cheerful the music, which is precisely the mirror
   behaviour VISION §6 forbids. After: `clamp01(moodValence + min(0.1, 0.15·S))`, a bounded comfort bias,
   with regulation done *structurally* by the `meet-then-lower` trajectory instead of by overriding the
   felt state.
2. **A workout is no longer read as maximal stress (D3).** Before: `restingElevation` fired on
   `activity === 'unknown'`, which every batch row was, so a workout produced z ≈ 14 → S = 1.0 → a
   narrow, acoustic, instrumental, forced-cheerful target. After: it is computed only for genuinely
   resting readings, and the affect engine's soft rest gate makes that structural rather than a rule.
3. **Scoring totals are normalised (D18).** Before: mood weights summed to 0.95 and intent weights to
   1.20, so the same `total` meant different things in the two modes and the flat 0.40 exposure penalty
   bit ~26 % harder under intent purely as an arithmetic artefact. After: Σw = 1 per mode; a track that
   maxes every term scores exactly 1.0 in both.
4. **Band width finally affects fit.** Before: the energy kernel used the band midpoint only, so a track
   at 0.75 energy scored identically against a 0.1–0.9 band and a 0.45–0.55 one — band width had
   literally no say. After: σ_energy is the band half-width, so a track at the band edge lands at
   exp(−½) in *any* band.
5. **One measured dimension can no longer score 1.0.** Before: the fit averaged over whichever dims
   happened to be present, so a track with nothing but a dead-on tempo claimed a perfect fit and
   outranked a fully measured track that was merely very good. After: every dim the target constrains
   has a place in the mean, and confidence enters as a mass mixture `k_eff = m·k + (1−m)·0.5`, so low
   confidence pulls toward *no opinion* in both directions rather than acting as a one-way discount.
6. **`Number(null) === 0` — three separate live instances, all fixed.** The un-relaxable band read a
   missing tempo as 0 bpm, so a track with energy measured and tempo *not* measured was hard-dropped
   while a track with no features at all passed: knowing more about a track got it excluded. The golden
   harness then found a third instance on the *target* side — an unconstrained request read as a target
   of 0 bpm and a [0, 0] energy window, so v1 kept 38 of 240 tracks and served exclusively the tracks it
   knew nothing about.
7. **Similarity judges all five dims.** Before: `_featureSim` ignored acousticness and danceability
   entirely, so a solo acoustic ballad and a club edit at the same tempo and energy came back identical
   and MMR dropped one as a duplicate.
8. **Half/double time folds (§M.10).** 87 and 174 bpm are the same groove — except against a step
   cadence, where footfall has no octave. `translate` publishes `cadenceLocked` as an additive key for
   exactly walking, running and cycling.
9. **Playlists have an arc.** Track order is planned against an archetype curve rather than left as
   score order.
10. **Taste decays.** Affinity decays with a ~90-day time constant at read time.
11. **Recalibration triggers on state, not on bpm deltas (D11).**
12. **Live readings are filtered and persisted**, so the live lane finally feeds baselines and history.

**Re-pins.** Twelve deliberate re-pins across the wave, each argued in its PR section and in STATE's task
row. The three worth naming: `featureProvider` now projects provenance keys; `selectionUnits`'s
"featureless tracks pay the unknown penalty" had its body strengthened to assert the demotion it names
rather than passing on a diagnostic field; and `shadow.fullSystem`'s exhaustive zero-knowledge allow-list
gained `cadenceLocked` — which is that pin doing its job, since it forced the new key to be argued
against the zero-knowledge boundary instead of appearing unexamined.

---

## 5. GOLDEN-SET DIFFS

`backend/tests/score.v2.golden.test.js` with a committed `backend/tests/golden/score.v2.golden.json`:
five literal-target personas (calm-recovery, stress-downshift, run-cadence, evening-unwind,
manual-no-signal-fresh) over one seeded 240-track corpus with eight feature classes — fully measured at
each provenance tier, present-but-null dims, single-dim tracks, and featureless. Both scorings run end to
end through the real pipeline, so the file records what a listener would actually have received.
Re-baseline is `GOLDEN_UPDATE=1` and ships the file diff in the PR body — a committed JSON rather than a
jest snapshot precisely because `-u` is one keystroke.

What the harness measured, v1 → v2:

| Measurement | v1 | v2 | Reading |
|---|---|---|---|
| calm-recovery slots given to single-dim (tempo-only) tracks | 9 of 20 | 4 of 20 | the fabricated perfect fit, in playlist terms |
| null-tempo tracks picked across the four constrained personas | **0** | 10 | the band fix seen from the listener's side |
| under a phantom (unconstrained) target | pool 38 of 240; 7 of 20 picks null-tempo | pool 240 of 240; normal mix | v1 served only what it knew nothing about |
| mean feature mass (calm / run / stress / unwind) | 0.510 / 0.491 / 0.629 / 0.664 | 0.536 / 0.577 / 0.600 / 0.646 | **moves both ways — deliberately not asserted directionally** |

That last row is the honest one. "v2 lands more of its fit on measurement" is *false* as a law, because
v2's pool contains the partially-measured tracks v1 hard-dropped, so the two means are not like-for-like.
The number is committed (visible on change) but not asserted; the class counts are the honest instrument
and those *are* asserted.

**Latency.** The S10 budget did its job on its first run: v2 measured 620 ms min on a 500-track pool,
breaking the 600 ms ceiling at 2.18× v1. Root-caused by stage timings rather than guessed — MMR 558 ms
against v1's 287 ms, from `Math.log2` recomputed twice per pair at ~250 k pairs. After hoisting the fold
into `selection/tempo.js` and memoising the derived vector: MMR 385 ms, total 394–400 ms, **1.28–1.35×**,
inside both the 600 ms ceiling and the 1.6× ratio budget. The hoist was verified behaviour-preserving by
checking the pre-hoist files back out and re-running them against the post-hoist golden file — pick lists
included, not just aggregates.

---

## 6. SOAK RESULTS

Both lanes run under `RUN_SOAK=1`, which widens their scope from the strided default to the full
population. Raw instrument output is saved verbatim in `docs/plans/WAVE4_SOAK_2026-09-02.md`.

### 6.1 Full-stack soak — `tests/sim.fullStackSoak.test.js`, 38.0 s, 6/6 green

Seven personas (five core + two holdouts with a different noise family), one simulated day each, driven
through the **real** socket ingest stack, the real anomaly filter, the real affect engine and the real
batch lane against `mongodb-memory-server`. 288 generated samples per persona; 283–289 socket events
delivered after artifact injection.

| Persona | Readings that resolved a state | Label transitions | Batch rows landed | Dwell histogram |
|---|---|---|---|---|
| athlete | 287 | 11 | 286 | light-focus 135, resting-content 86, evening-unwind 39, meditative 17, steady-cardio 9, casual-walk 1 |
| sedentary | 282 | 8 | 285 | neutral-baseline 180, evening-unwind 54, light-focus 41, restless-distracted 3, morning-activation 3, commute-active 1 |
| olderAdult | 285 | 6 | 285 | neutral-baseline 122, light-focus 79, evening-unwind 56, morning-activation 28 |
| shiftWorker | 286 | 5 | 287 | light-focus 205, evening-unwind 37, neutral-baseline 27, restless-distracted 13, casual-walk 4 |
| stressedProfessional | 285 | 16 | 287 | light-focus 93, morning-activation 92, evening-unwind 70, restless-distracted 27, post-exertion-recovery 3 |
| holdoutHeavyTail | 289 | 8 | 287 | light-focus 170, evening-unwind 75, morning-activation 23, resting-content 15, steady-cardio 6 |
| holdoutErratic | 286 | 6 | 287 | neutral-baseline 112, restless-distracted 103, morning-activation 60, evening-unwind 11 |

**Reading it.** The histograms are plausible *and different per persona*, which is the point: the athlete
is the only one to reach `steady-cardio` and `meditative`; the sedentary and erratic personas spend most
of the day in `neutral-baseline`; the stressed professional has by far the most transitions (16) and the
most fragmented day. **No label flap:** transitions are 5–16 against 282–289 resolved readings, i.e. two
to six orders of magnitude below the per-reading rate — the hysteresis is holding. **Recalibrations
bounded** follows from the same figure, since a recalibration can only follow a confirmed transition.
**Memory:** the run's heap delta is asserted under a pinned 300 MB ceiling and passed; the soak report is
O(personas) by construction (it summarises, it never accumulates), so "no unbounded growth" is a property
of the harness rather than a hope. **11 distinct taxonomy states** were reached across the population in
a single simulated day.

### 6.2 State-coverage soak — `tests/sim.stateCoverage.soak.test.js`, 25.1 s, 10/10 green

The second lane answers W4-015's DoD 1 directly: it drives all 34 authored taxonomy moments through **two
real production seams** and reports, for every state it fails to reach, the *measured* reason.

| Lane | Seam | Reached | Coverage | Structural blind spots |
|---|---|---|---|---|
| **serving** | `buildTargets` | **21 / 34** | 0.618 | **0** |
| **live** | `liveStateAdapter.onlineUpdate` | **13 / 34** | 0.382 | **7** |

Both numbers are pinned as **floors**: a retune that reaches more must not go red, a regression that
reaches fewer must.

**The serving lane has no blind spot at all.** All 13 misses report `reason=outcompeted` with
`absent=none` — the lane sees every axis those states require and a neighbouring state simply wins the
posterior. Concretely: `acute-stress`, `afternoon-dip`, `drowsy-low-battery`, `mental-fatigue` and
`morning-sluggish` all lose to `night-owl-alert`; `casual-walk`, `morning-activation`,
`post-exertion-recovery` and `restless-distracted` lose to `cooldown`; `commute-active` and
`overload-needs-downshift` lose to `anxious-restless`; `obligated-workout-low-recovery` loses to
`intervals`; `neutral-baseline` loses to `meditative`. **That is a geometry question, not a data
question** — more simulated days cannot move it, which is why W4-D69 exists.

**The live lane's 7 blind spots are structural and no simulation can reach them.** Four
(`creative-flow`, `energized-positive`, `low-mood-low-energy`, `tense-but-positive`) abstain on
`valence`, because **no mood tap crosses the socket seam**. Three (`drowsy-low-battery`,
`obligated-workout-low-recovery`, `overload-needs-downshift`) abstain on `recovery` (and, for the last,
`stress` as well), because no sleep, HRV, body-battery or readiness signal crosses it either. Both need a
client change, not a backend one — W4-D70 and the §10 checklist.

### 6.3 Consequence for DoD 1 — stated, not hidden

The mission's §3 asks the soak to demonstrate "every taxonomy state hit". **It cannot, and this report
does not pretend otherwise.** Per H16's own stated default, the DoD line in the mission file was **not**
rewritten; the measured floors and the per-state reasons above are the deliverable instead. If you want
the 34 states reached this wave, H16 option (1) — promote W4-D69, roughly one session — is the only
route for the serving lane, and even then the live lane's four `valence` states wait on a mobile client.

---

## 7. COMPLIANCE & DATA PROTECTION

- **ADR-0011 / ADR-0012 (learning compliance).** Two-track learning: state-space bucket aggregates
  (`stateDomain × targetBand × hourBin`, never track identity) for everyone; track-level Beta posteriors
  **only** for CC0 `mbid:` keys, enforced by a schema-level validator that rejects any other key shape and
  by `backend/tests/adr0012.tripwire.test.js`. ReccoBeats features of Spotify tracks stay serve-time-only
  and are never persisted into a learned artefact. Re-verified by R3 on every reflection pass.
- **Zero-knowledge biometrics.** No numeric vital appears in any new log line, DTO, LLM prompt, job
  summary or Redis key introduced this wave. `shadow.fullSystem`'s exhaustive allow-list on `translate()`
  output is an exact-key assertion and went red the one time an additive key appeared — the guard
  working. One pre-existing leak was found and fixed on the way (W4-D10: an unconditional stdout write of
  median resting HR, HRV, respiration, SpO₂ and sleep-stage minutes on every successful batch).
- **GDPR Art. 9 scope.** Collection was **not** widened. Every dormant metric sits behind
  `WAVE4_CONSENT_V2_METRICS` and is off.
- **S5 erasure completeness.** All four new collections (`VitalSample`, `RewardEvent`, `MorningState`,
  `PersonalWeights`) and the new Redis key families were registered in the account-erasure cascade,
  `userRedisPurge`, wearable-scoped erasure and `userDataExport` **in the same PR that introduced them**,
  and the completeness guard was extended to discover models mechanically off the models directory rather
  than from a hand-maintained list.
- **Encryption.** Three binding defects were found and closed by reflections (W4-D74/D75/D76): unbound
  AAD on `User` (whose owner id is `_id`, not `userId`), unbound encrypted leaves under a whole-array
  `$set`, and plaintext written into every encrypted field by an aggregation-pipeline update.
- **Attribution.** `git log 44fd951..HEAD` over all 336 wave commits: the only match is the *filename*
  `docs/CLAUDE_DESIGN_PROMPT.md` inside a commit subject, which is a path, not attribution. W4-D78 landed
  a mechanical guard (`tests/wave4.attributionGuard.test.js`) so the standing order is no longer enforced
  by memory alone.
- **Secret scan.** `git diff 44fd951..HEAD` against the mission's pattern: 29 matches, **every one** of
  them the substring `sk-` inside an ordinary word (`risk-register`, `task-`). No credential material.

**Kill switches** — every one defaults *unset* (new behaviour on); setting it to any ON spelling restores
the prior behaviour with no revert and no deploy:
`WAVE4_AFFECT_DISABLED`, `WAVE4_AFFINITY_DECAY_DISABLED`, `WAVE4_ANOMALY_FILTER_DISABLED`,
`WAVE4_BASELINE_ABSTENTION_DISABLED`, `WAVE4_BASELINE_ENGINE_DISABLED`, `WAVE4_FEEDBACK_DISABLED`,
`WAVE4_GENRE_FAMILIES_DISABLED`, `WAVE4_LLM_BAND_FROM_STATE_DISABLED`, `WAVE4_PULSE_SUPERSET_DISABLED`,
`WAVE4_RECAL_STATE_TRIGGER_DISABLED`, `WAVE4_SCORING_V2_DISABLED`, `WAVE4_SERVE_LATCH_DISABLED`,
`WAVE4_TRAJECTORY_DISABLED`.
Opt-**in** flags, all currently off: `WAVE4_NOVELTY_BANDIT`, `WAVE4_PERSONAL_WEIGHTS`,
`WAVE4_CONSENT_V2_METRICS`, `SCORING_V2_SHADOW`, `EMBEDDING_V2_WRITE`, `EMBEDDING_V2_READ`,
`EMBEDDING_V2_BACKFILL`.
Spelling is parsed by exactly one function (`backend/app/utils/envFlag.js`) and pinned by
`tests/wave4.killSwitchSpelling.test.js`. You audited Railway's Variables on 2026-08-23 and no `WAVE4_`
variable is set at all (H14), so every one of these is at its default in production.

> `WAVE4_SCORING_V2_DISABLED` is an **emergency lever, not a supported mode** — it demonstrably restores
> three known defects together (phantom target, fabricated perfect fit, band drops partially-measured
> tracks).

---

## 8. HITL DECISION MATRIX

### Open — wants your decision

| id | What | Cost to you | If you do nothing |
|---|---|---|---|
| **H16** | W4-015 DoD 1 ("every taxonomy state hit") is measurably unreachable. Options: (1) promote W4-D69 so the serving lane reaches 34/34 (~1 session); (2) amend the DoD to cite measured floors and per-state reasons; (3) both, in that order. | 5 min | **This report takes option (2)** — §6 records the floors and the reasons and the mission file was *not* rewritten. Stating the gap is the deliverable. |
| **H13** | The v2 Atlas vector index (`track_embedding_index_v2` on `vectorV2`, 135 dims, cosine) **and** the `DISCOVERY_MIN_COSINE` retune that must ride with it. Flipping `EMBEDDING_V2_READ` without retuning the floor silently changes what discovery admits — the PR #135 starvation failure mode from the other direction. | 15 min portal + a measured sweep | Nothing. Both flags are unset and the v1 path is byte-identical. The instrument for the retune already exists: `backend/app/scripts/measureDiscoveryComposition.js` (read-only). |
| **H6** | The user-facing vocabulary for the 34 taxonomy states needs compliance review before any of it reaches a screen. | a review cycle | Nothing today — no state id is surfaced to a user anywhere. |
| **H8** | (1) Should ~470 KB of run-state docs live in `main`'s permanent history? **Settled by your own merge — they are in `main` now.** (2) Is a process-name mention (`claude.exe`, in `scripts/wave4-doctor.ps1`, whose entire job is counting concurrent sessions) acceptable under the attribution policy's intent? | 2 min for (2) | (2) stays a judgement every session re-derives. Note that `scripts/update-h13-diagnosis.ps1` (untracked) still contains an old credit string and its idempotence guard now misses, so **re-running it re-inserts the attribution**. |
| **H9** | *Optional*: re-embed the corpus to repair pre-W4-D21 vectors. Degrades variety, not correctness. | a backfill run | Nothing breaks; discovery stays slightly less varied. |
| **H1** | The scheduled "Secret scan (full history)" workflow has failed on `main` since at least 2026-07-27. Unrelated to this wave; logged so it does not drift out of view. | unknown | It stays red. |

### Open — a two-minute chore

| id | What | Steps |
|---|---|---|
| **H15** / **W4-D83** | `mobile/KokonadaHealth/android/mobile__KokonadaHealth__android__keystore.properties` is a path-flattened duplicate of your real keystore file. It is **untracked and not ignored** (`mobile/KokonadaHealth/.gitignore:38` matches the basename, which a flattened basename walks straight past), so `git add -A` in this repo would stage your Android release signing passwords. **Nothing has leaked** — it is uncommitted, unpushed, and `git log --all` has never carried it. No agent deleted it: it is your credential file. | (1) `diff` it against `mobile/KokonadaHealth/android/keystore.properties`; (2) if identical, delete the mangled copy; (3) add `**/*keystore.properties` to the **root** `.gitignore` beside the existing `**/debug.keystore` line — a suffix glob catches any prefix a tool invents; (4) `git status --porcelain` and confirm the `??` line is gone. |

### Resolved during the run — no action

| id | What | Outcome |
|---|---|---|
| H2, H5, H7, H11, H12(halt), H17 | Concurrent sessions on one working tree, and four separate mid-session halts caused by an **empty** `docs/plans/WAVE4_HALT`. | All cleared; the file was absent at this session's preflight. See §11 — the recurrence is the run's single most expensive operational pattern. |
| H3 | Ten stranded `worker.test.js` node processes on the box. | Cleared 2026-08-19. |
| H4 | Atlas index build for `vitalsamples`. | **You built it** via the Atlas UI, 2026-08-20. |
| H10(portal) | The CI token lost its PR-read permission and gitleaks had not run since 13:41. | Repaired in-repo (W4-D37). |
| H12(index) | Atlas index build for `morningstates`. | **You built it** via the Atlas UI, 2026-08-23. |
| H14 | Env audit for a kill-switch spelled `=false`. | **You audited Railway Variables**, 2026-08-23: no `WAVE4_` variable is set at all. |

---

## 9. PR QUEUE

| PR | Clusters | Status |
|---|---|---|
| [#179](https://github.com/DanielMalede/Kokonada/pull/179) | W4-000 → W4-006 pure core | **MERGED** by you 2026-08-20 as `44fd951`, 10/10 checks green |
| [#180](https://github.com/DanielMalede/Kokonada/pull/180) | W4-007 → W4-D78 (everything after #179) | **MERGED** as `0e19ad8`. Verified by content: the wave's `agents/runtime`, `sim` and new models are byte-identical between `origin/main` and the branch |
| — | **W4-015 (this closeout)** | Not yet published — see below |

Per §1 the run used **one running PR per branch**, updated per cluster, rather than a PR per cluster off a
single branch. Nothing was ever merged by an agent; both merges were your click.

> **Why this closeout is not on a PR yet.** `feat/intelligence-wave` has been reused by a different,
> concurrent workstream: locally it carries **12 design commits** that are not Wave-4 work, and
> `origin/feat/intelligence-wave` carries **2** the local branch lacks, so `git push` would be rejected
> as non-fast-forward and any resolution would publish another session's in-flight work. The mission's
> own §0.3 and risk-register R8 say exactly this: on divergence, record it and hand it over — never
> auto-rebase mid-task. The closeout commits are safe on the local `feat/intelligence-wave` ref.
>
> **To publish** (docs only — all Wave-4 *code* is already in `main`):
> ```
> git fetch origin
> git switch -c wave4/closeout origin/main
> git checkout feat/intelligence-wave -- docs/plans/WAVE4_REPORT.md docs/plans/WAVE4_STATE.md \
>     docs/plans/WAVE4_SOAK_2026-09-02.md docs/GROUND_TRUTH_2026-09-02.md KOKONADA_ARCHITECTURE_MASTER.md
> git commit -m "wave4: closeout report, ground truth and architecture refresh"
> git push -u origin wave4/closeout && gh pr create --fill
> ```
>
> **Four cluster sections were never written into a PR body** (W4-D75, W4-D76, W4-D72, and W4-D84's own
> row) — tracked as W4-D84. Since #180 is merged they are now historical record rather than review
> material; their full evidence is in STATE's backlog rows.

---

## 10. ON-DEVICE VERIFICATION CHECKLIST (yours to run by hand)

None of this could be verified by an agent — the wave was backend-only and the client does not emit
several of these signals yet.

1. **Real watch data through the new live lane.** Wear the device, connect, and confirm `BiometricLog`
   rows appear with a real `activity` and `source` (not `unknown`), throttled to ≤1/min per socket. This
   is D2 and D10 together, and it is the single highest-value check on this list.
2. **`tzOffsetMinutes` emission.** The socket and batch ingest both *accept* it (additive, optional) and
   fall back to server hour. Until mobile sends it, every circadian and hour-bin term is keyed to the
   server's clock. Confirm the field arrives, then confirm the hour-bin baseline moves with your timezone.
3. **`playback_event` emission** (`skip` / `complete` / `save`, with `positionMs`). The backend handler,
   schema, rate limit and reward path all exist; the client only forwards `track_skipped` today, so the
   learning loop sees one of four event types and the novelty bandit cannot learn at all (W4-D50).
4. **Pulse / MorningState surfacing.** `/api/pulse/state` is now a superset carrying MorningState and
   coarse affect (domain, band, readiness bucket, confidence — never a numeric vital). Nothing renders it.
5. **A mood tap that crosses the socket seam.** This is what unblocks four of the live lane's seven
   structural blind spots (§6.2, W4-D70).
6. **APK smoke** after any of the above.
7. **Watch for a forced-cheerful regression.** If music ever feels like it is arguing with you under
   stress, that is D4, and `WAVE4_SCORING_V2_DISABLED` / `WAVE4_TRAJECTORY_DISABLED` are the levers — but
   report it rather than leaving a flag on, because the flags restore known defects.

---

## 11. HOW THE RUN ITSELF WENT

79 sessions over 15 days. 336 commits on top of `44fd951`. **15 reflection passes**, which found and
closed 38 backlog rows — seven of them `class: repair` defects in work that had already reported success,
which is exactly what §2.5's R2 exists for. **Error budget: 0 consecutive failed sessions; no task ever
hit the rule-of-2.**

The single most expensive operational pattern was not technical: **four separate mid-session halts caused
by an empty `docs/plans/WAVE4_HALT` file**, each costing a session, each correlated with a second `claude`
process starting on the same working tree. Nothing in the Wave-4 code path writes that file. If you want
one durable fix, it is the one H5 named: have `run-mission.ps1` refuse to launch while another session's
process is alive, and have anything that writes a halt file write a *reason* into it — an empty halt is
indistinguishable from an accident, and this run could not tell the two apart four times.

This session hit the same class of problem in a new form and routed around it rather than through it. The
shared working tree was checked out on an unrelated branch (`feat/be-015-withdrawal-learning-erasure`)
with 11 live `claude` processes and a concurrent session's uncommitted work in it, so W4-015 ran in an
isolated git worktree instead of switching the tree's branch out from under someone. That is also why the
suite figure here is 232/3866 rather than STATE's 232/3868: the two-test difference is exactly the
concurrent session's uncommitted `measureDiscoveryComposition.test.js` additions, which a clean checkout
does not carry.
