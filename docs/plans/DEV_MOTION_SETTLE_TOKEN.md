# DEV ITEM — Add `motion.duration.settle = 1200` to the token scale

**Raised:** 2026-08-26, from the screen-14 (Flow) design review.
**Routing:** `developer` under TDD.
**Status:** not started. Small, and the Flow board now depends on it.

---

## Scope: one entry in one object

`motion.duration` (`mobile/KokonadaHealth/src/design/tokens.ts:259`) is today:

```ts
duration: { instant: 0, fast: 120, base: 240, slow: 420, breath: 4200, flow: 15000, focalGlow: 4600 }
```

Every value the Flow board cites resolves to one of these — `120` is `fast`, `240` is `base`, `420` is `slow`, `4200` is `breath`, and `cubic-bezier(.22, 1, .36, 1)` is `easing.calm` verbatim. **One value does not: 1200 ms.** It is used by two different transitions, and until now the board carried it as a literal marked *"proposed token"*.

Daniel adopted it (screen 14, `settle=token`), so the board now names it as real. Add:

```ts
duration: { instant: 0, fast: 120, base: 240, slow: 420, settle: 1200, breath: 4200, flow: 15000, focalGlow: 4600 }
```

## Why it needs its own name rather than reusing `slow`

`slow` (420) is a *transition* duration — a cut between two screens. `settle` is a **state change within a screen**: the field moving to a new hue and reach, and the placement dots moving to the fused hue. They are the same event seen from two elements, which is exactly why the board gives them one duration. Reusing `slow` would collapse two distinct ideas and make a future change to screen-transition timing silently retime the field.

The two consumers:

- **Transition 00, "The read lands"** — the dots move from the placed hue to the fused hue over 1200 ms on `easing.calm`, with an 80 ms stagger, newest dot first.
- **Transition 03, "The field changes state"** — hue and reach cross-fade together over 1200 ms.

## Do not forget `durationReduced`

`durationReduced` (`tokens.ts:261`) mirrors every key and sets it to 0:

```ts
durationReduced: { instant: 0, fast: 0, base: 0, slow: 0, breath: 0, flow: 0, focalGlow: 0 }
```

**`settle: 0` must be added there too.** The comment above it says reduced motion "collapses transitions to near-instant and stills every ambient loop" — a key present in `duration` and missing from `durationReduced` would read as `undefined` at the one moment the value matters most, and the Flow board specifies a designed reduced-motion still for both consumers (the dots render at the fused hue immediately; the field steps rather than eases).

## Guard

`tokens.test.ts` already pins motion invariants. Extend it with a structural assertion rather than a value check: **every key in `duration` has a matching key in `durationReduced`.** That catches this whole class of bug — a token added to one object and not the other — instead of only this instance.

## Related

- Screen 14 review: `docs/review/14-flow.html`
- The board now states the token as real, so it and the code disagree until this lands.
