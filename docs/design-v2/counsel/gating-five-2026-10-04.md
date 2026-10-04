# Kokonada · Counsel brief: the five questions that gate the plan · 2026-10-04

**To:** a technology and privacy lawyer in Israel with EU reach. **From:** the owner. **Prepared by:** regulatory-researcher, from the project's regulatory files. It decides nothing; the owner and counsel decide.

- Repository facts are at commit `e4743af`.
- Sources were fetched on 2026-10-04 unless another date is given.
- Tags: **RET** = primary text retrieved · **REP** = reproduction, needs an official-text check · **COM** = commentary · **UNR** = not retrieved.
- Every other open question is in the appendix, marked "answer when convenient".

**The product.** A free Android app with the launcher label "KokonadaHealth" (`strings.xml:2`).
- It selects and orders existing music, played through Spotify. Its inputs are a tap on a mood plate and, only after explicit consent that the server enforces, heart rate, HRV, sleep and resting heart rate.
- A server engine infers one of 34 states, such as `acute-stress`, `anxious-restless` and `low-mood-low-energy` (`stateTaxonomy.js:276-304,456-477`). It also learns each user's preferences.
- Today the owner is the only user (TASKS `DAN-021`).
- Next come testers in **Israel only**. The controller is the owner, a natural person living in Israel (owner's ruling, 2026-10-04).

**Calendar.**
- **Applying now:**
- GDPR;
- AI Act Art. 5 (since 2 Feb 2025);
- AI Act Art. 50, which "applies as from 2 August 2026" (Commission FAQ, RET);
- MDR;
- Israel's Privacy Protection Law (PPL) as amended by Amendment 13 (since 14 Aug 2025, REP).
- **Later:**
- Art. 50(2) marking by 2 Dec 2026, but only for systems "placed on the market before 2 August 2026" (Art. 111(4), REP);
- Annex III high-risk rules from 2 Dec 2027;
- Annex I from 2 Aug 2028 (Art. 113 as amended by Reg. 2026/1744, REP).

**The hinge for every date below: do the EU instruments reach an Israel-only tester stage?**
- **AI Act:** it reaches systems placed on the market or put into service "in the Union", or whose "output … is used in the Union" (Art. 2(1)(a), (c)).
- **GDPR:** it reaches a controller outside the EU for "data subjects who are in the Union" (Art. 3(2)).
- **MDR:** it reaches supply "on the Union market … whether in return for payment or free of charge" (Art. 2(27)).
- All three are REP.
- If counsel answers no, each EU part below is needed **before the first EU or EEA country opens**, and the Israeli parts come first. The country list is undecided (`DEC-056`).
- Edge cases:
- a tester who uses the app while in the EU;
- a database in an EU region. Its region is unrecorded (`DAN-018`).

**In place whatever the answers.**
- The AI notice on Generate (the first screen), Onboarding and Pulse.
- Consent before any health data is read, enforced by the server (PR #193).
- Withdrawal and account deletion in the app.
- A "not a medical device" line and a consult reminder on Pulse (`legalCopy.ts:11-40`).
- No build reaches anyone but the owner.

---

### Q1 · Who is the controller, and which law governs the Israeli tester stage? *(KW-054 item 3)*
- **Ask.**
- Does Israel's PPL govern a database controlled by an Israeli individual and hosted in the US?
- If it does, which duties apply at tester scale? Candidates: the s.11 notice, a privacy protection officer under s.17ב1, the Data Security Regulations, and the transfer regulations.
- Once the EU opens: does Art. 3(2) apply, and is an Art. 27 representative required? The same question for the UK.
- Must a postal address be published?
- **Facts.**
1. **The owner's ruling** (owner rulings, 2026-10-04):
   - the controller is the owner himself, as a natural person in Israel;
   - his name and country go on the policy, with no postal address;
   - a dedicated privacy mailbox will be the contact.
2. **Health data is "information of special sensitivity"** (PPL s.3, `REG-250`, REP Nevo). A privacy officer is required where the main activity includes processing such data "בהיקף ניכר" [on a significant scale] (s.17ב1(א)(4), `REG-254`, REP).
3. **Hosting.** The host's DPA says its "primary processing operations take place in the United States" (dossier §1, fetched 2026-09-29). The database region is unrecorded.
4. **The Art. 27 exemption.** Art. 27(2)(a) exempts only processing that "is occasional, does not include, on a large scale, processing of special categories … and is unlikely to result in a risk" (REP).
- **Readings.**
- **Israel, reading 1:** the PPL governs. Then come the s.11 notice, informed and active consent, a database definition document at the medium security level, and a transfer route for each US recipient (`REG-249`–`REG-257`).
- **Israel, reading 2:** US hosting changes that (`REG-249`).
- **EU, later, reading 1:** a representative is required. The 27(2)(a) conditions are cumulative, and Art. 9 data is the core of the service.
- **EU, later, reading 2:** the processing is "occasional". This must overcome a service that runs continuously on health data.
- **Needed by.**
- The first build that reaches anyone but the owner. No date is set.
- The Art. 27 part: before the first EU or EEA country opens.
- **Meanwhile.**
- The policy is not hosted, and the in-app link is off (`legalLinks.ts:30`).
- The draft policy names the owner. It leaves out any representative or privacy-officer line, and never says one is "not required" (DAN-015 draft, gates G-3 to G-5).

### Q2 · Wellness, or a medical intended purpose? *(item 2)*
- **Ask.**
- Does the product have a medical intended purpose under MDR Art. 2(1), "modification of … a physiological … process or state", read with Art. 2(12)?
- Is it medical equipment under Israel's Medical Equipment Law?
- Both questions arise because the product has a documented down-regulation objective that no outward text states. Does the answer change if the internal documents are published?
- **Facts.**
1. **The record of intent.**
   - VISION §6: "a wellness product that senses distress must help regulate it" (`VISION.md:45-47`).
   - The breath law, "נשימה מווסתת" [regulated breathing]: a 5–6 s cycle at rest and about 10 s under strain, with the exhale longer than the inhale (`DEC-015`).
2. **The engine in production.**
   - A "WELLBEING REGULATOR" that under strain "TIGHTENS the target".
   - It adds an arc "whose START meets the listener at their current arousal and whose END is where the state's own policy wants to take them", which the code calls "the iso-principle" (`wellbeingRegulator.js:4-17`; `trajectoryPlanner.js:6-12`).
   - Its input is a stress axis built from HRV suppression and resting heart-rate elevation (`affectEngine.js:458-487`).
   - A switch, `WAVE4_TRAJECTORY_DISABLED`, exists. Its production value is unrecorded.
3. **Outward text.**
   - Only the disclaimer and the consult reminder (`legalCopy.ts:18-24`).
   - No store listing exists.
   - The launcher label is "KokonadaHealth".
4. **How intended purpose is read.** From "the label, … instructions for use or … promotional or sales materials or statements and as specified by the manufacturer in the clinical evaluation" (Art. 2(12), REP).
- **Readings.**
- **Reading A: only outward statements count, so the product is wellness.**
  - Recital 19: "software intended for life-style and well-being purposes is not a medical device" (RET, 2026-10-02).
  - MDCG 2019-11 rev.1 §3.1 (RET, 2026-10-02).
  - On this reading, keeping claims disciplined is the whole control.
  - Reading A must overcome three things: the third indent of Art. 2(1), which needs no disease; the label "KokonadaHealth"; and the fact that the repository was public until 2026-09-24.
- **Reading B: the documented objective counts,** now or once it is published or put into technical documentation. Then follow Rule 11 (possibly Rule 22), clinical evidence, and the AI Act through Annex I from 2 Aug 2028.
- **Linked: the Play account. A medical answer settles it; a wellness answer does not remove it.**
- Play's policy says developers providing these services "must register as an Organization", including "Health apps, such as Medical apps and Human Subjects Research apps. Learn more about Health app categories." An organisation account needs a D-U-N-S number (RET, Play Console Requirements 10788890 §1.2; Play Help 13628312).
- The "Health app categories" link leads to Play's definition: health apps "are designed to support and improve users' health, well-being (mental and physical), and medical management". It names three types: "Health and fitness apps", "Medical apps" and "Human subjects research apps". Its examples of the first include stress management (RET, Play Help 13996367).
- An app that reads health data cannot declare that it has no health features: "If your app provides health features or accesses health data to support non-health features, you must declare one or more of the following features" (RET, Play Help 14738291).
- On the policy's text Kokonada is a health app, whatever the MDR answer. The contrary reading rests only on the two examples after "such as", and no Google text confirms it. A medical answer makes the requirement certain: such an app is "declared as such" (16555673), and Play counts SaMD among "Medical apps". The natural-person route collides with it unless an Israeli sole trader can hold a D-U-N-S number. That is unverified, and whether it changes the controller line is a Q1 point (`CMP-093`, `DEC-044`).
- **Needed by.**
- **Israel:** the first tester build, if the Medical Equipment Law reaches stand-alone software (`REG-260`, open).
- **MDR:** the first EU distribution.
- **Play:** before the Play developer account is created, so before any Play track, internal testing included. A D-U-N-S number "can take up to 30 days" (RET, Play Help 13628312); Google's developer-verification FAQ says "up to 28 days". A converted account must "wait at least 72 hours" before submitting new apps (RET, 16260648). A tester build installed directly as an APK needs no Play account.
- **Meanwhile.**
- No string, listing or site may claim an effect on the body or mind (`REG-070`, `REG-075`, `REG-080`).
- The sentinel proposes freezing the documents that describe the purpose until counsel answers (`KW-055`). That proposal has not been ruled on.

### Q3 · Is 16+ a lawful minimum age, and how must it be checked? *(item 4)*
- **Ask.**
- For Israeli testers: can a 16- or 17-year-old give, without a guardian, the informed and explicit consent that health data needs?
- For the EU, later: Art. 9(2)(a) sets no age. Is 16 enough, and does the minimum vary by Member State?
- Which age check is enough: a neutral screen where the user states their age, or age signals from the store or the operating system?
- **Facts.**
1. **The owner chose 16+.** 18+ was the recommended option. The ruling says it is "to be confirmed by counsel" (owner rulings, 2026-10-04).
2. **There is no age check today:** no age step and no age field (`User.js`; a repository search at `e4743af`).
3. **Israel:** "אדם שלא מלאו לו 18 שנה הוא קטין" [a person under 18 is a minor] (Legal Capacity and Guardianship Law, `REG-263`, REP Nevo).
4. **EU:** under GDPR Art. 8(1), consent-based processing for an online service offered directly to a child is lawful "where the child is at least 16 years old". Member States may set a lower age, but "not below 13 years" (REP).
- **Readings.**
- 16+ with an age screen where users state their age;
- 16+ with a guardian's consent for 16–17 in Israel;
- 18+ (the earlier proposal, `DEC-050`).
- Other markets come later: COPPA below 13, and California's age signal from 1 Jan 2027 if the US opens (calendar B4).
- **Needed by.** The first build that reaches anyone but the owner. The policy's children section stays out until then (DAN-015 draft, gate G-15).
- **Meanwhile.** Only the owner has the app. No Play target-audience form has been filed (`CMP-094`).

### Q4 · What legal text must the first non-owner tester see, and in which language? *(item 5, re-scoped)*
- **Ask.**
- (a) Is the AI line acceptable as final? Is the Hebrew draft acceptable for users whose phones are set to Hebrew?
- (b) The health-data consent text is a placeholder that never names emotional-state inference. Must it be replaced, with fresh consent, before any tester consents?
- (c) In Israel, is the mood-only lane (taps, a typed note, the inferred state) health data, or a "personality assessment" (`REG-253`)? If either, must a consent step come before the first tap?
- (d) Is English acceptable for Israeli testers?
- **Facts.**
1. **The line shipped in English:** "An AI system infers your emotional state here. It is a machine's reading, not a person's — and it can be wrong." (`legalCopy.ts:11-15`).
2. **The Hebrew draft:** "מערכת בינה מלאכותית מסיקה כאן את המצב הרגשי שלך. זו קריאה של מכונה, לא של אדם — והיא עלולה לטעות."
   - It exists only in a lab app that never ships.
   - The production app contains no Hebrew. A phone set to Hebrew shows the app in English (`DAN-017`).
3. **The consent sheet.**
   - The code marks its text "PLACEHOLDER COPY".
   - Its six sections never mention emotion inference. Its purpose line is "turns how your body is doing into music tuned to you" (`ConsentSheet.tsx:19,38,40-77`).
4. **The already-enrolled group is the owner alone** (`REG-011`).
5. **The LLM-written captions are off,** by the owner's ruling of 2026-10-04 (`DISCOVERY_CAPTION_LLM`, read at call time, `captionService.js:20`). The deploy-log proof is not yet recorded.
- **Readings.**
- **EU, the AI line.**
  - Art. 50(3) is law only if the system is emotion recognition and Kokonada is its deployer (Q5). The line ships either way.
  - The information must be given "in a clear and distinguishable manner at the latest at the time of the first interaction or exposure" (Art. 50(5), REP).
- **Israel, consent and disclosure.**
  - Consent must be informed and active. This is the Privacy Protection Authority's (PPA) 2026 consent position (COM; the text is UNR).
  - A new purpose needs new consent (`REG-251`, COM).
  - The PPA's draft AI guidance asks for disclosure that an AI-based system is collecting the data (`REG-259`, COM).
- **Captions.**
  - The 2 Dec 2026 grace covers only systems "placed on the market before 2 August 2026" (Art. 111(4), REP), so it may not cover these captions.
  - With the flag off, there is nothing to mark.
- **Needed by.**
- The first build that reaches anyone but the owner.
- The Hebrew line: before any Hebrew screen ships.
- The captions: before the flag is turned back on for any EU user.
- **Meanwhile.**
- The English AI line shows on three screens.
- Only the owner has seen the placeholder consent.
- The Hebrew line exists only in the lab app.
- The captions are off.

### Q5 · Is the affect engine high-risk emotion recognition? *(item 1)*
- **Ask.**
- Is the engine "an AI system for the purpose of identifying or inferring emotions or intentions of natural persons on the basis of their biometric data" (Art. 3(39))?
- Are heart rate and HRV biometric data under Art. 3(34)? If so, Annex III 1(c) makes the system high-risk from 2 Dec 2027.
- If it is high-risk: does the profiling sentence in Art. 6(3) remove the derogation?
- Who is the deployer?
- **Facts.**
1. **Valence comes only from the user.** The code says: "Physiology NEVER writes valence … `axes.valence` moves only on a DECLARED tap" (`affectEngine.js:40-44`). Physiology writes the stress axis (`:458-487`).
2. **The states fall into two domains** (`stateTaxonomy.js:276-304,456-477`):
   - a `stress` domain: `acute-stress`, `anxious-restless`;
   - an `emotional` domain: `low-mood-low-energy`, `tense-but-positive`.
3. **Recital 18** lists emotions including "excitement". It excludes "physical states, such as pain or fatigue" (REP).
4. **The Art. 50 Guidelines,** C(2026) 5054 para 102, as reproduced: "all emotion recognition systems are also classified as high-risk" (REP; the PDF has not been read).
- **Readings.**
- **ER-yes:** high-risk from 2 Dec 2027, with the full provider duties. Art. 6(3) says such a system "shall always be considered to be high-risk where the AI system performs profiling of natural persons" (REP).
- **ER-no:** stress is a physical state and valence is self-reported, so the Art. 50(3) notice is voluntary.
- **Split:** yes on the wearable lane only.
- **The ER-no reading must overcome:**
  - "excitement" in Recital 18;
  - a domain that the code names `emotional`;
  - the Commission listing "heartbeats" among behavioural biometrics (C(2025) 5052 para 251, `REG-001`, read 2026-09-30);
  - the draft Annex III guidelines' warning against relabelling (COM).
- **A system already on the market:** Art. 111(2) applies the Act to a high-risk system placed on the market before the Chapter III date "only if, as from that date, those systems are subject to significant changes in their designs" (REP).
- **Needed by.** Before the first EU or EEA country opens. The plan's checkpoint is 15 Jan 2027 (calendar B7).
- **Meanwhile.** The notice ships under every reading. Nothing is designed around the label (`DAN-010`).

---
*What this page does not say.*
- It does not say that any regime applies or does not apply.
- It does not say that the product is, or is not, a medical device, high-risk, or subject to Israeli law.
- It does not say that any wording is cleared, or that anything should go ahead.
- Every Israeli quote is a Nevo reproduction. Every EU article quote is a reproduction; EUR-Lex returned empty pages on 2026-10-04.

---

# Appendix A · Every other open question — ANSWER WHEN CONVENIENT

**Where each question is filed:**
- **In the repository:**
- **D** = `docs/design-v2/counsel/counsel-dossier-2026-09-29.md` §7.
- **EU** = `docs/design-v2/counsel/eu-questions-for-counsel-2026-09-29.md`.
- **HX** = `docs/design-v2/counsel/hx-questions-for-counsel-2026-09-30.md`.
- **J1** = `docs/design-v2/counsel/j1-questions-for-counsel-2026-10-02.md`.
- **RR** = `docs/design-v2/research/2026-09-23/r_regulatory.md` §7.
- **BR** = `docs/design-v2/research/2026-09-23/track-h/brief_regulatory.md`.
- **T** = `TASKS.md` row `DAN-014`, dated updates.
- **Outside the repository** (paths relative to `Kokonada-private/`):
- **BE** = `session-3181c7f6/be016/be016-brief-regulatory.md` §11.
- **H5** = `session-3181c7f6/hx5/hx5-brief-regulatory.md` §5 and `hx5/r1/hx5-r1-regulatory.md`.
- **H3** = `session-3181c7f6/hx3/r1/hx3-r1-regulatory.md`.
- **J2** = `session-3181c7f6/j2/j2-brief-regulatory.md`. These are drafts, to be filed once `DAN-050`'s record exists.
- **V1** = `design-v2/v1/v1-regulatory-copy-check.md` §7.
- **PP** = `session-3181c7f6/dan015/dan015-regulatory-dossier.md`.
- **QH** = `design-v2/counsel/q-h-spotify-notice-2026-09-30.md`.

**Already covered by the five:**
- **Q1:** EU-1; RR-1; D-12, D-13, D-34, D-35; PP-Q1.
- **Q2:** EU-9; RR-3 (second half); D-22, D-24, D-25; V1-1.
- **Q3:** EU-5; RR-4; D-29 to D-32; PP-Q13.
- **Q4:**
- EU-3 (bullets 2–3), EU-6 (bullets 3–5), EU-12, EU-13 (the Art. 50(2) half);
- RR-5, RR-12, RR-13;
- BR-1, BR-5, BR-10, BR-11;
- D-1 (the Israeli limb), D-2, D-6, D-7, D-11;
- V1-3, V1-4; PP-Q10.
- **Q5:** EU-6 (bullets 1–2), EU-8; RR-8; BR-6, BR-7.

**A. What counts as health data, and the lawful basis**
1. D-1, EU-2 (first bullet), RR-2 — Is the mood-only lane health data in the EU, the UK, WA, NV, CT and CA (CMIA)?
2. EU-2 (second bullet), PP-Q2, BE-C4 — Which Art. 6 basis covers each processing of non-health data, and each item kept after a withdrawal? That includes data that stands under a grant given again before a running job checks again.
3. EU-3 (first bullet), BR-2 — Is an identified user's live heart rate health data? Is showing it on the device before consent processing? Is sending it and refusing it with a 403 a collection?
4. EU-3 (fourth bullet) — Can one text serve as both the Art. 9 consent and the ePrivacy Art. 5(3) consent?
5. BE-C1, T (2026-09-30) — Which leftovers kept on a session are health data: the watch activity, the Live mark, heart-session tracks and serve keys, valence, a wearable-detected activity?
6. J2-Q4 — Is the trace a state-recompute job leaves health data?
7. PP-Q3 — Is a target tempo from which the heart rate can be recovered, sent to the AI provider, health data? Is the notice about it enough? (The captions are off.)
8. H5-CQ9 — Can a language tag stored with a health-consent record reveal Art. 9 data?

**B. How consent works**
9. D-3 — One consent text for every market with additions, or a variant per market?
10. D-4 — Washington: does the necessity exception cover collection from the wearable? Must the MHMDA content list appear anyway?
11. D-5 — Washington and Nevada: is sending derived values to the AI sub-processor a "share" that needs separate consent?
12. D-8 — UK: if explicit consent is the only Art. 9 condition relied on, is an appropriate policy document unnecessary?
13. D-9 — Must the consent name each sub-processor and its country, or are categories enough?
14. EU-7, RR-6, D-10 — Withdrawal takes two steps while Agree takes one tap: is that "as easy"? The same question for filled versus outlined buttons.
15. BE-C3 — Do the three consent statements cover all health data, or only data from the wearables? Does Recital 42 (through Dir. 93/13 Art. 5) resolve a doubt in the user's favour?
16. BE-C8 — Were consents given while the sheet's statements were untrue still "informed"?
17. HX-Q-D (H5-CQ1–CQ3) — Is a link on the consent sheet part of the information presented? Could a build ID plus archived screenshots replace a version bump? May the link show before its page is hosted?
18. H5-CQ5, PP-Q5 — Once the sheet links the policy, is the policy part of the consent information? Which policy changes need a consent-version bump?
19. H5-CQ7, H5-CQ8 — Is recording the device language with each grant within Art. 5(1)(c)? On what basis are `appVersion` and `locale` stored?
20. RR-7 — Was the Bluetooth lane before consent processing, and an ePrivacy Art. 5(3) access? (Closed in the code by #193; the past use remains.)
21. D-41 — UK PECR: are the stored tokens and the health reads "strictly necessary"? Is a stranger's broadcast heart rate "automatically emitted" information?

**C. The notice and the privacy policy**
22. H5-CQ4, D-14, D-15 — Is a link at sign-in enough, or must a first layer of the notice appear there? May the Israeli s.11 items be one tap away? Must the UK first layer mention the US transfer?
23. H5-CQ6, PP-Q7 — The page host logs visitors' IP addresses: is it a recipient, a processor, and on what basis?
24. H3-Q1, H3-Q8 — May the policy state facts about stored data from production counts, including while older backups may exist?
25. H3-Q6, PP-Q6 — Is Spotify a processor, or an independent recipient? Is creating the "Kokonada Session" playlist a disclosure? Should YouTube be listed at all?
26. H3-Q4 — Are artist names from the open catalogue, sent to the AI provider, the artists' personal data (Art. 14(5)(b); the Art. 30 record)?
27. PP-Q9, EU-19, RR-14 — Art. 13 or Art. 14? Confirm Art. 22 is not engaged. Is a factual description of the inference enough under Art. 13(2)(f) and Recital 60?
28. PP-Q11, BR-4 — What is owed to people who are not users, whose broadcast heart rate the Bluetooth lane could read? Must ownership of the device be confirmed first?
29. V1-2 — Must the living background's behaviour be disclosed? Is the candidate sentence an efficacy claim?
30. V1-6 — Does the voice line beneath the AI line read as the AI's verdict?
31. J2-Q5 — Is the withdrawal row that account deletion writes first accurate? Must it say that the deletion wrote it? Must the controller finish a failed deletion itself?

**D. Erasure, withdrawal, retention and logs**
32. HX-Q-A — A reading admitted under a current grant is written after the withdrawal. Does Art. 7(3)/17(1)(b) cover it, or is it a new operation? How fast must the compensating delete run?
33. HX-Q-E, BE-C6, D-16 — Must "removed after N days" mention backups and logs? Does trimming a field meet a retention statement? What backup window is acceptable in Washington?
34. HX-Q-F — If past "Working" sessions fall within HX-Q-C, should they be kept as they are?
35. HX-Q-G, J1-Q5, PP-Q12 — Should log lines carry a raw ID or a pseudonym, and how long are they kept? Must a job that was running at the time be recorded? Are logs with values derived from health data a declared category?
36. J1-Q3, J2-Q6, PP-Q8 — Some writes land after an erasure (the learning residue, the state-job residue). Is declaring them enough, or must a sweep exist before any non-owner user? Is a row keyed to a deleted account's ID still personal data?
37. J2-Q3 — Are pseudonymised job-log entries personal data after the account is deleted? Is a 2-day limit "without undue delay"?
38. BE-C5 — Is a withdrawal an Art. 17 "request"? Is completing it within 24 hours, or over several nights, "without undue delay"?
39. BE-C7, BR-3 — Heart rates are held for users who never consented (`DAN-016`). Does the Art. 17(1)(d) clock run now? What remedy is owed?
40. BE-C9, H3-Q7 — Art. 19: must recipients be told of an erasure?
41. H3-Q2, H3-Q3 — If a non-operator account linked YouTube, what do Arts. 12–15, 17 and 19 require? May a backed-up token be used only to revoke access?
42. T (2026-10-02) — Are shared per-recording counts personal data while only one user is enrolled (Recital 26)?

**E. Breach assessment**
43. HX-Q-B — Is a row that survived an erasure a personal data breach? Does a later read change the answer? Should this be answered before the production count?
44. BE-C2 — The same questions for the BE-016 backlog: plaintext, read after a withdrawal, shown and exported. Is it a breach, from when does awareness run, and must it be answered before the first sweep?
45. J2-Q1, J2-Q2 — The state-job log and the re-created profiles: is this a breach? What must the record taken before the clean contain (Art. 33(5))? May anything be kept (Art. 17(3)(e))?
46. D-19 — US HBNR: if the error tracker received vital signs (`BE-020`), is that notifiable?

**F. Rights**
47. D-21 — Must an in-app export ship before launch (UK, EU, Israel s.13)?
48. J1-Q4 — Do Art. 15(3) and Art. 20 reach queued jobs and the cache?
49. D-17 — UK s.164A: is email an "electronic form" for complaints?

**G. The AI Act, apart from Q4 and Q5**
50. HX-Q-C, EU-14, RR-9 — Art. 5(1)(f): does it reach a consumer's own use while working or studying, and work context detected from typed text? (The chips were retired in #203.)
51. RR-10 — Art. 5(1)(a)/(b) and UCPD Art. 9(c): is the rule "affect shapes ambience and music, never choice architecture" enough? Is adaptive pacing a "technique"?
52. EU-13 (first half) — Does the session flow "interact directly" with people (Art. 50(1))?

**H. Claims and vocabulary, apart from Q2**
53. EU-4, BR-8, BR-9, RR-3 (first half) — Rule on these words and features: "stress", "recovery", "readiness", "sleep debt", "exhausted", "balanced", "vitals", "flow", "focus", "100% read confidence", the drift flags, and where the disclaimer sits.
54. D-23 — Clear or strike each draft store-listing claim (DMCC Sch. 20, FTC, 21 CFR 801.4).
55. D-26 — The forbidden-term lists for Illinois P.A. 104-0054, Nevada AB 406 and California's CMIA.
56. D-27 — The exact "not a medical device" line for each market, Hebrew included (`REG-260`).
57. V1-5 — Internal documents sat in a public repository until 2026-09-24. Is care from now on enough, or is a correction needed? (This follows from Q2.)

**I. Transfers and processors**
58. EU-11, D-33, PP-Q4 — Which transfer mechanism applies for each recipient and origin? Is a flow from an Israeli controller to US processors a "transfer"? Can the EU–US Data Privacy Framework be relied on while the appeal is pending?
59. H3-Q5 — Is the AI provider's standard DPA annex enough under Art. 28(3)?
60. D-20 — Israel: is the database "in Israel" for the 2023 regulations on data from the EEA?

**J. Other markets and instruments**
61. D-18 — US HBNR: is Kokonada a vendor of personal health records?
62. D-28 — Israel: is a free app a "עסקה" [transaction] under the Consumer Protection Law?
63. D-36 — Israel: does the reg. 35ו accessibility exemption apply?
64. D-37 — Connecticut: is Kokonada in scope, and what applies beyond consent?
65. D-38 — California: confirm Kokonada is not a CCPA business. Is HRV "neural data"?
66. D-39 — ADA Title III, and the UK Equality Act: do they reach an app-only foreign provider?
67. D-40 — Is the FTC biometric policy statement current, and does it reach heart rate and HRV?
68. D-42 — New York S9269: what changes if it is signed? (Watch only.)
69. EU-10 — Is a DPIA required, and which authority's list applies?
70. EU-15 — EU consumer law: the UCPD for a free app; the Consumer Rights and Digital Content Directives; the Product Liability Directive.
71. EU-16 — The Data Act.
72. EU-17, RR-11 — The European Accessibility Act: its scope, microenterprise status, and the effect of any future in-app purchase.
73. EU-18 — DSA: are stored prompts and history "hosting"?

**K. Wording requests, and one question filed outside the repository**
74. D §8 — Counsel is asked to supply wording for seven slots:
  - the consent text;
  - the first layer of the sign-in notice;
  - the final AI line;
  - the "not a medical device" line per market;
  - the policy sections;
  - the accessibility statement;
  - the age-screen copy.

  A sharing-consent slot is also reserved.
75. QH — A question about notice under a provider's developer terms, with six sub-questions. Its text is kept in the private counsel folder. Whether it joins this pack is the owner's decision.

# Appendix B · Sources not retrieved

1. **Art. 50 Guidelines C(2026) 5054.**
 - Why missing: a binary file the tooling cannot read (a saved copy is kept in the private evidence folder).
 - Would settle: point 102 (Q5); first exposure and language (Q4).
 - How: rename the file to `.pdf` and read points 100–106 and 141–146. About 30 minutes.
2. **The AI Act as amended by Reg. 2026/1744, in the Official Journal.**
 - Why missing: EUR-Lex returned an empty page on 2026-10-04. Every AI Act quote here comes from the Commission Service Desk's consolidated text "as at 27 July 2026".
 - How: open EUR-Lex in a browser. About 10 minutes.
3. **The draft Annex III classification guidelines (May 2026).**
 - Why missing: the copy saved today is unreadable here, because the PDF renderer (poppler) is not installed (a saved copy is kept in the private evidence folder). That copy is hosted by dirittobancario.it, not by the Commission.
 - Would settle: where the guidelines draw the line between emotions and physical states, and their warning against relabelling (Q5).
 - Also: no final version was found by a search on 2026-10-04.
4. **The GDPR and the MDR in the Official Journal.**
 - Why missing: EUR-Lex returned empty pages. The quotes here are from legislation.gov.uk's "as adopted" texts.
5. **EDPB Guidelines 3/2018 on territorial scope.**
 - Why missing: the saved PDF is unreadable (poppler) (a saved copy is kept in the private evidence folder).
 - Would settle: the hinge, and the Art. 27(2)(a) exemption (Q1).
6. **Israeli official texts.**
 - Every Israeli quote is a Nevo reproduction. The Knesset PDF is binary.
 - The PPA's consent position and AI guidance, and the Ministry of Health medical-devices division's (AMAR) software guidance, are on gov.il, which returned 403 to earlier runs.
 - Would settle: the Israeli limbs of Q1–Q4.
 - How: open gov.il in a browser.
7. **Play's dates (resolved 2026-10-04).** "September 30, 2026" is the date of Play package-name registration (16984799) and of Android developer verification in Brazil, Indonesia, Singapore and Thailand. It is not the organisation rule's date. That rule was announced on 17 July 2024 and rolled out "to new developer accounts first" (14993590). D-U-N-S: "up to 30 days" (13628312).
8. **C(2025) 5052 (the Art. 5 guidelines).** Paras 245, 251 and 253–255 are quoted from a run of 2026-09-30 and were not read again today.

# Appendix C · Facts the owner should have ready for the call

- **Hosting regions:** the region of the Atlas database and of the Railway backend (`DAN-018`).
- **Distribution:** how testers will get the app, through a closed test on Play or as an APK installed directly.
- **The regulator switch:** the production value of `WAVE4_TRAJECTORY_DISABLED`.
- **The captions:** deploy-log proof that `DISCOVERY_CAPTION_LLM` is now false, and the date it was first set to true.
- **Past users:** whether anyone other than the owner has ever used the app. The dossier records "5 or fewer" in the past.
- **The policy:** the privacy mailbox, and the exact name for the controller line.
- **Countries:** the intended country list and when each country opens.
