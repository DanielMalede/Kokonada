# ADR 0013 — The affect state model: four layers, and what each one is allowed to claim

- **Status:** Accepted
- **Date:** 2026-08-19 (Wave 4 — Runtime Intelligence, W4-005)
- **Extends:** [ADR 0005](0005-zero-knowledge-biometrics.md) (zero-knowledge biometrics)
- **Implements:** `docs/plans/WAVE4_INTELLIGENCE_MISSION.md` §M.5, §M.6, §M.8; kills D1, D3, D14

## Context

Until Wave 4 the app answered "what is this person's state?" with three scalars computed inside
`translate()` — recovery, stress, exertion — from population constants, an unweighted mean, and a
handful of thresholds. It shipped, and it was wrong in ways that were measured, not suspected:

- A 165 bpm run scored **maximal stress** (D3), because any reading that could not be *proven* to
  be exercise fed a "resting elevation" term. W4-001 bought time with a flat `heartRate < 110`
  ceiling, which is a brisk walk for an athlete with a resting rate of 48 and genuine zone-3 work
  for an older adult with a maximum of 155.
- Every user was scored against `{hrvMedian: 45, hrvMAD: 8}` (D1) — a constant, for a quantity
  that varies between healthy adults by a factor of four.
- "Winding down" was `hour >= 21`, which is simply false for a night-shift worker.
- Nothing could say *I don't know*. Absent inputs produced the same confident-looking numbers as
  present ones.

W4-003 and W4-004 supplied the missing raw material: filtered readings with per-reading
confidence, and real per-person baselines (RHR, HRV, a 24-bin hour-of-day table, a cosinor fit,
Karvonen zones). W4-005 is the model that consumes them.

## Decision

A **four-layer stack**, each layer with a strictly bounded claim.

### Layer 1 — Evidence axes (`affectEngine.computeAxes`)

Six axes, each a pair `{ value, mass }` rather than a number:

| Axis | What it measures | Against what |
| :-- | :-- | :-- |
| `arousal` | activation | the user's own hour-of-day HR bin |
| `stress` | HRV suppression + resting elevation | the user's own HRV median/MAD and hour bin |
| `recovery` | sleep, HRV, battery, readiness | explicit weights summing to 1 |
| `exertion` | §M.8 Karvonen `(HR−RHR)/(HRmax−RHR)` | the user's own zones |
| `fatigue` | §M.6 sleep debt + multi-day HRV downtrend | the user's own chronic baseline |
| `circadianAlertness` | §M.3 cosinor phase − debt penalty | the user's own acrophase |

`mass` is the fraction of the answer that is DATA rather than prior, `evidence/(evidence + 0.35)`.
It is the mechanism by which an axis says **"I don't know"**: no evidence returns the neutral prior
at mass 0, and every downstream layer reads mass 0 as *this axis constrains nothing*.

Two consequences are load-bearing and pinned by the suite:

1. **The rest gate is soft and personal.** Whether an elevated heart rate is read as distress fades
   linearly from fully-open at `ACTIVITY_EXERTION_FLOOR.walking` (0.35 HRR) to fully-shut at the
   bottom of Karvonen zone 1 (0.5 HRR). Both bounds are read off tables that already exist. A first
   attempt placed the gate at 0.30 HRR and was measurably self-defeating — stress raises heart rate,
   heart rate raises exertion, and the gate then shut on exactly the elevation it existed to weigh
   (a genuine 2.4σ resting elevation kept 21% of its mass). **Any gate that is a monotone function
   of heart rate has this defect, W4-001's 110 bpm ceiling included.**
2. **A stated activity is a PRIOR, not an override.** `translate()` did `Math.max(measured, floor)`,
   so a Workout chip forced peak exertion onto a body sitting still. The same table now enters the
   fusion at ~⅓ of an observation's weight: a real 165 bpm barely notices it, an intent with no
   reading behind it still moves the axis most of the way.

### Layer 2 — Declared-mood fusion

All emotion taps, not just the last: centroid plus RMS dispersion about it. Confidence is
`n/(n+1) · exp(−dispersion²/2σ²)` — an evidence term times a coherence term. Taps in opposite
quadrants are a person who does not know what they feel, and that is genuinely *less* information
than one clear tap, so it falls toward zero confidence instead of averaging into a confident
neutral. This replaces every fixed 50/50 blend at the numeric level.

### Layer 3 — Temporal layer (§M.5 HMM)

Sticky transitions `A(s,s) = exp(−Δt/τ_s)`, off-diagonal mass split 70% within-domain / 30%
across, emission `b_s(e) = Π_a N(e_a; μ_{s,a}, σ_{s,a})^{m_a}` over the axes the state constrains.
The mass exponent carries Layer 1's abstention into the posterior: at `m = 0` the factor is
exactly 1, so §M.5's "missing axis → factor 1" is reached continuously rather than by special case.

### Layer 4 — Label projection with hysteresis

Four gates — enter threshold, minimum dwell, switch margin, exit threshold. A label change is a
music change, so the label is engineered to be something a person would recognise rather than a
reading. Measured on an hour of boundary-hugging noise: a memoryless labeller relabels **24 times**,
this one **zero**.

## The taxonomy is an injected PORT, not a table in the engine

W4-006 owns `stateTaxonomy.js` and its ~32 states. `affectEngine` takes `states` as a parameter,
validates it mechanically (`validateStateSet`), and degrades to axes-only with `topState: null`
when given none. The two tasks therefore land independently and neither becomes the other's source
of truth. One consequence taxonomy authors need to know: **a region's `width` is not only a
tolerance, it is a prior.** A narrow state claims more and is rewarded more when it is right (the
`−log σ` term) — correct Bayesian behaviour, and also a lever that an implausibly tight width will
pull.

## Two deliberate deviations from §M

Both were found by measurement, not preference, and both are pinned.

1. **§M.5's strong-switch clause is narrowed.** §M.5 allows an immediate switch on `α(s*) > 0.5`
   alone. As a bare absolute bar it re-admits the very flap the dwell exists to prevent: measured,
   a signal oscillating between two adjacent states every 6 minutes relabelled **20 times an hour —
   identical to a memoryless labeller**, with the dwell contributing nothing. The bypass now also
   requires the switch margin *and* that the change be a genuine **regime change** (a different
   domain or a different musical band). It costs nothing in the case §M.5 wrote the clause for
   (someone who starts running crosses bands and is detected inside a minute) and restores the dwell
   as a real guarantee for everything else. The exit-threshold bypass is gated identically.
2. **The affect DTO carries no elapsed-time field.** It is a value object — persisted, replayed and
   compared byte-for-byte by the soak harness — and a wall-clock duration inside it makes two
   identical inputs produce two different results. Stage timing belongs to the caller, which owns
   the clock.

## Regulator, not mirror: physiology never writes valence

There is no vital sign that means "sad". HRV suppression is as consistent with excitement, or with
a head cold, as it is with distress. An engine that inferred low valence from a stressed body and
then steered music toward it would be **amplifying what it found**, which VISION §6 forbids
outright. `axes.valence` moves only on a declared tap; the suite pins that a reading which drives
stress up leaves valence bit-identical. Down-regulation is achieved structurally, by the trajectory
(W4-006's `wellbeingRegulator`: meet the current arousal, then guide) — never by forcing valence.

## Zero knowledge

Raw vitals enter (this runs in worker scope only). What leaves is unit-interval abstractions, a
state id, a coarse band, an entropy and a confidence. No bpm, no RMSSD, no percentage, at any depth
— the suite walks the entire DTO and asserts it, and the telemetry line carries coarse bands and
counts only. State labels are internal vocabulary: encrypted at rest, never in prompts or logs, with
display copy a separate compliance-gated layer.

## The Borbély two-process model: cut this wave, pinned here

The full two-process model of sleep regulation is the principled version of `fatigue` and
`circadianAlertness` together, and it is deliberately **not** implemented in Wave 4:

```
Process S (homeostatic sleep pressure), across wake:      S(t) = S_lower + (S_0 − S_lower)·e^(−t/τ_r),   τ_r ≈ 18.2 h
                                       across sleep:      S(t) = S_upper + (S_0 − S_upper)·e^(−t/τ_d),   τ_d ≈ 4.2 h
Process C (circadian), the cosinor already fitted:        C(t) = M + A·cos(ω(t − φ))
Alertness ∝ C(t) − S(t)
```

Why cut: the recovery time constants require sleep *onset and offset* timestamps at a fidelity the
consent-v1 ingest does not carry (the health store gives nightly stage minutes, not a hypnogram),
and fitting τ per person needs months of data no user has yet. Wave 4 ships §M.6's discrete
multi-night debt accumulator plus the cosinor instead, which is the same shape at daily resolution.
When W4-012's `MorningState` has accumulated real nightly series, this is the upgrade — and the
formula is recorded here so the next implementer does not re-derive it from a search.

## Consequences

- `translate()` is unchanged by this ADR. W4-006 wires the affect state into the serving path
  behind `targetsBuilder`, keeping `targets` a strict superset (§0.2.5), with `computeStateVector`
  retained as the degraded fallback.
- Every engine takes `now` as a parameter (S9). The module contains no `Date.now()`, no
  `Math.random()`, no `new Date()` — asserted mechanically by the suite, because replay determinism
  is what makes the soak harness and the golden sets comparable at all.
- The dormant Garmin `stressLevel` lane (D16) is wired and unfed: consent v1 does not collect it,
  and this ADR does not widen collection.
