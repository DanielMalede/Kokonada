# FOR COUNSEL — Is Kokonada a high-risk emotion recognition system under the EU AI Act?

**Status: OPEN. Two different calendars — do not merge them.**

| | Applies from | State today (2026-08-28) |
|---|---|---|
| **Art. 50(3)/(5) transparency** — tell people an emotion recognition system is operating | **2 August 2026** | **LIVE. 26 days late.** |
| **Annex III high-risk regime** (Chapter III: conformity assessment, registration, logging, oversight) | **2 December 2027** | Not yet applicable. ~15 months. |

**This corrects the first version of this document, which stated that the high-risk obligations were already in force.** They were, until six days before the deadline: **Regulation (EU) 2026/1744 — the Digital Omnibus on AI, published in the Official Journal 24 July 2026, in force 27 July 2026** — deferred Annex III to 2 December 2027 (and Annex I to 2 August 2028). It **did not move Article 50**.

The practical consequence, and it is the whole shape of this file: **the transparency duty is a live exposure to be fixed now; the classification question has fifteen months and should be answered properly rather than urgently.**

**Raised:** 2026-08-28, by a compliance audit of the design canvas.
**Owner: Daniel.** This is a legal classification question. It cannot be closed by a design change, a copy edit, or an engineering fix, and nobody on the build side should attempt to.
**Written to be read cold** by someone with no prior exposure to this codebase.

---

## 1 · What the product does, in plain terms

Kokonada reads a user's heart rate, heart-rate variability, sleep and resting heart rate from a wearable (via Android Health Connect or Apple Health, with explicit GDPR Art. 9 consent). It combines those readings with a gesture in which the user places a point on a two-axis grid, and with an optional free-text note.

From that, it computes a named emotional state and selects music intended to regulate it.

The named states it outputs are points on a **valence × arousal circumplex**. Examples taken verbatim from the product:

- "Resting but content"
- "Bright and eager"
- "Wired, running on empty"
- internal state identifiers: `anxious-restless`, `low-mood-low-energy`, `tense-but-positive`, `energized-positive`

The design token that colours the interface according to the computed state is literally named `emotionAccent`. The product's own vision document describes the goal as reading "body + mind" and responding to how the user feels.

It also builds and persists two profiles: a physiological baseline (resting heart rate, HRV, sleep medians) and a music-taste profile.

## 2 · The question

Does this make Kokonada an **emotion recognition system** under the EU AI Act, and therefore **high-risk** under Annex III?

## 3 · The reasoning chain, article by article

Quotations below were fetched live from `artificialintelligenceact.eu` by the compliance audit on **2026-08-28**. **Counsel should re-verify each against the Official Journal text**; a secondary reproduction is adequate for raising the question and is not adequate for settling it.

**Step 1 — the definition.**

> **Art. 3(39):** "'emotion recognition system' means an AI system for the purpose of identifying or inferring emotions or intentions of natural persons **on the basis of their biometric data**."

Kokonada infers emotional states. The question turns on whether it does so on the basis of *biometric data*.

**Step 2 — what "biometric data" means here, and why it is broader than under GDPR.**

> **Art. 3(34):** "'biometric data' means personal data resulting from specific technical processing relating to the **physical, physiological or behavioural characteristics** of a natural person, such as facial images or dactyloscopic data."

**This is the load-bearing step.** The AI Act definition omits the limb that GDPR Art. 4(14) contains — GDPR requires that the processing "allow or confirm the unique identification of that natural person." The AI Act text does not.

On a plain reading, heart rate and heart-rate variability are physiological characteristics, and computing a state vector from them is specific technical processing. Under GDPR they would likely *not* be biometric data, because they do not uniquely identify. Under the AI Act, that escape route appears to be absent.

**Step 3 — the risk classification.**

> **Annex III, point 1:** "Biometrics, in so far as their use is permitted under relevant Union or national law: … **(c) AI systems intended to be used for emotion recognition.**"

> **Art. 6(2):** "AI systems referred to in Annex III shall be considered to be high-risk."

**Step 4 — the derogation, and why it appears unavailable.**

Art. 6(3) allows an Annex III system to escape high-risk classification where it performs only a narrow preparatory or procedural task. But:

> **Art. 6(3), final subparagraph:** "Notwithstanding the first subparagraph, an AI system referred to in Annex III shall **always** be considered to be high-risk where the AI system performs **profiling** of natural persons."

Kokonada persists a physiological baseline and a taste profile, and its consent notice describes both. That is profiling within the meaning of GDPR Art. 4(4). If that reading is right, the derogation is closed off regardless of how narrow the task is argued to be.

**Step 5 — the dates. This step was wrong in the first version and is corrected here.**

The original AI Act text reads:

> **Art. 113:** "It shall apply from **2 August 2026**. However: … (c) **Article 6(1)** and the corresponding obligations shall apply from 2 August 2027."

Reading Art. 113 alone, Art. 6(2) — the Annex III route — is not carved out, and the high-risk regime would have applied from 2 August 2026. **That was true until 27 July 2026 and is no longer.**

**Regulation (EU) 2026/1744 (Digital Omnibus on AI)** — OJ 24 July 2026, in force 27 July 2026 — deferred the Annex III high-risk obligations to **2 December 2027**, and Annex I to 2 August 2028. It left **Article 50 transparency on its original 2 August 2026 date**; the only Art. 50 concession was a four-month grace for Art. 50(2) watermarking on systems already on the market.

So the two obligations have been **physically separated by the legislature**, and one was moved without the other. Counsel needs that split, because it means the transparency duty is live while the classification question legitimately is not urgent.

**Status of this finding: REPRODUCTION.** Confirmed against multiple independent secondary sources naming Regulation (EU) 2026/1744 and the 24/27 July dates. **Not yet read against the Official Journal text itself — counsel should confirm the regulation number and the operative article before relying on it.**

## 4 · The exclusion that would rescue this, and why it appears not to

> **Recital 18:** the notion of emotion recognition "does **not** include physical states, such as pain or fatigue."

This is the strongest argument the other way, and it should be tested properly rather than dismissed. A system that reported "you are tired" or "you are physically depleted" would plausibly sit inside it.

The difficulty is that Kokonada's outputs are not framed as physical states. "Resting but **content**", "Bright and **eager**", `tense-but-positive`, `anxious-restless` are affective descriptions on a valence axis. Recital 18's own list of covered emotions expressly includes **satisfaction** — which is difficult to distinguish from "content".

An argument that the product reports fatigue rather than emotion would have to contend with its own naming, its own vision document, and the `emotionAccent` token.

## 5 · What could not be verified, and why it matters

1. **Whether HR/HRV constitutes Art. 3(34) biometric data is genuinely contested.** This is the single point on which the whole analysis turns. Published third-party commentary treats wearable signals — HRV, galvanic skin response, breathing rate — as emotion-related biometric data. The European Commission published guidance on Annex III classification in **May 2026**; the audit **could not retrieve that document**, and it is likely to be the most directly relevant source in existence. **Counsel should obtain it first.**
2. **Whether the Art. 6(3) profiling limb is engaged** as I have read it.
3. **The Art. 113 reading.** The conclusion that Art. 6(2) is already in force rests on Art. 113(c) naming only Art. 6(1). That is what the text says on its face; it deserves confirmation.

**None of these is recorded as settled.** The exposure is stated as material and unresolved, not as established.

## 6 · What attaches if the classification holds

If Kokonada is a high-risk Annex III system, the obligations are structural rather than cosmetic — Chapter III of the Act. In outline, and for counsel to scope properly:

- a risk management system across the lifecycle
- data governance for training, validation and testing data
- technical documentation, maintained
- automatic logging / record-keeping
- transparency and information provision to deployers
- human oversight designed into the system
- accuracy, robustness and cybersecurity requirements
- a conformity assessment before placing on the market
- registration in the EU database
- post-market monitoring and serious-incident reporting

There is a separate transparency duty that applies **regardless of the high-risk question**, and it is the one obligation the product is already measurably failing:

> **Art. 50(3):** "Deployers of an emotion recognition system … shall **inform the natural persons exposed thereto of the operation of the system**."
> **Art. 50(5):** "The information … shall be provided … **in a clear and distinguishable manner at the latest at the time of the first interaction or exposure**."

The product's only line to this effect — *"The reading is done by an automated system, not by a person"* — currently sits inside section 3 of a collapsed accordion within the consent notice. It does not identify the system as one that infers emotion, and it is neither clear nor distinguishable at first exposure. **If Art. 50(3) applies, first exposure is the Generate screen, not a subsection of a legal document.**

## 7 · What is NOT being claimed

- Not a legal conclusion. A build-side audit raised a classification question; it is not competent to answer it.
- Not an assertion that the product is unlawful today.
- Not a reason to stop building. It is a reason not to submit to a store, or to ship in the EU, before the question is answered.

## 8 · What should NOT happen

**Do not design around this.** A copy edit that removes the word "emotion" from the interface while the system continues to infer affective states from physiological data would change nothing legally and would damage the honesty of the product. The same applies to renaming `emotionAccent`.

**Do not soften it in the handover.** If the classification holds, it is a significant scope change, and the earlier that is known the cheaper it is.

## 9 · Suggested first step

Obtain the Commission's May 2026 Annex III guidance and put the Art. 3(34) question to counsel with this document. Everything else — whether the derogation is closed, whether Recital 18 helps, what conformity assessment would cost — follows from that answer.

## Related

- `docs/plans/HALT_CONSENT_VERSION_RETENTION_AND_DECLARATIONS.md` — the GDPR consent work, which is separate and does not address this.
- `docs/canvas/Consent.dc.html` §3, §4 — where the current automated-processing language lives.
- `docs/VISION.md` — the product's own description of what it reads and infers.
