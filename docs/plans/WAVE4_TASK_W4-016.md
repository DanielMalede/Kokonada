# W4-016 · Route the LLM candidate-generation band through the real state source — M · MUST · deps: 004 (eligible NOW; auto-improves when 006 lands)

> Added by Daniel's direction 2026-08-19, outside the original §3 queue. Not a reflection discovery —
> a scope addition the run owner asked for after reviewing the LLM path end to end.
> This file is the full spec; STATE's task table carries the one-line row.

## The defect (verified against source, not inferred)

The LLM is what **generates the candidate pool** — `geminiEngine` turns the user's typed prompt, the
music profile and the physiological context into search parameters, and everything downstream
(`discoveryFetch` → `candidatePool` → `score` → `mmr` → the W4-008 trajectory planner) can only ever
choose from the tracks that call found. Its inputs therefore bound the quality of the entire wave.

Two call sites feed that path a band computed from **hardcoded population thresholds**, bypassing
every personalization this wave built:

1. `backend/app/services/geminiEngine.js:235` — `_buildBiometricPrompt` calls
   `bandFromHeartRate(heartRate)` **directly**. That function (`moodDescriptors.js:214-220`) is a
   fixed ladder: `<90 → resting`, `<120 → active`, `else peak`. The band string is the ONLY
   physiological fact in the prompt, so it single-handedly determines what the LLM searches for.
2. `backend/app/services/geminiEngine.js:326` — `adjustBiometricPlaylist` calls
   `applyBiometricBands(rawParams, { heartRate: biometric.heartRate })`. The context object carries
   **only** `heartRate`, so `biometricBand(ctx)` (`moodDescriptors.js:278-288`) finds no `stateLabel`
   and no `hrRatio` and falls through to the same fixed ladder.

`biometricBand` already implements the correct preference chain — `ctx.stateLabel` → `ctx.hrRatio`
→ `bandFromHeartRate(ctx.heartRate)`. Nothing is missing from it. The defect is purely that these
two call sites never populate the richer fields, so the good chain always degrades to its last resort.

**Consequence after the whole wave lands:** an athlete with RHR ~48 and a sedentary user with RHR ~72
receive the identical band at the identical raw HR, and the ~32-state taxonomy (W4-006), the personal
Karvonen zones and hour-of-day baselines (W4-004, `MedicalProfile.hrZones`/`maxHeartRate`, already
written) never reach the one component that decides which songs exist as options at all. The
sophisticated scoring built in W4-007 then ranks a pool that was retrieved for the wrong intensity.
Garbage in, ranked beautifully.

Note the contrast that proves the gap is specific and not systemic: `buildEmotionPlaylist`
(`geminiEngine.js:299`) DOES pass the full `biometricContext` into `applyBiometricBands`, so the
emotion/text-prompt lane's post-processing already benefits from `stateLabel` when one is present.
Only the prompt itself and the biometric lane are stranded.

## Scope

Populate the context these two call sites pass, from the sources this wave already built, and let
`biometricBand`'s existing preference chain do its job. Do NOT rewrite `biometricBand`, do NOT change
the band vocabulary (`resting|active|peak`), and do NOT widen what crosses the LLM boundary.

- `_buildBiometricPrompt` takes a context (or the already-resolved band) instead of deriving one from
  raw HR, and uses `biometricBand(ctx)` with `|| 'active'` preserved as the final fallback.
- `adjustBiometricPlaylist` builds a real context — `stateLabel` (from the affect/state source, when
  available), `hrRatio` (HR relative to the user's personal resting baseline, from the W4-004 superset
  blob), `heartRate` last — and passes it to BOTH `_buildBiometricPrompt` and `applyBiometricBands`,
  so the prompt and the post-LLM mapping can never disagree about which band the session is in.
- Every new field is best-effort: a missing baseline, a Redis miss or a cold-start user degrades to
  exactly today's behaviour, never to an error and never to a fabricated ratio.

## Hard compliance boundary (§0.2.2 — do not weaken)

The prompt today carries the **band string only** — no numeric HR, no resting HR, no ratio — and the
file's own Wave-0 egress note at `geminiEngine.js:226-229` says so explicitly. That property is
load-bearing and this task must preserve it exactly: `hrRatio` and `stateLabel` are inputs to the
server-side band computation and **must never be interpolated into prompt text**. Taxonomy state
labels are internal vocabulary (mission §3 W4-006: "never in prompts/logs") — they resolve to a band
server-side and the label itself stays out of the prompt. A shadow test pins this.

## Definition of Done

- Failing test first, per the TDD iron law.
- Both call sites resolve their band through `biometricBand` with a populated context; neither calls
  `bandFromHeartRate` directly any more.
- Pins, all required:
  - two users with the SAME raw HR but different personal baselines resolve to DIFFERENT bands
    (this is the whole point of the task, and it fails today);
  - a present `stateLabel` wins over `hrRatio`, which wins over raw HR (the documented chain);
  - cold start / no baseline / Redis miss ⇒ byte-identical to today's output (dormancy invariant,
    R17 pattern);
  - the prompt string contains no digits originating from vitals and no taxonomy label — assert
    against the built prompt, not against a mock (zero-knowledge shadow test);
  - the prompt band and the `applyBiometricBands` band agree for the same session.
- Kill-switch per §0.4 S11: `WAVE4_LLM_BAND_FROM_STATE_DISABLED=true` restores the current
  `bandFromHeartRate` behaviour byte-for-byte, without a revert.
- Full backend suite green and ≥ the recorded `testBaseline`, run twice; lint clean; secret scan of
  the diff; no attribution anywhere; STATE updated with evidence (suite counts before/after, new pin
  count, any deliberate re-pins listed individually with justification).

## Sequencing note

Eligible as soon as W4-004 is `done` (it is) — `hrRatio` against the personal resting baseline
already delivers most of the value and is the half that makes two different bodies score differently.
When W4-006 lands, `stateLabel` starts populating and the SAME code path automatically improves with
no further change, because `biometricBand` already prefers it. If this task runs before W4-006, leave
the `stateLabel` branch wired and unit-tested against a supplied label even though production has not
started emitting one yet, and say so in the STATE evidence — that is a dormant lane, not dead code.

## Why it earns a MUST slot

It is the difference between the wave's intelligence reaching the product and stopping one layer
short. Every other MUST task improves how well the system *chooses*; this one is the only task that
improves what the system has to choose *from*. It is also cheap — the correct routing function
already exists and is already tested; this task supplies its inputs.
