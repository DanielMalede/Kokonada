# Canvas scale audit — the four declared scales versus what the canvas paints

**Status:** queued, not started. Raised by `designer` across the S1 review rounds and
deliberately excluded from them. **Do this as one pass over one board covering all four
scales.** Splitting it by scale is the failure mode — radius, type and space are one
defect and will re-diverge if fixed separately.

**Why it is a defect and not a backlog:** `docs/canvas/Tokens.dc.html` is the board every
other board is checked against. It states rules as fact that its own render breaks — and
it already invented the correct remedy for one of the four scales and applied it nowhere
else.

## The remedy already exists on the board

`Tokens.dc.html` OFF-SCALE panel, for durations:

> *"Ten durations sit outside the declared scale. A scale nothing obeys is decoration, so
> they are counted here rather than assumed away."*

That is the pattern. Radius, type and space get the assertion with no audit. Each scale
either **conforms** or is **counted** in an off-scale panel beside the durations one, with
the sizes, the use counts, and which are intended to converge versus which are genuinely
local.

## 1 · Type — the largest gap

`Tokens.dc.html` publishes **"TYPE — NINE STEPS, NO HALF-PIXELS, NOTHING BELOW 11."**

Measured against the canvas it governs:

| finding | count |
|---|---|
| half-pixel font declarations, all boards | **206** |
| …of which on `Tokens.dc.html` itself | **23** |
| `13.5px` occurrences, across six boards | 16 (seven on `You`) |
| `12px` — off-ramp, between the 13 footnote step and the 11 caption floor | 34, across eleven boards |
| sizes below the declared floor of 11 | `9px`, `6.5px` (both on `You`) |

Worst per board: `Flow` 36 · `Components` 30 · `Tokens` 23 · `Plan` 15 · `YouVault` 15 ·
`You` 12 · `States` 11 · `Archive` 10 · `Receipt` 9 · `Pulse` 7 · `Field` 7 · `StateNoWatch` 7.

One role also fragments three ways: `Tokens.dc.html` declares the receipt verdict at **22**,
`Receipt.dc.html` renders **19**, and `Flow.dc.html` says it *"grows to 21px"* — 21 being one
of the exact sizes the board names as the old H1 sprawl it claims to have fixed.

**Explicitly out of scope:** the `12.5px` shrink on `Consent`'s pinned facts stays **struck**.
That is legally load-bearing text, 12.5 is already the notice body size so the change
destroys the contrast marking the summary as the summary, and shrinking consent copy to
win scroll room is the shape of the thing regulators look for.

## 2 · Radius

`Tokens.dc.html` publishes **"RADIUS — SIX, AND ONLY SIX: 6 · 10 · 14 · 20 · 28 · pill"**.

The canvas paints **eleven off-scale values** — 2, 3, 4, 5, 8, 11, 12, 13, 15, 16, 18 —
across **seventeen** boards. `Components.dc.html` alone paints 999, 16, 14, 11, 6, 5 and 4
while its eyebrow claims one control radius.

## 3 · Space

One page gutter is declared: **24**. `Consent` is correct at 24 on all four regions.
`You`, `Pulse`, `Main` and `Archive` are still on **22**, which is on no scale.

*(Do not "fix" this by porting 22 outward. `Consent` is the board that has it right.)*

## 4 · Motion — S1-4, the inverted declaration

Layer 1 declares the **derived** value and leaves the **primitive** as a literal in eleven files.

- `--d-field` = **5670** is declared, and is `4200 × 1.35` — the multiplication is done by hand.
- The literal **`4200ms`** appears **17 times across 11 boards**: `Field`, `Genesis` ×2,
  `Flow` ×3, `Splash`, `Onboarding`, `Main` ×2, `StateLoading`, `NowPlaying`, `Pulse` ×2,
  `States` ×2, plus `4200 MS` as display text on `Field`.
- `tokens.css` argues for exactly this fix in its own comment and does not do it.

**Fix:** declare `--t-field:4200ms` in Layer 1, redefine `--d-field: calc(var(--t-field) * 1.35)`
so 1.35 stops being hand-multiplied, and repoint the 17 literals.

Same inversion as the frozen `--swatch-tint` swatch, at three times the blast radius.

## 5 · The overlap check is not a standing guard

`canvas.json` geometry was corrected by a one-off script that no longer exists in the repo.
Its result ("0 board-vs-annotation overlaps") was a measurement, not a guard — the opposite
of what the `$preview`/record guard achieves. Two consequences:

- It can regress silently the next time a board grows.
- It used each annotation's **declared** `w` and an assumed height, so it is structurally
  incapable of reporting an annotation whose **rendered** text overruns its gutter.
  `states-note` is the case to check first: ~640 characters at `w:700` and ~13px type is
  roughly 7 lines (~140px) against 110px of clearance above `StateNoWatch`.

**Fix:** fold the check into `scripts/design/board.py` beside the height guard, measuring
rendered annotation height rather than assuming one.

## Definition of done

1. Every one of the four scales on `Tokens.dc.html` either matches what the canvas paints,
   or has an off-scale panel counting the exceptions with use counts and intent.
2. `--t-field` declared; `--d-field` derived from it by `calc()`; zero `4200ms` literals.
3. The annotation-overlap check lives in `board.py` and measures rendered height.
4. `board.py --all` clean, and a `designer` SHIP on the Tokens board specifically.
