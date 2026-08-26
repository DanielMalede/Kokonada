# DEV ITEM — The archive's colour history: a title→quadrant mapping, and two fields it needs

**Raised:** 2026-08-26, from the screen-11 (History) design review.
**Routing:** `architect` (the mapping is a product decision, not a styling one) → `developer` under TDD → `resilience-auditor`.
**Status:** not started. The canvas now depicts this; the code does not produce it.

---

## Why this exists

Daniel's screen-11 decision tints every archive row by its emotional state. That is the one screen where colour genuinely carries information — every row has a known state — and contrast is not a barrier: all four quadrant inks clear the 4.5:1 text floor in both faces (calm 5.20, joyful 5.68, intense 6.36, reflective 5.63 in light).

**But no title→quadrant mapping exists anywhere in the repo.** I searched before proposing one. Choosing this treatment commissions the mapping, and the mapping is an interpretive claim about what a person was feeling — so it needs an owner, not a default.

## Dependency 1 · The mapping itself

`friendlyTitle()` (`historyFormat.ts`) can return exactly ten things. Here is the mapping the canvas now draws, and the two cases it does **not** answer:

| Title | Source | Proposed quadrant |
|---|---|---|
| `Calm` | `MOOD_TITLES.calm` | calm |
| `Unwind` | `MOOD_TITLES.unwind` | calm |
| `Uplift` | `MOOD_TITLES.uplift` | joyful |
| `Energize` | `MOOD_TITLES.energize` | joyful |
| `Intense` | `MOOD_TITLES.intense` | intense |
| `Focus` | `MOOD_TITLES.focus` | reflective |
| `Resting` | `BIO_BAND_TITLES.resting` | calm |
| `Peak Energy` | `BIO_BAND_TITLES.peak` | intense |
| **`Active`** | `BIO_BAND_TITLES.active` | **UNRESOLVED** — a raised heart rate carries no valence. It is joyful on a walk and intense in a panic, and the archive cannot tell which. |
| **`A moment`** | `GENERIC_TITLE` | **UNRESOLVED** — the generic exists precisely because the state is unknown. It must not be given a colour. |

**Two rules that must hold whatever is decided:**
1. **The generic gets no colour.** `A moment` means "we do not know"; tinting it would be the archive asserting a feeling it never read. Render it in `--ink`.
2. **Never infer valence from arousal alone.** The bio bands are heart-rate bands. Mapping `Active` to a valenced quadrant would reintroduce the exact confusion the regulator ethic exists to prevent — and would be a mirror, not a regulator. If it cannot be resolved from stored data, `Active` gets no colour either.

A `moodKey`-keyed map is safer than a title-keyed one: `title` can be backend-supplied free text, `moodKey` is the controlled vocabulary.

## Dependency 2 · `metaLine()` must compose the track count

The board now renders `Live · Running · 18 tracks`. `metaLine()` today returns source and activity only:

```ts
export function metaLine(item): string {
  return [sourceLabel(inferSource(item)), activityText(item)].filter(Boolean).join(' · ');
}
```

`trackCount` **is** a field on `SessionItem`, so this is composition, not new data. Guard a zero/absent count so the row never reads `· 0 tracks`.

## Dependency 3 · The "same state, new music" badge must be earned

The board shows it on two of eight rows. Today it is on all five and means nothing. Earning it requires comparing a row's state against earlier sessions in the feed — a comparison that does not exist in `sessionsFeed.ts`. Define it precisely: *the same quadrant as the immediately preceding session*, or *the same quadrant seen within N days*? Those produce different badges. Until it is defined, the badge is decoration.

## What already landed on the canvas

- `tokens.css` gained `--q-calm` / `--q-joyful` / `--q-intense` / `--q-reflective`, theme-resolved from the existing per-face inks. Still one source; no new literals.
- The Archive board's **tab-bar chrome was made neutral**. It used `var(--accent)`, which on a fieldless board resolves to the reflective ink — so "this tab is selected" was painted the same colour as the reflective *rows*. On any screen showing several quadrants at once, chrome must not borrow one of them. **This likely applies to every tab bar and belongs on the Components board.**

## Risk flag

Shipping the tinted archive before the mapping is agreed means the app makes a claim about a user's past emotional states based on an undocumented default. That is worse than an achromatic list. Either the mapping lands with an owner, or the rows stay neutral.

## Related

- Screen 11 review: `docs/review/11-history.html`
- `docs/plans/DEV_COLOUR_SINGLE_SOURCE.md` — the quadrant inks' single source.
