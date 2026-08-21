# Kokonada — Design Brief for a Ground-Up Vision & UI/UX Rebuild

You are the lead product designer for **Kokonada**. Your job is not to reskin what exists — it is to author a **new design vision and a complete UI/UX system** for a shipped, working product, and to prove it with real screen designs.

Read this whole brief before drawing anything. It contains the product, the mechanics, the current design language, the hard constraints, and the deliverables.

---

## 1. What Kokonada is

Kokonada is a mobile app (React Native, Android now, iOS next) that turns **what you feel plus what your body is doing** into **music that matches this exact minute of your life**.

It is not a mood tracker. It is not a playlist app. The one-line pitch:

> *An emotional sanctuary that reads your mind and your nervous system at the same time, and answers with a living environment of sound, colour and motion.*

The user opens the app, pours in their conscious intent — a few taps on an emotion map, an activity, optionally a sentence — and the app fuses that with the **unconscious signal streaming off their body**: heart rate, HRV, resting HR, sleep, recovery, body battery, readiness, movement and derived stress, read from a Garmin watch or Android Health Connect, or live over Bluetooth.

From that fusion the backend computes a **State Vector** — a real, named physiological + emotional state such as *"High-Stress / Pre-Panic"*, *"Exhausted Commute"*, *"Resting but Content"*, *"Obligated but Drained"*, *"Peak Athletic Performance"* — translates it into musical targets (tempo centre and width, energy floor and ceiling, valence target, acousticness, instrumentalness), and builds a playlist that plays through the user's own Spotify or YouTube Music account.

The differentiator, which must never be designed away: **the body is a first-class input, never decoration.** A wrecked body that taps "energise" does not get bangers. A still, stressed body gets calm. A running body gets tempo locked to its cadence.

### The magic moment

The peak of the product arrives in the seconds right after the user commits their state. The screen transitions softly, a breathing "neural analysis" visual appears (**never a spinner**), and then the right music fades in. The feeling to engineer is *"it read my mind."* Everything else in the app exists to protect that moment: no latency theatre, no error toasts, no dead ends, no waiting.

### The ethic — regulator, not mirror

Because the app senses distress, it carries a duty. When biometrics indicate stress, the interface **slows, softens and deepens** — it entrains the user downward. It never visually or sonically amplifies agitation. Practically this means:

- High arousal is **never** rendered as red or alarm colouring. The existing palette caps the arousal ramp at violet/indigo — a racing heart is met with deeper, cooler light.
- Motion under stress gets *slower*, not faster.
- Nothing in the app ever scolds, shames, or gamifies the body. Streaks, scores, and "you slept badly" are all forbidden.

---

## 2. How the product actually works (the mechanics you are designing around)

**Input side**

- **Emotion map:** a radial wheel over the valence×arousal circumplex. The user places **up to 3 taps** anywhere on the disc — the payload is capped at 3 and this contract is fixed. X = valence (unpleasant ↔ pleasant), Y = arousal (low ↔ high). Taps can be undone one at a time or cleared entirely. Emotion is *placed*, not picked from a list — but a text/list alternative must exist for screen-reader and motor-impairment users.
- **Activity chips:** single-select from 8 presets — Running, Working, Resting, Walking, Commuting, Workout, Focus, Winding down.
- **Prompt box:** optional free text, 500 characters, sanitised.
- **Body:** continuously ingested in the background. Live heart rate arrives over a socket; batch vitals sync from Garmin / Health Connect.

**Two generation modes**

- **Manual** — the user's taps drive the generation.
- **Live** — when a heart-rate signal is present, the app can drive itself from the body, recalibrating the queue when the user crosses a heart-rate band (resting → active → peak). Live mode is **opt-in and off by default** — the app never hijacks a manual user.

**Output side**

- A generated set plays through the connected provider. The app is a controller over a remote player: **the real player is the source of truth**, so if the user changes track inside Spotify itself, the app reconciles rather than fights.
- Each set carries a **"mix receipt"** — an honest, human explanation of *why this music* ("your HRV was low and you'd been still for an hour, so I kept the tempo under 90 and leaned acoustic"). This is a trust surface and a differentiator; treat it as a real design object, not a tooltip.

**Privacy posture (a design theme, not fine print)**

- Raw biometrics are zero-knowledge: encrypted, never logged, never sent to the language model, never rendered from an unencrypted source.
- Health data requires explicit, versioned GDPR Article-9 consent — shown *just in time*, immediately before the OS permission sheet, never as a login wall.
- Full GDPR export and delete are in the product.
- The wearable is **always optional** — a "try with mood only" path exists everywhere and must never be buried.
- The app is **100% free.** No paywalls, no tiers, no upsells, no subscription UI, no ads. Do not design any.

---

## 3. Where the product is today

Everything above is **built and shipping**. Backend engine, biometric ingestion, generation, playback and all eleven screens exist and are device-verified. A design system called **"Aurora"** was locked in mid-2026 and is implemented in code.

**The current design language — "Calm / Premium Wellness × Bioluminescent Depth" / Aurora:**

- Two faces. **Light "Aurora Day"** is primary: cool porcelain canvas `#FAFAFF → #EEF1FC`, frosted white glass, generous whitespace. **Dark "Aurora Nocturne"** is the alternate: midnight indigo `#0E1030 → #080A20`, the same hues glowing through smoked glass.
- The **ambient aurora** is the brand: four soft radial colour blobs — sky `#5EC8F5`, violet `#9B7BF0`, gold `#FFCB6E`, pink `#F79AC0` — drifting slowly over the canvas on a 15-second cycle, with a 4.6-second focal-glow "breath".
- **Emotion re-tints the app.** The valence×arousal quadrant maps to an accent: calm = sky, joyful = gold, intense = violet (deliberately never red), reflective = indigo. The aura, the tap dots and the primary CTA all shift to the current emotion.
- **Gold** is the premium signature, used only at key moments, plus a 1px gold hairline frame.
- Type: General Sans for display, system face for text; modular ~1.25 scale — 34 / 28 / 22 / 18 / 16 / 15 / 13 / 11.
- Space on a 4pt base (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64); radii 6 / 10 / 14 / 20 / 28 / pill; soft diffuse wellness-grade shadows, never harsh Material drops.
- Motion tokens: 120ms fast / 240 base / 420 slow / 4200 breath / 15000 flow; easing "calm" = easeOutQuint `[0.22, 1, 0.36, 1]`. **Every motion token ships a reduced-motion variant that collapses ambient loops to zero.**
- A curated haptic vocabulary: selection / commit / success / warning. Audio earcons are opt-in and off by default.

**Treat this as context, not as a cage.** It is competent and it shipped, but it was authored under time pressure and it is exactly the thing I want re-examined. You are allowed — encouraged — to challenge the aurora-blob motif, the frosted-glass direction, the gold accent, the radial wheel's visual treatment, the five-tab structure, and the information architecture itself. What you may **not** change are the hard constraints in §6.

---

## 4. Every screen (the current map — restructure it if you can justify it)

Five tabs: **Generate · Now Playing · Pulse · History · Profile.**

1. **Splash / auth-check** — brand breath while the session restores. Under 1.5s, no error UI, sets the resting palette.
2. **Onboarding (FTUE)** — three panels teaching *feel it → your body is heard → your soundtrack*. Cinematic, near-wordless, full-bleed motion. This is the value-prop moment **before** any permission is requested. Must preserve the "try with mood only" escape.
3. **Login** — Google, Apple (exact HIG on iOS), email fallback. Trust-forward, providers at equal weight, zero dark patterns.
4. **Connect services** — two grouped cards, Music (Spotify / YouTube Music) and Wearable/Health, each with a status row, an action, and a "why we ask" expander. A prominent "Try with mood only" secondary path. The health path routes through the consent gate before the OS sheet.
5. **Generate — THE HERO.** Vertically: ambient bio-aura → radial emotion wheel (the star) → activity chips → prompt box → a morphing CTA reading *Generate* / *Listen to your heart* (live mode) / disabled. States: empty, one to three taps placed with undo and clear available, live-mode available, submitting, soft retryable error. When the keyboard opens for the prompt, the wheel shrinks to a mini-ring so the committed taps stay visible. This screen is where the product lives or dies.
6. **Genesis overlay** — the generating moment. Full-screen takeover, a breathing neural/particle field, one calm status line. Never a spinner. Reduced-motion gets an elegant static treatment. On failure it silently falls back to a deterministic set — the music never stops, the user never sees an error.
7. **Now Playing** — large album art with subtle gyro parallax, track and artist, transport, progress, and the mix-receipt "why this" affordance. States include *foreign track* (the user changed Spotify externally) and end-of-queue. Controls recede until touched.
8. **Pulse — the body dashboard.** Live tiles (heart rate, source, connection) → gauges (HRV, resting HR, sleep, body battery, readiness) → a friendly state headline like "Resting / Calm". Critically: **honest empty states.** Some metrics are Garmin-proprietary and simply absent on other watches — those read "Not shared by your watch", never a dash, never an error. This is where "the body is a first-class input" becomes visible.
9. **History** — reverse-chronological sessions. Each row: a friendly title ("Peak Energy"), a subtext ("Manual · Run" / "Live · running"), a time, tap to replay. A quiet archive, not a feed.
10. **Profile / "Privacy Vault"** — identity, integrations with consistent status rows, a health-data vault panel (what we read and why, sync, permissions), watch pairing, log out, withdraw health consent, delete account. The tone is *impenetrable and premium*; destructive actions are clearly separated from everything else.
11. **Health-data consent (Article 9 gate)** — the deliberate inverse of everything else in the app. A **static** surface, no aura, no reactive tint, a real scrollable legible legal document, and a fixed action bar where **Decline is exactly as easy as Agree** — same size, same weight, same contrast, no scroll-gating, no confirmshaming. This is the one place a legal choice is never emotionally nudged, and the one place "the music never stops" yields to legal integrity.

**Global system states every screen inherits:** loading → skeletons, never spinners; empty → a ghosted premium state with one guiding action, never a dead end; offline → a soft banner plus cached content; reduced-motion / low-power → animation simplifies or stops while layout stays identical.

---

## 5. What's coming next (design for this, don't ignore it)

The engine is being upgraded right now to a far more intelligent one. The UI has no home for any of it yet, and I want your vision to make room:

- **Around thirty distinguishable states** instead of a handful — *tired* vs *resting-but-content*, *stressed-needs-calm*, *no-energy-wants-calm*, *mid-activity*, *going-to-train-energised* vs *obligated-but-drained* — each with a real confidence value.
- **Per-person baselines** — the app learns *your* normal HRV and resting heart rate instead of comparing you to a population constant. There is a warm-up period before it knows you; that needs an honest, non-anxious representation.
- **Playlist trajectory / iso-principle arcs** — a set is no longer a flat target but a *path*: meet the user where they are, then guide them somewhere. This is inherently visual and currently invisible.
- **A discovery bandit** — the balance between familiar and new, learned per person. Users may deserve a sense of, or a hand on, that dial.
- **A feedback lane** — skips, replays and explicit signals teach the system. Feedback capture must feel weightless and must never turn into rating chores.
- **Morning state / daily analysis** — the app will know something about how the user woke up.

Consider whether these want new surfaces, new states on existing screens, or to stay entirely invisible. Argue your position.

---

## 6. Hard constraints (non-negotiable — a design that breaks these cannot ship)

1. **The emotion payload is at most 3 taps** on a valence×arousal disc. You may completely re-imagine how that disc *looks and feels*, but not that it is a continuous 2D placement capped at three.
2. **Never red for high arousal.** The arousal ramp stays in the cool band. Distress is met with deeper, cooler, slower light. This is enforced as a code-level invariant.
3. **No spinners at the Genesis moment.** Skeletons everywhere else.
4. **WCAG 2.2 AA minimum**, including all text over glass, gradients and the moving aurora. Dynamic Type throughout — no fixed pixel type. Minimum tap targets. Logical focus order. Emotion and state are **never encoded by colour alone** — always paired with shape, position or label. The emotion wheel needs a full screen-reader path plus a list alternative.
5. **Reduced-motion and low-power paths for every animated surface** — layout must not change when they engage, only motion.
6. **60fps is a hard floor** on a mid-range Android (Galaxy S22+ is the reference device); 120Hz where the panel allows. Animation runs on the UI thread. This rules out designs needing constant heavy blur over large moving areas without a degradation story — give one for anything expensive.
7. **The wearable is never a gate.** Mood-only users must reach the full core loop.
8. **The consent screen stays static, neutral and symmetric** (see §4.11).
9. **Third-party brand rules** — Spotify and YouTube Music marks, attribution, and Sign in with Apple must follow their published brand and HIG requirements exactly. Don't invent custom-styled provider buttons.
10. **No paywalls, no tiers, no subscription UI, no ads.**
11. **Zero magic numbers** — everything you specify must land in a token (colour, type, space, radius, elevation, motion, haptics), because the codebase enforces token-only styling.
12. **Light and dark are both first-class**, not an afterthought inversion.

---

## 7. What I want from you

**Deliverable 1 — the vision.** A short, sharp articulation of the *new* design idea in your own words: what the app feels like, what the central metaphor is, what makes it unmistakably itself and not a wellness template. Name the direction. Say explicitly what you keep from Aurora, what you replace, and why. I want a point of view, not a survey.

**Deliverable 2 — two or three distinct directions, not variations.** Genuinely different answers to "what is the visual metaphor for a body being heard." Show each on the same screen (Generate) so I can compare like for like. Then recommend one and defend it.

**Deliverable 3 — the design system** for the recommended direction: full colour matrices for light and dark (surfaces, content, accents, states, and the emotion-quadrant accents) with contrast pairs stated; a type scale with the faces you'd choose; space, radius and elevation scales; motion tokens including durations, easing curves and their reduced-motion variants; and the haptic vocabulary.

**Deliverable 4 — the screens.** Design every screen in §4 in the recommended direction, in both light and dark, including empty, loading, offline and error states. Show the Generate screen's full tap sequence (empty → one tap → three taps → submitting) and the Genesis moment as a sequence, not a single frame.

**Deliverable 5 — motion and the brand gesture.** Describe the signature motion — the "breath" — precisely enough to build: what animates, at what rate, driven by what, and how it degrades. Define the brand mark, wordmark, app icon and splash if you are changing them.

**Deliverable 6 — the argument.** For every meaningful departure from what exists, one or two sentences on what problem it solves. And tell me plainly where you think the current app is weakest.

---

## 8. How to work

- Lay the artboards out as a canvas I can walk through: vision and direction comparison first, then the token system, then the screens grouped by flow (first run → generate → play → body → archive → settings), then motion notes.
- Design at real mobile dimensions with real content — real track names, real state headlines, real mix-receipt copy. Never lorem ipsum, never "Card Title".
- Write the actual microcopy. The voice is calm, plain, honest and warm — never clinical, never cutesy, never motivational-poster. Short sentences. It says "Not shared by your watch", not "Data unavailable".
- Show the unglamorous states: empty History, a user with no watch, a failed connection, a stale consent, a low-power render. A design that only works when everything is perfect is not finished.
- Annotate. Where a choice serves the regulator ethic, the privacy posture, accessibility, or the 60fps floor, say so on the artboard.
- Where you are uncertain, or where two readings of this brief diverge materially, make the call, state the assumption on the canvas, and keep going. Don't stop to ask about things you can reasonably decide.

The bar: this should be able to win an Apple Design Award, and it should feel like a *sanctuary* — air, restraint, and room for feeling. When something doesn't earn its place, remove it.
