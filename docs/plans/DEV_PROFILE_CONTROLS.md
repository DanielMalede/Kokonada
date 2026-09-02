# DEV ITEM — The two Profile controls the canvas draws and the app does not have

**Raised:** 2026-08-26, from the screen-12 (Profile) design review.
**Routing:** item 1 → `developer` under TDD. Item 2 → `architect` first (it is a recommender decision, not a UI one), then `developer`.
**Status:** not started.

Grounded by an 11-agent verification pass over the Profile source surface; every claim below carries a file:line and was independently re-checked by an adversarial verifier.

---

## Context that changes how both should be built

**The shipped Profile screen is *ahead* of the canvas, not behind it.** It already renders both legal actions:

- `ProfileScreen.tsx:354-358` — "Delete account", rendered **unconditionally**, `accessibilityLabel="delete-account"`, behind a two-step confirm at `:361-383` ("Permanently delete your account?" → `delete-cancel` / `delete-confirm`) calling `profileController.deleteAccount()` at `:210`.
- `VaultConsentPanel` (mounted `ProfileScreen.tsx:327-333`) — "Withdraw health-data consent", `accessibilityLabel="withdraw-consent"` at `VaultConsentPanel.tsx:81-90`, with its own two-step confirm ("Keep it" / "Withdraw") at `:92-127`, shown **only when `consentGranted` is true** (`VaultConsentPanel.tsx:79`).

So the canvas should follow the app here, including that conditional. Deletion is genuinely irreversible: `DELETE /api/auth/account` runs a 14-collection + Redis cascade (`services/privacy/erasure.js:36-68`) then `User.deleteOne` — a hard delete, not a soft one.

**The app currently has exactly one toggle**, the live-mode switch at `GenerateScreen.tsx:288`, and no sliders anywhere. Both items below add app-firsts.

---

## Item 1 · The Living background toggle — build it, the pattern already exists

Requested by Daniel; not built. No `livingBackground` / `fieldEnabled` / `auraEnabled` / `backgroundEnabled` anywhere.

**Persistence is a solved problem — do not invent one.** The sanctioned path is `SecureStore` (`storage/secureStore.ts:19` — *"the only sanctioned persistence path on the device"*) over the `KVBackend` port (`platform/kvBackend.ts:5`), backed in production by encrypted MMKV plus a cipher (`storage/secureStoreFactory.ts:8`).

There is a **three-instance precedent** for persisted toggles under the `koko.` namespace, each a zustand vanilla store with `hydrate()` bound in `prodBootstrap.ts`:

| Store | Key |
|---|---|
| `experience/generate/liveModeStore.ts:10` | `koko.liveMode` |
| `onboarding/onboardingStore.ts:16` | `koko.onboarding.seen` |
| `experience/connect/connectStore.ts:19-21` | `koko.connect.<uid>.resolved` / `.moodOnly` |

Copy that shape: `koko.field.living`, defaulting **on**, hydrated at bootstrap.

**What the toggle must actually control.** The ambient field is not one component — it is `LivingAurora`, `AuroraGradientFill`, `BioAura` and the per-screen `.fld` layers. Off must mean *off everywhere*, not dimmed on some screens. It must also compose with `prefers-reduced-motion`: reduced motion already stills the field, and the toggle removes it. Reduced-motion-on plus toggle-on must not resurrect movement.

**Do not couple it to the regulator.** The field's copy promises *"It never speeds up when you are stressed — it slows down."* A user switching the field off must not change what the regulator does to the music; it changes what is drawn, nothing else.

---

## Item 2 · The adventurousness slider — decide what it does to the bandit before building it

Daniel chose to keep this control (screen 12, `slider=keep`). It has no client or backend parameter today, **but that is not because the concept is missing — it is because the concept is deliberately learned rather than set.**

`backend/app/agents/runtime/knowledge/noveltyController.js` is a Thompson-sampling bandit over `{stateDomain, targetBand, hourBin}` context buckets. Its own header states the design position:

> "The question is a genuine explore/exploit trade-off and it is CONTEXTUAL: the same person who welcomes an unknown track on a Sunday morning skips it three times in a row mid-interval."

and, on why it will not sample an untrained prior:

> "That is not exploration, it is noise wearing exploration's clothes… a learner with nothing to say should say nothing."

`planNovelty` returns a **null** budget until a bucket has at least one observation, and the pipeline reads null as "impose no quota". Its ceiling is `MAX_NOVELTY_SHARE = 0.3` — which is exactly where the canvas copy *"about a third of each set will be new to you"* comes from. **The copy is already true; the control is the open question.**

**A user dial must pick one of three relationships, and they are different products:**

1. **Clamp** — the dial sets a ceiling the bandit may not exceed. Preserves contextual learning; the user can only ask for *less* novelty than the engine would choose.
2. **Bias the prior** — the dial shifts the Beta prior per bucket. Keeps the bandit in charge and lets it learn away from the user's setting over time.
3. **Replace** — the dial is the budget; the bandit is bypassed. Simplest to build, and it discards the contextual behaviour the file exists to provide.

**DECIDED (Daniel, 2026-08-26): clamp.** The dial sets a ceiling the bandit may not exceed; it can only ask for *less* novelty than the engine would choose. Rationale, in his words: it is the only option where a user who never touches the control gets exactly today's behaviour, and *"I don't want the slider silently changing what the algorithm does for people who ignore it."*

Two consequences that follow and must be built in:
- **An untouched dial is a no-op.** It must sit at the ceiling by default, so `planNovelty`'s output is passed through unmodified. Not "defaults to 0.3" — defaults to *no clamp at all*, because the bandit legitimately returns null (no quota) until a bucket has an observation, and a clamp of 0.3 on a null budget would impose a quota where the engine deliberately imposed none.
- **The clamp never raises.** If the bandit's budget is below the dial, the bandit wins. The control is a ceiling, never a floor.

Whichever is chosen, note `NOVELTY_FLAG = 'WAVE4_NOVELTY_BANDIT'` — the bandit is flag-gated, so the dial's behaviour with the flag **off** must also be defined.

## Risk flag

Both controls are currently drawn on the canvas and inert in the app. Shipping Profile before they land puts a switch that cannot switch and a slider that cannot slide in front of users — and a slider is the worse of the two, because dragging it produces visible movement and no effect, which reads as a broken app rather than a missing feature.

## Related

- Screen 12 review: `docs/review/12-profile.html`
- `docs/plans/DEV_EMAIL_SIGNIN_PATH.md`, `docs/plans/DEV_PLAYBACK_SEEK_AND_POSITION.md` — same pattern, same shipping rule.
