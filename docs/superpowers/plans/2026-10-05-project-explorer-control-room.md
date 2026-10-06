# Kokonada Project Explorer Control Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, internal Hebrew Project Explorer that explains Kokonada's POC, architecture, verified project snapshot, deployment decision, and professional contribution workflow through a Control Room dashboard with optional Learning Mode.

**Architecture:** Add a dependency-free static site under `project-explorer/`. Core content stays semantic and readable without JavaScript; small UMD modules provide testable status data and client behavior, while a Node built-in local server supplies the checked-out Git SHA without writing generated files.

**Tech Stack:** Semantic HTML5, CSS, vanilla JavaScript, Node.js built-ins, `node:test`, PowerShell/Git for verification.

**Spec:** `docs/superpowers/specs/2026-10-05-project-explorer-control-room-design.md`

## Global Constraints

- This is an internal surface in the private repository, not the future public landing/privacy/store-support site.
- Do not deploy or publish it in this phase.
- Do not call the backend, GitHub, Railway, MongoDB, Redis, Spotify, or any other remote service from the page.
- Do not include secrets, credentials, production user data, private operational URLs, or production mutation controls.
- Keep the implementation dependency-free; do not add a framework, package lock, build step, or runtime package.
- Preserve core content when JavaScript or local storage is unavailable.
- Use Hebrew-first natural RTL; isolate technical flows in explicit LTR regions.
- Treat status as a dated 2026-10-05 snapshot at `55d68cc`, never as live telemetry.
- Present Kokonada as wellness, not medical diagnosis or treatment.
- Do not present YouTube as an active playback path.
- Keep PR #217 marked HOLD / do not merge or deploy in the initial snapshot.
- Meet WCAG 2.2 AA contrast intent, visible keyboard focus, reduced-motion support, and color-independent status labels.
- Stage only task-owned paths and use short single-line commits with no body or trailers.

## Review Focus

- A checkout SHA different from `55d68cc` must produce a visible “snapshot may be stale” state; Task 3 pins this in `app-core.test.js`.
- Denied or throwing local storage must leave Learning Mode enabled and the page usable; Task 3 pins this in `app-core.test.js`.
- JavaScript disabled or failed must still expose every core section and the deployment warning; Task 2 pins this in `page-contract.test.js`.
- Keyboard and narrow-screen users must retain navigation, visible focus, and readable diagrams; Task 4 pins structural CSS contracts and Task 6 performs browser checks.
- Path traversal or malformed requests to the local server must never escape `project-explorer/`; Task 5 pins this in `serve-core.test.mjs`.

---

## File Map

- `project-explorer/index.html` — semantic Hebrew document, all core copy, sections, navigation, controls, and no-JS fallback.
- `project-explorer/styles.css` — tokens, Control Room layout, responsive behavior, focus, status, and reduced-motion rules.
- `project-explorer/status-data.js` — dated engineering/deployment snapshot usable in both browser and Node tests.
- `project-explorer/current-commit.js` — direct-file fallback that declares the current checkout SHA unavailable.
- `project-explorer/app-core.js` — pure Learning Mode, step, and snapshot-state functions usable in browser and Node tests.
- `project-explorer/app.js` — thin DOM adapter for navigation, Learning Mode, glossary disclosure, and stale status.
- `project-explorer/serve-core.mjs` — safe static-path, content-type, and virtual current-commit helpers.
- `project-explorer/serve.mjs` — dependency-free local HTTP entry point and Git SHA reader.
- `project-explorer/README.md` — verified local start, test, and snapshot-refresh instructions.
- `project-explorer/tests/status-data.test.js` — exact snapshot/content contract.
- `project-explorer/tests/page-contract.test.js` — semantic, offline, no-JS, and content-presence contract.
- `project-explorer/tests/app-core.test.js` — pure behavior and failure-mode tests.
- `project-explorer/tests/style-contract.test.js` — focus, responsive, reduced-motion, and status-label structure.
- `project-explorer/tests/serve-core.test.mjs` — local server traversal, MIME, and commit-script tests.

### Task 1: Pin the dated project snapshot

**Files:**
- Create: `project-explorer/status-data.js`
- Create: `project-explorer/tests/status-data.test.js`

**Interfaces:**
- Produces: `KokonadaStatus` / `module.exports` with `{ schemaVersion, snapshot, product, verification, deployment, glossary }`.
- Produces: `snapshot.commit`, `snapshot.capturedOn`, and `snapshot.timezone` consumed by Tasks 2 and 3.
- Produces: `verification.backend`, `verification.mobile`, `verification.lint`, and `verification.audit` consumed by Task 2.

- [ ] **Step 1: Write the failing snapshot contract test**

Create `status-data.test.js` with `node:test` cases named:

- `exports the 2026-10-05 snapshot identity` asserting `schemaVersion === 1`, `commit === '55d68cc'`, `capturedOn === '2026-10-05'`, and `timezone === 'Asia/Jerusalem'`.
- `pins verified backend and mobile evidence` asserting backend `285/4658`, backend skipped `3 suites/38 tests`, mobile `200/2689`, mobile skipped `1`, and mobile open-handle warning `true`.
- `keeps warnings and audit findings visible` asserting backend lint `0/21`, mobile lint `72/75`, backend audit `6` with `0 critical`, and mobile audit `53` with `0 critical`.
- `keeps the deployment decision explicit` asserting recommended baseline `55d68cc`, PR `217`, decision `'hold'`, and `deployWithPr === false`.
- `contains the required plain-language glossary terms` asserting all terms from spec section 4.7 are present.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test project-explorer/tests/status-data.test.js`

Expected: FAIL because `../status-data.js` does not exist.

- [ ] **Step 3: Implement the UMD status object**

Create `status-data.js` as a side-effect-free factory that assigns the same frozen object to
`window.KokonadaStatus` in a browser and `module.exports` in Node. Use only values pinned by the
spec. Represent evidence provenance explicitly with values such as `verified-locally`, `ci`, or
`unverified`; do not derive an overall “healthy” boolean.

- [ ] **Step 4: Run the snapshot test to verify GREEN**

Run: `node --test project-explorer/tests/status-data.test.js`

Expected: 5 tests PASS.

- [ ] **Step 5: Commit the status contract**

```bash
git add project-explorer/status-data.js project-explorer/tests/status-data.test.js
git commit -m "feat: add project explorer status snapshot"
```

### Task 2: Build the semantic no-JavaScript document

**Files:**
- Create: `project-explorer/index.html`
- Create: `project-explorer/current-commit.js`
- Create: `project-explorer/tests/page-contract.test.js`

**Interfaces:**
- Consumes: `window.KokonadaStatus` from Task 1 for progressive status enhancement only.
- Produces: stable section IDs `overview`, `journey`, `architecture`, `data-flow`, `status`, `deployment`, `workflow`, `glossary`.
- Produces: hooks `[data-learning-toggle]`, `[data-learning-step]`, `[data-next-step]`, `[data-snapshot-state]`, and `[data-glossary-term]` for Task 3.

- [ ] **Step 1: Write the failing page contract test**

Use `fs.readFileSync` and `assert.match`/`assert.doesNotMatch` in cases named:

- `declares Hebrew RTL and semantic landmarks` — assert `lang="he"`, `dir="rtl"`, skip link, `header`, `nav`, `main`, and `footer`.
- `keeps every core section in static HTML` — assert all eight IDs and five numbered learning steps exist without relying on generated markup.
- `states the product boundary honestly` — assert Body + Mind to State to Music to Spotify, wellness/non-medical copy, privacy control, and no active YouTube path.
- `shows dated evidence and the PR 217 hold without JavaScript` — assert date, commit, key counts, `PR #217`, and a Hebrew do-not-merge/deploy warning.
- `uses local assets only` — reject `http://`, `https://`, protocol-relative asset URLs, forms, inline event handlers, and non-local script/style sources.
- `provides a no-script explanation` — assert a visible `noscript` note explaining that all core content remains available.

- [ ] **Step 2: Run the page contract test to verify RED**

Run: `node --test project-explorer/tests/page-contract.test.js`

Expected: FAIL because `index.html` does not exist.

- [ ] **Step 3: Create the semantic Control Room document**

Build the complete reading experience directly in HTML in the spec's section order. Include:

- project header with snapshot date and commit;
- desktop navigation and a mobile navigation control;
- first-viewport POC flow;
- five numbered Learning Mode callouts;
- user journey and architecture/data-flow diagrams using lists and labelled containers;
- evidence cards that expose skipped tests, warnings, audit findings, and provenance;
- an amber deployment decision panel recommending recorded `main` and excluding PR #217;
- professional worktree-to-production workflow;
- complete glossary;
- `noscript` fallback and explanatory footer.

Load scripts with `defer` in this order: `status-data.js`, `current-commit.js`, `app-core.js`,
`app.js`. Set `current-commit.js` to `window.__KOKONADA_CURRENT_COMMIT__ = null` so direct-file use
degrades to “checkout unknown”.

- [ ] **Step 4: Run the page and status contracts**

Run:

```powershell
node --test project-explorer/tests/status-data.test.js project-explorer/tests/page-contract.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the semantic page**

```bash
git add project-explorer/index.html project-explorer/current-commit.js project-explorer/tests/page-contract.test.js
git commit -m "feat: add project explorer semantic dashboard"
```

### Task 3: Add Learning Mode and stale-snapshot behavior

**Files:**
- Create: `project-explorer/app-core.js`
- Create: `project-explorer/app.js`
- Create: `project-explorer/tests/app-core.test.js`
- Modify: `project-explorer/index.html`

**Interfaces:**
- Consumes: Task 1 `snapshot.commit` and Task 2 DOM hooks.
- Produces: `KokonadaExplorerCore.normalizeLearningPreference(raw)` returning `true`, `false`, or `null`.
- Produces: `KokonadaExplorerCore.resolveInitialLearningMode(readPreference)` returning boolean and defaulting to `true` on missing/invalid/throwing storage.
- Produces: `KokonadaExplorerCore.deriveSnapshotState(snapshotCommit, currentCommit)` returning `'current'`, `'stale'`, or `'unknown'`.
- Produces: `KokonadaExplorerCore.nextStepId(currentId, orderedIds)` returning the next ID or `null`.

- [ ] **Step 1: Write failing pure behavior tests**

Create cases that assert:

- stored `'on'`/`'off'` resolve to `true`/`false`, while other values return `null`;
- missing, malformed, and throwing preference reads default Learning Mode to `true`;
- equal full/short commit prefixes return `'current'`;
- different commits return `'stale'`;
- null, empty, or non-hex current commit returns `'unknown'`;
- `nextStepId` advances across the five known IDs and returns `null` at the final or unknown ID.

- [ ] **Step 2: Run the app-core test to verify RED**

Run: `node --test project-explorer/tests/app-core.test.js`

Expected: FAIL because `app-core.js` does not exist.

- [ ] **Step 3: Implement the pure UMD behavior module**

Implement exactly the four interfaces above. Normalize commit strings case-insensitively and allow
prefix comparison only when both inputs contain 7–40 hexadecimal characters. Do not access the DOM
or local storage in this file.

- [ ] **Step 4: Run the pure tests to verify GREEN**

Run: `node --test project-explorer/tests/app-core.test.js`

Expected: all cases PASS.

- [ ] **Step 5: Implement the thin DOM adapter**

In `app.js`:

- read/write key `kokonada.learningMode` inside `try/catch`;
- keep `aria-pressed`, the visible mode label, and `document.body.dataset.learningMode` synchronized;
- make next-step actions focus and scroll to the next `[data-learning-step]` section;
- update `[data-snapshot-state]` from `deriveSnapshotState` using status data and
  `window.__KOKONADA_CURRENT_COMMIT__`;
- provide tap/click and keyboard-safe glossary disclosure using native `button` attributes;
- expose no globals beyond the already defined modules.

Update `index.html` only where required to complete these hooks and accessible labels.

- [ ] **Step 6: Run all behavior/content tests**

Run:

```powershell
node --test project-explorer/tests/status-data.test.js project-explorer/tests/page-contract.test.js project-explorer/tests/app-core.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit Learning Mode**

```bash
git add project-explorer/app-core.js project-explorer/app.js project-explorer/index.html project-explorer/tests/app-core.test.js
git commit -m "feat: add guided project explorer mode"
```

### Task 4: Apply the accessible Control Room visual system

**Files:**
- Create: `project-explorer/styles.css`
- Create: `project-explorer/tests/style-contract.test.js`
- Modify: `project-explorer/index.html`

**Interfaces:**
- Consumes: semantic classes and data attributes from Tasks 2–3.
- Produces: CSS custom properties for background, surface, text, muted text, teal, amber, danger, border, focus, and spacing.
- Produces: desktop side navigation, tablet two-column cards, and mobile single-column flow.

- [ ] **Step 1: Write the failing visual contract test**

Using static file assertions, add cases named:

- `defines the approved semantic color tokens` — assert named custom properties, with no status represented only by a color class.
- `pins visible focus and skip-link behavior` — assert `:focus-visible` and revealed skip-link rules.
- `supports reduced motion` — assert `@media (prefers-reduced-motion: reduce)` disables non-essential transition/scroll animation.
- `defines tablet and mobile layouts` — assert breakpoints at or near 960px and 640px and single-column content at the narrow breakpoint.
- `keeps technical flow readable on narrow screens` — assert a labelled flow container uses controlled horizontal overflow while body-level overflow is prevented.

- [ ] **Step 2: Run the visual contract test to verify RED**

Run: `node --test project-explorer/tests/style-contract.test.js`

Expected: FAIL because `styles.css` does not exist.

- [ ] **Step 3: Implement the visual system**

Create the near-black/navy dashboard, teal guidance/verified accents, amber warning panels, and
restrained danger state from the approved visual. Use compact cards with sufficient internal
spacing, not gradients or decoration as a substitute for hierarchy. Add visible text/icon labels to
every status. Keep all body copy readable at 200% zoom and set a comfortable Hebrew line height.

- [ ] **Step 4: Wire the stylesheet and status labels in HTML**

Add the local stylesheet reference and any non-color status icons/text needed for the style
contract. Do not move core content out of HTML.

- [ ] **Step 5: Run all four contract groups**

Run:

```powershell
node --test project-explorer/tests/status-data.test.js project-explorer/tests/page-contract.test.js project-explorer/tests/app-core.test.js project-explorer/tests/style-contract.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the visual system**

```bash
git add project-explorer/styles.css project-explorer/index.html project-explorer/tests/style-contract.test.js
git commit -m "feat: style project explorer control room"
```

### Task 5: Add the safe local server and operator guide

**Files:**
- Create: `project-explorer/serve-core.mjs`
- Create: `project-explorer/serve.mjs`
- Create: `project-explorer/tests/serve-core.test.mjs`
- Create: `project-explorer/README.md`

**Interfaces:**
- Produces: `resolveStaticPath(rootPath, requestUrl) -> string | null` that rejects traversal and maps `/` to `index.html`.
- Produces: `contentTypeFor(filePath) -> string` for `.html`, `.css`, `.js`, `.mjs`, and a safe binary fallback.
- Produces: `createCurrentCommitScript(commit) -> string` assigning a validated SHA or `null`.
- `serve.mjs` consumes those functions, reads `git rev-parse HEAD`, binds to loopback only, and serves the virtual `/current-commit.js` response.

- [ ] **Step 1: Write the failing server-core tests**

Assert:

- `/` resolves to `<root>/index.html`;
- ordinary local asset paths remain under the root;
- encoded and plain `..` traversal return `null`;
- query strings do not affect the resolved file;
- required extensions receive correct content types;
- a 40-character Git SHA produces an assignment script and invalid input produces `null`.

- [ ] **Step 2: Run the server-core test to verify RED**

Run: `node --test project-explorer/tests/serve-core.test.mjs`

Expected: FAIL because `serve-core.mjs` does not exist.

- [ ] **Step 3: Implement the pure server helpers**

Use only `node:path` and URL parsing. Decode safely, normalize against the fixed root, and reject any
resolved path outside that root. The commit script must serialize values with `JSON.stringify`.

- [ ] **Step 4: Run server-core tests to verify GREEN**

Run: `node --test project-explorer/tests/serve-core.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Implement the loopback-only server**

`serve.mjs` must:

- accept optional `--port`, defaulting to `4173`;
- bind to `127.0.0.1` only;
- read the current repository SHA with `git rev-parse HEAD` without modifying files;
- serve only files inside `project-explorer/`;
- return the dynamic commit script for `/current-commit.js`;
- return 404 for missing files, 403 for rejected paths, and 405 for non-GET/HEAD methods;
- print the exact local URL and stop cleanly on `Ctrl+C`.

- [ ] **Step 6: Write and verify the operator README**

Document these exact commands:

```powershell
node project-explorer/serve.mjs
node --test project-explorer/tests/status-data.test.js project-explorer/tests/page-contract.test.js project-explorer/tests/app-core.test.js project-explorer/tests/style-contract.test.js project-explorer/tests/serve-core.test.mjs
```

Explain that opening `index.html` directly keeps core content but cannot verify the checkout SHA.
Document the manual snapshot refresh checklist: fetch, identify commit, rerun project verification,
update `status-data.js`, run tests, review copy, and commit the refreshed evidence.

- [ ] **Step 7: Commit the local delivery path**

```bash
git add project-explorer/serve-core.mjs project-explorer/serve.mjs project-explorer/tests/serve-core.test.mjs project-explorer/README.md
git commit -m "feat: add project explorer local server"
```

### Task 6: Perform final functional and visual verification

**Files:**
- Modify only if verification finds a defect: files under `project-explorer/`

**Interfaces:**
- Consumes: the complete site and all tests from Tasks 1–5.
- Produces: a clean implementation worktree ready for user review in VS Code.

- [ ] **Step 1: Run the complete Project Explorer suite**

Run:

```powershell
node --test project-explorer/tests/status-data.test.js project-explorer/tests/page-contract.test.js project-explorer/tests/app-core.test.js project-explorer/tests/style-contract.test.js project-explorer/tests/serve-core.test.mjs
```

Expected: all tests PASS with exit code 0.

- [ ] **Step 2: Run repository hygiene checks**

Run:

```powershell
git diff --check origin/main...HEAD
git status --short
rg -n "https?://|fetch\(|XMLHttpRequest|WebSocket|EventSource" project-explorer
```

Expected: no whitespace errors; only intentional worktree changes; no runtime remote request code.
The README may contain no remote URL because none is needed.

- [ ] **Step 3: Start and probe the local server**

Run `node project-explorer/serve.mjs` in a background terminal, then verify:

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/current-commit.js).Content
```

Expected: `200`; the commit response contains the current 40-character worktree SHA.

- [ ] **Step 4: Review desktop and mobile behavior in a real browser**

At 1440px and 390px widths, verify:

- the first viewport explains the POC and identifies the snapshot;
- all five learning steps are reachable and next-step focus lands correctly;
- switching Learning Mode survives reload and still works when storage is blocked;
- stale/current/unknown snapshot states use text and icon, not color alone;
- navigation, glossary, and toggle work by keyboard;
- the architecture flow is readable without body-level horizontal scrolling;
- 200% zoom retains content and controls;
- reduced-motion mode removes smooth scrolling/non-essential transitions.

- [ ] **Step 5: Fix any observed defect with a focused RED/GREEN cycle**

Add the smallest failing test to the owning contract file, run it RED, patch the owning source file,
and rerun the complete suite. Stage only the affected paths.

- [ ] **Step 6: Commit verification fixes if any**

If files changed:

```bash
git add <explicit-project-explorer-paths>
git commit -m "fix: polish project explorer verification issues"
```

If no files changed, do not create an empty commit.

- [ ] **Step 7: Open the implementation worktree in VS Code**

Run:

```powershell
code -n "C:\Users\Daniel\Documents\Codex\2026-10-05\my\Kokonada\.worktree-project-explorer"
```

Confirm the VS Code window title references the Project Explorer worktree and hand Daniel the local
URL plus branch, commit, and verification summary. Do not merge, push, or deploy without a separate
explicit request.
