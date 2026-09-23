# ADR-0016 — Launch platform: Android-first or dual

**Status:** ACCEPTED — **Option A, Android-first.** Ruled by Daniel 2026-09-02.
**Asked by:** `MASTER_BLUEPRINT_2026-07-07.md` § "OPEN DECISION — Launch platform", which says
*"Both options are presented for Daniel; do not decide by default … Once ruled, record the decision
as a new ADR."* It was never recorded. This is that ADR, re-costed against today's evidence rather
than July's.

## Why it needs re-costing before you rule

The Blueprint framed this around **PREREQ-iOS**, stated as: *"iOS builds require macOS + Xcode +
an Apple Developer account … The current dev environment is Windows/Android-only, so iOS is not
buildable today … no agent/session can satisfy it from code."*

**That is no longer true, and the part that changed is the expensive part.**

| Blueprint claim (2026-07-07) | Evidence today |
|---|---|
| "iOS is not buildable today" | **iOS builds green on CI.** `OPS-008`: run `32992549921`, `event=push`, sha `0e19ad8` on `main` — `setup-ruby → success`, `CocoaPods install → success`, **`Xcode build (simulator, unsigned) → success`**. Every step executed. |
| "needs a human with a Mac" | `DAN-006` records its own premise as **falsified**: the Podfile modular-headers fix (`ios/Podfile:35-36`) *"did not need a Mac — CI fixed and proved it."* |
| Apple Sign-In blocked | Backend `/api/auth/apple` verifier **already built** (Blueprint 2.1); only the native button remains. PR **#183** carries Apple sign-in hardening and is open. |

**What still genuinely requires a Mac or an Apple account** — a much shorter list:

1. **Code signing** — certificates and provisioning profiles. CI builds *unsigned*.
2. **App Store Connect submission** — a paid Apple Developer account ($99/yr) and portal actions.
3. **On-device iOS verification** — a physical iPhone. No simulator or CI run substitutes for the
   Definition of Done's on-device evidence, and this project's own rule is that a green check is
   not evidence.

So the residual blocker is **sign + submit + verify**, not **build**.

## Option A — Android-first launch

Every iOS-blocked item (2.1 native Apple button, 2.4's iOS pipeline half, 3.1 iOS submission and
on-device iOS verify) moves to a post-launch **"iOS Parity"** wave. Wave 3 targets **Google Play only**.

**Cost from today:**
- **Unblocks launch with no hardware purchase.** Android release signing already ships (#174,
  Kokonada keystore, CI-safe debug fallback).
- iOS work is **deferred, not lost** — and less is deferred than the Blueprint assumed, because the
  build already works. What waits is signing, submission and device QA.
- **Apple Sign-In can stay built.** It is App-Store-mandatory *for iOS*; on Android-only it is
  simply unused. PR #183's hardening does not need to be reverted or shelved.
- **The macOS CI job keeps costing something.** macOS runners bill at a premium, which is why #185
  gated it (`needs` + `if`, so a skipped run costs nothing). Under Option A that gate is the
  correct steady state — keep the job, keep it skipped.
- **Risk you accept:** the iOS build silently rots while nobody submits from it. #185's gating makes
  that *more* likely, not less, because a skipped job reports skipped rather than green. Mitigate by
  running it on a schedule or on `ios/**` changes.

## Option B — Dual-platform launch

PREREQ-iOS becomes a hard blocker on Wave 3: no submission until the Apple side exists.

**Cost from today:**
- **A purchase and an enrolment**, not a project: Apple Developer Program (~$99/yr), a Mac (or a
  hosted-Mac / MacStadium-style rental — CI already proves a rented macOS runner can build), and an
  iPhone for on-device QA.
- **Signing is the real work**, and it is Pause & Guide throughout — certificates, provisioning
  profiles, App Store Connect app record, TestFlight. No agent can do any of it.
- **Wave 3 cannot submit until all of that exists**, so the Android launch date is set by the iOS
  critical path. That is the whole cost of Option B: it converts an Android-ready product into one
  waiting on hardware and an enrolment.
- **What it buys:** one simultaneous launch, no second submission cycle, no "iOS Parity" wave to
  schedule and re-review, and no window where iOS users are told to wait.

## The asymmetry worth naming

The Blueprint treated this as *"can we build iOS at all"*. It isn't that any more. It is now:
**do you want the launch date set by Play, or by an Apple enrolment you have not started?**

Option A is reversible — Play first, iOS later, nothing thrown away. Option B is also reversible,
but it spends calendar time before anything ships, and the thing it is waiting on is procurement
rather than engineering.

## Decisions this unblocks once ruled

- **Wave 3.1's shape** — Play-only, or both.
- **`OPS-008`'s remaining half** — whether the `Gemfile.lock` commit and the iOS CI job matter now
  or later.
- **PR #183** (`recover/wave6-apple-signin-scopes`) — open and untouched since 2026-08-27. Under A it
  can merge and sit unused; under B it is on the critical path.
- Whether **PREREQ-iOS** should be struck from the Blueprint entirely and replaced with the narrower
  "sign + submit + verify" statement, since its build clause is now false.

---

## Decision

**Chosen option: A — Android-first launch.** Ruled by Daniel, **2026-09-02**.

**Reason, in his terms:** *no Apple enrolment exists and none has been started.* The blocker was
never the build — CI proves that green. It is **sign + submit + verify**, and every one of those
three sits behind a Developer Program enrolment, a signing chain and a physical device that do not
exist yet. A launch date should not be set by a queue you have not joined.

**iOS is a future thing, not a launch-blocking thing.** Nothing in the plan is to be shaped around
it. Concretely, from here:

- Wave 3.1 targets **Google Play only**. The iOS submission and on-device iOS verification move to a
  post-launch **"iOS Parity"** wave with no date attached.
- The macOS CI job stays, stays gated (#185), and stays skipped. Keep it building so it does not rot,
  but nothing waits on it.
- PR **#183** (Apple sign-in hardening) may merge and sit unused. It is not on any critical path.
- **PREREQ-iOS as written in `MASTER_BLUEPRINT_2026-07-07.md` is now factually wrong** and should be
  struck. Its build clause — *"iOS is not buildable today"* — is false (`OPS-008`, run
  `32992549921`). Replace it with the narrow, true statement: **signing, submission and on-device
  iOS verification require an Apple enrolment and hardware that do not exist.**

---

## THE SCHEDULE, RECORDED HONESTLY

**Launch is around 2027. It is not near-term, and there is no deadline.**

This is written into the ADR because the opposite belief is load-bearing elsewhere and wrong.
`MASTER_BLUEPRINT_2026-07-07.md` reads as though store submission (Wave 3) is the next thing after
the current wave. It is not. Daniel's own assessment, 2026-09-02: **the app is not stable and there
is a lot still to improve.**

**What follows from that, and it is the operative part:**

- **Nothing may be rushed on the grounds of a deadline, because there is no deadline.** Any argument
  of the form "we need to ship, so accept this" is invalid here by construction. If a thing is not
  right, it does not go in — there is no calendar cost to fixing it properly.
- A REVISE verdict, a HALT, or a defect found late is **not** schedule pressure. It is the process
  working, and the schedule can absorb it.
- Estimates in older docs that imply an imminent submission are **stale, not targets**. Where one is
  found, correct it rather than working toward it.
- This also removes the usual reason to take shortcuts on evidence. On-device capture, mutation
  proofs and re-audits cost time the project has.

**Read any date in an older planning document as descriptive of when it was written, never as a
commitment.**
