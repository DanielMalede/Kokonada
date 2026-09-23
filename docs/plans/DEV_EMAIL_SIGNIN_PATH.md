# DEV ITEM — Email sign-in: wire the mobile client to the auth path the server already ships

**Raised:** 2026-08-26, from the screen-03 (Sign in) design review.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor`.
**Status:** not started. Not a canvas item — this is code.

---

## Why this exists

`docs/SCREENS.md` §3 specifies an email flow. The Sign in screen draws a **"Continue with email"** button. Daniel's decision (2026-08-26) is that **both stay** and the code catches up.

Today the mobile client cannot perform that action.

---

## What already exists — the server side is built and tested

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

## What is missing — all of it client-side

`mobile/KokonadaHealth/src/auth/auth.ts` exports exactly `signInWithGoogle`, `signInWithApple`, `isLoggedIn`, `signOut`. **There is no email path.** `SignInScreen.tsx` therefore has no email affordance at all, and the button on the canvas has nothing to call.

## Scope

1. **`auth.ts`** — add `signUpWithEmail(email, password)` and `signInWithEmail(email, password)` returning the same `KokonadaUser` shape as the OAuth paths, and installing into the same `AuthSession` token plane (single-flight refresh). No new session mechanism.
2. **Preserve the sacred contract.** `SignInScreen.tsx:29` — a successful sign-in ALWAYS runs `<provider>() → currentUserStore.setUser() → onSignedIn()` (QA4 Suspect #1). The email path funnels through the **same** `runSignIn` handler; it does not get its own ignition.
3. **A validated form** — email + password, with the client mirroring the server's rules so the user is not round-tripped for a malformed address. Client validation is a courtesy; the server stays authoritative.
4. **Error surfacing** — map `invalid-email` / `invalid-password` / `email-taken` / network failure onto the existing inline alert (`accessibilityRole="alert"`, `state.danger`). Do not invent new error chrome; screen 03's error state is already designed.
5. **States** — idle · submitting · error, matching the OAuth buttons' `opacity: busy ? 0.6 : 1` treatment.
6. **Tests first.** Extend `src/auth/__tests__/loginFlow.test.ts` and `SignInScreen.test.tsx`. Cover: happy path both verbs, each `reason`, the timing-safe unknown-email login, and that `onSignedIn` fires exactly once per success.

## Risk flag — read before shipping the screen

**Shipping the Sign in screen ahead of this code puts a dead control in front of users.** The button is drawn on the canvas and specified in `SCREENS.md`, but until `auth.ts` gains the path, tapping it can do nothing. Either this item lands first, or the screen ships with the button withheld. It must not ship visible-and-inert.

## Compliance notes for the gate

- **Apple Guideline 4.8** requires Sign in with Apple wherever a *third-party* login is offered. A first-party email/password path does not by itself trigger 4.8 — but Google sign-in already does, and Apple is already implemented behind `Platform.OS === 'ios'`. No change.
- **Guideline 5.1.1(v)** — an app offering account creation must offer account deletion. `GET /api/auth/account/export` exists; account deletion is the Vault screen's "Delete my account". Confirm that path is real before this ships, since email signup makes account creation a first-party act.
- Password handling, rate limiting and lockout are already the server's; the client must never log, cache or persist the password.

## Related

- Screen 03 review: `docs/review/03-signin.html`
- `docs/SCREENS.md` §3 — keep the email flow in the spec; it is now backed by a dated dev item rather than being aspirational.
