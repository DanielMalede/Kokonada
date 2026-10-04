# V1 Squad B: branch notes (`design/v1-vision-frame`)

Work this branch owes that cannot land yet. Each item says when it lands. Delete an item in the commit that does it, and delete the file when it is empty.

## 1. The sweeps project: the first commit after main (with #A) is merged into this branch

Source: the resilience-auditor's round-2 verification, §2 and §3 (`Kokonada-private/design-v2/v1/v1b-r2-resilience-verify.md`), as the orchestrator scoped it in round 3.

- **What:** a `sweeps` jest project, run as its own serial CI step after the unit project (for example `jest --selectProjects sweeps --runInBand`).
- **Inside it, a full-resolution 8-bit pass:**
  - backgrounds from `ditherReachable(colour, A)`, A being the field's dither plus the larger grain, not the nearest pixels only;
  - byte k at 0.01;
  - field t and k at 0.1 or finer;
  - pixel shimmer at 1°.
- **The default run keeps the coarse grids**, as they are pinned today:
  - field: `grid` in `fieldSweepFor` (t and k at 0.2 on 8-bit pixels), pinned in `neverRed.field.test.ts`;
  - edges: `EDGE_SWEEP_GRID` in `neverRedSweeps.ts` (byte k 0.1, `byteDitherAmplitude` 0, the nearest pixels only), pinned in `neverRed.edges.test.ts`;
  - pixel shimmer at −s, 0 and +s, fixed in `sweepNeverRed` (`color/blendSpace.ts`) and pinned through `blendSpace.test.ts`'s sample counts. A 1° pixel shimmer needs a new grid field there.
- **Why it must run:** inside the design band, the exact float pass plus at most about 0.004 of rounding bounds the check band. The blind spot is a colour just outside 345–55° with C ≳ 0.016 that rounding turns into 350–50°, and only the 8-bit grid can see it. The coarse grids are acceptable in the default run only if the full pass runs in CI.
- **Why not now:** the jest `projects` config arrives with #A (A3). Adding it here first would collide with A3's `jest.config.js`.
- **Also from §3:** the three UI suites with 5 s timeouts already flaked in the loaded `e4743af` baseline. They need their own TASKS row (deterministic timers). Do not raise their timeouts, and do not count the sweeps project as fixing them.

## 2. B4: the worklet guard covers the helpers too

Source: the same verification, "Low, recorded only".

- `src/design/v2/__tests__/workletSafe.test.ts` checks the `Math` and `Number` bindings of the four future worklet modules. It does not check that a helper a worklet calls is itself marked `'worklet'`.
- When B4 marks the worklets, the guard must also cover the helpers B4 marks `'worklet'`:
  - `atWrap` and `assertN` (`motion/breathPhaser.ts`), and `assertClock`, which `advanceBreath` also calls;
  - `clampStress` (`motion/breathLaw.ts`);
  - `multiply` (`color/oklab.ts`).
