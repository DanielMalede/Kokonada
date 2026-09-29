# Track H: code plan for H1 and H2 (architect, read-only)

H1 and H2 edit disjoint file sets, so they can be built in two worktrees at once. The biggest thing I found while tracing H2: today nothing ever stops the heart-rate stream. After logout, the next account on the same phone can see the previous account's heart rate. After a withdrawal, the stream keeps running on the phone. H2 has to fix this, because it is the change that introduces a holder for the stream.

Short paths below use these roots:
- `M\` = `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\`
- `B\` = `C:\Users\danie\Videos\Kokonada\backend\`

## 0. What I verified in the code this session

**H2 (boot path)**
- **Player connects before sign-in.** `M\src\appBootstrap.ts:26` calls `connectPlayer()` before the auth check at `:28`. So `player.connect()` runs for signed-out users. On `NOT_LOGGED_IN`, `spotifyRemoteAdapter.ts:43-54` falls back to `SpotifyRemote.authorize()`, which opens Spotify's login screen in the foreground.
- **Every signed-in boot and every sign-in runs the full chain with no checks.** The chain is `startBiometrics` (`appBootstrap.ts:33`, `prodBootstrap.ts:77` and `:93`):
  1. `biometricsWiring.ts:17`
  2. `liveHr.ts:24` calls `getWatchToken()`. If the Keychain has no token, `liveHrClient.ts:23` mints one with `POST /api/integrations/watch/token`.
  3. Then `liveHr.ts:26` calls `requestBlePermissions()`, which is `blePermissions.ts:34` `requestMultiple`, the OS "Nearby devices" dialog.
  4. There is no consent check and no wearable check anywhere in this chain.
- **The server does not gate minting.** `B\app\routes\integrations.js:101` mints with no consent gate. `mintWatchToken` (`B\app\controllers\integrationsController.js:701-705`) sets `wearableProvider='garmin'`. As a result every signed-in user reads as "wearable connected" (`getIntegrationsStatus :831`, `ProfileScreen.tsx:210`). The ingest route `/watch/hr` *is* gated inline (`:763-765`).
- **The stream handle is thrown away** (`appBootstrap.ts:33`, `prodBootstrap.ts:93`). Nothing can stop BLE or the 3-minute fallback. What follows:
  - **Logout:** `wipeLocalSession` never stops the stream. The in-memory `whr_` token keeps pushing. `onHr` refills `warm.liveHr` after `resetWarm`, so the next account sees the previous account's heart rate. Logging out and back in starts a second stream.
  - **Withdrawal** (`ProfileScreen.tsx:179-188`) only flips a React flag. The stream keeps feeding Pulse and the aura. The server nulls `watchToken.hash` (`wearableErasure.js:139`), so pushes get 401. The dead token stays in the Keychain and `getWatchToken` never re-mints. After a re-consent, live-HR ingest therefore returns 401 permanently.
  - **Two race gaps.** `restFallback.ts:47-58` does not re-check `stopped` after its `await`. `bleHeartRate.ts:50-57` does not re-check after `await scanned.connect()`. A stop during either wait leaks one reading or leaves a zombie connection.
- **The boot health sync is ungated.** `prodBootstrap.ts:84-85` runs `syncMedicalProfile` on every boot whenever a Health Connect OS grant exists, including signed-out and withdrawn users. Health Connect grants survive withdrawal.
- **`granted_ack` is not a global state.** `createConsentFlow` is a per-sheet factory, used only from the wearable CTA (`ConnectServicesScreen.tsx:171`, `ProfileScreen.tsx:165`). The lasting equivalent is `GET /api/consent/status` with `granted && !staleVersion`.
- **The existing wearable flags are wrong both ways.** `connectStore.resolved/moodOnly` are one-way and only written by the Connect screen, so they are wrong in both directions (as `TASKS.md` UI-005 already notes). `providers.ts` is a static list, not user state.
- **Foreground handling only exists inside the app.** `AppLifecycle` is mounted only on the `'app'` route (`AppFlow.tsx:85-89`).
- **Dead code with a player connect.** `startPlayback` (`playbackServices.ts:105-109`) has no callers and calls `player.connect()` unconditionally.

**H1 (screens and labels)**
- **The only place a state label is shown is Pulse** (`PulseScreen.tsx:267` → `:198`). `friendlyStatus` passes any label with capitals through unchanged (`statusLabels.ts:23`). It also title-cases lowercase labels, so `'pre-panic'` would render as "Pre-Panic" too.
- **The Pulse colour wash reads the raw status.** `statusQuadrant(sv?.status)` uses the raw label (`PulseScreen.tsx:269`), and the test `pulsePresentation.test.ts:118` pins that. The raw label must keep reaching it.
- **The raw label is a backend lookup key.** It comes from one of the 10 rule labels in `B\app\services\medicalProfileService.js`. It is also a key at `stateTaxonomy.js:574`, and 4 backend test files pin it.
- **Nothing exists yet.** "AI system infers" has 0 hits in `src`, and there is no in-app "not a medical device" line.
- **Contrast gaps.**
  - The contrast guard on `textScrimFill` covers only `content.primary` and `content.muted` (`auroraSurfaces.test.ts:45-82`). The ink UI-005 names as the minimum, `content.secondary`, is untested over the aurora.
  - The Pulse wash colours are 8-digit hex, and `contrast.parseHex` accepts 6 digits only.
- **The Onboarding bottom chrome is absolutely positioned over the panel copy area** (`OnboardingScreen.tsx:137`, `:192`). Adding the sentence there risks overlapping the panel copy on short screens or at 200% font.
- **Generate is the reliable first exposure.** It is tab 1 (`tabRoutes.ts:6`). Onboarding shows once per device (MB-009), so it can only be a supplementary surface.

## 1. Who owns which files (nothing shared)

**H1 only**
- NEW `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\legal\` (`legalCopy.ts`, `LegalLine.tsx`, `AiDisclosure.tsx`, `MedicalDisclaimer.tsx`, `__tests__\*`)
- NEW `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\pulse\stateDisplayVocabulary.ts` and its test
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\pulse\statusLabels.ts`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\pulse\PulseScreen.tsx`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\generate\GenerateScreen.tsx`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\onboarding\OnboardingScreen.tsx` (plus `OnboardingPanel.tsx` only if the designer picks the layout that needs it)
- Their `__tests__`: `statusLabels.test.ts`, `PulseScreen.test.tsx`, `GenerateScreen.test.tsx`, `OnboardingScreen.test.tsx`

**H2 only**
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\appBootstrap.ts`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\prodBootstrap.ts`
- `M\src\health\{blePermissions,liveHr,restFallback,bleHeartRate,biometricsWiring}.ts`
- NEW `M\src\health\healthLane.ts`, NEW `M\src\health\healthLaneServices.ts`
- NEW `M\src\experience\player\playerBootGate.ts`
- `M\src\experience\connect\{connectController.ts,ConnectServicesScreen.tsx}`
- `M\src\experience\profile\{ProfileScreen.tsx,profileServices.ts}`
- `M\src\experience\playback\{foregroundReconcile.ts,AppLifecycle.tsx}`
- Their tests; NEW `M\src\__tests__\prodBootstrap.test.ts`, NEW `M\src\__tests__\shadow.healthLane.test.ts`
- `C:\Users\danie\Videos\Kokonada\backend\app\routes\integrations.js`
- `C:\Users\danie\Videos\Kokonada\backend\tests\integrationsConsentGate.test.js`
- `C:\Users\danie\Videos\Kokonada\backend\tests\surfaceBoundaryGuard.test.js` (comments only)

**Neither task touches**
- `jest.setup.js`, `scripts\lint\design-system-baseline.json`, `src\design\tokens.ts`
- `warmStore.ts`, `consentStore.ts`, `consentApi.ts`, `consent.js`, `ConsentSheet.tsx`
- `docs\`, `TASKS.md`, `.claude\`, `src\health\config.ts`

Each worktree stages by path. Merge order doesn't matter. The H2 backend change can merge first on its own.

---

## 2. H1: AI Act notice, not-a-medical-device line, Pre-Panic display map

### Decisions

**DT-H1-A: how to stop clinical labels from rendering**

| Option | Impact | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **M1 (recommended).** A fixed map for known backend labels, plus a forbidden-term check on the final output with a neutral fallback | Pre-Panic disappears. Any future clinical label is neutralised too, including lowercase ones that get title-cased | 1 new module + `statusLabels.ts` | Vocabulary is duplicated until B2 moves it to the server | High | A regex that is too broad hides a harmless label behind the fallback (visible, not harmful) |
| M2. Map only | Exact | Same | Same | High | A new clinical label from the backend renders unchanged |
| M3. Rename the backend key | Clean | `stateTaxonomy.js:574`, `medicalProfileService`, 4 backend tests | None | Low | Taxonomy lookup silently falls to its default (already rejected in DT-8) |

**DT-H1-B: where the legal text lives**

| Option | Impact | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **L1 (recommended).** Constants in `src\legal\legalCopy.ts`, plus thin v1 components | The same constants feed the v2 `AiDisclosure` component later, and seed the translation catalogue | New folder | Custodian deletes the v1 components later | High | — |
| L2. Put it in `src\design\system\` | Sits with other components | Design layer, which DT-1 freezes | Mixes legal text into the v1 design system | Medium | Conflicts with the v1-freeze guard |
| L3. Write it inline in each screen | Fastest | 3 screens | 3 copies that can drift apart | Low | Copy divergence (the R4 risk) |

**Text and placement decisions (regulatory-researcher and designer; the code shape works either way)**
- **Exact wording and punctuation.** `TASKS.md:240` says "not a person's — and it can be wrong". The regulatory report §3b says "not a person's, and it can be wrong". The apostrophe style (' or ’) also needs choosing.
- **Onboarding wording.** "…infers your emotional state *here*" is not literally true on Onboarding. Decide between the one standard sentence and a separate Onboarding constant.
- **Display label for `'High-Stress / Pre-Panic'`, and the fallback label.**
  - Suggested safe wording is "activated"-style; the word "stress" is still open (counsel question Q4).
  - Also decide whether `'Exhausted Commute'` or others change.
- **Onboarding chrome layout.** Recommended: turn the chrome into a normal bottom region below the pager, instead of an overlay. It then cannot overlap the copy, and the hero and copy zones stay disjoint. The alternative is to measure the chrome height and pad the panels.
- **Pulse placement.** Put the AI sentence in the StateCard in every non-empty state. Put the medical line in both the dashboard and the empty state. The designer confirms.

### Task order (tasks within a group can run in parallel)

**H1-0 (gate, no code).**
- regulatory-researcher delivers the strings.
- designer delivers placement for the 3 screens.
- The developer may start with the UI-005 wording as the default. The pinned tests are updated when the ruling lands; a text change re-runs gate G5.

**Group 1: {H1-1, H1-2}. Group 2: {H1-3, H1-4, H1-5}. Then H1-6, then H1-7.**

**H1-1: legal text module and components**
- NEW `src\legal\legalCopy.ts`:
  - `export const AI_DISCLOSURE`
  - `export const MEDICAL_DISCLAIMER`
  - `export const LEGAL_TEST_IDS = { aiDisclosure: 'ai-disclosure', medicalDisclaimer: 'medical-disclaimer' } as const`
  - Nothing for the ConsentSheet.
- NEW `LegalLine.tsx` (private), `AiDisclosure.tsx`, `MedicalDisclaimer.tsx`:
  - Props `{ surface: 'aurora' | 'plain' }`.
  - One `<Text>` with the constant. Ink is `c.content.secondary`, size at least `typography.size.body`, `allowFontScaling` on.
  - With `surface="aurora"`, the band background is `textScrimFill(c, name)`.
  - Uses **only** `useTheme()`. No `useMotion`, no effects, no animation, no subscriptions (this keeps the S10-1 and ATTACK-6 leak checks valid). Tokens only.
- Tests first:
  - `src\legal\__tests__\legalCopy.test.ts`:
    - Each constant `toBe(<exact ruled string>)`.
  - `src\legal\__tests__\LegalLine.test.tsx`:
    - Renders one Text node whose children equal the constant.
    - Ink is `content.secondary`; fontSize is at least `typography.size.body`.
    - No node inside the component has `pointerEvents` 'none', `accessibilityElementsHidden`, or `importantForAccessibility` 'no' / 'no-hide-descendants'.
    - aurora → `backgroundColor === textScrimFill(c,name)`, in both faces.
    - `AccessibilityInfo.addEventListener` and `Keyboard.addListener` are called 0 times.
  - `src\legal\__tests__\legalContrast.test.ts` (checks `content.secondary`, both faces):
    - Over the text scrim on every aurora blob, at least 4.5:1.
    - Over the scrim on `auroraGlow(x,y)` sampled across x,y ∈ [-1,1], step 0.25, at least 4.5:1.
    - Over `surface.raised` plus each `emotionAccent[q].wash`, with alpha read from the 8-digit hex, at least 4.5:1.
    - On `surface.base`, at least 4.5:1.

**H1-2: display vocabulary**
- NEW `stateDisplayVocabulary.ts`:
  - `STATE_LABEL_HIGH_ACTIVATION`, `STATE_LABEL_FALLBACK`: one constant per string.
  - `STATE_DISPLAY_MAP = { 'high-stress / pre-panic': STATE_LABEL_HIGH_ACTIVATION }`, keyed by the lowercase backend label.
  - `FORBIDDEN_STATE_TERMS`, a regex over the §3b condition and prediction words: pre-panic, panic, anxiety, depress, burnout, disorder, symptom, at-risk, early warning, predict, diagnos, clinical.
- `statusLabels.ts` `friendlyStatus`, signature unchanged. Order:
  1. null or empty → null
  2. the display map
  3. the existing `REMAP`
  4. pass-through or title-case
  5. **the final output** is checked against `FORBIDDEN_STATE_TERMS`; a match returns the fallback
- Tests first:
  - `stateDisplayVocabulary.test.ts`:
    - Each label constant is pinned exactly.
    - The regex matches every §3b term in a fixture list.
    - No map value or fallback matches the regex.
    - All 10 backend rule labels (listed as a fixture) produce a non-null result with no forbidden term.
  - Additions to `statusLabels.test.ts` (the existing 5 tests are not edited):
    - `'NEVER renders Pre-Panic'`: the backend key, and variants in different case or with extra spaces, all return `STATE_LABEL_HIGH_ACTIVATION`.
    - `'clinical/prediction labels fall back, never verbatim'`: `'Burnout Risk'`, `'panic'`, `'pre-panic'` (lowercase), `'Anxiety Attack Warning'` all return the fallback.
    - `'the result never matches FORBIDDEN_STATE_TERMS'` over a fuzz list.

**H1-3: Generate**
- In `GenerateScreen.tsx`, insert `<View style={[styles.fullWidth, styles.gap16]}><AiDisclosure surface="aurora" /></View>` between the hero's closing `</View>` (`:280`) and the live-mode `Pressable` (`:282`).
- It renders unconditionally.
- No new state, effects or literal style values; the baseline count for this file stays at 1.
- Tests to add in `GenerateScreen.test.tsx`:
  - Exactly one `ai-disclosure`; its Text equals `AI_DISCLOSURE`; ink `content.secondary`; size at least body; in both faces.
  - Band background equals `textScrimFill`.
  - Reading order: after `RadialWheel`, before the `accessibilityRole="switch"` toggle.
  - Stays present with no taps, with taps, while typing (mini-ring) and in live mode.
  - Not under the `pointerEvents="none"` aurora layer.

**H1-4: Onboarding**
- One `<AiDisclosure surface="plain" />` in the bottom chrome (`:137`), laid out as the designer chooses.
- Tests to add in `OnboardingScreen.test.tsx`:
  - Exactly one instance, and it is not inside `onboarding-copy-zone` or `onboarding-hero-zone`.
  - Present on panel 1, after Continue (panel 2), and on panel 3, and present before Skip.
  - Ink `content.secondary` in both faces, using the file's `forceFace` helper.
  - If the chrome becomes a normal bottom region: the chrome is not `position:'absolute'`.

**H1-5: Pulse**
- In `StateCard` (`:178-216`), add `<AiDisclosure surface="plain" />` after the headline or confidence line, and after the empty-state placeholder text. It must stay outside the `pointerEvents="none"` wash.
- Add `<MedicalDisclaimer surface="plain" />` at the end of `body()` (`:343`) and below `EmptyState` (`:363-369`).
- `status` and `quadrant` keep their current inputs.
- Tests to add in `PulseScreen.test.tsx`:
  - Status `'High-Stress / Pre-Panic'`: the header equals `STATE_LABEL_HIGH_ACTIVATION`, and `/panic/i` appears nowhere in the rendered text or in any `accessibilityLabel`.
  - For that same status, the wash `backgroundColor` still equals `colors[face].emotionAccent.intense.wash`. This proves the backend key path is untouched.
  - Order inside StateCard: header, then (confidence), then `ai-disclosure`. A null status shows the placeholder, then `ai-disclosure`.
  - `medical-disclaimer` appears on both the dashboard and the empty state.
  - Neither legal line is inside the wash.

**H1-6: single-source guard**
- `src\legal\__tests__\legalSingleSource.test.ts` scans all production `src` files:
  - "infers your emotional state" and "not a medical device" appear only in `legal\legalCopy.ts`.
  - `pre-panic` (any case) appears only in `stateDisplayVocabulary.ts`.
  - `AiDisclosure` is imported by exactly Generate, Onboarding and Pulse, and **never** by `ConsentSheet.tsx`. This pins the DT-7 scope and keeps placeholder text out of a consent record.

**H1-7: evidence and review**
- Release build on the S22+. Capture Generate, Onboarding panels 1-3 and Pulse (dashboard and empty) in both faces, at 1.0 and 2.0 font scale.
- TalkBack must read each sentence as one node.
- Check "above the fold" on Generate at 200%.
- Reviews: designer SHIP, compliance on the built result, resilience G10, then you merge.

**Sacred contracts in H1 and how they stay intact**
- ≤3-tap payload, `screenToCircumplex`, `shadow.generate.sacred`: not touched; nothing in the controller or wheel changes.
- `GenerateScreen.test.tsx:351` and `shadow.experience.test.tsx:177`: the new components add no subscriptions.
- `PulseScreen.test.tsx:128-175` (honest-empty) and its "no bare dash" check: the sentence is a single Text node, so they still pass.
- `pulsePresentation.test.ts:118`: the raw key still drives the wash.
- The existing tests in `statusLabels.test.ts`: not edited.
- Lint baseline: no file increases.

**H1 verification** (from `M\`):
- `npx jest src/legal src/experience/pulse src/experience/generate src/onboarding src/design/__tests__ src/__tests__/shadow.experience.test.tsx src/__tests__/shadow.generate.sacred.test.ts src/__tests__/shadow.qa4.uiux.test.tsx`
- `npm run lint:design-system`
- `npx jest --ci`
- `npx tsc --noEmit` should show no errors in `src/legal`, `stateDisplayVocabulary` or `statusLabels`. Existing `src/health` type errors don't count.

---

## 3. H2: health stream and player start only after opt-in and consent

### Signals available today, and what I propose

| Signal | Where | Usable? |
|---|---|---|
| `granted_ack` / `ready` | `consentStore` per-sheet instance, in memory | No. Transient and not reachable from bootstrap |
| Server consent `granted && !staleVersion` | `GET /api/consent/status` via `consentApi.fetchConsentStatus` (read only) | **Yes.** It is the lasting form of `ready` / `granted_ack` |
| Health Connect OS grant present | `getGrantedPermissions()` | **Yes, together with consent.** It can only be obtained after the consent wall. It survives withdrawal and is per device, not per account |
| `connectStore.resolved && !moodOnly` | per-account KV | No. One-way; misses grants made from Profile; ignores withdrawal |
| `user.wearableProvider`, Keychain `whr_` | server, device | No. The boot mint writes it for every user |

**DT-H2-1: what counts as "wearable opted in"**

| Option | Impact | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **A (recommended).** Health Connect grant AND server consent current | Mood-only users never start the stream. Grants made from Profile count. Withdrawal closes it. Per-account consent stops a device-level Health Connect grant leaking to another account | `healthLane` only | None | High | If the Health Connect check throws, the stream stays off until the next trigger. It never opens on iOS |
| B. A new stored per-account `wearableOptIn` flag | Explicit | `connectStore`, 3 places that write it, a migration | Another flag to keep in sync (the same failure class as `connectStore`) | Medium | Drift between the flag and consent |
| C. `connectStore` `resolved && !moodOnly` | No new code | — | Inherits the one-way bugs | High | Users who connected from Profile are excluded forever |

**DT-H2-2: where the Bluetooth permission prompt goes**

| Option | Impact | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **1 (recommended).** Only *check* the permission, never ask, until P6 adds a disclosure followed by the request | Closes the three open Bluetooth findings (C6, G14, P-UD) with no new copy | `liveHr`, `blePermissions` | `requestBlePermissions` stays exported, reserved for P6 | High | New wearable users get the 3-minute Health Connect updates, not real-time Bluetooth, until P6 |
| 2. Ask inside the connect flow, after the Health Connect grant, behind an interim disclosure | Real-time Bluetooth now | + connect and profile flows + copy + designer + compliance | Throwaway interim UI | Medium | If the copy is rejected the finding stays open; four dialogs in a row |
| 3. Ask when the stream starts (the literal reading of the task) | Same | `liveHr` | — | High | The prompt has no Bluetooth disclosure immediately before it, so **C6 stays a HALT** |

**DT-H2-3: add a server guard on token minting?**

| Option | Impact | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **S1 (recommended).** `requireConsent(HEALTH_CONSENT)` on `POST /watch/token` | Art.9 enforced where the credential is issued. Stops new `'garmin'` stamping for users without consent | Route + 1 structural test | None | Trivial | Old app builds get 403 on the boot mint, which `startBiometrics` already absorbs and returns `null`. Tokens already cached on old builds are unaffected, and ingest is already gated |
| S2. Rely on the app only | — | 0 | Every future client build must get it right | — | A regressed or old client mints without consent again |
| S3. S1 plus stop stamping `'garmin'` | Also closes PU3 | + controller, `watchIntegration` "marks provider garmin" pin, the Profile "Wearable" row | — | Medium | Changes the `biometricProvider` field Profile relies on; this belongs to B8 |

**DT-H2-4: what "linked" means for the Spotify player**

| Option | Impact | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **P1 (recommended).** `GET /api/integrations/status` → `spotifyConnected`; any failure means don't connect | Signed-out and unlinked users never see Spotify's login screen. Testers keep the warm connection | `appBootstrap` order + `playerBootGate` | None | High | If the request fails, the player connects on first play instead (that path already exists) |
| P2. Never connect at boot | No boot network call and no prompt | Same | None | High | First play is slower; the login screen shows on first play |
| P3. A stored "linked" flag | No network call | New KV | A stale flag | Medium | The flag drifts from the server |

**DT-H2-5: what a return to the foreground does**

| Option | Impact | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **F1 (recommended).** Foreground can only *stop* the stream | Catches a withdrawal whose response was lost, and a Health Connect grant revoked in Settings. Keeps "Disconnect" meaning "until next boot or sign-in" | `foregroundReconcile` (optional dependency) + `AppLifecycle` | None | High | A wearable user who booted offline stays off until the next boot, sign-in or re-link |
| F2. Foreground can start and stop | Recovers from an offline boot | Same | — | High | Silently mints a new token right after the user tapped "Disconnect" |
| F3. Do nothing on foreground | — | 0 | — | — | A withdrawal with a lost response keeps streaming until reboot |

**Small decision, no table.** Clear the heart rate from the warm store with a new helper `clearBiometricFeed(warm)` that calls `warm.setState({ liveHr: null, biometricSource: 'none' })`. Do not add an action to `warmStore.ts`, which is S12-1 sacred. `connection` and `permissions` are never touched.

### Design: the `healthLane` module
```ts
// M\src\health\healthLane.ts
export const isCurrentGrant = (s: ConsentStatus) => s.granted === true && s.staleVersion === false;
export interface HealthLaneDeps {
  hasWearableGrant(): Promise<boolean>;                 // HC OS grant (no UI)
  fetchConsentStatus(): Promise<ApiResult<ConsentStatus>>;
  startFeed(isActive: () => boolean): Promise<LiveHrSession | null>; // prod: startBiometrics({warm,isActive})
  clearFeed(): void;                                     // prod: clearBiometricFeed(warmStore)
  clearWatchToken(): Promise<void>;
}
export interface HealthLane {
  evaluate(o?: { allowStart?: boolean }): Promise<boolean>; // gate open?
  stop(o?: { forgetToken?: boolean }): Promise<void>;
  status(): 'idle' | 'running';
}
```
The guarantees `healthLane` must keep:
- The Health Connect check runs first, with no network call. Mood-only users therefore make zero requests.
- Consent is checked second. Any error means the gate stays closed.
- Only one evaluation runs at a time; concurrent calls share it.
- There is only ever one session.
- `stop()` bumps a counter, so any evaluation or start still in flight is discarded and stopped when it resolves.
- A closed gate while running stops the stream and forgets the token.
- The token is cleared **after** the session stops.
- Neither `evaluate` nor `stop` ever throws.

**What triggers an evaluation**
- **Boot**, only after the auth check: `startBiometrics` → `evaluate({allowStart:true})`. A successful result also gates the boot Health Connect sync.
- **`onSignedIn`**: `evaluate({allowStart:true})`.
- **After the wearable connect succeeds**: `connectController.runSync` → `onWearableLinked` → `evaluate({allowStart:true})`.
- **Foreground**: `evaluate({allowStart:false})`.

**Withdrawal in the middle of a session**
1. `ProfileScreen.onWithdraw` calls `withdrawConsent()`. The server writes the withdrawal row and nulls `watchToken.hash`.
2. When the response is ok, the screen calls `await healthLane.stop({forgetToken:true})`:
   - bump the counter, so late BLE or REST callbacks are dropped by `isActive`
   - `session.stop()`: stop the BLE scan, cancel the connection and destroy the manager, or clear the REST interval
   - `clearFeed()`: Pulse shows "No live reading"; `connection` is untouched
   - `clearWatchToken()`
3. Backstops if step 2 is missed: a late push gets 401, and the next foreground evaluate finds consent missing and stops the stream.
4. If the withdrawal fails, nothing is torn down.

**Logout and account delete.** In `profileServices.clearLocal`, bind `clearWatchToken` to `stopLaneThenClearToken(healthLane, clearWatchToken)`. The step order in `wipeLocalSession` does not change, and the stream stops before `resetWarm`.

### Task order
**Group A: {H2-1, H2-2, H2-5, H2-10} in parallel → H2-3 (can be built with fakes alongside A) → H2-4 → group B: {H2-6, H2-7, H2-8} in parallel → H2-9 → H2-11.**

**H2-1: Bluetooth check only (DT-H2-2 option 1)**
- `blePermissions.ts`: add `checkBlePermissions()` using `PermissionsAndroid.check` for each permission. Non-Android or any error returns false.
- `liveHr.ts`: `startLiveHr(cb = {}, { hasBle = checkBlePermissions } = {})`.
- New `src\health\__tests__\blePermissions.test.ts`:
  - API 31+: checks SCAN and CONNECT, and `requestMultiple` is never called.
  - API 30 and below: checks FINE_LOCATION.
  - A throw returns false.
  - Non-Android returns false.
- `liveHr.test.ts`:
  - Add `check` to the local `react-native` mock.
  - Selection tests: BLE when already granted, REST when not, and in both cases `expect(requestMultiple).not.toHaveBeenCalled()`.

**H2-2: close the race gaps**
- `restFallback.ts`: re-check `stopped` after the `await`.
- `bleHeartRate.ts`: after `connect()` and after discovery, `if (stopped) { d.cancelConnection(); return; }`.
- `biometricsWiring.ts`:
  - Add `isActive?`. When it is false, drop the reading. When it is false as the start resolves, call `session.stop()` and return null without setting a source.
  - Add `clearBiometricFeed(warm)`.
- Tests:
  - `biometricsWiring.test.ts`, 3 new: drops a late reading; stops a start that resolves after teardown; `clearBiometricFeed` keeps `connection` and `permissions` (S12-1). The existing 5 tests are unchanged.
  - New `bleHeartRate.test.ts`: a device whose `connect()` resolves after `stop()` gets `cancelConnection` and is never monitored.
  - REST: a tick that resolves after `stop()` produces no `onHr` and no push.

**H2-3: `healthLane.ts` + new `healthLane.test.ts`**
- Mood-only (no grant): `start` and `fetchConsentStatus` are never called.
- Consent missing, stale, 401, offline or malformed: closed.
- The Health Connect check throwing: closed.
- Gate open: starts once.
- Two concurrent evaluations: one start.
- Evaluating while running: no second start.
- `allowStart:false` while idle and open: no start.
- `allowStart:false` with the gate now closed: stops, `clearFeed`, forgets the token.
- `stop()` while a start is in flight: that session is stopped when it resolves.
- A late `onHr` after stop never lands.
- `stop({forgetToken})` stops the session before clearing the token.
- `stop` can be called twice and never throws.
- A rejected mint leaves it idle and doesn't throw.
- **Parity:** for every consent status combination, `isCurrentGrant(s)` is true exactly when the real `createConsentFlow` after `hydrate(s)` reports `flow === 'ready'`.

**H2-4: `healthLaneServices.ts`, the production singleton**
- `hasWearableGrant` = `initialize()` then `getGranted().length > 0`, wrapped in try/catch.
- Export `stopLaneThenClearToken`.
- Test: the stream stops before the token is cleared, and a throwing stop still clears the token.
- No `console.*` line may contain "token"; `shadow.authMigration` checks this.

**H2-5: `playerBootGate.ts` `connectPlayerIfLinked({fetchIntegrations, connect})`**
- Tests:
  - Linked: connects once.
  - Not linked: never connects.
  - Request fails: never connects.
  - `connect` rejects: the error is swallowed.

**H2-6: bootstrap wiring**
- `appBootstrap.ts`: move `connectPlayer()` below `if (!authed) return;`.
- `prodBootstrap.ts`:
  - `:76` → `connectPlayerIfLinked(...)`
  - `:77` → `startBiometrics: () => (laneBoot = healthLane.evaluate({allowStart:true}))`
  - `:84-85` → `void laneBoot.then(open => open && syncMedicalProfile({kv}))`
  - `:93` → `void healthLane.evaluate({allowStart:true})`
  - Remove the direct `startBiometrics` import.
- `appBootstrap.test.ts`:
  - **Deliberately invert** `'always attempts the Spotify player…'` to `'with NO session: never attempts the Spotify player'`. resilience co-signs this change to a pinned test.
  - Add `'with a session: attempts the gated player exactly once'`.
- New `src\__tests__\prodBootstrap.test.ts`, with the modules mocked:
  - Signed-out boot: no lane, no player, no Health Connect sync.
  - Signed-in boot: evaluates once, and syncs only when the result is true.
  - `onSignedIn`: evaluates once and never calls `player.connect`.

**H2-7: triggers from the connect and profile flows**
- `connectController.ts`: optional `onWearableLinked` dependency, called after `markResolved()` and guarded.
- Wire it in `ConnectServicesScreen.tsx` `defaultController` and in `ProfileScreen.tsx` `ctrl`.
- `ProfileScreen.onWithdraw`: when the response is ok, `stop({forgetToken:true})`.
- Wrap the `LiveHeartRateCard` revoke: when it is ok, `stop()`.
- `profileServices.ts`: the logout binding above.
- Tests:
  - `connectController.test.ts`:
    - Notifies once after a real Health Connect grant.
    - Never on deny-twice.
    - Never from `begin()` when there is no current grant.
  - `ProfileScreen.test.tsx`: add `jest.mock('../../../health/healthLaneServices')`, then:
    - A successful withdrawal calls stop with `forgetToken`.
    - A failed withdrawal leaves the lane alone.
    - A successful Disconnect stops the lane.
    - T7–T10 and D1 are untouched.

**H2-8: foreground, stop only**
- `foregroundReconcile.ts`: an optional `reevaluateHealth?` dependency, guarded like `refreshPulse`.
- `AppLifecycle.tsx` passes `evaluate({allowStart:false})`.
- Test to add: it is called, and a throwing call never breaks the reconcile.

**H2-9: `shadow.healthLane.test.ts` (static guards)**
- `requestBlePermissions(` and `requestMultiple(` appear nowhere in production code except their definition.
- Who may import what:
  - `./liveHr` only from `biometricsWiring.ts`
  - `./biometricsWiring` only from `healthLaneServices.ts`
  - `getWatchToken` only from `liveHr.ts`
- `prodBootstrap` and `appBootstrap` contain no `startLiveHr`, `getWatchToken` or `requestBlePermissions`.
- `player.connect(` appears only in `prodBootstrap.ts`, `spotifyLinkBack.ts`, and `playbackServices.ts` (the dead `startPlayback`, flagged for custodian).

**H2-10: backend**
- `integrations.js:101` → `router.post('/watch/token', requireConsent(HEALTH_CONSENT), issueWatchToken);`
- Add to `integrationsConsentGate.test.js`: `it('gates POST /watch/token (whr_ mint) with requireConsent', …)` using the existing `gated('/watch/token','issueWatchToken')` helper.
- Update the stale comments in `surfaceBoundaryGuard.test.js` (`:14-15`, `:85`). Its route check is a prefix match, so it still passes.

**H2-11: evidence and review**
- On a fresh install in mood-only mode:
  - no "Nearby devices" dialog
  - no Spotify login screen
  - no `POST /watch/token`
  - in the database, `watchToken` and `wearableProvider` are null
- Wearable path: consent → Health Connect sheet → the stream starts.
- Withdraw during the stream: the BLE disconnect shows in logcat, Pulse shows "No live reading", and the Keychain slot is empty.
- Logout, then sign in with account B: no heart rate is shown.
- Reviews: resilience, then compliance (C6, G14, P-UD), then you. No designer review needed unless you pick option 2 in DT-H2-2.

**Sacred contracts in H2 and how they stay intact**
- Three-lane state / S12-1: `clearBiometricFeed` never touches `connection`. `shadow.qa4.biometric` and `shadow.context` are unchanged.
- Logout order: `sessionTeardown.ts` is unchanged, and `shadow.authMigration` stays green.
- Consent contract: untouched.
- Socket and DTO contracts: untouched.
- The only contract change is that `/watch/token` can now return 403. `getWatchToken` already treats that as a failure and fails soft.
- Pinned tests changed on purpose, with resilience signing each: `appBootstrap.test.ts` (the player inversion) and the permission mocks in `liveHr.test.ts` (the test titles and intent stay the same).

**H2 verification**
- From `M\`:
  - `npx jest src/health src/__tests__/appBootstrap.test.ts src/__tests__/prodBootstrap.test.ts src/__tests__/shadow.healthLane.test.ts src/__tests__/shadow.authMigration.test.ts src/__tests__/shadow.qa4.biometric.test.ts src/__tests__/shadow.context.test.ts src/__tests__/shadow.mobile.test.ts src/experience/connect src/experience/profile src/experience/player src/experience/playback src/navigation`
  - `npm run lint:design-system`
  - `npx jest --ci`
- From `B\`:
  - `npx jest tests/integrationsConsentGate.test.js tests/surfaceBoundaryGuard.test.js tests/watchIntegration.test.js tests/requireConsent.test.js tests/app.chain.integration.test.js`
  - `npm test`

---

## 4. Decisions for you
1. **DT-H2-2, the Bluetooth prompt.** Option 1, check only, is recommended. Option 3, the literal reading of the task, leaves C6 as a HALT.
2. **DT-H2-1, the wearable signal.** Recommended: Health Connect grant AND server consent current.
3. **DT-H2-3.** Recommended: S1, the server guard on minting. S3 goes with B8.
4. **DT-H2-4.** Recommended: P1, connect only when the server says Spotify is linked.
5. **DT-H2-5.** Recommended: F1, foreground can only stop. Accept that a wearable user who boots offline stays off until the next boot.
6. **Gate the boot Health Connect sync behind the same check?** Recommended: yes.
7. **One-off data clean-up** of existing `watchToken` / `wearableProvider='garmin'` rows for the ≤5 users who never consented. Recommended: yes, as a separate script you run, not inside the H2 PR.
8. **H1 text** (regulatory-researcher):
   - the exact sentence and punctuation
   - an Onboarding-specific sentence or not
   - the label for the Pre-Panic key and the fallback label
   - whether "stress" is allowed (Q4)
   - whether any other labels change
9. **H1 layout** (designer): the Onboarding chrome (recommended: a normal bottom region); Pulse loading and empty-state placement.

## 5. Flagged and out of scope
- Deferred by DT-7:
  - The ConsentSheet variant: waits for counsel's text and version 3.
  - The Now Playing receipt enumeration: P4.
- Onboarding shows once per device (MB-009), so Generate is the notice that actually reaches everyone.
- Generic Bluetooth straps are still stamped as Garmin (PU3 / B8).
- `startPlayback` is dead code (custodian).
- `player.dispose()` removes listeners for good, so a later connect in the same session has none. This predates H2.
- The comment in `liveHrClient.ts:13-14` about the "web UI" is stale.
- `accessibilityLabel="live-mode-toggle"` uses an ID as a screen-reader label (M4). It sits right next to the new notice.
- Raising the consent version (1→3) will pause live heart rate for every wearable user until they re-consent. That should go into the P5 charter.
- On-device check needed: `getGrantedPermissions` after `initialize()` must be silent.

Plan ready — approve before implementation.