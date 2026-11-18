---
title: State-label review
author agent: regulatory-researcher
source: 'reg-eu.md §6 (lines 1528–1654)'
prepared: 2026-09-29
repo HEAD: b9639c5
---

## 6 · STATE-LABEL TABLE

**The rules applied:**
- **(a)** no clinical or diagnostic labels (REG-081);
- **(b)** no inferred state shown as fact (REG-082);
- **(c)** no "Pre-Panic"-type condition predictions (REG-076).

Every replacement below is a **proposal for counsel and the owner**, not a decision. None of these changes affects the AI Act classification.

### 6a. Labels rendered on Pulse today

The display strings live in `stateDisplayVocabulary.ts` and `statusLabels.ts`. The rules that produce them are in `medicalProfileService.js:17-183`.

| Backend key (what the rule actually observes) | Shown today | Verdict | Reason | Proposal |
|---|---|---|---|---|
| `High-Stress / Pre-Panic` (HRV < 20 ms alone, or HR > 1.6× resting HR with respiration > 20) | "Highly activated" | Key: **REMOVE** (server-side). Display: **KEEP**, provisional. | "Pre-" predicts a condition: rule (c), REG-076, MDR Art. 2(1) "prediction". The display wording is physiological. | Server key `high-activation`; display "Highly activated" |
| `Peak Athletic Performance` (HR > 1.5× resting plus steps or SpO₂; SpO₂ is not collected) | verbatim | **RENAME** | "Performance" is a judgement the rule cannot observe: rule (b) | "Peak effort" |
| `Intense Workout` (can fire on heart rate alone, `:59`) | verbatim | **RENAME** | Claims a workout the rule may not see: rule (b) | "Working hard" |
| `Active Recovery` (moderate HR plus 50–100 steps/min) | verbatim | **RENAME** | "Recovery" is a borderline word (REG-084) | "Cooling down" |
| `Exhausted Commute` (Body Battery < 25, or readiness < 30 with low steps) | "Low on energy" | Key: **REMOVE**. Display: **KEEP**. | "Exhausted" is a health verdict (a). "Commute" cannot be observed (b). | "Low on energy" |
| `Screen-Off / Background Listening` (screen off plus Bluetooth audio) | verbatim | **RENAME** | Not clinical; device jargon | "Listening in the background" |
| `Deep Focus / Flow State` (low HR plus low movement or daytime) | verbatim | **RENAME** | Claims a mental state from heart rate and the clock (b). "Focus" also raises REG-015. | "Settled and steady" |
| `Morning Activation` (can fire on the time of day alone, `:144`) | verbatim | **RENAME** | Names a body state from the clock alone (b) | "Morning" |
| `Resting / Meditative` (HR ≤ 1.05× resting) | verbatim | **RENAME** | Meditation cannot be observed (b) | "Resting" |
| `Neutral` / legacy `natural` (no rule matched, including when resting HR is missing) | "Balanced" | **RENAME**, for counsel | Reads as an evaluation close to "normal/healthy", and it is shown with no evidence (REG-078, REG-082, REG-084) | "No clear pattern yet", or "Steady" if counsel prefers a state word |
| fallback | "Current state" | **KEEP** | Neutral; makes no claim | — |

### 6b. `BAND_LABELS` (`backend/app/agents/runtime/physiology/affectEngine.js:197-198`) plus `n/a` (`backend/app/controllers/pulseController.js:91`)

These travel on the wire as `morning.readinessBucket` and `morning.sleepDebt.bucket` (`pulseController.js:160-166`). v1 does not render them; the client has no `morning` type.

| Label | Verdict | Reason | Proposal |
|---|---|---|---|
| `min` | **KEEP** as a wire key; **RENAME** for display | Harmless alone, but "Readiness: min" or "Sleep debt: peak" is a judgement on a derived health measure, shown as fact (REG-078, REG-082) | A 5-step fill with no adjective; spoken as "level 1 of 5, as read" |
| `low` | same | same | "level 2 of 5" |
| `mid` | same | Jargon | "level 3 of 5" |
| `high` | same | same | "level 4 of 5" |
| `peak` | same | "Peak" next to sleep debt reads as an alarm (REG-077) | "level 5 of 5" |
| `n/a` | **RENAME** | Must make no claim | "Not enough data yet" |
| Noun: "Readiness" | **RENAME**, for counsel | A borderline word (REG-084). It is also labelled as a Garmin metric, which is wrong (BE-013, UI-021). | "Energy, as read" |
| Noun: "Sleep debt" | **RENAME**, for counsel | Sleep-medicine vocabulary (REG-084) | "Recent sleep vs your usual" |

### 6c. Taxonomy vocabularies (`stateTaxonomy.js:87-88`)

These travel as `affect.domain` and `affect.band` (`pulseController.js:129-134`). They are not rendered in v1.

| Label | Verdict | Reason | Proposal |
|---|---|---|---|
| domain `rest` | KEEP | — | "Rest" |
| domain `stress` | **RENAME** | Borderline (a) / REG-084; the H1 guard already blocks it | "Activation" |
| domain `focus` | KEEP, for counsel | Rule (b) framing; workplace question (REG-015) | "Focus" |
| domain `movement` | KEEP | — | "Movement" |
| domain `rhythm` | KEEP | — | "Daily rhythm" |
| domain `emotional` | **REMOVE** from display | It announces an inferred emotion as a category of the person (b). The owner's default is physical and energetic names only. | Not shown. If it must be: "Mood, as read" |
| band `resting` | KEEP | — | "Resting" |
| band `active` | KEEP | — | "Active" |
| band `peak` | **RENAME** | Matches the History title (`backend/app/services/sessionLabels.js:19`) | "Peak energy" |

### 6d. The 34 taxonomy IDs, as candidate display names

These never reach the client today: `pulseController.js:52-53` does not send them, and `explain.js:25-29` keeps the ID internal.

| ID | Verdict | Reason | Proposal |
|---|---|---|---|
| deep-rest | KEEP | — | "Deep rest" |
| meditative | RENAME | The practice cannot be observed (b) | "Very still" |
| resting-content | RENAME | "Content" is an emotion (Recital 18 lists "satisfaction"), stated as fact (b) | "Resting, unhurried" |
| drowsy-low-battery | RENAME | Alertness verdict (b) | "Low energy" |
| post-exertion-recovery | RENAME | "Recovery" (REG-084) | "After effort" |
| sleep-onset-wind-down | RENAME | Sleep-medicine term (a) | "Winding down" |
| acute-stress | RENAME | Diagnostic vocabulary (a). The legacy map sends Pre-Panic here (`stateTaxonomy.js:574`). | "Highly activated" |
| simmering-tension | RENAME | Tension stated as fact (b) | "Steadily activated" |
| anxious-restless | RENAME | "Anxious" is condition vocabulary (a) | "Restless, high energy" |
| overload-needs-downshift | RENAME | "Needs" is a prescriptive health verdict (a)(b) | "Wired, low on energy" |
| recovering-from-stress | RENAME | "Recovering" and "stress" (REG-084) | "Settling" |
| deep-focus | KEEP, for counsel | Rule (b) framing; REG-015 | "Deep focus" |
| light-focus | KEEP | — | "Light focus" |
| creative-flow | RENAME | "Creative" is a claim about the person (b) | "In flow" |
| mental-fatigue | RENAME | Symptom-adjacent vocabulary (a) | "Low on focus" |
| restless-distracted | RENAME | "Distracted" is an attention verdict (b) | "Unsettled focus" |
| warmup | KEEP | — | "Warming up" |
| steady-cardio | RENAME (optional) | Jargon only | "Steady effort" |
| peak-effort | KEEP | — | "Peak effort" |
| intervals | KEEP | Rule (b) framing | "Intervals" |
| cooldown | KEEP | — | "Cooling down" |
| obligated-workout-low-recovery | RENAME | "Obligated" infers an intention (Art. 3(39) covers "intentions"); "recovery" (REG-084) | "Effort on a low-energy day" |
| casual-walk | KEEP | — | "Walking pace" |
| commute-active | RENAME | Commuting, and "not by choice", cannot be observed (b) | "On the move" |
| morning-activation | KEEP | Needs heart-rate evidence here, unlike legacy rule 8 (`stateTaxonomy.js:190-193`) | "Morning activation" |
| morning-sluggish | RENAME | "Sluggish" is evaluative (b) | "Slow morning" |
| afternoon-dip | KEEP | — | "Afternoon dip" |
| evening-unwind | KEEP | — | "Evening wind-down" |
| night-owl-alert | RENAME | A trait label about the person (b) | "Awake late" |
| pre-sleep | RENAME | The same "pre-" prediction pattern as (c), though not a condition | "Late evening" |
| energized-positive | RENAME | Valence stated as fact (b) | "High energy" |
| low-mood-low-energy | **REMOVE** "low mood" | Depressive-symptom vocabulary (a) | "Low energy" |
| tense-but-positive | RENAME | Two emotion claims stated as fact (b) | "Energised, activated" |
| neutral-baseline | RENAME | Jargon; nothing stands out | "No clear pattern yet" |

### 6e. Explain lines (`receipt.why`)

The client drops these today; plan step 14 restores them on P4. The pattern for every fix: describe the music, attribute the state to "your readings", and drop "because".

- **Rewording proposed** (rule (b)):
  - simmering-tension ("a wound-up hour") → "…something even to lean on while your readings run high."
  - anxious-restless ("a restless edge") → "Starting near your current pace, then narrowing towards something steadier."
  - overload-needs-downshift ("because there is nothing left to spend") → "Pulling the demand right down, for readings that run high and low at once."
  - recovering-from-stress ("the edge finishes coming off") → "Keeping things level as your readings ease."
  - mental-fatigue ("a tired mind") → "Simple and low-effort, for an alert hour with low-energy readings."
  - restless-distracted ("a scattered stretch") → "Repetitive and narrow, one thing to hold on to."
  - creative-flow ("something already going well") → "Bright and continuous, staying out of the way."
  - energized-positive ("already good") → "Bright and moving, keeping pace with high-energy readings."
  - low-mood-low-energy ("a low stretch") → "Starting quiet, then opening up a little."
  - tense-but-positive ("Keyed up but in a good way") → "Kept bright while the pace comes down."
  - drowsy-low-battery ("very little left in it") → "Gentle and undemanding, for low-energy readings."
  - commute-active ("not by choice… the trip") → "Something steady to sit inside while you're on the move."
  - night-owl-alert ("genuinely awake") → "Kept level for a late, alert hour."
- **Keep as written:** the other 21 lines.

### 6f. Other Pulse labels (`pulsePresentation.ts:27-40`)

- **KEEP** "HRV", "Resting HR", "Deep sleep", "REM sleep" and "Last night". They name measured values, not inferences.
- **RENAME, for counsel:**
  - group "Vitals" → "Heart" (the clinical "vital signs" register);
  - group "Recovery" → "Energy" (REG-084);
  - "Readiness" (see 6b).
- **"Body Battery"** is out of scope here; it is `compliance-auditor`'s (a Garmin mark).
