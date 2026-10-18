# Compliance gate for Track H (H1, H2), before build. Compliance auditor, 2026-09-23

## Verdict

- **Current `main`: HALT on H2.** The app asks for the Nearby-devices permission (and the location permission on API 26–30), mints the `whr_` token and starts streaming heart rate at every signed-in boot and right after sign-in. This happens before the user has chosen mood-only or wearable, and before any disclosure. Code path: `prodBootstrap.ts:77,93` → `appBootstrap.ts:33` → `liveHr.ts:24-26` → `blePermissions.ts:34`.
- **Current `main` on H1:** the Art.50 sentence is missing on Generate, Onboarding and Pulse. On Pulse, "High-Stress / Pre-Panic" reaches users (`statusLabels.ts:23`). That counts as a misleading health claim under Play policy (P-HEALTH), so it is a store-rejection candidate.
- **Cleared to build, subject to everything below.** The design of H1 and H2 raises no new ban or store-rejection risk. The final PASS applies only to the built result checked against Part E.

## Sources (fetched 2026-09-23 unless marked)

**Google Play policy**
- **P-UD** (answer/10144311):
  - Disclosure "must be immediately preceded by an in-app disclosure".
  - It must be "displayed in the normal usage of the app and not require the user to navigate into a menu or settings".
  - It must "Describe the data being accessed or collected" and "Explain how the data will be used and/or shared".
  - It must not be "included with other disclosures unrelated to personal and sensitive user data collection".
  - It must "Require affirmative user action".
  - It "Must not interpret navigation away from the disclosure (including tapping away or pressing the back or home button) as consent".
  - It must not use "auto-dismissing or expiring messages".
  - "Health data" and "device location" both count as personal and sensitive data.
- **P-PERM** (answer/9888170):
  - "Request permissions and APIs that access sensitive information to access data in context (via incremental requests), so that users understand why your app is requesting the permission."
  - Requests must be "limited to user consented purposes."
- **P-HEALTH** (answer/16679511):
  - "Other health and medical apps must include a clear disclaimer in their app description indicating that the app is 'not a medical device and does not diagnose, treat, cure, or prevent any medical condition.'"
  - "We don't allow apps containing misleading health claims that contradict existing medical consensus, or can cause harm to users."
  - The page says nothing about an in-app disclaimer.
- **P-HCPOL** (answer/12991134):
  - "any in-app disclosures related to health data access must accurately represent your data practices and intended use"
  - "Only request permissions and access data types that support the specific, user-facing health features you offer."
- **P-AIGC** (answer/13985936): the in-app reporting duty applies only to "Apps that generate content using AI". The H1 sentence does not trigger it. The LLM captions would, if they ship.

**Android developer docs**
- **A-PERM** (training/permissions/requesting, updated 2026-09-16):
  - "Wait for the user to invoke the task or action in your app that requires access"
  - Tapping Deny more than once "is considered a permanent denial"
  - "only prompt users for permissions when they need access to a specific feature"
- **A-BT** (bt-permissions, 2026-09-16): `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` show the "Nearby devices" prompt. On API 30 and below, `ACCESS_FINE_LOCATION` is required.
- **A-CDM** (companion-device-pairing, 2026-09-16): the system picker scans "without requiring the ACCESS_FINE_LOCATION permission" and "the user selects the device".

**Health Connect UI guidance**
- **HC-PROMO** (2026-09-22): "Ask for new permissions where it makes sense for users". Never write "Connect to Health Connect".
- **HC-DATA** (2026-09-22): you MUST display the source app's icon and name.
- **HC-PERM** (2026-09-22): the two-cancel screen and the insufficient-access screen are SHOULDs.
- **HC-GS** (2026-09-08): the rationale activity "must display the same privacy policy you provide … in the Google Play Console".

**Spotify Developer Policy (effective 15 May 2025)**
- I.1.a: "Only request and process the data that is needed to operate your SDA."
- III.14: "Do not use the Spotify Platform or any Spotify Content to train a machine learning or AI model or otherwise ingest Spotify Content into a machine learning or AI model."
- II.1 / VI.2: no implied endorsement by Spotify.

**AI Act**
- **AIA50** (secondary reproduction; law, owned by `regulatory-researcher`): 50(5) requires the notice "in a clear and distinguishable manner at the latest at the time of the first interaction or exposure … conform to the applicable accessibility requirements."

**Garmin: UNVERIFIED today**
- Both PDFs came back as binary and no renderer is available here: the brand guidelines and the Developer Program Agreement (the live agreement PDF's metadata shows it was created 2026-03-03).
- Garmin rules below come from the repo extraction of 2026-08-26 (`docs/plans/halts.md#garmin-brand-and-attribution` (was `C:\Users\danie\Videos\Kokonada\docs\plans\HALT_GARMIN_BRAND_AND_ATTRIBUTION.md`)).
- Only secondary search snippets corroborate them.

## A. H1: MUST / MUST NOT

### Cross-cutting
1. **One exported constant per string, in one module:**
   - the AI sentence;
   - the not-a-medical-device line;
   - the replacement for Pre-Panic, plus a neutral fallback.
   The literal appears once in `src`. The three screens import it; no inline copies.
2. **The AI sentence must not name Spotify, YouTube, Garmin or Health Connect,** or suggest that provider content feeds the AI system (Spotify III.14). It must not suggest a provider does or endorses the inference (Spotify II.1; Garmin "must not imply Garmin endorsement", UNVERIFIED). The wording itself belongs to `regulatory-researcher` (UI-005 default text).
3. **The not-a-medical-device line must not be weaker than, or contradict, the Play listing phrase** (P-HEALTH). Recommended: reuse the Play wording verbatim, so the constant can also serve the store listing at P13. It must add no claim ("clinically…", "wellness-proven"). It must not attach to a provider's values (never "Garmin/Health Connect data is not medical").
4. **Line (b) and map (c) ship in the same PR.** A "does not diagnose" line placed beside a "Pre-Panic" prediction is a self-contradicting health claim (P-HEALTH, misleading).
5. **Presentation of the legal lines:**
   - one readable text node, in the accessibility tree, never hidden;
   - no `numberOfLines` or ellipsis;
   - `allowFontScaling` stays on;
   - colour from content tokens only, never emotion-tinted;
   - no dismiss control;
   - AA contrast: 4.5:1 at body size, in both light and dark.
6. **Do not touch:**
   - `ConsentSheet.tsx`, `consentApi.ts` (`CONSENT_SCREEN_VERSION` stays 1), `consentStore.ts`, `backend/app/services/privacy/consent.js`;
   - `docs/`, `TASKS.md`, `.claude/`, `CLAUDE.md`;
   - `src/health/config.ts`.
7. **No Data safety or manifest change.** H1 changes no collection.
   - Before store submission (not an H1 blocker): the privacy policy, the Health Connect rationale page and the Health-apps declaration must state emotional-state inference. Otherwise P-HCPOL's "accurately represent … intended use" fails once this in-app statement exists.

### Generate (`GenerateScreen.tsx`)
- Persistent, between the hero and the Live/Manual toggle, above the fold at default font scale.
- On `textScrimFill`, at least `content.secondary` and body size.
- Not inside a `pointerEvents="none"` or accessibility-hidden wrapper.
- Visible in every state: 0–3 taps, typing, list open, error, Live on. The Genesis overlay covering it is acceptable.
- No sacred contract changes: the payload, `screenToCircumplex` and the tap cap stay as they are.

### Onboarding (`OnboardingScreen.tsx:137` chrome)
- In the persistent bottom chrome, rendered on all 3 panels.
- Must not inherit `beginFade` opacity.
- Not covered by the CTA or dots at 200% font.
- No OS permission or OAuth request from this screen (O3).

### Pulse (`PulseScreen.tsx` StateCard)
- The AI sentence and the not-a-medical-device line sit in the same card, directly after the state headline, whenever a headline renders.
- AA over `emotionAccent[quadrant].wash` in both faces.
- MUST NOT change, move or replace:
  - the source chips (`'Heart-rate sensor' | 'Health Connect' | 'No live source'`);
  - the gauges;
  - the Garmin-only notes.
- MUST NOT add any Garmin or Health Connect naming.
- This keeps H1 text-only on a surface that may show Garmin-origin data via Health Connect. Whether this counts as a new Garmin-data display under Agreement §6.6 (30-day notice) is UNVERIFIED. File the H1 screenshots for the §6.6 packet.

### Display map (`statusLabels.ts`)
- `friendlyStatus('High-Stress / Pre-Panic')` returns the exported constant. The replacement must be a non-clinical descriptor from the regulatory safe list. No "stress" until regulatory question Q4 is answered.
- `friendlyStatus` currently passes unknown strings through, only title-casing them (`:23-24`). Add a guard: any input matching `/panic|anxi|depress|disorder|attack|burnout|symptom|at risk|early warning|predict|diagnos|clinical/i` returns the neutral constant.
- Keep the existing D-4b assertions green, unchanged.
- `statusQuadrant` still receives the raw key, so its violet "intense" band for stress labels is unchanged.
- Only Pulse renders `stateVector.status` (grep-verified). The backend's `affect` / `BAND_LABELS` are not consumed by v1. The client must not start consuming them in H1.

## B. H2: MUST / MUST NOT

1. **One pure gate predicate** protects all of the following:
   - `startBiometrics`, `startLiveHr`, `getWatchToken` (including the cached-Keychain path), `requestBlePermissions`, `new BleManager()`, `startRestFallback` and Health Connect `readRecords`.
   - Predicate: signed in AND the account's wearable opt-in is set AND the consent is a fresh server read with `granted && !staleVersion` (ready or granted_ack).
   - Unknown, offline or malformed means no start (fail closed).
   - Applies to both `startApp` and `onSignedIn` (P-UD "before your app can begin to collect or access"; P-PERM "limited to user consented purposes").
2. **Mood-only accounts are never prompted.** No prompt, no mint, no scan and no Health Connect read on any path: boot, sign-in, foreground, the Generate Live toggle, the "Listen to your heart" CTA. The Live toggle must not set the opt-in.
3. **The Nearby-devices prompt is user-initiated only** (P-PERM "in context"; A-PERM "Wait for the user to invoke"; HC-PROMO). It never fires from bootstrap, sign-in, foreground or a timer.
   - An auto-restart for an already-granted, opted-in and consented user is fine, because no prompt appears.
   - After a denial, never re-prompt automatically (A-PERM permanent denial).
4. **Prominent disclosure immediately before `PermissionsAndroid.requestMultiple`** (P-UD).
   - The Art.9 ConsentSheet cannot serve as this disclosure. It never mentions Bluetooth, nearby devices or live streaming (`ConsentSheet.tsx:37-74`), and its copy is frozen for H1/H2.
   - Required: a separate in-app screen covering only this Bluetooth access. It states:
     - the data: heart rate from a nearby Bluetooth heart-rate device;
     - the use: sent to Kokonada to tune music live;
     - on API 26–30: why a Location prompt appears, and that location is not collected (A-BT; `minSdkVersion = 26`).
   - Affirmative tap to proceed. Back, tap-away or Home means no prompt. No timer or auto-dismiss.
   - The copy must be true of the code (see finding C4).
   - The copy must not name Garmin unless the string gets a separate compliance review.
   - The consent version is not bumped: this is a permission rationale, not Art.9 copy.
   - **Acceptable alternative:** H2 never asks for Bluetooth at all (Health Connect fallback only) until P6 builds the disclosure. That option is COMPLIANT as well.
5. **The opt-in is per account, set only by an explicit wearable-path action.**
   - It is cleared by `LiveHeartRateCard` Disconnect and by consent withdrawal.
   - It is never inferred from `integrations.biometricProvider`, `me.wearableProvider` or a cached `whr_`. Those are polluted by today's boot-time mints (finding C5).
6. **Withdraw, Disconnect and logout stop the running session:**
   - scan stopped, `BleManager` destroyed, fallback interval cleared;
   - `warmStore.liveHr` cleared;
   - no further `POST /watch/hr`.
   The `LiveHrSession` handle must therefore be kept. Today it is discarded (`prodBootstrap.ts:93`, `appBootstrap.ts:33`).
   - Logout teardown: the existing order of `sessionTeardown.ts` stays. Adding a stop step is an addition, and `architect` decides its slot (preferably before `clearWatchToken`).
7. **`player.connect()` only when there is a session AND Spotify is linked** (`/api/integrations/status.spotifyConnected`, fresh read, fail closed).
   - Otherwise, today's code can launch `SpotifyRemote.authorize()` at launch for signed-out or unlinked users (`spotifyRemoteAdapter.ts:52-54`). Spotify I.1.a supports the change; P-UD covers the unsolicited authorization screen.
   - `appBootstrap.test.ts:39-43` ("always attempts the Spotify player") conflicts with the owner-approved H2. Retire it with a recorded contract change, never a silent deletion.
   - `playbackServices.ts:105-109` `startPlayback()` connects unconditionally and has no caller. It must not be re-wired (route to `custodian`).
8. **No manifest or permission changes.**
   - `neverForLocation` stays.
   - `FINE_LOCATION maxSdkVersion=30` stays.
   - Nothing new: no `BODY_SENSORS`, background location, `FOREGROUND_SERVICE` or `READ_HEALTH_DATA_IN_BACKGROUND`.
   - No Health Connect `requestPermission` becomes reachable from bootstrap. The existing order in `connectController.ts` (consent wall, then OS sheet) is untouched.
9. **Garmin:** no Garmin term governs when Kokonada's own `whr_` credential is minted. It is not a Garmin credential, and the Connect IQ app is retired (`watchPairingClient.ts:4-9`). H2 must not touch or trigger the `garmin/connect` OAuth route. The BLE source label stays generic ("Heart-rate sensor").

## C. New findings (not in r_compliance.md)

1. **Stale copy (NEEDS CHANGE, inside H2).** `LiveHeartRateCard.tsx:99` says "live heart rate starts on its own once a source is available". That becomes false under H2, and P-HCPOL requires in-app disclosures to "accurately represent" data practices.
2. **Disconnect is not durable today (NEEDS CHANGE, inside H2).** Revoking in `LiveHeartRateCard` does nothing to stop the next boot re-minting the token. H2's opt-in must be cleared by Disconnect.
3. **The stream outlives logout and withdrawal (NEEDS CHANGE, inside H2).** The session handle is dropped, so scanning, pushes and `liveHr` continue until the app process dies. The server rejects the pushes (`integrationsController.js:763-765`), but the device keeps accessing the data.
4. **The Bluetooth path connects to the first device advertising the heart-rate service** (`bleHeartRate.ts:45-53`). It can ingest another person's broadcast.
   - Verdict: NEEDS CHANGE before any public release; it does not block H2, which only reduces exposure. The GDPR side is routed to `regulatory-researcher`.
   - Least-privilege fix: the system device picker (A-CDM). The user picks the device, and API 26–30 no longer needs the location permission.
5. **Minting the token flips `wearableProvider='garmin'`** (`integrationsController.js:704`), and `ProfileScreen.tsx:210` shows any `biometricProvider` as a connected wearable.
   - Today that shows mood-only users as connected, and labels generic Bluetooth and Health Connect data as Garmin (G5/PU3; Garmin "must not imply Garmin endorsement of data from other devices", UNVERIFIED).
   - Verdict: NEEDS CHANGE. Backend follow-up, not in H2's client scope. It becomes HALT the moment any Garmin attribution UI lands.
   - Defence in depth: put `requireConsent` on `POST /watch/token` (`routes/integrations.js:101`).
6. **Pre-existing, out of scope, H1 must not make them worse:**
   - Pulse shows no source-app name (HC-DATA MUST, PU5).
   - "Garmin-only" appears on Readiness (PU2).
   - "Body Battery" appears without ™ (PU4, UNVERIFIED).
   - The Health Connect rationale activity and privacy policy (CS10, HALT at submission).

## D. UNVERIFIED (do not record as compliant)

- **Garmin:** brand guidelines, Agreement §5.2(g), §6.6, the downstream-attribution scope, and the ™ rule. The live PDFs could not be read today.
- **Spotify:** no clause explicitly forbids unsolicited `authorize()`. Item B7 rests on P-UD and Spotify I.1.a.
- **Play:** an in-app not-a-medical-device line is not required by Play. It is driven by the MDR, which `regulatory-researcher` owns.
- **Law:** the Art.50 deployer question, the "here" wording on the pre-sign-in Onboarding, and the DT-7 gap on the consent sheet all go to `regulatory-researcher`.

## E. What I will check on the BUILT result

### Code
1. `git diff main` touches no:
   - `ConsentSheet.tsx`, `consentApi.ts`, `consentStore.ts`, `consent.js`;
   - `docs/`, `TASKS.md`, `.claude/`, `CLAUDE.md`, `src/health/config.ts`;
   - `AndroidManifest.xml`.
2. The constants module:
   - exact-string `toBe` pins;
   - a grep shows each literal defined once;
   - imported by `GenerateScreen.tsx`, `OnboardingScreen.tsx` and `PulseScreen.tsx`;
   - no provider names inside the strings.
3. `statusLabels` tests:
   - Pre-Panic maps to the constant;
   - a forbidden-vocabulary input set never returns a match to the regex;
   - all 10 labels in `medicalProfileService.js` are covered by a fixture;
   - the D-4b tests are unchanged and green;
   - `statusQuadrant` behaviour is unchanged.
4. RNTL tests on the legal nodes:
   - present in each Generate state and on each Onboarding page, and adjacent to the Pulse headline;
   - reachable by the accessibility tree;
   - no `numberOfLines`;
   - not inside a hidden or `pointerEvents="none"` ancestor.
5. H2 tests with stateful fakes. With the predicate false, none of these are called or constructed:
   - `requestMultiple`, `POST /watch/token`, the Keychain token read, the `BleManager` constructor, `readRecords`, `SpotifyRemote.authorize`.
   Cases where the predicate is false:
   - mood-only;
   - fresh sign-in before the Connect choice;
   - consent missing, stale, erroring or malformed;
   - opted in without consent;
   - signed out, and signed in but unlinked, for the player;
   - Live toggle pressed.
   Further H2 tests:
   - Disclosure: Back or dismiss means no request; Continue means exactly one request.
   - Withdraw, Disconnect and logout lead to zero pushes and zero scan callbacks, and clear `liveHr` and the opt-in.
   - The logout order test still passes.
   - The `appBootstrap` Spotify test is retired with a record.
6. `LiveHeartRateCard` copy matches the gated behaviour.

### Device evidence
Galaxy S22+ and an API 36 target, plus one API 26–30 target for the location branch.

7. Captures in both faces at font scale 1.0 and 2.0 (200%), with 3-button and gesture navigation:
   - the Generate sentence above the fold;
   - the Onboarding chrome on all 3 pages;
   - the Pulse card.
8. Contrast measured on pixels:
   - Generate over the worst aurora frame;
   - Pulse over the wash.
9. Screen recordings:
   - fresh install and sign-in, then mood-only: no OS dialog of any kind;
   - wearable path: consent, Health Connect sheet, Bluetooth disclosure, Nearby-devices prompt, in that order;
   - deny twice: no automatic re-prompt at the next boot;
   - withdraw: the live chip and heart-rate value clear.
10. Network capture (proxy) on mood-only and signed-out boots: no `/watch/token` and no `/watch/hr`.
11. TalkBack pass: all three legal lines are announced in reading order.

**Gate:** any failure in item 5, 9 or 10 is a HALT on merge. Any other failure is NEEDS CHANGE.