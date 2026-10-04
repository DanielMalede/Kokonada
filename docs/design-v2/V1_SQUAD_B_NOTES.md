# V1 Squad B: branch notes (`design/v1-vision-frame`)

Work this branch owes that cannot land yet. Each item says when it lands. Delete an item in the commit that does it, and delete the file when it is empty.

## 1. B4: the worklet guard covers the helpers too

Source: the resilience-auditor's round-2 verification, "Low, recorded only" (`Kokonada-private/design-v2/v1/v1b-r2-resilience-verify.md`).

- `src/design/v2/__tests__/workletSafe.test.ts` checks the `Math` and `Number` bindings of the four future worklet modules. It does not check that a helper a worklet calls is itself marked `'worklet'`.
- When B4 marks the worklets, the guard must also cover the helpers B4 marks `'worklet'`:
  - `atWrap` and `assertN` (`motion/breathPhaser.ts`), and `assertClock`, which `advanceBreath` also calls;
  - `clampStress` (`motion/breathLaw.ts`);
  - `multiply` (`color/oklab.ts`).
