# DEV ITEM — The ambient field: where it renders, and what degrades it

**Raised:** 2026-08-26, from the screen-14 (Flow) design review.
**Routing:** `architect` (item 1 is a product scope decision) → `developer` under TDD.
**Status:** not started.

Two gaps in the same subsystem, both surfaced by resolving a doc contradiction against the code. Neither is a canvas error; in both cases the canvas describes behaviour the app cannot currently produce.

---

## Item 1 · The canvas draws a living field on Now Playing. The app has none.

While resolving whether the field re-tints on arrival at Now Playing, the answer turned out to be **neither of the two candidate behaviours**, because the screen has no field at all.

`mobile/KokonadaHealth/src/experience/playback/NowPlayingScreen.tsx` renders **zero** occurrences of `LivingAurora`, `AuroraGradientFill` or `BioAura`. Its only ambient element is the local `PlaybackAura` behind the album art (`:32`, rendered `:155`), and its colour is `c.accent.glow` — the **fixed brand accent**, static, never emotion-derived.

The emotion quadrant *is* read on this screen, but once:

```ts
// :80  the session accent is chosen ONCE (static per session, never per-track)
const quadrant = useMemo(() => emotionAccentFor(store.getState().emotion.taps), []);
const accent = c.emotionAccent[quadrant];   // :113
```

and `accent.ink` is used **only** on the discovery receipt — its border (`:220`) and caption text (`:234`, `:254`). Nothing else on the screen carries the emotion hue.

The canvas board `NowPlaying.dc.html` draws a field regardless (5 `.fld` / `fldwrap` occurrences).

**The decision to make, and it is a product one:** does the living field extend to Now Playing, or does the board stop drawing one?

- **If it extends** — it must move under the Flow board's Transition 03 rule: hue and reach change only when the state has held for **two consecutive reads**, never on arrival. Re-tinting at the cut would show a listener their state improving because the music started rather than because they did, which inverts the regulator ethic on the screen where it matters most.
- **If it does not** — the board drops the `.fld` layers from `NowPlaying.dc.html`, and `PlaybackAura` on the fixed brand accent stands as the deliberate answer: the room stops reacting once the music is playing.

**There is a real argument for the second option.** Now Playing is the only screen where the music itself is the ambient element. A field that also moves competes with it.

## Item 2 · The degradation ladder has no signal to run on

The Flow board specifies four rungs of graceful degradation and now names a condition for each. Three of those conditions **cannot be detected today**:

| Rung | Condition | Detection |
|---|---|---|
| Second field lobe stops | low-power mode | **none** |
| Breath holds at rest frame | thermal, sustained | **none** |
| Field flattens to a static wash | thermal, critical | **none** |
| Genesis stops | never automatically | reduced motion only |

Searches that came back empty across `mobile/KokonadaHealth/src`: `lowPower`, `LowPower`, `batteryLevel`, `PowerState`, `isLowPowerMode`. The single `thermal` hit is a comment (`state/hot/laneCommit.ts:49`) explaining that `smoothTowards` derives alpha from **elapsed time, not frame count**, so convergence is identical at 120/60/30 Hz. All eight `fps` hits are comments asserting the same frame-rate independence. That is a good property — it means the app degrades *gracefully* under throttling already — but it is not a signal, and nothing reads a frame budget.

**The one real signal** is reduced motion: `AccessibilityInfo.isReduceMotionEnabled()` in `useMotion()` (`design/theme.ts:25-29`). Note it is a *user preference*, not device pressure — so it is not a rung on this ladder. It is a separate, complete still that applies at any rung, and the Flow board now says so.

**What is needed:** a power/thermal state source, and a token set for the intermediate rungs. The old plan proposed `motion.durationLowPower`; it does not exist (`grep` → 0), and only `duration` / `durationReduced` ship today.

**Do not ship the ladder before the signal.** Four rungs that can never fire are worse than no ladder, because the board reads as a specification of live behaviour.

## Related

- Screen 14 review: `docs/review/14-flow.html`
- `docs/plans/DEV_MOTION_SETTLE_TOKEN.md` — same token object, and shares the `duration`/`durationReduced` parity guard.
