# Kokonada: design-time constraints registry, compliance-auditor, 2026-09-23 (read-only)

**Path roots.** `M\` = `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\`, `B\` = `C:\Users\danie\Videos\Kokonada\backend\app\`, `D\` = `C:\Users\danie\Videos\Kokonada\docs\`.
**Severity.** HALT = risk of losing developer-account access (ban) or store rejection. NC = needs change: a rule breach with a lower consequence, or a platform requirement. UNV = could not be confirmed from the live source, so it is not treated as compliant.
**State.** OPEN = verified in the repo today. NEW = not in any existing HALT/DEV plan. N/A = the surface is not built yet.

## 0. Read these before any direction work

1. **HALT: there is no live music playback provider.**
   - Spotify's Development Mode now limits new apps to 5 users, requires the app owner to have Premium, and Extended Quota needs a registered business plus 250k monthly active users ([SP-FEB26]).
   - The repo already agrees: `M\src\experience\connect\providers.ts:30` marks Spotify as halted, and the 2026-07-16 audit's Fork C chose "C1 — public path = vector Live Discovery + non-Spotify sink" (`D\audits\2026-07-16-fullstack-compliance\synthesis.md:51-59 (deleted; see docs/ARCHIVE.md)`). The only sink shipped in mobile is `spotifyRemoteAdapter.ts`.
   - YouTube cannot be an audio sink at all. The YouTube API Developer Policies forbid separating the audio from the video and forbid playing from a background player (a player not shown on the screen the user is viewing) ([YT-DP]).
   - **Consequence:** Now Playing, Genesis, the Generate call-to-action and the Mix Receipt cannot be directed until the owner and `architect` decide which service plays the music. Design two variants now (Spotify dev-beta, and no-provider or the future sink).
2. **NEW HALT: health-data collection starts at sign-in with no disclosure.**
   - The chain runs on every sign-in and every authenticated boot: `M\src\prodBootstrap.ts:77,93` → `M\src\health\biometricsWiring.ts:17-22` → `M\src\health\liveHr.ts:24-26` → `M\src\health\blePermissions.ts:34`.
   - It requests the Bluetooth scan/connect permissions ("Nearby devices"); on Android 11 and below it requests fine location instead.
   - It mints a watch token (`M\src\health\liveHrClient.ts:23`), which flips the user's wearable provider to Garmin.
   - It streams heart rate into the app's warm store, which Pulse and the aura display.
   - None of this checks consent on the client or shows a prominent disclosure first. Google Play's User Data policy requires the disclosure to be in-app and to immediately precede the consent request ([P-UD]). The Art.9 consent sheet protects only the Health Connect lane. The GDPR side (processing on the device before consent) goes to `regulatory-researcher`.
3. **NEW HALT: session history keeps provider content forever.**
   - `B\models\PlaylistSession.js:36-53` stores `trackIds` and `trackSummary` (title and artist) with no expiry. `B\workers\sessionTrim.worker.js:8,25` deliberately keeps `trackSummary`, and `B\controllers\sessionsController.js:40-41` serves it to the app.
   - Spotify Developer Terms IV.3.1.a: "Do not store Spotify Content indefinitely." Terms V.8 and Appendix A 5.c require deleting Spotify personal data within 5 days of disconnect.
   - YouTube Developer Policies III.E.4 allow at most 30 days before stored data must be refreshed or deleted.
   - **Consequence:** a History redesign built around "revisit the soundtrack" cannot rely on this data.
4. **Plan documents that are out of date:**
   - `docs/plans/dev-items.md#signin-brand-assets` #2 (Apple button style in dark mode) is fixed at `M\src\auth\SignInScreen.tsx:60`.
   - In `docs/plans/halts.md#spotify-track-ids-to-third-party`, the ReccoBeats path now drops Spotify tracks before the adapter runs (`B\services\features\featureService.js:26-33,72,152`). It looks mitigated, but it needs a formal re-audit to close. The outbound leak-monitor guard was not checked.
   - The note in `docs/plans/halts.md#health-connect-play-blockers` that no Health Connect brand page exists (404) is superseded. [HC-UI] now publishes official logo assets and background rules.

## Sources (all fetched 2026-09-23 unless marked)

| Key | Source (version / updated date) |
|---|---|
| SP-DG | https://developer.spotify.com/documentation/design (no version on page) |
| SP-POL | https://developer.spotify.com/policy (effective 15 May 2025) |
| SP-TOS | https://developer.spotify.com/terms (v10, effective 15 May 2025) |
| SP-FEB26 | https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide |
| YT-BR | https://developers.google.com/youtube/terms/branding-guidelines (updated 2025-08-20) |
| YT-DP | https://developers.google.com/youtube/terms/developer-policies (updated 2026-09-14) |
| YT-RMF | https://developers.google.com/youtube/terms/required-minimum-functionality (updated 2026-09-14) |
| GA-BG | https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf (V 6.30.2025, PDF text read) |
| GA-AGR | Garmin Connect Developer Program Agreement FRM-0952 Rev. B. **Not re-fetched**; from the repo audit of 2026-08-26 |
| G-SIWG | https://developers.google.com/identity/branding-guidelines (updated 2026-07-07) |
| A-HIG | https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple (page metadata: updated 2022-09-14) |
| A-ARG | App Store Review Guidelines 4.8 / 2.1. **Not re-fetched**; repo audit 2026-08-26; iOS parity only |
| HC-GS | https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started (2026-09-08) |
| HC-UI / HC-PERM / HC-DATA / HC-PROMO | https://developer.android.com/health-and-fitness/health-connect/ui/{guidelines,permissions,data,promote} (2026-09-22) |
| HC-ONB | https://developer.android.com/health-and-fitness/health-connect/ui/onboard-users (2026-04-28) |
| P-HEALTH | https://support.google.com/googleplay/android-developer/answer/16679511 |
| P-HCPOL | https://support.google.com/googleplay/android-developer/answer/12991134 |
| P-UD | https://support.google.com/googleplay/android-developer/answer/10144311 |
| P-DEL | https://support.google.com/googleplay/android-developer/answer/13327111 |
| P-META | https://support.google.com/googleplay/android-developer/answer/9898842 |
| P-ASSET | https://support.google.com/googleplay/android-developer/answer/9866151 |
| P-DECEPT | https://support.google.com/googleplay/android-developer/answer/9888077 |
| P-ICON | https://developer.android.com/distribute/google-play/resources/icon-design-specifications (2026-06-15) |
| P-TAPI | https://support.google.com/googleplay/android-developer/answer/11926878 (API 36 required from 2026-08-31; extension to 2026-11-01) |
| A16 | https://developer.android.com/about/versions/16/behavior-changes-16 (2026-09-16) |
| SPLASH | https://developer.android.com/develop/ui/views/launch/splash-screen (2026-09-22) |
| A11Y | https://developer.android.com/guide/topics/ui/accessibility/apps (2026-09-22) |
| AIA50 | https://artificialintelligenceact.eu/article/50/ (a secondary reproduction; applies 2 Aug 2026; this is law, so `regulatory-researcher` owns it) |

## G. Rules that apply to every screen

| # | MUST / MUST NOT | Source | Sev | Repo state |
|---|---|---|---|---|
| G1 | MUST NOT design any public surface assuming Spotify is the playback provider | SP-FEB26 | HALT | OPEN (§0.1) |
| G2 | MUST NOT play YouTube in the background, audio-only, or hidden. Any YouTube playback needs a visible embedded player at least 200×200 px, nothing drawn in front of the player or its controls, autoplay only when more than half of it is visible, and at most one autoplaying player | YT-DP; YT-RMF | HALT | N/A (no YouTube player in `M\src`) |
| G3 | MUST NOT build a product integrated with streams or content from another service (III.5). MUST NOT segue, mix or overlap Spotify audio with other audio (III.7), so no earcons, UI sounds or crossfades while Spotify plays. MUST NOT synchronize sound recordings with visuals, so no beat- or audio-reactive animation | SP-POL III.5-7, II | HALT | OPEN in spec: `D\UI_UX_OVERHAUL_SPEC.md:67,78` allows an optional earcon on track change. III.5 as applied to YouTube-derived taste is UNV and has been an open item since July (`D\superpowers\specs\2026-07-13-discovery-ui-compliance.md:23 (deleted; see docs/ARCHIVE.md)`) |
| G4 | Third-party marks: official asset files only. Never redrawn, recoloured, animated, rotated or stretched. Boards use labelled slots. Plain-text service names are fine | SP-DG; YT-BR; G-SIWG; A-HIG; GA-BG | HALT if redrawn | PASS. Canvas fixed per `docs/plans/dev-items.md#spotify-canvas-assets`; keep the invariant at `providers.ts:19` |
| G5 | Spotify logo colours: green only on black, white or non-duotone photography; black logo on light backgrounds, white on dark, monochrome elsewhere. Never on busy or low-contrast areas, so never directly on the aura or field | SP-DG | NC | PASS for colour selection at `SpotifyAttribution.tsx:18-21`; placement must be checked per screen |
| G6 | Touch targets at least 48×48 dp. Text contrast 4.5:1 below 18 sp, 3:1 otherwise. Every control has a content label. Colour is never the only signal | A11Y | NC (Play pre-launch report flags these; not a rejection) | partial |
| G7 | Every screen must handle system-bar insets. On Android 16 devices, apps targeting API 36 cannot opt out of edge-to-edge, and Play requires API 36 | A16; P-TAPI | NC (elevated for legal controls) | OPEN: `M\android\gradle.properties:44` sets `edgeToEdgeEnabled=false` while `build.gradle:6` targets SDK 36. No insets handling in `SignInScreen.tsx:120` (hard-coded 96/56), `ConsentSheet.tsx:256,268`, Generate, or Now Playing |
| G8 | Predictive back: on Android 16 with target API 36, `onBackPressed` is not called and the system back animations are on by default. Every overlay (Genesis, Consent, Up Next, Receipt) needs a designed back outcome. Back on a tab root must be allowed to go home | A16 | NC | OPEN: no `enableOnBackInvokedCallback` decision; `UpNextSheet.tsx:85` relies on `BackHandler`, which must be verified on Android 16 |
| G9 | On large screens (smallest width 600 dp and up), orientation and aspect-ratio locks are ignored, so layouts must adapt | A16 | NC | not designed |
| G10 | Health data is never used for ads, upsells or promotions. Any Spotify element on a health-data surface stays purely functional | P-HCPOL; SP-POL IV.2 | HALT if crossed | PASS today; standing rule (`docs/plans/halts.md#health-connect-play-blockers (was HALT_HEALTH_CONNECT_PLAY_BLOCKERS.md:89)`) |
| G11 | Nothing targeted at children; the store target audience must exclude them | SP-POL III.8 | HALT | store configuration not done |
| G12 | Privacy policy reachable inside the app, and shown before signup | P-HEALTH; SP-TOS V.12 | HALT | OPEN: no policy URL anywhere; landing page (`ARCH-003`) not built |
| G13 | AI Act Art. 50 first-exposure notice (law; placement comes from the repo ruling UI-005) | AIA50; `TASKS.md:228-265` | HALT (legal) | OPEN: the string "AI system infers" appears nowhere in `M\src` |
| G14 | No permission or OAuth request anywhere before its disclosure plus consent | P-UD | HALT | OPEN (§0.2) |

## 1. Splash

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| S1 | Use the system SplashScreen API. Icon is 240 dp fitting a 160 dp circle (with background) or 288 dp fitting 192 dp (without). Animated icon at most 1000 ms. No custom splash activity and no double splash | SPLASH | NC (guidance) | PASS via bootsplash (`MainActivity.kt:9`, `styles.xml:8-9`). The JavaScript "breath" splash must continue the system splash seamlessly, not read as a second splash |
| S2 | No third-party marks and no health or AI claims. No Art.50 notice needed here (repo ruling: install is not exposure) | P-DECEPT | — | PASS |
| S3 | Handles system-bar insets | A16 | NC | verify |

## 2. Onboarding

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| O1 | Art.50 sentence in the persistent bottom chrome, visible on every panel, not on a single panel | AIA50; UI-005 | HALT | OPEN (`OnboardingScreen.tsx:137`) |
| O2 | Onboarding can be reached again per account; today it is one-way per device and survives logout and deletion | UI-005 ruling; MB-009 | NC | OPEN `M\src\onboarding\onboardingStore.ts:8-14` |
| O3 | MUST NOT request OS permissions or OAuth here. Health Connect copy talks about user benefit. Never say "Connect to Health Connect"; use "Set up", "Get started" or "Choose data to share" | HC-PROMO; P-UD | NC | PASS |
| O4 | MUST NOT show capabilities that are not delivered: live Garmin, steps, GPS, cadence, SpO₂, "reads your mind", or clinical states | P-DECEPT; P-HEALTH | HALT in store assets, NC in-app | Risk: `D\VISION.md:38-43` |
| O5 | No real artist, track or cover-art content in panels | SP-POL II.3 | NC | OPEN on the canvas (UI-003) |

## 3. Login

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| L1 | Google button: official full-colour "G" only. Fills limited to #FFFFFF (stroke #747775, text #1F1F1F), #131314 (stroke #8E918F, text #E3E3E3) or #F2F2F2 (no stroke) — not porcelain theme tokens. Android padding 12/10/12. No monochrome or home-made G. Following these guidelines is required for app verification | G-SIWG | HALT | OPEN `SignInScreen.tsx:78-97` (text only, fill is `c.surface.raised`) |
| L2 | Google shown at least as prominently as other providers. Apple button no smaller than other sign-in buttons and never below the fold | G-SIWG; A-HIG | NC | OPEN `SignInScreen.tsx:126`: Apple height fixed at 52, Google scales with font size |
| L3 | iOS parity: system `AppleButton`, BLACK on light and WHITE on dark, at least 140×30 pt, margin at least 1/10 of height, corner radius may match the other buttons | A-HIG | NC | PASS `:60`. The entitlement HALT remains for iOS |
| L4 | iOS: an equivalent login must be offered wherever Google is (4.8); an email path does not exempt this | A-ARG | HALT at iOS submission | deferred (ADR-0016) |
| L5 | Legal microcopy with privacy policy and terms links on the signup surface | SP-TOS V.12; P-HEALTH; GA-AGR §5.3 (UNV) | HALT | OPEN (no link) |
| L6 | Reserve the Apple slot in the Android layout so iOS parity needs no re-layout | design | — | — |

## 4. Connect Services

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| C1 | No connect button for a provider that cannot complete the connection. Decide whether to show a Music card that has zero live rows | P-DECEPT; A-ARG 2.1 | NC (HALT if a button dead-ends) | Buttons PASS (`providers.ts:10-12`); card decision OPEN (YT-5) |
| C2 | Label it "YouTube", never "YouTube Music". Never use "YouTube" in the app name. "Works with YouTube" is allowed | YT-BR | HALT for store, NC in-app | OPEN `providers.ts:37` |
| C3 | YouTube explanation line must not imply a relationship with Google or promise a date | P-DECEPT | NC | OPEN `providers.ts:40` |
| C4 | Plan for YouTube's unverified-app screen (capped at 100 users until domain verification, DAN-007). If YouTube artist names still go to Groq, show a disclosure before OAuth | YT-DP III.E.3.2 (repo audit) | HALT | OPEN (YT-4, not re-verified) |
| C5 | Wearable path order: Art.9 sheet, then the OS Health Connect sheet. Back or dismiss is never consent | P-UD; HC-PROMO | HALT if broken | PASS `ConnectServicesScreen.tsx:153-161`; protect it |
| C6 | The Bluetooth "Nearby devices" prompt (and location on Android 11 and below) happens only on the wearable path, after the Art.9 sheet, with a disclosure immediately before it | P-UD | **HALT** | **OPEN, NEW** (§0.2) |
| C7 | Health Connect missing or needing an update is handled before consent. An insufficient-access screen appears at every entry point. After two cancels, show a screen pointing to Health Connect settings | HC-PERM | NC | Partial: Alerts at `ConnectServicesScreen.tsx:145-161`; pre-check at `healthConnect.ts:17-23` |
| C8 | Health Connect logo: official asset, transparent background, placed on white or very light grey (black allowed). Never on the navy dark surface #0E1030. Name is exactly "Health Connect" | HC-UI | NC | N/A |
| C9 | Garmin (blocked by DAN-009): the text "Garmin Connect", not abbreviated or stylized. Garmin brand features required on the connection surface (§6.1). 30 days' notice with mockups before shipping any UI that shows Garmin data (§6.6) | GA-BG; GA-AGR | HALT (schedule) | blocked upstream |
| C10 | If Spotify is ever shown: full logo at least 70 px, icon at least 21 px, clear space half the icon height. No Spotify green or circle-with-waves in Kokonada's own glyphs. No co-branding | SP-DG | NC | — |

## 5. Generate

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| GE1 | Art.50 sentence persistent, above the fold, on `textScrimFill`, at least `content.secondary`, not `pointerEvents="none"` | AIA50; UI-005 | HALT | OPEN |
| GE2 | Aura reacts to live heart rate only after Art.9 consent; otherwise mood-only visuals | P-UD (+GDPR, routed) | HALT | OPEN (§0.2) |
| GE3 | Any auto-continuous "Listen to your heart" mode keeps the user in control. Spotify prohibits non-interactive webcasting | SP-POL III | UNV | — |
| GE4 | No Spotify metadata on this screen without the mark, cover art and link-back | SP-POL II.4.1, II.5 | HALT | — |
| GE5 | No diagnose, treat or "regulates your nervous system" copy. Activity chips must not imply sensing that is not collected | P-HEALTH; P-DECEPT | NC | — |

## 6. Genesis

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| GN1 | No chime or earcon over Spotify audio and no beat-synced dissolve. "Music fades in" means starting playback, not a Kokonada audio layer | SP-POL III.6-7 | HALT | OPEN in spec (`UI_UX_OVERHAUL_SPEC.md:67,78`) |
| GN2 | A defined back-gesture outcome (cancel and return to Generate) | A16 | NC | — |
| GN3 | Honest status copy, no "reading your mind" | P-DECEPT | NC | — |

## 7. Now Playing and Up Next

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| NP1 | Cover art is required during Spotify playback. The "♪" placeholder may only be a transient retry state | SP-POL II.5 | HALT | Partial `NowPlayingScreen.tsx:160-178` |
| NP2 | Artwork corner radius 4 px (small or medium devices) or 8 px (large). No crop, overlay, text, logo or blur on the art. The art is never animated or distorted | SP-DG | NC (branding) | OPEN: radius is `radius.xl` = 28 (`:168,354`, `tokens.ts:231`); `resizeMode="cover"` at `:164` crops non-square art. **The spec contradicts the rule:** `D\UI_UX_OVERHAUL_SPEC.md:89` and `D\SCREENS.md:110-111` call for "album-art gyro-parallax". Parallax may move the background only |
| NP3 | Spotify mark on every playback view (full screen, widgets, notifications, lock screen if Kokonada renders one). Clear space = half the icon height, derived from the mark itself | SP-DG | NC | OPEN `SpotifyAttribution.tsx:25,93`: gap is 8 px where about 11.6 px is required |
| NP4 | Link-back wording "PLAY / OPEN / LISTEN ON SPOTIFY", or "GET SPOTIFY FREE" when not installed. The link should reach the specific content | SP-DG; SP-POL II.4.2 | NC / UNV | Wording PASS `:55`. `spotifyLinkBack.ts:27` opens bare `spotify:`, not the track URI |
| NP5 | Title and artist as Spotify provides them, legible, truncated only with the full text available. Never misleading about the artist | SP-DG; SP-POL II.3 | NC | OPEN risk: title and artist come from Kokonada's queue while the cover comes from App Remote (`nowPlayingStore.ts:8-10`) |
| NP6 | Receipt kept visually separate from the Spotify mark | SP-DG | — | PASS `:197-205` |
| NP7 | Aura runs on its own clock, never reacting to the audio | SP-POL III.6 | HALT if broken | PASS; pin with a test |
| NP8 | Do not clone Spotify's core Now Playing experience | SP-POL III | NC | — |
| NP9 | A YouTube-sourced item carries the official YouTube icon, not recoloured, linking to `youtube.com/watch?v=<id>`. Non-YouTube content must not look YouTube-sourced | YT-DP III.F.2; YT-BR | HALT once YouTube is live | OPEN (YT-2: no provider discriminator) |
| NP10 | Art.50 per-read enumeration, emitted by the server | UI-005 | HALT | OPEN |

## 7b. Mix Receipt

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| R1 | The mark and link-back cover only the playing item, or each Up Next row gets its own Spotify URI | SP-POL II.4.2 | NC | OPEN (`docs/plans/dev-items.md#spotify-canvas-assets`) |
| R2 | Never display analysis derived from Spotify content (per-track BPM or energy of Spotify tracks) | SP-POL III.13; SP-TOS IV.2.a.i | HALT | Backend gate PASS (`featureService.js:26-33`); the design must not surface it |
| R3 | When Garmin data contributed: Garmin attributed as a contributing source, e.g. "Insights derived in part from Garmin device-sourced data" (Garmin's own acceptable wording). Must not imply Garmin endorses Health Connect or Bluetooth inputs. Never in tooltips or accordions | GA-BG "Combined or Derived" | HALT once live | OPEN (G3) |
| R4 | Health Connect "attribution with education": source app name plus a link to Health Connect's App permissions screen | HC-DATA | NC | OPEN |
| R5 | "Not a medical device" line at the head (C5(b)) plus the Art.50 enumeration | P-HEALTH; UI-005 | HALT | OPEN |

## 8. Pulse

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| PU1 | "Garmin [device model]" (or "Garmin" only if the API gives no model) directly under or beside the title, above the fold, whenever a Garmin value is **present**. Never the literal "[DEVICE MODEL]" | GA-BG | HALT once live | OPEN `pulsePresentation.ts:95,107`; `warmStore.ts:7` has no `'garmin'` source |
| PU2 | Readiness is never labelled as Garmin data | GA-AGR §5.2(g) | HALT | OPEN `pulsePresentation.ts:107` |
| PU3 | Generic Bluetooth heart-rate straps are never stamped as Garmin | GA-BG | HALT once PU1 lands | OPEN `liveHrClient.ts:14`; `issueWatchToken` |
| PU4 | Written as "Body Battery™"; the licence for that mark is UNV | GA (repo audit) | NC | OPEN `pulsePresentation.ts:32`; `ConsentSheet.tsx:29` |
| PU5 | Health Connect values show the origin app's name (and icon) from `DataOrigin.packageName` | HC-DATA | NC | OPEN, NEW |
| PU6 | No diagnostic, clinical or panic-predicting state labels | P-HEALTH (misleading or harmful health claims) | HALT-candidate; also a medical-device question for `regulatory-researcher` | OPEN: `B\services\medicalProfileService.js:18-20` "High-Stress / Pre-Panic" reaches users verbatim via `statusLabels.ts:23` |
| PU7 | "Not a medical device" line and the Art.50 sentence next to the state headline | P-HEALTH; UI-005 | HALT | OPEN |
| PU8 | Detail views repeat the Garmin attribution | GA-BG "Secondary screens" | HALT once live | N/A |

## 9. History

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| H1 | Rows showing tracks carry the Spotify mark and link-back, or the YouTube icon, per row or per section | SP-POL II.4; YT-DP III.F.2 | HALT when shown | N/A: `HistoryRow.tsx:67` shows the title only, but `sessionsApi.ts:7` already delivers tracks |
| H2 | Soundtrack detail must fade to session title and mood once stored metadata ages out (Spotify: not indefinitely; YouTube: 30 days; Spotify disconnect: delete within 5 days) | SP-TOS IV.3.1.a, V.8, App. A 5.c; YT-DP III.E.4 | **HALT** | **OPEN, NEW** (§0.3) |
| H3 | Views derived from Garmin data are attributed | GA-BG | HALT once live | — |

## 10. Profile / Privacy Vault

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| V1 | Account deletion easy to find in-app, plus a public web deletion URL naming the app | P-UD; P-DEL | HALT | In-app PASS (`ProfileScreen.tsx:348-372`); web URL OPEN |
| V2 | Privacy policy link | P-HEALTH | HALT | OPEN |
| V3 | A permanent "Manage access" link into Health Connect, and a sync switch that stops all Health Connect sync when off | HC-PERM (fetched summary says MUST; search snippet says "should" — strength UNV) | NC | OPEN (only the alert path at `:145`) |
| V4 | YouTube disconnect revokes the token at Google programmatically, then deletes data within 7 days. Copy says "Disconnecting…" and "no longer linked", and says nothing about Spotify | YT-DP III.D.2; SP-POL I.1 | HALT | OPEN `B\controllers\integrationsController.js:406-442` (no call to `oauth2.googleapis.com/revoke`); `ProfileScreen.tsx:294` "Rebuilding…" |
| V5 | Spotify disconnect deletes Spotify personal data within 5 days | SP-TOS V.8 | HALT | not re-verified |
| V6 | "Garmin Connect" written in full; Garmin trademark notice in About; terms of service with §5.3 clauses | GA-BG; GA-AGR (UNV) | NC | name PASS (`:151`); the rest OPEN |
| V7 | Withdrawing Art.9 consent does not revoke Health Connect permissions; say so and offer "Manage access" | HC-PERM | NC | OPEN |

## 11. Art.9 consent sheet

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| CS1 | Disclosure is in-app, in the normal flow, immediately before the OS request, accepted by tapping Agree. Back, tap-away or home never count as consent. Nothing auto-dismisses | P-UD | HALT | PASS for the Health Connect lane (`ConsentSheet.tsx:124-127,142`; modal close at `ProfileScreen.tsx:383`, `ConnectServicesScreen.tsx:240`). FAIL for the Bluetooth lane (C6) |
| CS2 | Final legal copy with real retention periods | P-HCPOL (retention); GDPR (routed) | HALT | OPEN `ConsentSheet.tsx:16,35,58` placeholder copy |
| CS3 | Privacy-notice link inside the sheet | P-HEALTH | HALT | OPEN |
| CS4 | Any copy change means a version bump in lockstep (client v3 ships first, then server v3; Garmin minimum 4), the text archived, and a screenshot filed per version | HALT_CONSENT C2 | HALT (process) | OPEN |
| CS5 | Data list matches the OS sheet ("Sleep session"; history listed as a separate permission line) | P-HCPOL (accuracy) | NC | OPEN `ConsentSheet.tsx:24`; `VaultConsentPanel.tsx:24,26` |
| CS6 | Purpose and controller identity always visible; several sections can be open at once; Art.50 scoped wording in the fixed chrome | UI-003; UI-005 | NC / HALT | OPEN |
| CS7 | Decline and Agree identical in geometry, Decline first, Decline border at least 3:1, Agree never tinted by emotion | `D\SCREENS.md:175-186` | — | PASS; measure the border at `:234`; fix the false comment at `:220-224` |
| CS8 | Action bar fully above the navigation bar in edge-to-edge (3-button navigation), targets at least 48 dp | A16; A11Y | NC (legal control) | OPEN `:256,268` fixed padding, no insets handling |
| CS9 | Export an onboarding activity (`SHOW_ONBOARDING`, both manifest forms) that shows education and consent before permissions. Without it, a user connecting from inside Health Connect goes straight to Manage permissions and never sees the Art.9 notice | HC-ONB | NC | OPEN, NEW (not in `AndroidManifest.xml`) |
| CS10 | The rationale activity shows the same privacy policy as Play Console; the alias targets the rationale activity; only one intent-filter | HC-GS | HALT (blocks Play) | OPEN `PermissionsRationaleActivity.kt:18-19`; `AndroidManifest.xml:75-77,93` |

## 12. Tab bar and system states

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| T1 | Handles insets. Back on a root tab goes home. Selected state is not signalled by colour alone | A16; A11Y | NC | PASS `EmotionTabBar.tsx:23,36,45,68-69` |
| T2 | Any mini-player in the tab chrome follows NP1-NP4, and G10 on the Pulse tab | SP-POL II.4-5 | HALT when built | — |
| T3 | Tab glyphs never resemble Spotify (circle with three arcs) or the YouTube play mark, and never use Spotify green | SP-DG; discovery-ui C4 | NC | — |
| SS1 | Health Connect states: insufficient access at every entry point, two-cancel screen, not installed or needs update | HC-PERM | NC | partial |
| SS2 | Error and offline copy never blames a provider or implies affiliation with one | SP-POL I.1, II.3; GA-AGR §5.2(g) | NC | — |
| SS3 | Notifications, widgets or lock screen showing Spotify metadata carry the mark | SP-DG | HALT when built | — |

## 13. App icon and store assets

| # | MUST / MUST NOT | Source | Sev | State |
|---|---|---|---|---|
| A1 | Icon 512×512, 32-bit sRGB PNG, at most 1024 KB, full square with no pre-rounded corners and no shadow, opaque background, on the keyline. No ranking, deal, program badge or misleading graphics | P-ICON; P-ASSET | HALT | not exported |
| A2 | Adaptive icon includes a monochrome layer | QPR2 (search-derived, UNV) | NC | PASS `mipmap-anydpi-v26\ic_launcher.xml:5` |
| A3 | Icon must not resemble the Spotify logo (green, circle, waves) or YouTube marks | SP-DG | NC | — |
| A4 | Title at most 30 characters; no emoji, all-caps, "#1" or "Best"; no price or promo text ("Free") in the title or icon | P-META | HALT | — |
| A5 | Description includes verbatim "not a medical device and does not diagnose, treat, cure, or prevent any medical condition". It must also disclose the wearable requirement and device compatibility, and not imply the health features work without the hardware | P-HEALTH | HALT | OPEN (C5(a)); the hardware disclosure is NEW |
| A6 | Screenshots show the real app; taglines at most 20% of the image; no "Download now"; no device frames; no third-party logos without permission; made-up track and artist names; never "YouTube Music"; no Garmin UI before the §6.6 notice | P-ASSET; P-META; SP-POL II.3; YT-BR | HALT | OPEN: Holocene / Bon Iver on the boards (UI-003) |
| A7 | No efficacy claims ("reduces anxiety", "reads your mind") | P-HEALTH; P-DECEPT | HALT | — |
| A8 | Data safety form, health-apps declaration, in-app copy and the rationale page all match | P-HCPOL | HALT | OPEN: `D\PRIVACY_DECLARATIONS.md:72-80` omits Sentry and still lists Vercel; `:85-91` Groq DPA/ZDR unconfirmed; declaration not filed |
| A9 | Target audience excludes children | SP-POL III.8 | HALT | — |

## 14. When compliance-auditor runs in the per-page pipeline

1. **Stage 0: constraint brief.** Runs after `architect` has scoped the page and **before** `designer` sets its direction. It runs jointly with `regulatory-researcher` for the rows that come from law.
   - **Needs:** the page's `SCREENS.md` entry, plus a data-flow sheet listing every rendered field, which provider supplies it, the provider's state in `providers.ts`, the OS prompts in order, the consent-state dependencies, the marks planned, and whether the page will appear in store screenshots.
   - **Produces:** this registry's rows for the page, with any source older than 30 days re-fetched, the UNV and Pause & Guide items listed, and asset slots requested.
   - **Gate:** any HALT row blocks direction on that surface (for example, Now Playing waits for the Fork C decision).
2. **Stage 1: after the prototype.** Runs before `designer` gives SHIP and before `developer` starts.
   - **Needs:** boards for every state, in light and dark, at font scale 1.0 and maximum, with gesture and 3-button navigation; the exact copy deck; an asset manifest (source URL, file hash, rendered dp/px, measured clear space, background colour behind each mark); a motion spec (what moves, confirming the art never animates, nothing is audio-synced, no earcons during Spotify playback); a permission and back-gesture sequence diagram; truth and intended variants labelled.
   - **Gate:** a SHIP without Stage-1 COMPLIANT is invalid.
3. **Stage 2: after the build, on device.** Runs after `resilience-auditor` and before merge.
   - **Needs:** screenshots and screen recordings from the Galaxy S22+ and an API 36 / Android 16 target (the consent → OS sheet flow, two denials, back and predictive back on every overlay); an Accessibility Scanner report; values measured from the build, not the board (logo px, clear space, art radius, contrast); a network-egress capture for the page (new hosts, payload fields); manifest and permission diff; strings diff against the Stage-1 deck; tests pinning each property (mark renders whenever a value is present, link-back target, attribution text, no permission before consent).
   - **Gate:** a HALT blocks merge.
4. **Stage 3: before store submission.** Also re-runs whenever a provider's state changes (Spotify quota, YouTube verification, Garmin approval) or the consent copy changes.
   - **Needs:** the listing text, screenshots, icon and feature graphic; the Data safety and health-apps declaration answers; live privacy-policy and deletion URLs; the `PRIVACY_DECLARATIONS.md` diff; the consent-version archive; every cited source re-fetched within 14 days.
   - **Garmin:** the §6.6 notice must be sent with the Stage-2 screenshots at least 30 days before any build that shows Garmin data.

## UNVERIFIED — do not record as compliant

- **Garmin:** whether the Health API returns a device model, the ™/® marking rule, the Body Battery licence, and the §5.3 terms-of-service clauses are all behind the portal login or NDA. The agreement text was not re-fetched.
- **YouTube:** minimum logo sizes (the branding page defers to the brand site) and the YouTube Music brand terms (login-gated).
- **Spotify:** how III.5 applies to YouTube-derived taste combined with Spotify playback; whether the live mode counts as "non-interactive webcasting"; whether opening bare `spotify:` satisfies II.4.2.
- **Health Connect:** whether the settings switch is a MUST or a SHOULD, and whether logo use needs approval.
- **Suunto:** partner brand guidelines are partner-gated. Do not add any Suunto surface without an audit.
- **Apple:** 4.8 and 2.1 were not re-fetched (iOS parity only).
- **Law:** the Art.50 deployer question in a pure consumer setting goes to `regulatory-researcher` / DAN-010.

**Design tools (Taste Skill, awesome-design-md, UI UX Pro Max).** Anything these generate is bound by G4 and A6: no redrawn marks, no real artist or cover content, no fonts the app cannot bundle (UI-006). If a tool ships a Spotify-style DESIGN.md (unverified), using it as the base for Now Playing would breach SP-POL III (do not mimic Spotify's core experience) and SP-DG (no co-branding).