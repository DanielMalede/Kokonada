# Kokonada clean-slate redesign: design-lead audit

**Verdict on the current design base:** use it as reference only. Keep the principles, archive the canvas, and do not spend more effort closing the roughly 35 open findings on the 19 boards. Those boards draw a direction that was never ratified, and the shipped app draws a different one.

Evidence file paths are listed in the index at the end. Inline, files are cited as `[E#:line]`.

---

## 1. What must survive the reboot (principles, not pixels)

- **P1. Regulator, not mirror, on every channel.** The breath period is monotonic in stress (it can lengthen, never shorten). No red in the emotion range, pinned by value tests. No cardiac-rate layer. The rebuild must extend this to luminance, saturation, reach, haptics and copy. Today it is enforced only on period and hue (see RC7).
- **P2. Two voices.** The user's placement (YOU) and the body's read (BODY) sit side by side, and where they disagree, the disagreement is shown as information `[E10:235-248]`. This is the most original idea in the canvas and the clearest expression of "being seen".
- **P3. Honest data grammar.** Every bar is one of four types: ceiling, target, bias or stack. Every number carries its unit and direction in words. If the data isn't there, the screen says less rather than drawing an arc that means nothing `[E10:111-173]`, `[E3:127-133]`.
- **P4. Honest empties and honest confidence.** Show "Not shared by your watch", never a dash and never an advert for a watch. Confidence is shown, never implied, and the field is only as present as the engine is sure `[E11:122]`.
- **P5. Continuity through shared objects.** The placements become the Genesis ring, the ring becomes the album art, and the status line becomes the track title. Breath period changes only at a cycle boundary. The field changes state only after two consistent reads `[E14:220,281,301-302]`, `[E22:31]`.
- **P6. Legal surfaces are static, never emotion-tinted, and Decline is exactly as easy as Agree.** Error colour, accent colour and destructive colour are three different things `[E3:141-147]`, `[E3:173-188]`.
- **P7. Contrast is computed, not asserted.** Keep the max-min rule for label ink `[E7:103-118]`, tests that pin contrast ratios, and the rule "fix by deepening the colour, never by lowering the threshold".
- **P8. Every renderer input is total and frame-rate independent.** NaN/infinity clamps and elapsed-time phase `[E8:34-59]`, `[E9:61-85]`.
- **P9. Mood-only is a first-class path.** The wearable is never a gate, and health consent is asked just in time.
- **P10. Feedback restraint.** Four haptics, Genesis is silent, earcons are opt-in.
- **P11. One exported trust sentence.** A pairing code, never a raw token.
- **P12. Chrome never borrows an emotion quadrant** (Rule 2, ratified by Daniel 2026-08-26) `[E10:357-369]`. The shipped code violates it (RC1).
- **P13. Sacred contracts:** at most 3 placements on a continuous 2-D plate, `screenToCircumplex`, the three-lane state split, and all socket/DTO contracts.

---

## 2. What is weak, generic or inconsistent, and why REVISE keeps recurring

### RC1. The direction was changed three times, each "LOCKED", and nothing formally replaced the previous one
- **Clinical Premium** (teal/coral, 2026-07-12/13): `[E3:10-14]`, `[E15:35,44]`.
- **AURORA** (sky/violet/gold/pink, glass, "LOCKED 2026-07-13"): `[E5:2]`.
- **Quiet Instrument** (hairline elevation replaces glass, two-lobe field): `[E16:22,36]`.
- ADR-0009 was never superseded.

Names outlived their values. The Tokens board labels #1F6FA6 as "calm · teal", but it is a mid blue `[E12:37]`, and the Field board repeats the label `[E11:63,112]`. Contradictory truths now coexist:
- **Tab tint:** SCREENS says tint the active tab `[E2:40]`, the code tints it `[E17:37-51]`, and Rule 2 says neutral ink.
- **Primary theme:** the spec locks light as primary `[E3:13]` and tokens call light the primary face `[E5:6]`. But `theme.ts` defaults to dark and follows the OS `[E6:13-20]`, and the hero was device-verified in dark only `[E2:21]`.
- **Ambient field:** four blobs shipped versus two lobes drawn, still an open decision `[E18]`.
- **Breath ceiling:** 6200 ms on the canvas `[E11:115]` versus 6300 ms in code `[E19:13-14]`.

### RC2. The design source of truth is hand-written HTML full of literal values, so the canvas became a second product that needs its own review
- 206 half-pixel font sizes, 11 off-scale radii across 17 boards, and 17 literal `4200ms` values `[E20:33-77]`.
- The canvas uses Plus Jakarta and Space Mono; the app uses 'System' and 'monospace' `[E5:246-247]`.
- Canvas ink is #14163A, app ink is #241B45. Canvas danger is #9E3346 `[E4:114]`, app danger is #B4322F `[E5:206]`.
- About 60% of `tokens.css` is prose defending values.

Every system fix has to be re-typed by hand on each board. So reviews audit the drawing first and the app again later: double REVISE.

### RC3. Legal and data constraints reached the design as late findings instead of up-front inputs
- **AI Act Art. 50** (UI-005) was found by a compliance audit of the finished canvas `[E21:14]`, and the audit's factual basis turned out to be canvas copy, not shipped code `[E21:155]`.
- **Spotify, YouTube, Garmin and Apple halts:** six `HALT_*` plans.
- **Receipt lead sentence:** it is discarded by the mobile sanitizer `[E2:124]`.
- **State name and confidence:** the engine does not produce them yet `[E16:62,122]`.

The team itself names the recurring defect: "a board promising what the app cannot produce" `[E18:86]`.

### RC4. The hero is overloaded and its hierarchy is inverted
- `Main.dc.html` stacks about 12 element groups above the tab bar: body strip (trace, three metrics, a sentence), H1, a 276 px plate, a state-read card (three lines plus a bar), three controls, an activity row, a prompt row, the CTA, a caption, a live link, a playing hairline, and five tabs `[E13:52-157]`.
- The review board already records that "the raw BPM number outranks the fused state" and that the plate is 202 px inside a 237 px stage under a 375 px control block `[E23:209,213]`.
- The aesthetic has drifted toward an instrument panel: mono uppercase eyebrows, hairline rules, two-decimal confidence ("FAIRLY SURE · 0.69"). It is honest, but it reads as a lab report, not a sanctuary. VISION says "no dashboards" `[E1:23]`.
- The plate's own axis labels are ink at 42% opacity `[E13:87-90]`, about 2.7:1 by my calculation. The §7.1 rim exemption depends on those labels clearing 4.5:1 `[E3:128]`.

### RC5. The signature element is weakest exactly where it must be strongest
- On porcelain, the field peaks at about 11% alpha `[E4:132-135]`, and a placement halo is about 1.10:1, "near-nothing in a screenshot" `[E4:147-150]`. Light cannot glow on white; bioluminescence needs darkness.
- The shipped aurora is a constant sky/violet/gold/pink rainbow regardless of emotion `[E9:54-59]`. The emotion lives in a separate small bloom `[E24:64-68]`, so the static rainbow drowns the reactive accent.
- A pastel gradient mesh is the single most generic "AI wellness" look of 2024–26.
- Three ambient systems are stacked (LivingAurora, the heart-rate glow, the accent bloom) across two animation engines (Skia clock and React Native `Animated`) `[E24]`, `[E25]`. There are no Skia runtime shaders anywhere (grep returns 0).

### RC6. The colour model mixes in sRGB and the four emotions are hard to tell apart
- Three of the four quadrant inks sit within about 57° of hue: calm about 204°, reflective about 226°, intense about 261°. Only joyful is warm (about 36°).
- `auroraGlow` interpolates bilinearly in RGB `[E26:91-102]`, so the neutral origin is a grey-periwinkle (about #8393B9).
- The CTA gradient passes through a dusty mauve (the violet/gold midpoint is about #C09491).
- The CTA's label ink flips from dark to white at the intense corner `[E4:58-65]`, so its legibility depends on a code branch.
- Calm, reflective and intense collapse together for colour-vision-deficient users.
- The spec's own hues (teal, amber, violet-magenta, indigo) `[E3:14]` were better separated than what shipped.

### RC7. The regulator ethic leaks, and there is alarming language
- The aura's opacity equals HR-driven intensity (0.1 rising to 0.9 with heart rate) `[E8:43]`, `[E24:61]`. A stressed body gets a *brighter* aura: the UI mirrors stress through brightness.
- "High-Stress / Pre-Panic" is shipped as the Pulse header `[E21:157]`, `[E27:198]`. That breaks the ethic and is exposed under the AI Act.
- The 4200 ms breath floor is about 14 cycles/min, a normal resting breathing rate, so it does not pace anyone downward. Heart-rate-variability biofeedback uses about 6/min (a roughly 10 s cycle).

### RC8. Type, licensing and localisation foundations are unsound
- **Only one cut is bundled.** The canvas claims "ONE cut exists… no 400 and no 700 General Sans" `[E4:20-21]`. That is true only of what is bundled: the family ships roughly 200–700 weights (verify). The CTA contrast proof was then built around that false limit.
- **License mislabelled.** The file named `OFL.txt` actually contains the Fontshare FF EULA `[E28]`, while the README says OFL `[E29:5]`. EULA §02 forbids "uploading them in a public server" and handing the font to external designers `[E28:27]`, and a second copy of the .otf sits in `docs/canvas/`. The compliance-auditor must check whether the repo is public.
- **The shipped app's text face is Roboto ('System')**, not the canvas face.
- **Type scaling:** there is an 11 px floor full of tracked uppercase mono labels, and only Pulse handles font scale (14 hits).
- **No i18n or RTL infrastructure at all** (grep returns 0). The wheel geometry must stay left-to-right under RTL.

### RC9. Navigation works against the magic moment
- Five bottom tabs turn Generate → Genesis → Now Playing into a tab jump. The Flow board's shared-object continuity cannot survive a tab switch.
- The Now Playing tab is empty on first run `[E16:121]`.
- There is no native-stack navigator for pushed Receipt and Consent screens `[E30:17-18]`.

### RC10. The identity is generic
- The brand mark is concentric rings around a glowing seed `[E31:23-37]`, the common AI-orb/meditation-ring trope.
- Unicode glyphs stand in for icons (♥ ● ↺) `[E32:188,273]`.
- Shipped onboarding copy ("Feel it.") could belong to any app.

### Why REVISE keeps recurring
1. There is no single machine-checked source: tokens, canvas, SCREENS and code each carry values.
2. Gates run at the end, so compliance, regulatory and data findings arrive after the pixels.
3. Boards get drawn ahead of the data contract and the legal position.
4. Directions are re-locked without an ADR that supersedes the old one.
5. Reviews judge drawings, not on-device captures of components.
6. SHIP has no measurable criteria, so taste gets re-argued every round.
7. Systemic fixes are patched board by board. The Components board says "change here once and propagate", but hand-written boards cannot propagate.

---

## 3. Substantial improvements to consider (recommendation and trade-off)

**3.1 Primary face.** Recommend dark "Nocturne" as the primary face, with light as a fully verified alternate. The default can still follow the OS, but dark is designed and verified first and used for store screenshots.
- *Why:* emission needs darkness; OLED; night and wind-down listening; visual continuity with the Spotify handoff; the field can run at meaningful alpha.
- *Trade-off:* reverses a Daniel lock. The trust surfaces (Consent, Vault) keep a flat "paper" sub-surface in both faces so they still read clinical and serious.

**3.2 Navigation.** Recommend 3 destinations. **Session** is one stage (place → Genesis → playing → pull-up receipt). **Body** is Pulse. **Archive** is History. **You** sits behind an avatar in the Session top bar.
- *Why:* continuity stays inside one Skia/Reanimated surface. Cross-screen shared-element transitions in Reanimated 4 are experimental, feature-flagged and native-stack-only (verify), so the magic moment must not depend on them. The mini-player problem also goes away.
- *Trade-off:* discoverability of You; Android predictive back needs a spec per stage state. The architect must confirm socket and three-lane lifecycle stay unaffected.

**3.3 Hero hierarchy.** Recommend progressive disclosure. First paint is the field, the plate at about 80% of width, and one line of guidance. The first placement reveals the two-voice read. The body strip becomes a single sentence that expands on tap. Activity and words become optional chips that expand. At most 5 element groups are visible above the fold.
- *Trade-off:* power users see body data one tap later.

**3.4 The field as a Skia shader system.** Recommend one full-screen SkSL `RuntimeEffect` used by Session, Genesis and Body:
- Two lobes as soft metaball distance fields over domain-warped noise.
- Colour mixed in OKLab inside the shader, with blue-noise dithering (dark gradients band at 8-bit).
- Inputs: hue pair, reach, presence (confidence), breath phase, and stress (which slows, desaturates and dims).
- A quality level for low power (octaves 3 → 1), and a designed still frame for reduced motion.

This replaces four per-frame Blur circles `[E33:48-56]` and the separate glows. It adds no new dependency. *Trade-off:* needs SkSL expertise and a profiling pass on the S22+. The existing input-totality test pattern carries over.

**3.5 Colour.** Recommend authoring in OKLCH and generating hex at build time (culori).
- Return to the spec's hues, spread at least 70° apart: calm teal (h≈185), joyful amber (h≈75), reflective indigo (h≈265), intense violet-magenta (h≈305, capped to stay out of red and pink).
- Each quadrant gets an ink / glow / wash tier by lightness.
- The unplaced centre is a deliberate neutral.
- Map valence mostly to warmth and lightness, and arousal to reach and motion, so colour-blind users have non-hue cues.
- WCAG 2.2 AA remains the legal floor. APCA is an extra check for dark mode.
- *Trade-off:* every contrast pin gets re-proven once.

**3.6 Type.** Recommend a soft-serif "voice" face, used only for the few human sentences (state name, Genesis line, receipt verdict, onboarding), plus one humanist OFL sans for all UI with tabular figures in 3 static weights. Retire mono.
- Ship static weights; do not rely on variable font axes on Android.
- If Hebrew ships, pick families with Hebrew coverage. Rubik, Heebo, IBM Plex Sans Hebrew and Frank Ruhl Libre are all OFL.
- Android-first means 48 dp touch targets, not 44.
- *Trade-off:* roughly 300–500 KB of fonts; the serif can read "editorial" if overused.

**3.7 Motion system.**
- Replace ad-hoc bezier curves with 3 springs specified by response time and damping ratio: **respond** 0.35 s / ζ0.85 (interruptible feedback), **settle** 0.6 s / ζ1.0 (layout), **drift** 1.2 s / ζ1.0 (field state). Overshoot is forbidden in stressed states.
- One breath hook and one law: rest about 5–6 s, stretching toward about 10 s under stress, with a 40:60 inhale:exhale, retimed only at a cycle boundary.
- Add a real low-power tier driven by Android power-save mode and thermal status (API 29+). Today nothing detects it `[E22:36-53]`.
- Use one animation engine (Reanimated 4 plus the Skia clock) and retire React Native `Animated`.
- Reduced motion means a designed still frame with crossfades of 150 ms or less, not zero duration everywhere.
- *Trade-off:* a slower field feels less "alive" at rest. Any "breathing guide" wording is a medical-device (MDR) claim risk, so the regulatory-researcher must review it.

**3.8 Haptics and sound.**
- Build an Android vocabulary on `VibrationEffect.Composition` primitives (API 30+, check support at runtime), falling back to predefined effects and then to nothing: place = low tick, commit = click, arrival (only when audio actually starts) = slow rise, undo = soft low tick, account-deletion confirm = thud.
- `react-native-haptic-feedback` cannot do composition primitives, so this needs a small native module.
- Defer earcons until after launch. They would contend with Spotify's audio focus.

**3.9 Iconography and illustration.**
- A custom icon set drawn from the plate and placement geometry: 1.5 dp stroke, round caps, rendered as Skia paths (the current tofu-proof approach).
- No unicode glyphs. Material Symbols Rounded (Apache 2.0) for purely utilitarian icons.
- No illustration anywhere. Onboarding and empty states render the real field and plate.

**3.10 Brand mark.** Recommend deriving it from the product's own geometry, for example the plate with a three-placement constellation. Ship the monochrome themed-icon layer. The mark should come out of the finished language, not precede it.

**3.11 Voice and state vocabulary.**
- Use second person ("your variability was low, so…"); the app has no "I".
- Name physical and energetic states rather than affective ones. Recital 18 splits the product state by state `[E21:159]`.
- Delete "Pre-Panic" regardless of the outcome.
- These are regulatory-researcher and counsel inputs, not copy polish.

**3.12 Design pipeline.**
- One token source in W3C DTCG JSON, fed through Style Dictionary to generate `tokens.ts`, the canvas CSS and an agent-readable `DESIGN.md`.
- The HTML canvas is for exploration only.
- The contract is an on-device **Design Lab** (Storybook for React Native, or a dev-only route) showing every component × state × theme × field, captured automatically by Maestro on the Galaxy.

### Items the owner has not raised
- i18n and RTL policy (the plate stays left-to-right).
- Android 15 edge-to-edge.
- Predictive back.
- Opting out of Material You dynamic colour.
- The themed monochrome icon layer.
- The Android 12 splash constraints.
- Hiding health data in the recents thumbnail (FLAG_SECURE-style decision).
- Store screenshots and feature graphic as compliance-gated design deliverables.
- Play Data Safety answers that match the UI copy.
- TalkBack and Switch Access paths for the plate.
- Nonlinear 200% font scale (Android 14+).
- Disabling Android's force-dark.
- UI-005: the Art. 50 disclosure at first exposure is past its date. It needs an interim fix on `main` now, independent of the rebuild; owner and regulatory call.

### Design tooling asked about
I have no web access in this run and am working from memory. The compliance-auditor should verify licences, current versions and install commands before anything is installed.

- **Taste Skill:** a SKILL.md prompt pack that steers generation away from generic AI aesthetics. It is web-oriented (React/Tailwind/Framer). Useful as the designer's anti-generic checklist, and it targets our biggest weakness (template look). Install means copying the skill folder into `.claude/skills/`. **Recommended.**
- **awesome-design-md:** a collection of DESIGN.md files reverse-engineered from other brands' sites. The *format* is useful: adopt it, generated from our own tokens. The *content* works against "a product, not a template". **Skip.**
- **UI UX Pro Max:** a skill plus a searchable database of styles, palettes and font pairings, installed through its own CLI or the plugin marketplace, and it runs a Python script. Its aesthetic advice overlaps Taste Skill and pushes toward category averages ("wellness → soft pastels"), which is our current failure. Its UX and React Native checklists have some value. **Optional; do not use it for style decisions.**
- **Skills are executable instructions.** Pin each to a commit and have it security-reviewed before install. Changes under `.claude/` need Daniel's approval.
- **More advanced options that actually move quality:**
  1. Skia `RuntimeEffect`/SkSL: already installed, zero new dependencies.
  2. Rive (state-machine vector animation) for the brand mark, onboarding and icon micro-interactions. New dependency: architect checks New Architecture/RN 0.86 compatibility; compliance-auditor checks the licence.
  3. Reanimated 4 CSS-style animations and layout animations.
  4. Storybook for React Native plus Maestro screenshot flows as the review surface.
  5. Style Dictionary, DTCG, culori (OKLCH) and an APCA library.
  6. Optionally, `react-native-unistyles` 3 as the theming engine (architect's call).
  7. Figma with Tokens Studio or the Figma MCP only if Daniel wants a visual design tool; it is not required.

---

## 4. Decisions only Daniel can make (recommended option marked)

**Q1. Primary face?**
- A) Light Clinical Premium stays primary
- **B) Dark Nocturne primary, light as a full alternate (recommended)**
- C) Time-aware: dark at night and for wind-down, light by day
- D) Follow the OS, both treated as equal

**Q2. Navigation?**
- A) Keep 5 tabs
- **B) 3 destinations: Session stage, Body, Archive; You behind an avatar (recommended)**
- C) Single canvas with sheets and no tab bar
- D) 4 tabs (merge Now Playing into Generate)

**Q3. What does the hero show first?**
- **A) Field, plate and one line; the read appears after the first placement (recommended)**
- B) Everything at once, as the current canvas draws it
- C) Body first, then the plate

**Q4. The ambient field?**
- A) Keep the shipped 4-blob brand rainbow plus a small emotion bloom
- B) The canvas two-lobe gradients
- **C) One Skia shader field: emotion hue, stress slows and dims it, confidence sets its presence, covers about half the screen (recommended)**
- D) No field; emotion appears only on the plate and CTA

**Q5. Emotion palette?**
- A) Keep AURORA (sky/gold/violet/indigo)
- **B) Spec hues re-authored in OKLCH (teal/amber/violet-magenta/indigo), at least 70° apart (recommended)**
- C) A duotone pair per quadrant
- D) Monochrome field; colour on the placements only

**Q6. Languages at launch?**
- **A) English, with i18n-ready infrastructure from day one (recommended)**
- B) English plus Hebrew (RTL) at launch
- C) English only, no infrastructure

**Q7. Typography?**
- A) General Sans (properly licensed full family) plus Roboto
- B) One OFL sans superfamily for everything
- **C) Soft-serif voice face for the few human sentences plus a humanist OFL sans for UI, with tabular figures and no mono (recommended; the family depends on Q6)**

**Q8. The app's voice?**
- A) First person ("I kept the tempo under 96")
- **B) Second person; the app has no "I" (recommended)**
- C) Almost no sentences; labels and numbers only

**Q9. State names?**
- A) Affective ("Wired, running on empty", "content", "eager")
- **B) Physical/energetic states, with the user's placement shown in their own words (recommended, pending regulatory-researcher and counsel)**
- C) No state names; field and music only

**Q10. How is confidence shown?**
- A) Word and number ("FAIRLY SURE · 0.69")
- **B) Word on screen, number only in the receipt (recommended)**
- C) Field presence only

**Q11. Brand mark?**
- A) Keep Aurora Seed
- **B) A new mark from the plate and three-placement constellation, designed after the language is settled (recommended)**
- C) Wordmark only

**Q12. Breath law?**
- A) Keep 4.2 s rest / 6.2 s ceiling
- **B) Regulation-grade: rest about 5–6 s, stress stretching toward about 10 s, exhale-weighted 40:60 (recommended; the regulatory-researcher reviews any "breathing" claim)**
- C) Stillness under stress

**Q13. Design source of truth?**
- A) The HTML canvas stays the contract
- **B) Token JSON generates TS, CSS and DESIGN.md; the canvas is for exploration only; the on-device Design Lab captures are the contract (recommended)**
- C) Move to Figma with Tokens Studio

**Q14. Design tools?**
- A) Install all three
- **B) Taste Skill only (after vetting), adopt the DESIGN.md format, skip awesome-design-md and UI UX Pro Max (recommended)**
- C) None

---

## 5. The per-page process, with the designer as a gate

**Stage 0: Page Charter, before any pixels.** One page, co-signed before design starts:
- **architect:** which fields exist today in the DTO and stores. Anything missing goes on a "not drawable" list.
- **compliance-auditor:** marks, OAuth, permissions, store policy for this page.
- **regulatory-researcher:** Art. 50, Art. 9, MDR claim words, emotion vocabulary.
- **resilience-auditor:** the full state matrix (loading, empty, partial, stale, offline, error, slow, reduced motion, low power, 200% font, RTL if applicable).
- **designer:** the page's one job, the hierarchy ranking, and the maximum number of element groups.

Outputs are four lists: must show (disclosures), must not claim, allowed to draw, and states. This is the step that removes the late-gate rework.

**Stage 1: Direction.** At most 2 low-fidelity compositions built only from generated token classes. Daniel picks only where there is a real fork.

**Stage 2: Spec Pack for the developer.**
- Layout in token names, never pixels.
- The ranked hierarchy.
- A frame for every state in the matrix.
- A motion table: trigger, property, from/to, spring or duration token, interruptible or not, reduced-motion variant, low-power variant.
- Haptic events.
- Accessibility: focus order, roles, labels, live regions, 200% behaviour.
- A copy deck keyed for i18n.
- The exact list of acceptance captures.

**Stage 3: Components first in the Design Lab** on device. A component gets its own designer SHIP before any page assembly.

**Stage 4: Assembly and integration** with real data. A designer checkpoint on device at about 50% of the build. Resilience audit.

**Stage 5: Final review** on Maestro captures. Designer gives SHIP or REVISE; compliance re-checks the rendered marks; regulatory re-checks the final copy.

**What SHIP means, measurably:**
- Zero `kokonada/*` lint findings, and no unexplained constants in screen files.
- Every charter state captured in light and dark (and per emotion field where relevant), at font scale 1.0 and 2.0, with reduced motion and low power.
- Text at least 4.5:1, large text at least 3:1, and required non-text at least 3:1. Measured on captured pixels at the worst field frame (breath peak, maximum reach), not on flat colour.
- Touch targets at least 48 dp.
- On the S22+ (via Perfetto or `gfxinfo framestats`): 0 janky frames across the Genesis → Playing transition over 3 runs, janky frames at most 1% over 30 s of idle field, and a field GPU cost target of at most 3 ms per frame.
- A blurred capture shows the rank-1 element as the most salient thing on screen.
- Copy matches the copy deck by key.

**Loop killers:**
- Every finding cites a rule ID from a decision register; there are no "taste" findings without a principle.
- Severity P0 (contract, ethic, legal, contrast), P1 (hierarchy, rhythm), P2 (polish). P2 never blocks a SHIP.
- A systemic finding becomes a token or component PR, never a page patch.
- At most 2 review rounds, then escalate to Daniel.
- Any direction change requires an ADR that supersedes the previous one.

---

## 6. Recommended rebuild order

0. **Foundations (not a page).**
   - Decision register and an ADR superseding ADR-0009.
   - DTCG token pipeline with OKLCH palette, type, springs and breath law.
   - Low-power and thermal signal.
   - Haptics native module.
   - i18n string infrastructure.
   - Design Lab plus Maestro capture harness.
   - Archive the Quiet Instrument canvas as reference.
1. **Core components** in the Design Lab: Button family, Row, Chip, Switch, Slider, Sheet, the four bar types, honest empty, skeleton, banner, icon set, text styles.
2. **The signature:** the field shader, the breath hook, and the plate's visual layer. This is the highest risk (performance and ethic), so it is proven before any page uses it.
3. **Shell and navigation** in the chosen model, plus system states.
4. **Session stage** (Place → Genesis → Playing). This is the Vision Frame hero, and it carries UI-005 at first exposure.
5. **Mix receipt.** Blocked on the backend lead-sentence path and the targets DTO.
6. **Health consent.** Restyle only; legal text and version frozen. It can run in parallel after step 1.
7. **Connect services** (depends on consent).
8. **Body.**
9. **Archive.**
10. **You / Vault** (export, withdraw, delete).
11. **Onboarding.** Built from the real field and plate so it demonstrates the product rather than illustrating it.
12. **Login.**
13. **Splash, brand mark and app icon.** The mark comes out of the finished language; the bootsplash needs native re-export.

**Why this order:** every page consumes the foundations (the canvas plan's own "PR 00" already said ship tokens first `[E16:36-37]`). The riskiest element is proven before pages depend on it. The hero validates the whole system. Trust surfaces are mostly restyles. First-run surfaces come last because they are demonstrations of the finished system.

---

## Evidence index

| # | File |
|---|---|
| E1 | c:\Users\danie\Videos\Kokonada\docs\VISION.md |
| E2 | c:\Users\danie\Videos\Kokonada\docs\SCREENS.md |
| E3 | c:\Users\danie\Videos\Kokonada\docs\UI_UX_OVERHAUL_SPEC.md |
| E4 | c:\Users\danie\Videos\Kokonada\docs\canvas\tokens.css |
| E5 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\tokens.ts |
| E6 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\theme.ts |
| E7 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\auroraSurfaces.ts |
| E8 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aura\auraUniforms.ts |
| E9 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aurora\auroraField.ts |
| E10 | c:\Users\danie\Videos\Kokonada\docs\canvas\Components.dc.html |
| E11 | c:\Users\danie\Videos\Kokonada\docs\canvas\Field.dc.html |
| E12 | c:\Users\danie\Videos\Kokonada\docs\canvas\Tokens.dc.html |
| E13 | c:\Users\danie\Videos\Kokonada\docs\canvas\Main.dc.html |
| E14 | c:\Users\danie\Videos\Kokonada\docs\canvas\Flow.dc.html |
| E15 | c:\Users\danie\Videos\Kokonada\docs\superpowers\specs\2026-07-13-discovery-ui-visual-direction.md |
| E16 | c:\Users\danie\Videos\Kokonada\docs\canvas\Plan.dc.html |
| E17 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\navigation\EmotionTabBar.tsx |
| E18 | c:\Users\danie\Videos\Kokonada\docs\plans\DECISION_TWO_LOBE_FIELD.md |
| E19 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aura\auraBreath.ts |
| E20 | c:\Users\danie\Videos\Kokonada\docs\plans\CANVAS_SCALE_AUDIT.md |
| E21 | c:\Users\danie\Videos\Kokonada\docs\plans\LEGAL_AI_ACT_EMOTION_RECOGNITION.md |
| E22 | c:\Users\danie\Videos\Kokonada\docs\plans\DEV_AMBIENT_FIELD_SCOPE_AND_DEGRADATION.md |
| E23 | c:\Users\danie\Videos\Kokonada\docs\review\06-generate.html |
| E24 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aura\BioAura.tsx |
| E25 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aura\BreathingGlow.tsx |
| E26 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\emotionAccent.ts |
| E27 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\pulse\PulseScreen.tsx |
| E28 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\assets\fonts\OFL.txt |
| E29 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\assets\fonts\README.md |
| E30 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\package.json |
| E31 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\brandMark.geometry.ts |
| E32 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\generate\GenerateScreen.tsx |
| E33 | c:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aurora\LivingAurora.tsx |

Also relevant:
- c:\Users\danie\Videos\Kokonada\docs\adr\0009-calm-bioluminescent-design-language.md
- c:\Users\danie\Videos\Kokonada\docs\adr\0016-launch-platform.md
- c:\Users\danie\Videos\Kokonada\UI_UX_MASTER_PLAN.md (this describes the retired shadcn/Tailwind web plan; custodian should archive it)
- c:\Users\danie\Videos\Kokonada\docs\canvas\GeneralSans-Semibold.otf (second font copy; licence check needed)