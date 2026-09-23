# Design verification tooling

The boards in `docs/canvas/` and the reviews in `docs/review/` are checked by these, not by eye
and not by grepping source. They were written during the per-screen review pass and lived in a
session scratchpad until 2026-08-27; they are tracked now because **the boards are committed and
the means of proving them was one cleanup away from being lost.**

Everything here renders in real headless Chrome and reads **computed styles off the rendered DOM**.
None of it greps a source file for a token name — that is the whole point. A board can reference
`var(--accent)` and still paint the wrong colour; only the rendered result settles it.

## The standing rule

**Run `board.py <Board>` after EVERY edit to a `.dc.html`.** Not at the end of a batch — every edit.

Four times during the review pass, a replacement across nested markup silently restructured a
screen while the measurements still looked fine: a stray `</div>` closed a card early, the player
and tab bar vanished, and the height still reported a clean 844. Measurements alone cannot catch
that, because a broken tree still reports a plausible height. `board.py` runs the structural checks
**and writes a screenshot**, because the screenshot is what actually caught it.

**And run `board.py <Board> --sweep` before calling a screen done.** The boards declare their states
in `data-props` — Consent alone carries `state` x `platform` x `open`. For a long time the probe
rendered `theme x 2` and nothing else, so those states had never once been looked at; a review found
three defects that existed only for that reason. The sweep walks one axis at a time (baseline, then
each non-default option of each prop with every other prop left at its default, crossed with both
themes) — 24 frames for Consent rather than the 80 a full product would cost.

Two things the sweep reports that the baseline check cannot:

- **Unsupplied holes.** `support.js` substitutes an *empty string* for a `{{hole}}` that
  `renderVals()` never supplies, so a missing value ships as a blank row and never appears in the
  DOM as `{{...}}`. The probe reads the key set off the board's own `renderVals()` and diffs it
  against the holes in the source, which is the only way to see that class.
- **Dead axes.** A prop whose every option renders identically — same geometry, same paint, same
  visible text — is either unwired or occluded. Suspects get a bounded second pass that pairs them
  with the most revealing option of each other axis before any verdict is printed, because Consent's
  `platform` only rewrites copy inside a section that is `display:none` until `open` is set.

## The tools

| | |
|---|---|
| `board.py <Board> [field]` | **The standing check.** Tag balance, CSS brace balance, a render probe (top-level count, overflow ignoring scroll containers, sub-44px targets, unresolved template holes), and a screenshot in both themes. `Board` is the bare name — `board.py Consent`. |
| `board.py <Board> --sweep` | The same checks over **every declared enum prop variant**, not just the two themes. Add `--all` for the whole canvas, `--strict` for a non-zero exit on failure. |
| `reviewcheck.py <file> [--bases a,b]` | Verifies a `docs/review/NN-*.html` against the method: frame count and size, light/dark split, overflow, **dead options** (drives every radio and proves the assembled frame actually changes), and network references. `--bases` sets which rows to take the cartesian product over. |
| `paint.py <Board> [field] [theme]` | Enumerates what a board *actually* paints, from computed styles. The engine the others import. |
| `palette.py snap\|diff` | Snapshot every colour every board paints. Used to **prove** colour centralisation: snapshot → change one source hue → snapshot → diff. If anything did not move, that is the list of things bypassing `tokens.css`. |
| `contrast.py <fg> <alpha> <bg>` | WCAG ratio with alpha compositing. A token at 14% opacity is not its hex value. |

## Paths

Resolved from the repo root, with env overrides:

- `KOKO_CANVAS` — defaults to `docs/canvas`
- `KOKO_PROBE_OUT` — defaults to `.design-probe/` (gitignored, disposable)
- `CHROME` — defaults to the Windows install path; set it on any other platform

## What these do not check

- **Meaning.** A board can be structurally perfect and still describe a product that does not exist.
  Every factual claim on a board has to be checked against source by a person.
- **The `.dc.html` runtime.** `paint.py` substitutes props and strips the `<x-dc>` layer itself, so
  a board passing `board.py` says nothing about whether it opens correctly in a browser. See
  `docs/canvas/support.js`.
- **Contrast, automatically.** `contrast.py` computes a pair you give it. Choosing the right pairs,
  and the right floor for each, is a judgement call — a mis-assigned floor reads as a clean pass.
