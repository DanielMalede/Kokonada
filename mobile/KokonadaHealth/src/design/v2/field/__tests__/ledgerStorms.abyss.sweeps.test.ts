import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import type { DirectionId, Face } from '../../tokens/tokens.generated.ts';
import { ADMISSION, type Admission } from '../placementLedger.ts';
import { MIXED_EVERY, MIXED_GRIDS, MODES, STORMS, STORM_GRIDS, backlogBreaks, gridReport, mixedReport, storm, stormDeps, stormFailures, type Mode, type Storm } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// QA-068, the event path: E3 on the full grid for one direction, in the sweeps project
// (jest.sweeps.config.js), which CI runs in its own gated job. The storms, their clauses and the
// grids are the shared harness's (field/ledgerStorms.ts); the default run takes the coarse grid and
// every planted control (ledgerStorms.test.ts).

const ID: DirectionId = 'abyss';
const LONG = 15 * 60_000;
// Both faces: Abyss's rest table is per face (UI-112), one lobe on dark and two on light.
const FACES: Face[] = ['dark', 'light'];
const deps = (face: Face) => stormDeps(ID, staticsFor(ID, EXTENSIONS as never), face);

describe.each(FACES.flatMap((face) => MODES.flatMap((mode) => STORMS.map((kind) => [face, mode, kind] as [Face, Mode, Storm]))))(`E3 on the full grid: ${ID}, %s face, %s, %s`, (face, mode, kind) => {
  it(
    'taps every 17, 50, 100, 143, 167 and 250 ms, for 3 s and for 10 s: every clause, and the 10 s storm no more than 600 ms after the 3 s one',
    () => {
      const { runs, failures } = gridReport(ID, mode, kind, STORM_GRIDS.full, deps(face));
      expect(runs).toBe(12);
      expect(failures).toEqual([]);
    },
    LONG,
  );
});

// T10's mixed, lagged storm (ledgerStorms.ts) on the full seeds: 200 per face × start mode × input cadence
// (resilience round 1 F3: 200 seeds per direction × mode). The coarse seeds, the pins, the coverage and the
// planted controls run in the default run (ledgerStorms.mixed.test.ts, and fixture-outer's in
// ledgerStorms.fixture.test.ts).
describe.each(FACES.flatMap((face) => MODES.flatMap((mode) => MIXED_EVERY.map((every) => [face, mode, every] as [Face, Mode, number]))))(`the mixed storm on the full seeds: ${ID}, %s face, starting %s, the input seen every %s ms`, (face, mode, every) => {
  it(
    'every clause on each of the 200 seeds',
    () => {
      const { runs, failures } = mixedReport(ID, mode, every, MIXED_GRIDS.full.seeds, deps(face));
      expect(runs).toBe(200);
      expect(failures).toEqual([]);
    },
    LONG,
  );
});

// The controls whose clauses run here (resilience, rulings after T5d, §1 and §2), each asserting the
// harness's own clause output. Measured (runs/v1b-b4-T5b-E3-convergence-table.txt §1): at 250 ms a raw
// ledger converges 1450 ms after the 3 s storm's last tap and 2850 ms after the 10 s one's.
describe('E3’s planted controls in the sweeps project', () => {
  const raw: Admission = { ...ADMISSION, netting: false };
  const deps2 = (id: DirectionId) => stormDeps(id, staticsFor(id, EXTENSIONS as never), 'dark');
  const has = (failures: readonly string[], clause: string) => failures.some((f) => f.includes(clause));

  it('the one-sided backlog clause bites (the harness predicate): a raw ledger at 250 ms converges after both storms, the 10 s one more than 600 ms later', () => {
    const spans = STORM_GRIDS.full.span;
    const outcomes = spans.map((span) => storm('abyss', 'settle', 'toggle', 250, span, deps2('abyss'), { limits: raw, tail: 30_000 }));
    expect(outcomes.map((o) => o.converged === null)).toEqual([false, false]);
    expect(backlogBreaks('raw', spans, outcomes)).toHaveLength(1);
  }, LONG);

  it('and gridReport reports it, on the full spans', () => {
    const { failures } = gridReport('abyss', 'settle', 'toggle', { every: [250], span: STORM_GRIDS.full.span }, deps2('abyss'), raw, 30_000);
    expect(has(failures, 'ms storm converged')).toBe(true);
  }, LONG);

  it('a raw first-in-first-out ledger breaks the netting identity at every cadence of the full set', () => {
    const { failures } = gridReport('abyss', 'settle', 'toggle', { every: STORM_GRIDS.full.every, span: [3000] }, deps2('abyss'), raw);
    expect(STORM_GRIDS.full.every.map((every) => has(failures.filter((f) => f.includes(`every ${every} ms`)), 'the netting identity broke'))).toEqual(STORM_GRIDS.full.every.map(() => true));
  }, LONG);

  it('a raw ledger at 17 and 50 ms never converges inside the window: the absolute bound fires', () => {
    for (const every of [17, 50]) expect(has(stormFailures(`raw ${every}`, 'toggle', 'settle', storm('abyss', 'settle', 'toggle', every, 3000, deps2('abyss'), { limits: raw })), 'did not converge')).toBe(true);
  }, LONG);

  it.each(MODES)('%s: reemit’s fades are bit-identical to one tap sent once, at every cadence of the full set', (mode) => {
    for (const every of STORM_GRIDS.full.every) {
      const re = storm('abyss', mode, 'reemit', every, 3000, deps2('abyss'), { keepSeries: true });
      const once = storm('abyss', mode, 'reemit', 1e9, 3000, deps2('abyss'), { keepSeries: true });
      expect(re.series).toEqual(once.series);
    }
  }, LONG);
});
