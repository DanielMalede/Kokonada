---
status: living
verified: 2026-09-02
---

# Development items

Small development items from the 2026-08-26 design reviews and audits, one section each, in alphabetical order of their original file names. Each item's status of record is its `TASKS.md` rows (last column); the text below is the original write-up, kept verbatim with its headings one level down. New items of this size are new sections here, never new files (`README.md` § Where a new file goes).

| Item | Raised | Status (as last written in the item) | TASKS rows |
|---|---|---|---|
| [TASK — Mobile jest times out on a cold cache](#cold-jest-timeout) | 2026-08-26, on Windows 11, Node 24 | open, unfixed, **not caused by and not in scope for** the dependency-cleanup / design-system-lint change that … | `MB-006` |
| [DEV ITEM — Colour must resolve from one source in the app, as it now does on the canvas](#colour-single-source) | 2026-08-26, from the colour-centralisation audit | canvas side DONE and proven. App side NOT started — this item. | `MB-003` |
| [DEV ITEM — Email sign-in: wire the mobile client to the auth path the server already ships](#email-signin-path) | 2026-08-26, from the screen-03 (Sign in) design review | not started. Not a canvas item — this is code. | `MB-001` |
| [DEV ITEM — The archive's colour history: a title→quadrant mapping, and two fields it needs](#history-state-colour) | 2026-08-26, from the screen-11 (History) design review | not started. The canvas now depicts this; the code does not produce it. | `MB-004` |
| [DEV ITEM — Playback position and seek, so the Now Playing scrubber is a real control](#playback-seek-and-position) | 2026-08-26, from the screen-08 (Now Playing) design review | not started. | `MB-002` |
| [DEV ITEM — Sign-in brand assets, button styling and the privacy manifest](#signin-brand-assets) | 2026-08-26 by `compliance-auditor`, against sources fetched  | not started. Canvas side is fixed; everything below is shipped code. | `MB-036` |
| [DEV ITEM — Spotify marks, cover art and link-back on the canvas](#spotify-canvas-assets) | 2026-08-26 by `compliance-auditor` (two independent passes a | the redrawn-mark failure is **fixed**; the cover-art and geometry items are **open**. | `UI-003` |

---

<a id="cold-jest-timeout"></a>
## TASK — Mobile jest times out on a cold cache
_Was `docs/COLD_JEST_TIMEOUT_TASK.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Status:** open, unfixed, **not caused by and not in scope for** the dependency-cleanup / design-system-lint change that found it.
**Surface:** `mobile/KokonadaHealth`
**Found:** 2026-08-26, on Windows 11, Node 24.19.0, jest 29 + `@react-native/jest-preset`.

---

### The symptom

On a **cold** babel transform cache, `jest --ci` fails 9 tests across 3 suites. On a **warm**
cache the same tree is fully green. Nothing about the code changes between the two runs.

| Run | Cache | Timeout | Result | Wall clock |
|---|---|---|---|---|
| `jest --ci` | cold (after `npm ci`) | default 5000 ms | **9 failed**, 1405 passed / 1414 | 37 s |
| `jest --ci` | warm | default 5000 ms | 1414 passed / 1414 | 10 s |
| `jest --ci --testTimeout=20000` | cold (after `--clearCache`) | 20000 ms | **1414 passed / 1414** | 46 s |
| `jest --ci` | cold (after a `jest.setup.js` edit) | default 5000 ms | **62 failed**, 1410 passed / 1472 | 33 s |
| `jest --ci` | warm | default 5000 ms | 1472 passed / 1472 | — |
| `jest --ci --testTimeout=20000` | cold (after `--clearCache`) | 20000 ms | **1472 passed / 1472** | 37 s |

The last three rows are the same tree as the first three plus a `jest.setup.js` change. Editing
that file invalidates the whole transform cache, and the failure count went from 9 to **62**.

In the 9-failure run, every failure was the same thrown string — `Exceeded timeout of 5000 ms
for a test.` **Zero assertion failures.** (The 62-failure run is uglier; see the next section.)
Raising only the timeout, changing nothing else, turns the cold run green in both cases. So the tests are not wrong and the code under them is not wrong: the first
transform of a render-heavy module tree does not finish inside the per-test budget.

Worst observed case was worse still — an early cold run that happened to be sharing the machine
with two Metro bundle builds failed **38** tests. The failure count scales with machine load,
which is the signature of a time budget, not a defect.

### It does not fail as timeouts. It fails as lies.

This is the part that makes it worth fixing rather than tolerating. In the 62-failure run only
**16** messages were `Exceeded timeout of 5000 ms`. The other 46 were ordinary-looking assertion
failures and `TypeError`s in the *same files* — a timed-out test leaves the renderer mid-flight,
and every test after it in that file inherits the wreckage:

```
● HistoryScreen … › a confirmed-empty response shows the never-dead-end EmptyState
    expect(received).toContain(expected)
    Expected substring: "Your moments will live here"
    Received string:    ""
```

Nothing in that output says "timeout". It says the empty state does not render — a bug that does
not exist. Anyone triaging this red build starts by debugging `EmptyState`. The one real signal,
the timeout, is upstream in a different test and easy to scroll past.

So the cost of leaving this is not "some flaky reds". It is engineering hours spent chasing
fabricated failures, and a standing incentive to re-run rather than read.

### The 9 tests

`src/__tests__/shadow.experience.test.tsx`

1. ATTACK 6 (autonomous): GenerateScreen warm-store subscription on unmount › unmounting the Generate tab unsubscribes from the warm store (every subscribe is cleaned up)

`src/experience/connect/__tests__/ConnectServicesWearable.test.tsx`

2. ConnectServicesScreen — wearable → §11 consent → OS sheet (T6) › CROWN JEWEL: a not-yet-consented tap shows the wall and does NOT open the OS sheet until consent is granted
3. ConnectServicesScreen — wearable → §11 consent → OS sheet (T6) › DECLINE is penalty-free — dismisses the wall, never opens the OS sheet, mood-only intact
4. ConnectServicesScreen — wearable → §11 consent → OS sheet (T6) › BACKGROUND mid-consent (Modal onRequestClose) dismisses the wall with the OS sheet still shut
5. ConnectServicesScreen — wearable → §11 consent → OS sheet (T6) › OFFLINE during grant fails CLOSED — Agree errors, the OS sheet never opens, gate stays open
6. ConnectServicesScreen — wearable → §11 consent → OS sheet (T6) › Health Connect UNAVAILABLE routes to install — no wall, no OS sheet, gate open
7. ConnectServicesScreen — wearable → §11 consent → OS sheet (T6) › UNSUPPORTED platform (non-Android) presents an honest note, not a broken CTA
8. ConnectServicesScreen — wearable → §11 consent → OS sheet (T6) › DENY-TWICE throttle (OS sheet resolves []) → guidance alert, gate stays open

`src/experience/playback/__tests__/UpNextSheet.render.test.tsx`

9. UpNextSheet — list re-render hygiene (L3/V2) › a cursor-change re-render does not re-invoke every row — only the rows whose cursor state flips

Two other suites — `src/design/system/__tests__/EmptyState.test.tsx` and
`src/navigation/__tests__/SystemStateDock.test.tsx` — timed out on a cold run earlier the same
day under heavier load. Treat the list above as the tests closest to the edge, not as a closed set.

### Why this matters

**CI runs cold every single time.** `npm ci` on a fresh runner means no jest transform cache
ever exists, so the `mobile` job is running in exactly the configuration that fails locally. It
has been going green on GitHub's Linux runners, which are evidently fast enough to stay under
5000 ms — but the margin is unmeasured, and the failure mode is a red build on tests that are
correct. That is the worst kind of red: it teaches people to re-run rather than to read.

The eight `ConnectServicesWearable` tests are also not incidental coverage. They are the consent
gate — "does NOT open the OS sheet until consent is granted", "fails CLOSED". A flake that
routinely reds those is a flake that gets muted.

### What is NOT the cause

- **Not the dependency cleanup.** The same class was observed on the pre-change tree, and that
  change removed 335 packages and a babel plugin, which can only reduce transform work.
- **Not a behavioural regression.** No assertion failed in any cold run. Only the clock.
- **Not the new lint tooling.** Those suites are pure-node and finish in milliseconds.

### Where to start

Ordered by how much they would settle, not by effort:

1. **Measure the real cold cost per suite on a Linux CI runner** before choosing a fix — the
   headroom on GitHub's runners is currently unknown, and that number decides whether this is
   urgent or merely latent. `--logHeapUsage` and per-suite timings from a cold CI run.
2. **Raise `testTimeout` in `jest.config.js`.** One line, proven to work on both trees above. The objection is that
   it slows the discovery of a genuinely hung test; the counter is that 5000 ms is already not
   catching hangs, it is catching cold starts.
3. **Warm the transform cache in CI** — cache `jest`'s `cacheDirectory` across runs keyed on
   `package-lock.json` + `babel.config.js`, so CI stops paying the cold cost at all. This is the
   fix that makes CI match the warm local experience rather than papering over the gap.
4. **Look at what those three suites import.** They are the heaviest render trees in the app
   (Skia + reanimated + gesture-handler + navigation). If the cost is one shared import chain,
   trimming or stubbing it helps every suite, not just these.

Do **not** "fix" this by deleting, skipping, or loosening the assertions in the 9 tests. They
pass. The budget is what is wrong.

### Reproduce

```bash
cd mobile/KokonadaHealth
./node_modules/.bin/jest --clearCache
./node_modules/.bin/jest --ci                      # expect timeouts
./node_modules/.bin/jest --ci                      # warm: expect green
./node_modules/.bin/jest --clearCache
./node_modules/.bin/jest --ci --testTimeout=20000  # cold + headroom: expect green
```

<a id="colour-single-source"></a>
## DEV ITEM — Colour must resolve from one source in the app, as it now does on the canvas
_Was `docs/plans/DEV_COLOUR_SINGLE_SOURCE.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26, from the colour-centralisation audit.
**Routing:** `developer` under TDD → `resilience-auditor`.
**Status:** canvas side DONE and proven. App side NOT started — this item.

---

### The rule

Changing the app's palette must be **one edit**, not one edit per file. Brand and accent hues derive from a small set of source values; nothing outside that set declares a colour.

### What the audit found in `mobile/KokonadaHealth/src`

Most of the codebase already does this well. 35 hex strings appear outside `tokens.ts`, and **all but two groups are comments annotating a derived value** — e.g. `const CTA_SKY: Hex = emotionAnchors.calm; // #3FB4F0`. That is derivation done right and needs no change.

Two real problems:

#### 1 · `AURORA_CORNERS` is a second, independent declaration of the four brand hues

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

#### 2 · `brandMark.geometry.ts` hardcodes six colours, one of which it knows is a token

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

#### 3 · Minor — three stale value comments

`experience/generate/neuralLoaderMath.ts:33-35` annotates its derived anchors as `// #31E1C4`, `// #FF8A73`, `// #FF5A5A`. The code correctly derives from `emotionAnchors`, but those hexes do not match the current anchor values (calm is `#3FB4F0`). The code is right and the comments lie. Correct or drop them.

### Definition of done

A test that changes one source hue and asserts every derived consumer moves — the app equivalent of the canvas proof below. Not a snapshot of literals; a derivation check.

---

### For reference: what the canvas side now does

`scratchpad/canvas/tokens.css` is a single file in two layers — **SOURCE** (the only literal colours that exist) and **APPLIED** (everything computed from them, via `color-mix()`). All 22 boards link it and declare no colour of their own.

Proven by mutation, not asserted: changing three source literals (`--hue-reflective`, `--ink-reflective-l`, `--ink-reflective-d`) and re-rendering all 22 boards in both themes moved **370 paints across 19 of 22 boards, with 0 left behind on an old value and 0 collateral change** to unrelated colours. The three boards that did not move are the achromatic pre-emotion screens, which have no reflective surface.

<a id="email-signin-path"></a>
## DEV ITEM — Email sign-in: wire the mobile client to the auth path the server already ships
_Was `docs/plans/DEV_EMAIL_SIGNIN_PATH.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26, from the screen-03 (Sign in) design review.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor`.
**Status:** not started. Not a canvas item — this is code.

---

### Why this exists

`docs/design-v1/screens.md` §3 specifies an email flow. The Sign in screen draws a **"Continue with email"** button. Daniel's decision (2026-08-26) is that **both stay** and the code catches up.

Today the mobile client cannot perform that action.

---

### What already exists — the server side is built and tested

This is **not** a build-from-scratch. The backend email path is complete:

| Piece | Where |
|---|---|
| `POST /api/auth/signup` · `POST /api/auth/login` | `backend/app/routes/auth.js:15-16` (both behind `authLimiter`) |
| Controllers | `backend/app/controllers/authController.js:147` (`signup`), `:159` (`login`) |
| Business logic | `backend/app/services/auth/passwordAuth.js` — exports `{ signup, login }` |
| Password hashing | argon2, with a constant-cost `dummyHash()` on unknown-email logins so both branches cost one argon2 call (timing-safe) |
| Identity model | `Identity { provider: 'password', providerUserId: email }`; the unique index is the race arbiter, and a lost race rolls the fresh `User` back so no orphan survives |
| Tests | `backend/tests/auth.password.test.js`, `auth.controller.test.js` |

**Validation contract, already enforced server-side** (`passwordAuth.js:27-40`):
- email trimmed + lowercased, ≤254 chars, no control/whitespace chars, must match `^[^\s@]+@[^\s@]+\.[^\s@]+$`
- password length between `PASSWORD_MIN` and `PASSWORD_MAX`
- failure reasons returned as `{ ok:false, reason }` — `invalid-email` · `invalid-password` · `email-taken`, mapped to status/message by `SIGNUP_ERRORS`

### What is missing — all of it client-side

`mobile/KokonadaHealth/src/auth/auth.ts` exports exactly `signInWithGoogle`, `signInWithApple`, `isLoggedIn`, `signOut`. **There is no email path.** `SignInScreen.tsx` therefore has no email affordance at all, and the button on the canvas has nothing to call.

### Scope

1. **`auth.ts`** — add `signUpWithEmail(email, password)` and `signInWithEmail(email, password)` returning the same `KokonadaUser` shape as the OAuth paths, and installing into the same `AuthSession` token plane (single-flight refresh). No new session mechanism.
2. **Preserve the sacred contract.** `SignInScreen.tsx:29` — a successful sign-in ALWAYS runs `<provider>() → currentUserStore.setUser() → onSignedIn()` (QA4 Suspect #1). The email path funnels through the **same** `runSignIn` handler; it does not get its own ignition.
3. **A validated form** — email + password, with the client mirroring the server's rules so the user is not round-tripped for a malformed address. Client validation is a courtesy; the server stays authoritative.
4. **Error surfacing** — map `invalid-email` / `invalid-password` / `email-taken` / network failure onto the existing inline alert (`accessibilityRole="alert"`, `state.danger`). Do not invent new error chrome; screen 03's error state is already designed.
5. **States** — idle · submitting · error, matching the OAuth buttons' `opacity: busy ? 0.6 : 1` treatment.
6. **Tests first.** Extend `src/auth/__tests__/loginFlow.test.ts` and `SignInScreen.test.tsx`. Cover: happy path both verbs, each `reason`, the timing-safe unknown-email login, and that `onSignedIn` fires exactly once per success.

### Risk flag — read before shipping the screen

**Shipping the Sign in screen ahead of this code puts a dead control in front of users.** The button is drawn on the canvas and specified in `docs/design-v1/screens.md`, but until `auth.ts` gains the path, tapping it can do nothing. Either this item lands first, or the screen ships with the button withheld. It must not ship visible-and-inert.

### Compliance notes for the gate

- **Apple Guideline 4.8** requires Sign in with Apple wherever a *third-party* login is offered. A first-party email/password path does not by itself trigger 4.8 — but Google sign-in already does, and Apple is already implemented behind `Platform.OS === 'ios'`. No change.
- **Guideline 5.1.1(v)** — an app offering account creation must offer account deletion. `GET /api/auth/account/export` exists; account deletion is the Vault screen's "Delete my account". Confirm that path is real before this ships, since email signup makes account creation a first-party act.
- Password handling, rate limiting and lockout are already the server's; the client must never log, cache or persist the password.

### Related

- Screen 03 review: `docs/review/03-signin.html`
- `docs/design-v1/screens.md` §3 — keep the email flow in the spec; it is now backed by a dated dev item rather than being aspirational.

<a id="history-state-colour"></a>
## DEV ITEM — The archive's colour history: a title→quadrant mapping, and two fields it needs
_Was `docs/plans/DEV_HISTORY_STATE_COLOUR.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26, from the screen-11 (History) design review.
**Routing:** `architect` (the mapping is a product decision, not a styling one) → `developer` under TDD → `resilience-auditor`.
**Status:** not started. The canvas now depicts this; the code does not produce it.

---

### Why this exists

Daniel's screen-11 decision tints every archive row by its emotional state. That is the one screen where colour genuinely carries information — every row has a known state — and contrast is not a barrier: all four quadrant inks clear the 4.5:1 text floor in both faces (calm 5.20, joyful 5.68, intense 6.36, reflective 5.63 in light).

**But no title→quadrant mapping exists anywhere in the repo.** I searched before proposing one. Choosing this treatment commissions the mapping, and the mapping is an interpretive claim about what a person was feeling — so it needs an owner, not a default.

### Dependency 1 · The mapping itself

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

### Dependency 2 · `metaLine()` must compose the track count

The board now renders `Live · Running · 18 tracks`. `metaLine()` today returns source and activity only:

```ts
export function metaLine(item): string {
  return [sourceLabel(inferSource(item)), activityText(item)].filter(Boolean).join(' · ');
}
```

`trackCount` **is** a field on `SessionItem`, so this is composition, not new data. Guard a zero/absent count so the row never reads `· 0 tracks`.

### Dependency 3 · The "same state, new music" badge must be earned

The board shows it on two of eight rows. Today it is on all five and means nothing. Earning it requires comparing a row's state against earlier sessions in the feed — a comparison that does not exist in `sessionsFeed.ts`. Define it precisely: *the same quadrant as the immediately preceding session*, or *the same quadrant seen within N days*? Those produce different badges. Until it is defined, the badge is decoration.

### What already landed on the canvas

- `tokens.css` gained `--q-calm` / `--q-joyful` / `--q-intense` / `--q-reflective`, theme-resolved from the existing per-face inks. Still one source; no new literals.
- The Archive board's **tab-bar chrome was made neutral**. It used `var(--accent)`, which on a fieldless board resolves to the reflective ink — so "this tab is selected" was painted the same colour as the reflective *rows*. On any screen showing several quadrants at once, chrome must not borrow one of them. **This likely applies to every tab bar and belongs on the Components board.**

### Risk flag

Shipping the tinted archive before the mapping is agreed means the app makes a claim about a user's past emotional states based on an undocumented default. That is worse than an achromatic list. Either the mapping lands with an owner, or the rows stay neutral.

### Related

- Screen 11 review: `docs/review/11-history.html`
- `docs/plans/dev-items.md#colour-single-source` — the quadrant inks' single source.

<a id="playback-seek-and-position"></a>
## DEV ITEM — Playback position and seek, so the Now Playing scrubber is a real control
_Was `docs/plans/DEV_PLAYBACK_SEEK_AND_POSITION.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26, from the screen-08 (Now Playing) design review.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor`.
**Status:** not started.

---

### Why this exists

Daniel's screen-08 decision draws a **draggable scrubber** on Now Playing. The client cannot currently perform that action, and cannot even display the position it would scrub through. Same shape as the email sign-in item: the design is chosen, the code catches up.

### What exists today

| Piece | State |
|---|---|
| `positionMs`, `durationMs` from the Spotify App Remote | **Arrive**, via `onRemoteState` → `playbackServices.ts:49` → `orchestrator.syncToRemote(...)` |
| Where they are used | **Only** `playbackOrchestrator.isTrackFinished()` (`:342`), for end-of-track detection |
| `nowPlayingStore` | `{ track, isPlaying }` — no position, no duration |
| `spotifyRemoteAdapter` | `connect`, `disconnect`, `playUri`, `playContext`, `skipToIndex`, `skipNext`, `skipPrevious`, `pause`, `resume`, `getPlayerState`, `getTrackImage` |
| Seek | **No such method anywhere.** |

So there are two separate gaps, and they are not the same size.

### Scope

#### A · Position display — plumbing, not new capability
1. Extend `nowPlayingStore` with `positionMs` and `durationMs` (nullable), fed from the same `syncToRemote` path that already receives them. Do **not** add a second subscription; the data is already flowing.
2. Both values must survive a `null`/`undefined`/non-finite remote payload without rendering `NaN:NaN` — the existing `isTrackFinished` guards show the shape to follow.
3. The remote emits on its own cadence, not per frame. The store must not become a per-frame write; throttle or accept the remote's rate.

#### B · Seek — genuinely new capability
4. Add `seek(positionMs)` to `SpotifyRemoteLike` and implement it on `spotifyRemoteAdapter` (`SpotifyRemote.seek`). It is not in the interface today, so the type change will surface every call site.
5. Wire the Now Playing slider: drag updates a local value, release commits one `seek`. Never emit a seek per drag frame.
6. Clamp the target to `[0, durationMs]`. A seek past the end must not race `isTrackFinished()` into a false end-of-track.
7. **Tests first** — extend `experience/playback/__tests__`. Cover: seek clamping, drag-then-release emits exactly one call, a lost/rejected seek leaves the store consistent, and a null-position payload renders no time text.

#### C · Accessibility
8. The slider carries `role="slider"` with `aria-valuemin`/`max`/`now` and a spoken `aria-valuetext` (the board models this). Those values must be **real** once the store is plumbed — the same rule applied to the Genesis meter: never announce a position the system does not have.

### Risk flag — read before shipping the screen

**Shipping Now Playing ahead of this puts a dead control in front of users**, and a scrubber is worse than a dead button: it invites a drag and then does nothing, which reads as the app being broken rather than the feature being absent. Either this lands first, or the screen ships with the bar as read-only (position only, no thumb) until seek exists.

If only part A lands, the honest interim is a **read-only progress bar with no thumb** — that is a real reading of real data and affords nothing it cannot do.

### Related

- Screen 08 review: `docs/review/08-now-playing.html`
- `docs/plans/dev-items.md#email-signin-path` — same pattern: design chosen ahead of the code, with the same shipping rule.

<a id="signin-brand-assets"></a>
## DEV ITEM — Sign-in brand assets, button styling and the privacy manifest
_Was `docs/plans/DEV_SIGNIN_BRAND_ASSETS.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26 by `compliance-auditor`, against sources fetched that day.
**Routing:** `developer` under TDD → `compliance-auditor` re-check before submission.
**Status:** not started. Canvas side is fixed; everything below is shipped code.

The canvas failures found in the same audit have already been corrected: `Login.dc.html` drew a monochrome hand-made "G" and `&#63743;` (U+F8FF — the Apple logo glyph from Apple's private-use area). Both are now official-asset slots, matching NowPlaying and Receipt. The items below are in the app.

---

### 1 · Google button — NEEDS-ASSET

**Requirement** — Sign in with Google Branding Guidelines, https://developers.google.com/identity/branding-guidelines (page last updated 2026-07-07 UTC, fetched 2026-08-26):

> "Following these guidelines on displaying the Sign in with Google button is **required for app verification**."

> "Regardless of the text, you can't change the size or color of the Google 'G' logo. It must be the standard color version … and appear on a white background."

Prohibited, verbatim: *"Use monochrome versions of the Google 'G' for the button"*, *"Create your own icon for the button"*, *"Put the standard color Google 'G' icon on a colored background other than light, dark, or neutral"*.

**What the code does** — `SignInScreen.tsx:67-86`: the button contains **no Google mark at all**, only a `<Text>` reading "Continue with Google". There is no sanctioned logo-free variant. Fill and stroke come from theme tokens, and in dark theme `c.surface.raised` is `#161A3C` (`tokens.ts:122`) — a coloured background, outside Google's permitted light / dark / neutral fills.

**Fix** — `@react-native-google-signin/google-signin@16.1.2` is already a dependency (`package.json:16`) and ships `GoogleSigninButton`, which renders the official asset. Use it, or use the pre-approved downloads. **Do not hand-roll the mark.**

Also apply Google's padding structure — Android/Web `12 / 10 / 12`px, **iOS `16 / 12 / 16`px** — which neither surface implements. There is **no minimum height or width**; the only sizing rule is preserving aspect ratio so the logo is never stretched.

**Passing already:** the wording. "Sign in with Google", "Sign up with Google" and "Continue with Google" are all permitted, and localisation is *"permitted and encouraged."*

### 2 · Apple button style in dark mode — NEEDS CHANGE

**Requirement** — Apple HIG, Sign in with Apple (fetched 2026-08-26):

> "**Black:** … Use this style on white or light-color backgrounds that provide sufficient contrast; **don't use it on black or dark backgrounds.**"

**What the code does** — `SignInScreen.tsx:91` hard-codes `buttonStyle={AppleButton.Style.BLACK}`. The screen background is `c.surface.base`, which in dark is `#0E1030` (`tokens.ts:119`) — near-black.

**Fix** — drive it from the theme: `BLACK` in light, `WHITE` in dark. Optionally set `cornerRadius` to `radius.pill`; the HIG says *"Adjust the corner radius to match the appearance of other buttons in your app"*, and today Apple's default radius sits beside a pill-shaped Google button.

**Worth recording:** the auditor corrected a premise I gave it — Apple **does** permit a custom button (*"If your interface requires it, you can create a custom Sign in with Apple button"*), but only within fixed bounds: official logo artwork only, title from a fixed set, logo and title both black or white, title font size **43% of button height**, logo height matched to button height, no vertical padding, minimum 140×30pt. Using the system `AppleButton` remains the right call — it satisfies all of that by construction.

### 3 · Apple button height under Dynamic Type — NEEDS CHANGE

**Requirement** — HIG: *"Make a Sign in with Apple button no smaller than other sign-in buttons."* Google's equivalent: *"displayed at least as prominently as other third party sign-in options."* **Neither vendor mandates an order** — Google-then-Apple is fine — but both set a prominence floor.

**What the code does** — the two heights are equal *by coincidence*, via different mechanisms. Google: `paddingVertical: space.lg` (16) ×2 plus a `typography.size.body` (16) text line ≈ **52**. Apple: `height: 52`, hard-coded (`SignInScreen.tsx:115`).

At accessibility text sizes the Google button grows past 52 while Apple stays fixed — so the Apple button becomes measurably smaller than another sign-in button, breaching the HIG **on exactly the devices belonging to users who most need larger text**.

**Fix** — derive both from one shared token, or scale the Apple height with `PixelRatio.getFontScale()`.

### 4 · Privacy manifest declares nothing — NEEDS CHANGE

**Requirement** — App Privacy Details, https://developer.apple.com/app-store/app-privacy-details/ (fetched 2026-08-26):

> "You need to identify all of the data you or your third-party partners collect… Even if you collect the data for reasons other than analytics or advertising, it still needs to be declared."

**What the code does** — `ios/KokonadaHealth/PrivacyInfo.xcprivacy:32-33` has `<key>NSPrivacyCollectedDataTypes</key><array/>` — **empty** — while `auth.ts:72` requests `Scope.FULL_NAME` and `Scope.EMAIL`, `KokonadaUser` carries `id/displayName/email/avatarUrl`, and the app handles heart rate and HRV.

At minimum: Contact Info → Name, Email Address; Identifiers → User ID; Health & Fitness → Health.

**Fix** — populate it, and make the App Store Connect privacy answers match exactly; a mismatch between the two is the common rejection path.

**Scoped honestly:** the auditor flagged as **UNVERIFIED** whether an empty `NSPrivacyCollectedDataTypes` is *itself* a rejection trigger — it could not find a verbatim clause saying so. What is firmly cited is the App Store Connect disclosure obligation above, which an empty manifest contradicts.

**Minimisation note, not a blocker:** if `displayName` is only cosmetic, dropping `Scope.FULL_NAME` reduces both the disclosure surface and the GDPR Art. 5(1)(c) exposure.

### 5 · Google Play account-deletion web link — UNVERIFIED

Play requires **both** an in-app deletion path **and** a public web URL for deletion requests (https://support.google.com/googleplay/android-developer/answer/13327111, fetched 2026-08-26), submitted via the Data safety form. The in-app path passes. **The web URL cannot be verified from this repo — confirm in Play Console before release.** This is a listing-level takedown risk, not a code fix.

### Related

- `docs/plans/halts.md#sign-in-with-apple-entitlement` — the blocker on the same screen. Nothing here ships before that clears.
- `docs/plans/halts.md#garmin-deregistration-on-delete` — the auditor independently rated it a **pre-submission blocker**: Apple requires deletion of the account record "along with associated personal data", Play says "and associated data", and a live Garmin registration pushing biometrics for a deleted user fails both as well as GDPR Art. 17.

<a id="spotify-canvas-assets"></a>
## DEV ITEM — Spotify marks, cover art and link-back on the canvas
_Was `docs/plans/DEV_SPOTIFY_CANVAS_ASSETS.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26 by `compliance-auditor` (two independent passes agreed on the findings below).
**Routing:** `designer` for the board changes → `developer` for the shipped component → `compliance-auditor` re-check before submission.
**Status:** the redrawn-mark failure is **fixed**; the cover-art and geometry items are **open**.

---

### What was wrong, and why the redraw was the worst version of it

Five boards drew a **hand-authored SVG path** for the Spotify mark, filled from a `--spotify` design token.

> "The logo should not be misinterpreted, modified, or added to. Its orientation, color, and composition should remain as indicated in this document — **there are no exceptions**."
> — Spotify Design & Branding Guidelines, fetched 2026-08-26

The auditor's framing is the one to keep: **a redraw is worse than a labelled placeholder precisely because it looks right.** A dashed slot is an honest unresolved dependency that someone chases. A redraw passes design review, ships, and becomes an unlicensed derivative of a registered mark on every tab root. A design token is also not a colour guarantee — `var(--spotify)` could drift to any value without anything failing.

**DONE.** All five surfaces (`Login`, `NowPlaying`, `Receipt`, `Components`, `Pulse`, `You`) now carry labelled `OFFICIAL … MARK` slots. `--spotify` has been retired; `#191414` survives only as `--spotify-playback-bg`, scoped to the artwork fallback, with a comment recording that it is **not** a mark colour — the official marks carry their own colour and must never be tinted.

### Open · Cover art is required during playback, and the boards paint a gradient

> **§II.5** — "there shall be no playback of Spotify Content without showing relevant cover art and metadata in your SDA."
> **§II.4.a** — "If you display any Spotify Content you must clearly attribute the content as being supplied and made available by Spotify, by using the Spotify Marks."

The mini-player artwork tiles are `linear-gradient(140deg, var(--accentfill), var(--artph))` — a mood gradient standing in for album art, on rows that show real track and artist metadata.

**Fix:** convert every artwork tile to a labelled cover-art slot, the same way the marks were converted. Write into the `docs/design-v1/screens.md` Definition of Done: **real cover art is required for Spotify-sourced tracks; the gradient placeholder may never ship.**

### Open · Geometry

| Item | Current | Required |
|---|---|---|
| Artwork corner radius | 20px / 10px | **4px / 8px** per the guidelines' artwork rules |
| Mark slot geometry | ~148×20 | icon floor is **21px** in digital; the slot is 1px under it and has no exclusion zone drawn |
| Mini-player exclusion gap | 12px | **14–16px** — the zone is half the icon height, so it must be derived from the mark, not from a spacing token |

### Open · Link-back target on the Receipt

> **§II.4.b** — "Metadata, cover art and Audio Preview Clips must be accompanied by a link back to the applicable album, content or playlist on the Spotify Service."

On the Receipt the mark and "Listen on Spotify" sit in the **UP NEXT** section header, above three tracks that are not playing, while the shipped action foregrounds the *currently playing* item (`SpotifyAttribution.tsx:61` → `foregroundSpotify`). For Now Playing that resolves correctly; for the Up-Next list it does not link back to the listed content.

**Fix:** either move the mark and link so they govern only the playing item, or give the Up-Next rows their own Spotify URIs.

### Standing condition on the closed decision — do not lose this

Screen 08 and 09 closed on `attr=linkback`: the words "content from Spotify" were dropped and the link-back kept. **That decision is compliant** — under §II.4.a the *mark* is the attribution mechanism, and no fetched clause requires the words "content from Spotify" or "Powered by Spotify". (The auditor also corrected a standing assumption of mine here: "Powered by Spotify" is absent from the current guidelines and policy entirely.)

But the decision **moves 100% of the attribution burden onto asset fidelity**. Two consequences:

1. **"Link-back only" must never propagate to a developer as "drop the mark."** If the logo does not render, the surface has a link-back and **no attribution at all** — a straight §II.4.a breach on every content screen. This is the note that belongs beside the decision, not buried in a report.
2. **Replace the guard, never just delete it.** `mobile/KokonadaHealth/src/experience/player/__tests__/SpotifyAttribution.test.tsx:52` pins `expect(...).toContain('content from Spotify')`. Removing the string means editing a compliance regression test. Replace it with assertions that the logo renders (`spotify-attribution-logo` present, theme-correct source) and that the link-back exists — otherwise the next refactor can silently drop the logo and nothing fails.

### Open · Store screenshots

`Components.dc.html` and `You.dc.html` show **"Holocene" / "Bon Iver"** — a real recording by a living artist — paired with our own mood label "winding down".

PASS in-app: runtime metadata is user-driven. **NEEDS CHANGE for any store asset** — Spotify Developer Policy §II.3 exists to prevent exactly the confusion of "artist, creator or user associated with any Spotify Content", and Apple 2.3.7 covers misleading metadata. Use fictitious track and artist strings in every asset destined for a store listing.

### Related

- `docs/plans/halts.md#spotify-track-ids-to-third-party` — the shipped-code half, and the higher-severity one. It also carries the `SpotifyAttribution.tsx` clear-space breach (8px gap against ≈11.6px required) and the dead `/audio-features` caller.
- `docs/plans/halts.md#youtube-attribution-and-revocation` — YT-2 is the same attribution problem on the other provider, and its fix shares this slot.
