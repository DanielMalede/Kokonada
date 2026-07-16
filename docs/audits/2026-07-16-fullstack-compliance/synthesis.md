Ground truth confirmed on the load-bearing paths. Key verifications: `geminiEngine.js:34-40,88-90` (unguarded Gemini free-tier fallback via `GEMINI_API_KEY`, no tier/ZDR check), `integrationsController.js:531` (fail-open guard, `req.query.secret`, `!==`) + `:539-548` (unvalidated `gid` → `User.findOne`) + `:497-500` (backfill fires on callback), `erasure.js:19-24` (AudioFeature/TrackEmbedding deliberately excluded — the spotify-row containment surface), `userRedisPurge.js:12-16` (no `buffer:*` pattern), `jwt.js:55,59` (no `algorithms` pin), `auth.js:19-24` (connect-token authenticates all routes), `vercel.json:19-20` (Report-Only CSP + `unsafe-inline` + `https:`/`wss:` wildcards). Nested worktrees confirmed present via Glob.

---

# Kokonada — Security + Compliance Remediation Plan

## 1. Executive Summary & Risk Posture

**Overall posture: prod is store-unshippable and carries live ban risk on all three data providers.** One real user today, but the exposures are structural, not incidental.

**Live (active-in-prod) exposures — data already leaving the boundary right now:**
- **Special-category biometrics egress to Groq on every generation.** `resolveBiometricContext` decrypts MedicalProfile → `_formatBiometric` renders `HRV/SpO2/bodyBattery/readiness/sleep/HR + inferred state` → POSTed to `api.groq.com` (`biometricHandler.js:301-351,596-604` → `geminiEngine.js:231-255,286,46-91`). Directly violates ADR-0005 ("never shipped to external AI"), GDPR Art. 9, and every store declaration. **This is the single most severe NET-NEW item.**
- **Spotify Content → LLM.** Artist names/genres in the emotion prompt + `inferArtistGenres` batch to Groq (`geminiEngine.js:276,294-296,416-419`) — Spotify Developer Policy AI-ingestion prohibition = access revocation. (Folds into the already-planned HALT.)
- **Free-text notes verbatim to Groq/Gemini** (`geminiEngine.js:284`).
- **Silent Gemini free-tier fallback** (`geminiEngine.js:88-90`, no tier/ZDR guard) — if `LLM_API_KEY` ever unset, health data trains Google models + human review.

**Latent-but-armed exposures:**
- **Garmin webhook is a public, fail-open, injectable write to any user's medical profile** (`integrationsController.js:531,539-548`). Garmin approval is pending, so deploying with `GARMIN_WEBHOOK_SECRET` unset is realistic → unauthenticated cross-user biometric poisoning via `{"userId":{"$gt":""}}`.
- **Garmin Health API hit against prod without confirmed approval** + 6-month backfill on callback (`:497-500`) — Program Agreement breach.

**Store-submission blockers (hard rejections):** health→AI without disclosure/consent (Apple 5.1.3 / 5.1.2(i)); missing Sign in with Apple; privacy declarations that contradict the egress; Health Connect declaration unfiled.

**Commercial blocker:** Spotify Dev Mode is now non-commercial + 5-user cap + owner-Premium; Extended Quota is org-only + 250k-MAU. Public launch on Spotify-as-primary-sink is structurally impossible for an individual pre-launch dev.

**Bottom line:** nothing ships to a store, and nothing scales past a handful of test users on Spotify/Garmin, until WS-0 (egress) and WS-2 (webhook) land and the human gates clear. The good news: the clean alternatives already exist in-repo (deterministic state classifier, vector discovery sink, `captionService` feature-only pattern, Suunto fail-closed HMAC pattern, erasure cascade).

---

## 2. Decision Tables (widest-blast-radius forks — STOP points)

### Fork A — Biometric egress to the LLM (blast radius: `geminiEngine.js`, `biometricHandler.js`, `moodDescriptors.js`, PlaylistSession schema, store declarations)

| Option | What changes | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **A1 — Vitals never leave server; two-stage split (RECOMMENDED)** | LLM prompt carries only abstract mood + emotion coordinates → returns seed genres/taste params. Vitals decrypted in worker scope map to `target_bpm/energy/valence` deterministically *after* the LLM returns (`computeStateVector`/`moodDescriptors` already exist). | `geminiEngine.js` prompt builders (`_formatBiometric`, `_buildBiometricPrompt`), `biometricHandler` wiring. Contained backend. | Low — reuses existing deterministic engine. | High — pure server-side refactor, no external contract. | Coarser LLM steering; mitigated because BPM/energy were always the deterministic part anyway. |
| **A2 — Send only a coarse non-numeric state label** (`"recovering"/"energized"`) behind explicit Art.9 consent + Groq DPA/ZDR | Strip numerics; keep one label; add consent gate + sub-processor disclosure. | Same code + new consent surface + DPA/portal work. | Medium — a coarse label may still be argued to be health data; consent infra must exist. | Medium — consent + DPA are durable commitments. | Consent withdrawal must revoke; label leakage still a disclosure obligation. |
| **A3 — Keep numeric vitals in prompt behind consent+DPA** | Only add consent + DPA + declarations. | Minimal code, maximal legal surface. | High — permanently ships Art.9 data off-box; contradicts ADR-0005. | Low — hard to walk back a disclosed data flow. | Any DPA gap, free-tier fallback, or store re-review = ban/rejection. |

**Recommendation: A1.** It is the only option that keeps ADR-0005 intact, makes every store declaration true-as-written, and removes the Garmin/Apple/GDPR consent obligations for the egress entirely. A2 is the fallback *only if* product proves the coarse label materially improves output; it still requires the WS-4 consent infra. A3 is rejected — it converts a code bug into a permanent legal liability.

### Fork B — Web session-token storage (blast radius: `frontend/src/lib/api.ts`, `useSocket.ts`, backend cookie issuance, cross-site Vercel↔Railway topology)

| Option | What changes | Blast radius | Tech debt | Reversibility | Failure modes |
|---|---|---|---|---|---|
| **B1 — Partitioned (CHIPS) httpOnly+Secure+SameSite=None cookie (RECOMMENDED near-term)** | Backend already sets `kokonada_token` httpOnly cookie (`jwt.js:14-19`); add `Partitioned`. Frontend stops reading/storing `koko-token`; drop the Bearer/localStorage path for web. | `api.ts`, `useSocket.ts` handshake, cookie opts. Native mobile keeps Bearer via secure OS storage. | Low. | High. | Older browsers without CHIPS; Socket.IO handshake must send cookie cross-site (verify). |
| **B2 — Same registrable domain via custom domain / reverse proxy** | Serve API + SPA under one domain so a first-party httpOnly cookie "just works." | Infra/DNS + Vercel/Railway routing. | Low code, medium ops. | Medium (DNS). | Proxy/edge misconfig; larger ops change. |
| **B3 — Keep bearer but short-lived access + rotating refresh** | Minutes-TTL access token + silent refresh; token still JS-readable but expires fast. | `api.ts`, refresh endpoint, denylist. | Medium — refresh machinery. | High. | Still XSS-readable within TTL; CSP (WS-7) becomes the real control. |

**Recommendation: B1 now, B2 as the durable end-state.** The httpOnly cookie already exists; the localStorage copy is the residual XSS surface (`api.ts:9-37`). B3 is complementary hardening, not a substitute.

### Fork C — Spotify's role in the public product (blast radius: whole Spotify integration, playback sink, store positioning)

| Option | What changes | Blast radius | Reversibility | Failure modes |
|---|---|---|---|---|
| **C1 — Public path = vector Live Discovery + non-Spotify sink; Spotify gated to ≤5 Premium beta testers (RECOMMENDED)** | Ship the already-built `source ⊥ sink` public path; Spotify behind a dev/beta flag. | Sink selection, feature flag, UI gating. | High. | Beta users must be Premium + counted against the 5-cap. |
| **C2 — Form a registered business + apply for Extended Quota** | Legal/business entity + application. | Business/legal only. | Low (org commitment). | 250k-MAU chicken-and-egg likely rejects a pre-launch app. |
| **C3 — Ship Spotify as primary public sink** | Nothing. | — | — | **Structurally non-compliant** — Dev Mode is 5-user/non-commercial; guaranteed access loss + store misrepresentation. |

**Recommendation: C1.** This is the already-established direction (memory: source⊥sink, vector discovery SHIPPED). C2 is a parallel *business* track for Daniel, not an engineering blocker. C3 is off the table.

---

## 3. Deduped Findings by Severity

Classification legend: **BAN** (provider access revocation), **REJECT** (store rejection), **SEC** (security), **LEAK** (data leak), **PRIV** (privacy/GDPR).

### CRITICAL
- **C-1 Biometric vitals → third-party LLM.** `biometricHandler.js:301-351,596-604` → `geminiEngine.js:231-255,286,305-332,46-91`. Rule: ADR-0005; GDPR Art.9/44/28; Apple 5.1.3 + 5.1.2(i); Garmin consent clause. **LEAK/PRIV/REJECT/BAN.** (Dedup of findings: biometric-egress ×3, Apple-5.1.3, Garmin-consent, declaration-mismatch.)
- **C-2 Spotify public launch structurally impossible + Premium-required contradicts "free."** `spotify.js:5-64,37`; `integrationsController.js:82-144`; `frontend spotifyPlayer.ts:89-97`. Rule: Spotify Quota Modes + 2026-02-06 platform-security update. **BAN/commercial.** (Dedup: quota + Premium findings.)
- **C-3 Garmin Health API prod-without-approval + auto-backfill.** `wearable/garmin.js:8,118-133`; `integrationsController.js:497-500`. Rule: Garmin Connect Developer Program Agreement (manual prod vetting). **BAN.**

### HIGH
- **H-1 Garmin webhook fail-open + NoSQL injection + secret-in-URL + non-const-time + no range clamp.** `integrationsController.js:531,539-548`; `wearable/adapter.js:135,177,194`. Rule: OWASP A01/A03/A07/A09, CWE-943/598/208/305. **SEC.** (Dedup of 6 findings — single hardening task.)
- **H-2 Free-text notes verbatim to LLM.** `biometricHandler.js:1052-1058,600` → `geminiEngine.js:284`. **PRIV.**
- **H-3 Spotify Content (artist/genre) → LLM.** `geminiEngine.js:276,294-296,416-419`. Rule: Spotify Developer Policy AI-ingestion ban. **BAN.** (Folds into WS-1 Spotify HALT.)
- **H-4 Gemini free-tier fallback trains on health data.** `geminiEngine.js:34-40,88-90`. **LEAK.**
- **H-5 Garmin disconnect purges nothing + no deregistration/permission webhook.** `integrationsController.js:514-522,529-556`. Rule: Garmin retention/deletion-on-revoke. **BAN/PRIV.**
- **H-6 No Garmin attribution on any screen showing Garmin data.** `NowPlayingPage.tsx:233`; Profile health vault; mobile ProfileScreen. Rule: Garmin API Brand Guidelines. **BAN.**
- **H-7 No Sign in with Apple on iOS.** `mobile/.../ConnectHealthScreen.tsx:157`; backend ready `routes/auth.js:10`. Rule: App Store 4.8. **REJECT.**
- **H-8 Store privacy declarations contradict live egress.** `docs/PRIVACY_DECLARATIONS.md:24,37,41,52` vs `geminiEngine.js:286,336-341`. **REJECT.** (Resolves automatically if C-1/H-2/H-3 land.)
- **H-9 No GDPR Art.9 consent captured** (only OS/OAuth read grants). `mobile ConnectHealthScreen.tsx:111-144`; `integrationsController.js:462-511`. **PRIV/REJECT.**
- **H-10 YouTube titles/channels → Groq (classifier + estimator).** `musicClassifier.js:66-78,135-139`; `features/llmEstimatorAdapter.js:45-60,92`. Rule: YouTube Developer Policies. **BAN.**
- **H-11 YouTube `search.list` (100u) on every YouTube-source generation.** `youtube.js:290-304`; `biometricHandler.js:572-575`. Rule: 10k units/day → suspension. **BAN.**
- **H-12 Session JWT in localStorage.** `frontend/src/lib/api.ts:9-37`; `useSocket.ts:77`. **SEC.** (See Fork B.)
- **H-13 Spotify metadata rendered during playback without mark/link on mini-player + LivePlayer.** `NowPlayingBar.tsx:43-44`; `LivePlayer.tsx:32-33` (contrast `NowPlayingPage.tsx:218-228`). Rule: Spotify branding/attribution. **BAN.**

### MEDIUM
- **M-1 Groq unconfirmed DPA/ZDR** for health + free-text. `geminiEngine.js:33,49,286`. **PRIV.**
- **M-2 Full-scope Spotify token (incl. write) handed to browser.** `integrationsController.js:185-202`; `useSpotifyPlayer.ts:11-31`. **LEAK.**
- **M-3 BiometricLog "100k cap" never enforced, no TTL; MedicalProfile + PlaylistSession indefinite.** `BiometricLog.js:25,28`; `MedicalProfile.js`; `PlaylistSession.js:16,20-23,70-75`. Rule: GDPR 5(1)(e). **PRIV.**
- **M-4 Wearable disconnect never purges data; Apple/HealthConnect/Suunto have no disconnect route.** `integrationsController.js:514-522`; `routes/integrations.js:64-78`. **PRIV.**
- **M-5 Health Connect Play declaration unfiled** (background+history reads). `AndroidManifest.xml:6-14,70-95`. **REJECT.**
- **M-6 CSP is Report-Only + `unsafe-inline` + `https:`/`wss:`/`img https:` wildcards.** `vercel.json:19-20`. **SEC/LEAK.**
- **M-7 Docker runs as root.** `backend/Dockerfile:1-12`. **SEC.**
- **M-8 Untracked multi-GB dumps + nested worktrees not gitignored.** `.gitignore`, `.githooks/pre-commit:10`; confirmed `.worktree-spotify-guard/`, `mobile/.../. worktree-onboarding/`. **SEC.**
- **M-9 YouTube-derived rows in shared stores — confirm ≤30-day retention/refresh + Groq service-provider terms.** `youtube.js:138-279`; `musicClassifier.js`. **BAN/PRIV.**

### LOW
- L-1 ADR-0005 decryption audit-trail unimplemented (`encryptedField.js:26-42`; `biometricHandler.js:314-345`). **SEC.**
- L-2 Field encryption not AAD-bound to userId (`encryptedField.js:23-24,38-39` vs `baselines.js:82`). **SEC.**
- L-3 Erasure omits `buffer:${userId}:*` Redis keys (`userRedisPurge.js:12-16`; `shadowBufferRepo.js:11`). **PRIV.**
- L-4 MusicProfile declares plaintext `restingHeartRate`/`hrZones` (`MusicProfile.js:63-70`). **LEAK.**
- L-5 `garminUserId` + `pushTokens` plaintext on User (`User.js:33,45-50`). **LEAK.**
- L-6 Prod data in default `test` DB. **SEC/OPS.**
- L-7 Connect token authenticates all routes (`auth.js:19-24`). **SEC.**
- L-8 JWT verify not algorithm-pinned (`jwt.js:55,59`). **SEC.**
- L-9 No self-service data access/portability (only erasure) (`authController.js:220-245`). **PRIV.**
- L-10 TrackCatalog `source='library'` outside erasure (`erasure.js:19-24`; `TrackCatalog.js:16-20`; live 0 rows). **PRIV.** (Folds into WS-1.)
- L-11 Over-broad Spotify scopes (`user-read-email`/`-private` unused) (`spotify.js:12-13`; `integrationsController.js:106`). **PRIV.**
- L-12 Dead Spotify endpoints wired (audio-features/recommendations/bulk artists) (`spotify.js:202-219,295-324,397-462`). **BAN(low).**
- L-13 Session-playlist calls removed `POST /users/{id}/playlists` (`spotifySessionPlaylist.js:30-37`). **BAN(latent).**
- L-14 Spotify logo hand-recreated + icon-only (`SpotifyLogo.tsx:3-9`). **BAN(low).**
- L-15 Watch device bearer token rendered to DOM + clipboard (`WatchTokenCard.tsx:59,107`). **SEC.**
- L-16 Android debug.keystore committed (`mobile/.../debug.keystore`). **SEC.**
- L-17 No CI secret-scan backstop (`.github/workflows/ci.yml`). **SEC.**
- L-18 docker-compose Mongo/Redis unauth on published ports. **SEC(dev).**
- L-19 Apple Music scaffold inert — keep unexposed (no action; gate future MusicKit work). **OK.**

---

## 4. Per-Path Remediation — What Is Purged / What Replaces It

**C-1 (biometric egress):** *Purge* `_formatBiometric`'s numeric vitals line and its injection at `geminiEngine.js:286`; *purge* raw `Heart rate: ${heartRate}` in `_buildBiometricPrompt` (`:305-332`). *Replace* with Fork-A1: LLM prompt = abstract mood + emotion coordinates only; vitals decrypted in worker scope drive `target_bpm/energy/valence` deterministically *after* the LLM returns, via the existing `computeStateVector`/`moodDescriptors` band logic. Net: vitals never cross `api.groq.com`.

**H-2 (free-text):** *Purge* the raw `User note: "${textPrompt}"` at `geminiEngine.js:284`. *Replace* by parsing the note server-side into the structured mood/activity tokens the pipeline already consumes; send only derived tokens (optionally a PII scrub as belt-and-suspenders). Keep the encrypted `PlaylistSession.contextPrompt` for local history only.

**H-3 (Spotify→LLM) [WS-1]:** *Purge* `seed_artists`/top-genres from the prompt (`:276,294-296`) and delete `inferArtistGenres`'s artist-name batch to Groq (`:416-419`). *Replace* with the `captionService` feature-only standard app-wide: LLM sees audio features + first-party mood/HR context; genres derived deterministically (**Option-B mood-genre map**), never from Spotify Content.

**H-4 (Gemini fallback):** *Purge* the `getModel()`/`generateContent` fallback branch (`:88-90`). *Replace* with fail-closed behaviour: if no vetted-provider key, throw and let the deterministic `applyMoodFallback` path serve — never silently degrade to a training-eligible endpoint. Assert an allow-listed provider at boot.

**H-1 (Garmin webhook) [WS-2]:** *Purge* the fail-open guard and query-string secret (`:531`) and the unvalidated `gid` filter (`:539-548`). *Replace* with the in-repo Suunto/RevenueCat pattern: `const secret = process.env.GARMIN_WEBHOOK_SECRET; if (!secret) return 503;` header-borne secret compared via `timingSafeEqualStr`; `if (typeof gid !== 'string' || !gid) continue;`; per-metric physiological range clamps in `normalizeGarminSummaries`/`normalizeHealthStoreSamples` mirroring `watchHrIngest` (HR 30-230, etc.). Add a boot assertion (like `FRONTEND_URL`) that throws in prod if any wearable webhook secret is unset.

**C-3/H-5/H-6 (Garmin program) [WS-3]:** Keep all Garmin Health API calls behind a disabled flag until written approval (human gate). *Replace* the auto-backfill on callback with a flag-gated, post-approval trigger. On disconnect, *replace* the token-null-only handler with a call into the erasure cascade scoped to `provider='garmin'` (purge BiometricLog + reset MedicalProfile) + Garmin user-deregistration; implement the deregistration/permission webhook to the same cascade. Wrap every Garmin-sourced metric display in one `<GarminAttribution device>` component so no screen can render Garmin data without the mark.

**H-7/H-9/M-5 (store consent) [WS-5]:** *Add* a dedicated pre-permission Art.9 consent screen (purpose, data types, retention, sub-processors, withdrawal path) persisted as a versioned server-side consent record wired to erasure; *add* the exact-HIG Sign in with Apple button on iOS to the existing `/auth/apple`; file the Play Health Connect declaration.

**H-10/H-11/M-9 (YouTube) [WS-6]:** *Purge* the Groq title/channel tie-breaker in `musicClassifier.js` and the title/artist line in `llmEstimatorAdapter.js`; *replace* with the already-implemented deterministic `classifyByMetadata` (categoryId/topic/channel/lexicon) + the numeric genre-anchor estimator, pooling residue in `UnclassifiedTrack`. *Replace* per-generation `search.list` with cache/throttle + default-on internal vector corpus; keep YouTube as first-party taste import only. Add ≤30-day TTL/refresh on YouTube-derived shared rows.

**H-8 (declarations):** No code purge — becomes true once C-1/H-2/H-3 land. *Add* a standing check: any new external egress forces a declarations diff before store submission.

**M-2/L-11/L-12/L-13/L-14/H-13 (Spotify web) [WS-7]:** Keep write ops server-side (already have endpoints); *replace* browser token with a `streaming`-only token if/when Spotify supports downscoping. *Purge* `user-read-email`/`user-read-private` scopes and dead `/audio-features`/`/recommendations`/bulk-`/artists` wrappers. *Replace* `POST /users/{id}/playlists` with `POST /me/playlists` (or drop the app-managed playlist transport for an in-memory App Remote queue). *Add* a central `<SpotifyAttribution track>` (official full logo + "Listen on Spotify" deep link + cover art) required on every surface rendering Spotify metadata; *replace* the hand-drawn `SpotifyLogo` path with the official asset.

**H-12/M-6 (web security) [WS-7]:** Fork-B1 — *purge* the localStorage `koko-token` read/write; *replace* with the existing httpOnly cookie + `Partitioned`. Promote CSP to enforcing `Content-Security-Policy`; *purge* `unsafe-inline` (nonces/strict-dynamic) and the `https:`/`wss:`/`img https:` wildcards; pin to backend + Spotify/Google media hosts; add a real report sink.

**M-3/M-4/L-3/L-9 (lifecycle) [WS-4]:** *Add* TTL indexes / ring-buffer trims: BiometricLog (bounded window; baselines already aggregated onto MedicalProfile), PlaylistSession (drop/expire `contextPrompt`+`biometricSnapshot` after the recalibration window). *Add* `DELETE /integrations/wearable/{provider}` for every provider → erasure-scoped purge. *Add* `buffer:${userId}:*` to `userRedisPurge.patternsFor` (+ a test asserting all user-scoped prefixes are covered; ideally a shared key-builder registry). *Add* a read-only authenticated data-export endpoint reusing the erasure collection inventory.

**L-1/L-2/L-4/L-5 (crypto hygiene):** *Add* a single audited biometric accessor (logs userId+purpose+timestamp, no plaintext) per ADR-0005. *Add* userId AAD binding in `encryptedNumber`/`encryptedString` (match `baselines.js:82`). *Purge* the plaintext `restingHeartRate`/`hrZones` from MusicProfile (single source = MedicalProfile). *Replace* plaintext `garminUserId` lookup with an HMAC index; treat `pushTokens` as rotating credentials.

**L-6/L-7/L-8/M-7/M-8/L-15/L-16/L-17/L-18 (infra/authz) [WS-8]:** Pin explicit DB name in `MONGO_URI` + boot assertion. Scope the connect token to connect paths (`aud`/path claim in `signConnectToken`). Pin `{ algorithms: ['HS256'] }` on both `jwt.verify` calls. `USER node` in Dockerfile. Gitignore `*.tar.zst`/`*.ndjson`/`**/.worktree-*` + extend pre-commit size/path guard. Untrack `debug.keystore`. Add gitleaks CI job. Loopback-bind + credential docker-compose. Auto-clear the watch token from DOM/clipboard (or replace with a one-time pairing code exchanged server-side).

**WS-1 (Spotify HALT — folded, not rehashed):** corpus/Groq/AudioFeature/EMBEDDING/ServeEvent containment of `provider:'spotify'` rows (make them erasable or k-anon global-only; `corpusIngest.ingestLibrary` no longer seeds non-erasable spotify rows; `erasure.js:19-24` exclusion revisited for library-seeded rows per L-10); stop Spotify artist/genre → Groq (H-3); **Option-B deterministic mood-genre target + min-cosine retune**; one-time prod purge of existing `spotify:` rows and unpurged ServeEvent on disconnect.

---

## 5. Dependency-Ordered Execution DAG

**Top-of-DAG (backend, blocks store readiness + kills active leaks). Single owner for `geminiEngine.js` prompt inputs to avoid WS-0/WS-1 collision:**

- **WS-0 (Emergency egress)** — C-1, H-2, H-4, M-1. TDD: assert no numeric vital/free-text/artist string ever appears in the outbound prompt (snapshot the request body); assert boot fails without a vetted provider. *Blocks: WS-5.*
- **WS-1 (Spotify HALT)** — H-3, L-10, Option-B genres, spotify-row containment, one-time purge. *Coordinates with WS-0 on prompt inputs; otherwise parallel.*

**Parallel Squad Alpha (backend security, independent files):**
- **WS-2 (Garmin webhook hardening)** — H-1. TDD: unset secret → 503; bad secret → 401 const-time; `{"$gt":""}` → rejected; out-of-range values dropped.
- **WS-8 (infra/authz hardening)** — L-6/L-7/L-8, M-7/M-8, L-16/L-17/L-18. Mostly config; parallel-safe.

**Parallel Squad Bravo (health lifecycle + crypto, backend/db):**
- **WS-4** — M-3, M-4, L-3, L-9, L-1, L-2, L-4, L-5. TDD: TTL/trim enforced; per-provider disconnect purges; erasure covers `buffer:*`; export returns decrypted subject data.

**Parallel Squad Charlie (YouTube):**
- **WS-6** — H-10, H-11, M-9. TDD: no title/artist to Groq; generation issues zero `search.list` when corpus serves.

**Parallel Squad Delta (frontend, after WS-0 defines the contract):**
- **WS-7** — H-12/M-6/M-2, H-13, L-11/L-12/L-13/L-14, L-15. Needs `designer` SHIP for attribution components; `compliance-auditor` for Spotify branding.

**Gated tail (depend on upstream):**
- **WS-3 (Garmin program)** — C-3, H-5, H-6. Code (attribution, disconnect purge, deregistration webhook, flag) buildable in parallel, but **enablement gated on approval**.
- **WS-5 (Store readiness)** — H-7, H-9, M-5, H-8. Depends on WS-0 + WS-1 + WS-6 (declarations must be true) → then Apple button, consent screen, Play/Apple forms.
- **C-2 (Spotify commercial)** — pure human/business track (Fork C), parallel to everything.

**Merge discipline:** no squad merges its own work; UI screens need `designer` SHIP; every provider-facing change needs `compliance-auditor`; final `resilience-auditor` false-green sweep before the store gate.

---

## 6. Explicit Human Gates

1. **Fork decisions (A1 / B1 / C1)** — approve before any code lands.
2. **Groq DPA + Zero-Data-Retention** — execute agreement, enable ZDR in console, list Groq as health sub-processor (portal action). Required even under A1 for the taste-signal egress.
3. **Spotify** — business decision on C1 vs C2 (register business + Extended Quota application). Portal/legal.
4. **Garmin Health API production approval** — do not enable Garmin flag or backfill until written approval (Pause & Guide). Portal.
5. **Google Play Health Connect declaration** + **Apple App Privacy label / Data Safety form** reconciliation to the post-WS-0 reality. Portal.
6. **One-time prod data purges** (irreversible, human-run): (a) `spotify:` rows across TrackCatalog/TrackEmbedding/AudioFeature per WS-1 containment; (b) BiometricLog retention backfill/trim; (c) verify prod DB rename path if `test`→`kokonada` is adopted.
7. **Rotate secrets** exposed via query-string logs (Garmin webhook secret) after WS-2.
8. **Final compliance re-audit** (`compliance-auditor` HALT gate) + `resilience-auditor` false-green sweep **before any store submission or Spotify quota application**, then human merge.

---

Plan ready — approve before implementation.