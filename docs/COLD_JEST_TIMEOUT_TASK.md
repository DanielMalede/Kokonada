# TASK — Mobile jest times out on a cold cache

**Status:** open, unfixed, **not caused by and not in scope for** the dependency-cleanup / design-system-lint change that found it.
**Surface:** `mobile/KokonadaHealth`
**Found:** 2026-08-26, on Windows 11, Node 24.19.0, jest 29 + `@react-native/jest-preset`.

---

## The symptom

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

## It does not fail as timeouts. It fails as lies.

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

## The 9 tests

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

## Why this matters

**CI runs cold every single time.** `npm ci` on a fresh runner means no jest transform cache
ever exists, so the `mobile` job is running in exactly the configuration that fails locally. It
has been going green on GitHub's Linux runners, which are evidently fast enough to stay under
5000 ms — but the margin is unmeasured, and the failure mode is a red build on tests that are
correct. That is the worst kind of red: it teaches people to re-run rather than to read.

The eight `ConnectServicesWearable` tests are also not incidental coverage. They are the consent
gate — "does NOT open the OS sheet until consent is granted", "fails CLOSED". A flake that
routinely reds those is a flake that gets muted.

## What is NOT the cause

- **Not the dependency cleanup.** The same class was observed on the pre-change tree, and that
  change removed 335 packages and a babel plugin, which can only reduce transform work.
- **Not a behavioural regression.** No assertion failed in any cold run. Only the clock.
- **Not the new lint tooling.** Those suites are pure-node and finish in milliseconds.

## Where to start

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

## Reproduce

```bash
cd mobile/KokonadaHealth
./node_modules/.bin/jest --clearCache
./node_modules/.bin/jest --ci                      # expect timeouts
./node_modules/.bin/jest --ci                      # warm: expect green
./node_modules/.bin/jest --clearCache
./node_modules/.bin/jest --ci --testTimeout=20000  # cold + headroom: expect green
```
