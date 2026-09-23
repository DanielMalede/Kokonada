# DEV ITEM — Colour must resolve from one source in the app, as it now does on the canvas

**Raised:** 2026-08-26, from the colour-centralisation audit.
**Routing:** `developer` under TDD → `resilience-auditor`.
**Status:** canvas side DONE and proven. App side NOT started — this item.

---

## The rule

Changing the app's palette must be **one edit**, not one edit per file. Brand and accent hues derive from a small set of source values; nothing outside that set declares a colour.

## What the audit found in `mobile/KokonadaHealth/src`

Most of the codebase already does this well. 35 hex strings appear outside `tokens.ts`, and **all but two groups are comments annotating a derived value** — e.g. `const CTA_SKY: Hex = emotionAnchors.calm; // #3FB4F0`. That is derivation done right and needs no change.

Two real problems:

### 1 · `AURORA_CORNERS` is a second, independent declaration of the four brand hues

`design/emotionAccent.ts:66-71` declares the four Aurora hues as raw channel triples:

```ts
export const AURORA_CORNERS = {
  intense:    [139, 111, 232],  // #8B6FE8
  joyful:     [245, 185, 58],   // #F5B93A
  reflective: [75, 111, 208],   // #4B6FD0
  calm:       [63, 180, 240],   // #3FB4F0
};
```

`tokens.ts` declares the same four hues separately. **Neither file imports the other's values** — `tokens.ts` imports only the `Hex` type from `./contrast`, and `emotionAccent.ts` imports only the `EmotionQuadrant` type from `./tokens`. The comment is honest about it:

> "kept in lockstep with tokens.ts — auroraGlow.test.ts pins each corner against the token literal, so a re-tint that misses one fails loudly."

So drift is **caught**, but not **prevented**. A palette change is still two edits, and the test failure is the reminder rather than the mechanism. That is a materially better position than silent drift, and it is still not one source.

**Fix:** derive `AURORA_CORNERS` from the token values rather than restating them — parse the token hex into channels at module load (the existing `parseHex` helper in `experience/aura/auraBreath.ts` already does exactly this). Keep `auroraGlow.test.ts` as the guard; it should then be impossible to fail.

**Constraint that must not be broken:** `auroraGlow` feeds a Skia uniform every frame and is required to be **total** — every input including `NaN`/`∞`/`undefined` must yield a well-formed `#RRGGBB` and it must never throw. Any derivation must resolve once at module load, not per frame, and must not introduce a throw path.

### 2 · `brandMark.geometry.ts` hardcodes six colours, one of which it knows is a token

`design/brandMark.geometry.ts:72-79`:

```ts
bg: '#0E1030',
bgGradient: ['#0E1030', '#080A20'],
coreHighlight: '#FFCB6E',
coreBody: '#5EC8F5',
ring: '#9B7BF0',          // ← comment says "(= accent.glow)"
bloom: '#9B7BF0',
```

`ring` and `bloom` duplicate `accent.glow` and the comment says so. `bg` duplicates `surface.base` (dark). The remaining three are brand-mark-specific tints with no token.

**Fix:** `ring`/`bloom`/`bg` reference the tokens. The three mark-specific tints either become tokens or are declared in one place with a comment saying why they are not shared.

### 3 · Minor — three stale value comments

`experience/generate/neuralLoaderMath.ts:33-35` annotates its derived anchors as `// #31E1C4`, `// #FF8A73`, `// #FF5A5A`. The code correctly derives from `emotionAnchors`, but those hexes do not match the current anchor values (calm is `#3FB4F0`). The code is right and the comments lie. Correct or drop them.

## Definition of done

A test that changes one source hue and asserts every derived consumer moves — the app equivalent of the canvas proof below. Not a snapshot of literals; a derivation check.

---

## For reference: what the canvas side now does

`scratchpad/canvas/tokens.css` is a single file in two layers — **SOURCE** (the only literal colours that exist) and **APPLIED** (everything computed from them, via `color-mix()`). All 22 boards link it and declare no colour of their own.

Proven by mutation, not asserted: changing three source literals (`--hue-reflective`, `--ink-reflective-l`, `--ink-reflective-d`) and re-rendering all 22 boards in both themes moved **370 paints across 19 of 22 boards, with 0 left behind on an old value and 0 collateral change** to unrelated colours. The three boards that did not move are the achromatic pre-emotion screens, which have no reflective surface.
