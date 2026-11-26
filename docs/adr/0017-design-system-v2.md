# ADR-0017 — Design system v2: StyleSheet with our own tokens and primitives, behind a generated token pipeline and an isolated v2 layer

**Status:** Proposed · 2026-11-26
**Implements:** `DEC-033` (DECIDED 2026-09-23: "מנוע העיצוב נשאר `StyleSheet` עם טוקנים ופרימיטיבים משלנו. `Tamagui` ו-`Moti` יוצאים, ו-`ADR-0017` מחליף את `ADR-0009`.") · `ARCH-013` (plan §6 B9)
**Supersedes (on acceptance only):** ADR-0009. Until the owner accepts this ADR (`DAN-051`), ADR-0009 keeps its status (`ARCH-008`).
**Related:** `DEC-130` (the V1 direction, Abyss), `DEC-081`, `DEC-172`, `DEC-174`, `DEC-192`, `ARCH-017`, `UI-093`, `UI-094`, `UI-160`, `UI-168`, `DAN-033`, `DAN-051`, ADR-0016

## Context

ADR-0009 set the v1 design language: one design language bound to a Tamagui token architecture, with UI motion bound
to the ingested BPM and HRV. Design v2 rebuilds the interface from zero. `DEC-033` keeps React Native's `StyleSheet`,
with our own tokens and primitives, and drops Tamagui and Moti. Neither is a dependency of the app today:
`mobile/KokonadaHealth/package.json` holds React Native 0.86.0, `@shopify/react-native-skia` and
`react-native-reanimated`, and no Tamagui or Moti package. The owner chose Abyss as the V1 direction on 2026-10-07
(`DEC-130`), so the token sources ship exactly one direction.

The v2 foundations exist on the integration branch `wip/v2-hero-lab` at `13635c2`. They are not on `main` yet. This
ADR describes them as built there. Paths below are relative to `mobile/KokonadaHealth/` unless they start at the repo
root. If a path has moved by the time the foundations land on `main`, this ADR is the defect to fix before acceptance.

Three of the rulings cited below were decided under `DEC-142` by the orchestrator, once the named agents agreed:
`DEC-081` (2026-10-04), `DEC-172` and `DEC-174` (both 2026-10-06). The owner may reverse each of them. Their DECIDED
records are on the integration branch. On `main`, `DEC-081` still reads OPEN in `docs/design-v2/DECISIONS.md` until
those records land.

`/page` batch mode needs this ADR at least Proposed before any page batch. The pages are built in batches and the
owner reviews them at the end (`DEC-192`, rulings 1, 2 and 5). For that, the contract every page builds against has to
be written down once, here, rather than rediscovered per page.

## Decision

Design v2 is six layers. Each layer depends only on the layers below it. Each boundary is held by a test, not by
convention (see *Guards*).

### L0 — The token source

- `design-tokens/base.tokens.json` and `design-tokens/direction.abyss.tokens.json` (repo root) hold every v2 design
  value in DTCG form. They are the only place a colour, scale, motion or field value is authored.
- `neverRed.*` in the base file is the owner's (`DEC-081`); the designer locks the other token groups. No other
  direction may appear in the sources, the app or the scripts.

### L1 — The generator

- `scripts/tokens/generate.mjs` reads the sources (`lib/sources.mjs`), validates them (`lib/schema.mjs`) and emits
  three modules (`lib/emit.mjs`). `--check` exits 1 if a committed module is stale. A schema error exits 1, naming the
  path.
- The output is deterministic, byte for byte, and each module records the sha256 of every source file it was built
  from.
- A move to Style Dictionary (F1, `UI-094`) must reproduce all three modules byte for byte, or it does not land.

### L2 — The three generated modules (`DEC-172`)

They live in `src/design/v2/tokens/` and nobody edits them by hand.

- `tokens.generated.ts` — the styling tokens: `BASE` and `DIRECTIONS`, by face. App code reads it through
  `useTokens()` under a `DirectionProvider`. `useTokens()` throws without a provider or for an unknown direction
  rather than paint with a guess. A phone that reports no display mode reads as the dark face (`DEC-034`).
- `tokens.statics.generated.ts` — the field's runtime statics: the rest lobes, the drift tables, the fallback stops,
  and the graph's edges and node tier.
  - A pinned allow-list in the generator (`RUNTIME_STATICS`) selects them. The module is plain data with no imports,
    so worklets can capture it.
  - Changing the allow-list needs the designer's acknowledgement in its PR.
  - Validation at generation bounds each rest lobe: finite, 1 or 2 lobes per direction, and
    |c| ≤ `field.lobe.centreAlpha` + `field.lobe.centreBeta`.
- `tokens.extensions.generated.ts` — prose, capture plans and test data (the hero scenes, the hardest placements,
  the never-red scenes). Only the Design Lab, scripts, tests and the dev-only field preview may import it. Metro does
  not tree-shake, so any other importer would ship it.
- The field's builder takes `FieldStatics` as a parameter. A composition root supplies it as a memoised prop, once
  per direction. No worklet reads the extensions module. Until the `fieldStatics` adapter replaces `staticsFor`
  (`ARCH-017`, 1E), the lab passes the statics from the extensions module and the data sits in both modules.

### L3 — The laws: `src/design/v2/{color,tokens,clock,motion,field}`

- **Colour.** Colour is computed in OKLab and OKLCH (`color/oklab.ts`, `blendSpace.ts`, `gamut.ts`, `displayP3.ts`).
  Every mix goes through `mixSafe`. `redBand.ts` is the one test for red.
- **Never red (`DEC-081`, DSN-013).** A colour is red when its hue is in the band, both ends included, and its chroma
  is at or above the band's floor (a closed band). There are two bands:
  - the check band, for captured 8-bit pixels: h ∈ [350°, 50°], floor 0.020;
  - the design band, for analytic colours in float: h ∈ [345°, 55°], floor 0.015.

  Every authored colour, and every sweep's largest in-band chroma, stays at least 0.0005 below the floor of each band
  it is checked against.
- **Motion.** The clock and motion layers sit behind ports (`motion/ports.ts`). Reduced motion comes from the
  platform's setting (`reduceMotionSource.ts`), and every motion has a reduced form.
- **The field (Skia).**
  - `field/effect.ts` compiles the runtime effect once per process. An effect that cannot draw gives `FieldFallback`,
    and that answer is kept.
  - `FieldView` runs the placement ledger and the builder on the UI thread, once per drawn frame. The JS thread never
    reads the ledger per frame: it hears only of a start (`onStart`, with the admitted count and the live
    placements), the still tier's stop, and a failure.
  - A builder throw switches to `FieldFallback` for the rest of the mount.
  - `FieldView` is keyed by direction, face and scene, so a switch mounts a fresh ledger.
  - The effect's status is never reported off the device (REG-066).
- **The placement ledger** (`field/placementLedger.ts`) is the visual layer's only record of the placements.
  - It is derived from the cold-lane taps alone, read by value as `{x, y}`. It never imports `src/state` and persists
    nothing.
  - It is pure worklet code with no clock of its own.
  - Leaves cancel waiting enters ("netting").
  - Crossfades are serialised: a crossfade never interrupts another, and starts are at least `motion.settle.duration`
    apart.

### L4 — The components: `src/design/v2/components/` (F10)

- **Plate** — the plate's geometry, its rim, and its accessibility reading order.
- **RimLabels** — the rim words, as Skia text on the arc.
  - TalkBack reads them top, bottom, right, left in every locale.
  - Words that need a shaper are refused before they render (`visualOrder`).
  - Letters near a live bead are knocked out.
- **Bead** — `BeadLayer`, `useBeadPresence` and `beadTimeline`. A translucent bead is achromatic; its colour sits on
  an inner disc that is visible only while the bead is opaque. That way a bead composited over the field can never
  make red.
- **PlateTouch** — takes callbacks only, and hands each placing touch to its `toPoint` prop. Each page passes
  `screenToCircumplex` itself (QA-087, QA-088), so the ≤3-tap payload, the three lanes and the circumplex geometry are
  unchanged.
- **PlateEntry** — the plate's button. Activating it opens the list of every place (RA-39).
- **CommitCTA** and its pure machine `ctaState` / `useCtaMachine`, under `DEC-174`:
  - It shows, and changes its tint, only at the field's admitted starts, from a placement live in the store.
  - It hides at once when the store empties, and the hide latches.
  - It is pressable and exposed to accessibility only while shown, not hiding, and with a tap in the store.
  - In any 1 s window it makes at most 5 changes and at most 2 general flashes. `DEC-016` and DSN-018 stand.
- **Well** — hosts the hint and the action. Its first painted frame already has its final height.

Components may read the laws. No law imports a component.

### L5 — Composition roots: the pages, the Design Lab, the dev preview

Roots measure the layout and inject every source a component needs. v2 imports nothing outside itself:

- **Faces (F6).** `src/design/v2FaceSources.ts`, outside v2, holds each bundled face's Metro asset. The root mounts
  `TypefaceProvider sources={V2_FACE_SOURCES}` above the page's Skia text.
  - The provider loads the faces into one Skia font manager.
  - A face that fails to load throws to the nearest error boundary, never quietly to the system face.
  - React Native text names its face through `fontFace(family, weight)`. On Android that is the bundled file's name
    with no `fontWeight`, and a face the app does not bundle throws.
  - The bundled faces are Heebo (300–600) and Bellefair 400.
- **Copy, through the copy port.** No component owns a string: the page resolves every label, hint and accessible
  text and passes it in.
  - The port is a contract today, not code.
  - Regulated (R) keys carry no text in a batch tree. Batch PRs carry keys, neutral copy and placeholders, and the
    regulated text lands only with the cutover (`DEC-192`, ruling 5 (F3-B), and rulings 9, 12 and 15).
- **Statics.** The root supplies the field's statics (L2).
- **The Design Lab** (`src/design/lab/`) composes the same components from synthetic data only.
  - It has its own entry (`index.lab.js`), its own Android build type and its own application id (`.lab`).
  - The release entry (`index.js`) never imports it. It is absent from every uploadable build, not merely
    unreachable there (MB-084, QA-077).

### Evidence for the colour law (`UI-160`)

- Some band sweeps take too long for CI's sweeps budget. They run in an evidence lane, `scripts/field/bandEvidence.mts`,
  by hand: at the V1 law freeze, and in every PR that changes an input that moves a sampled band colour.
- `scripts/field/bandEvidence.stamp.json` records:
  - the sha256 of the inputs;
  - the commit the lane ran at;
  - its PASS line;
  - the sha256 of the run file.
- A test fails whenever the inputs no longer hash to the stamp. No CI job runs the lane, so a green PR is never
  mistaken for this evidence.

### DSN- design rules, and the ledger

- **DSN-** is reserved in `docs/design-v2/registry/INDEX.md` for design rules, and this ADR mints them in the L1
  registry.
- The designer authors each rule. A scribe writes it as `docs/design-v2/registry/DSN-nnn.md` and updates the INDEX
  in the same change.
- **Numbering keeps the drafted numbers.** DSN-001 to DSN-012 are V0's findings, and the rest follow the V1 draft.
  Existing records already cite them (DSN-013 in `DEC-081`, DSN-018 in `DEC-174`), so nothing is renumbered and an ID
  is never reused.
- A rule retired later stays in the registry, marked retired.
- Until a rule is minted, a finding cites the ledger's section and the draft ID, or a CMP-, REG-, DEC- or QA- ID.
- **What the ADR fixes, and what it leaves to the ledger.** This ADR fixes the layers, the boundaries and the laws
  above. It leaves the taste laws, the per-page composition rules, and the token values inside the locked groups to
  the designer's ledger of 2026-11-23 and its versions.
  - The ledger ranks below this ADR once the ADR is accepted.
  - If the ledger contradicts a boundary or a law here, the ledger is the defect.

## Alternatives rejected

- **Tamagui (ADR-0009's token architecture).**
  - Its compiler and theme runtime would sit between the tokens and every view, and it would own the tokens' shape.
  - The never-red law, the per-face values and the field's statics need a token contract we validate at generation
    and pin byte for byte; a third-party theme format would carry that only through adapters.
  - It adds a large dependency and upgrade surface to a React Native upgrade path that is already tight (`DEC-192`,
    F2-B).
  - Dropped by `DEC-033`.
- **Moti.**
  - Declarative animation over Reanimated, run as a JS-side abstraction.
  - The field's motion must be one builder step per frame on the UI thread, serialised by the ledger, with flash
    bounds proved on the exact ramps (`DEC-174`, E6). A second animation layer could start or retarget fades outside
    the ledger, which is the failure `DEC-174` exists to prevent.
  - Dropped by `DEC-033`.
- **ADR-0009's approach, carried forward.**
  - Its regulator ethic stays: under tension the interface calms, it never intensifies.
  - Its binding of UI motion to the ingested BPM and HRV is dropped (CMP-016, QA-070, REG-016). Motion follows the
    person's own placements and the platform's settings, never a live body signal.
  - Its glass, blur and luminous chrome conflict with Abyss, where the only light is the light the person places.
  - Its Vision-Frame gate is retired by design v2's stages.

## Consequences

- Every v2 value has one source and one generated form. Changing a value is a token edit plus a regenerated module,
  never a literal in a component.
- The field and its laws cannot be moved by a component change, so a page batch can change components and pages
  without re-proving the field. The cost is boilerplate: sources, statics and copy are injected at every root.
- The lab ships nowhere, so lab-only scenes can hold synthetic data and capture plans freely.
- Never red is proved three ways: by sweeps in CI, by the band evidence lane by hand, and by device captures. A change
  to an input of the colour law obliges a fresh stamp.
- Until `ARCH-017`'s 1E lands, the runtime statics sit in two modules. Until the CI sweeps filter covers
  `components/Plate/**` and `components/CommitCTA/**`, E6 runs on the coarse grid only, and no verdict may claim E6
  verbatim or close `UI-168`.
- In fallback no admitted start arrives, so the CTA never shows. The architect's F10 G8 rulings of 2026-11-25 (F1,
  S1) require the fallback to run the same ledger on JS and deliver starts the same way. Until that lands, a page with
  a CTA cannot pass in fallback.

## Guards

Each boundary is held by these tests. Paths are relative to `mobile/KokonadaHealth/`.

- **v2 isolation** (`src/design/v2/__tests__/isolation.test.ts`):
  - no relative import leaves `src/design/v2`, except the test fixture's two generator imports, pinned by file and
    specifier;
  - nothing outside a `__tests__` folder imports `__fixtures__`;
  - no file under `field/`, `color/`, `tokens/`, `clock/` or `motion/` names a module under `components/`;
  - every relative import names its file;
  - the design-system lint baseline holds no key under `src/design/v2/` or `src/design/lab/`;
  - each rule is also run against planted violations, which must fail.
- **The token-only lint** (`eslint.design-system.js`; `tools/eslint-plugin-kokonada/__tests__/no-color-literals.test.js`,
  `no-scale-literals.test.js`, `require-disable-reason.test.js`): colour and scale literals are errors everywhere under
  v2, tests included. Only `tokens.generated.ts` is exempt.
- **The generator** (`scripts/tokens/__tests__/generate.test.ts`, `schema.test.ts`, `freshness.test.ts`,
  `retiredDirections.test.ts`, `secretScanShape.test.ts`):
  - each of the three modules is byte for byte what the generator makes;
  - each records its sources' sha256;
  - exactly one direction (Abyss) ships;
  - the statics module is plain data at every depth;
  - no retired direction appears outside Markdown.
- **The extensions boundary** (`src/design/v2/tokens/__tests__/extensionsBoundary.test.ts`): only tests, the lab and
  `design/v2/preview/` import the extensions module. The statics module stays outside the ban.
  `scripts/jest/__tests__/devPreviewExcluded.test.ts` keeps the preview out of release bundles.
- **Worklet safety and the statics port** (`src/design/v2/__tests__/workletSafe.test.ts`,
  `src/design/v2/field/__tests__/graphConformance.test.ts`).
- **Never red:**
  - `src/design/v2/color/__tests__/redBand.test.ts` and `mixSafe.test.ts`;
  - `src/design/v2/tokens/__tests__/neverRed.field.test.ts`, `neverRed.edges.test.ts`, `neverRed.edgeAnchors.test.ts`,
    `neverRed.beadTwin.test.ts` and `neverRed.full.abyss.sweeps.test.ts`;
  - `bandCertificate.test.ts` and `betaPairFamily.test.ts`;
  - `src/design/v2/field/__tests__/fallbackNeverRed.skia.test.ts`;
  - `src/design/v2/components/Plate/__tests__/rimNeverRed.test.ts`;
  - the evidence lane's stamp: `scripts/field/__tests__/bandEvidence.test.ts`.
- **The ledger and the field** (`src/design/v2/field/__tests__/placementLedger.test.ts`, `ledgerStorms*.test.ts`,
  `FieldView.test.tsx`, `frameCap.test.ts`, `flashCount.sweeps.test.ts`).
- **The CTA (`DEC-174`):**
  - `src/design/v2/components/CommitCTA/__tests__/ctaStorms.test.ts` (E6, with its planted cases);
  - `ctaStateClosure.test.ts`: the machine's import closure loads no React Native, no native library and nothing from
    `Bead/`;
  - `ctaState.test.ts` and `useCtaMachine.test.tsx`.
- **The plate's taps never leave the page**
  (`src/design/v2/components/PlateTouch/__tests__/plateTouchClosure.test.ts`): nothing in PlateTouch's closure writes
  the cold lane, opens a socket, persists, prompts for a permission or reaches a native module.
- **Faces** (`src/design/v2/typeface/__tests__/faces.test.ts`, `TypefaceProvider.test.tsx`,
  `typefaces.skia.test.ts`; `src/design/lab/__tests__/fonts.test.ts`, `labFontGate.test.tsx`,
  `labTypefaceGate.test.tsx`).
- **Copy** (`src/design/v2/components/RimLabels/__tests__/rimWordsCopy.test.ts`): every locale's rim words pass
  `visualOrder`.
- **The lab's absence** (`src/design/lab/__tests__/labExclusion.test.ts`): statically, the release entry never
  reaches the lab. `scripts/lab/assertLabExcluded.mjs` proves it again on a real Metro and Hermes release bundle.

## What stays open

- **`DAN-033`, the provider colours.** `CMP-099` makes the Sign in with Google colours fixed values, while QA-056 and
  QA-058 ban colour literals outside token files.
  - The options are D1, a fixed provider group in the tokens, never mapped per face; D2, Google's official button
    images; and D3, a lint-exempt module.
  - This ADR takes none of them. The owner's ruling amends this ADR before it is accepted, and until then no provider
    colour enters the tokens.
- **`DAN-051`, acceptance.** The owner accepts or amends this ADR at his V1 sitting. On acceptance ADR-0009 becomes
  "Superseded by 0017" (`ARCH-008`). The orchestrator's rulings cited here (`DEC-081`, `DEC-172`, `DEC-174`) stay
  reversible by him until then.
- **The copy port** is a contract with no code yet. Its first implementation, and the catalogue that holds the R
  keys, come with the pages and the held regulated-copy branch (`DEC-192`, F3-B).
- **iOS is frozen** (ADR-0016; no Mac). `fontFace`'s iOS form (family plus weight) and every v2 surface on iOS are
  untested on a device. Device evidence is Android only, on emulators with one pass on the owner's phone at the
  cutover (`DEC-192`, ruling 2).
- **The React Native upgrade** (`DEC-192`, F2-B: target 0.88.1, fallback 0.87.1) lands before any batch PR merges.
  The foundations described here are built on 0.86.0.
