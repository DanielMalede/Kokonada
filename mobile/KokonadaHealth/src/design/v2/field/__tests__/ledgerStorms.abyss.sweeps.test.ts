import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import type { DirectionId } from '../../tokens/tokens.generated.ts';
import { MODES, STORMS, STORM_GRIDS, gridReport, stormDeps, type Mode, type Storm } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// QA-068, the event path: E3 on the full grid for one direction, in the sweeps project
// (jest.sweeps.config.js), which CI runs in its own gated job. The storms, their clauses and the
// grids are the shared harness's (field/ledgerStorms.ts); the default run takes the coarse grid and
// every planted control (ledgerStorms.test.ts).

const ID: DirectionId = 'abyss';
const LONG = 15 * 60_000;
const deps = stormDeps(ID, staticsFor(ID, EXTENSIONS as never));

describe.each(MODES.flatMap((mode) => STORMS.map((kind) => [mode, kind] as [Mode, Storm])))(`E3 on the full grid: ${ID}, %s, %s`, (mode, kind) => {
  it(
    'taps every 17, 50, 100, 143, 167 and 250 ms, for 3 s and for 10 s: every clause, and the 10 s storm no more than 600 ms after the 3 s one',
    () => {
      const { runs, failures } = gridReport(ID, mode, kind, STORM_GRIDS.full, deps);
      expect(runs).toBe(12);
      expect(failures).toEqual([]);
    },
    LONG,
  );
});
