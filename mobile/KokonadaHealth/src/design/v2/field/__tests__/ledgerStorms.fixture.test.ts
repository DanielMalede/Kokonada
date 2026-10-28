jest.mock('../../tokens/tokens.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule());
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());

import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId } from '../../tokens/tokens.generated.ts';
import { FIXTURE_OUTER, actualTokens } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { ADMISSION, type Admission } from '../placementLedger.ts';
import { MODES, STORMS, STORM_GRIDS, gridReport, storm, stormDeps, stormFailures, type Mode, type Storm } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// QA-068 E3's binding neutral3 case, on the test-only fixture-outer direction (__fixtures__/fixtureTokens.ts):
// neutral placements carry no lobe there (neutralLobe 0), so with three neutral placements the rest lobes
// stay lit beside them, and the ledger's lobe rule must agree with the builder's. No shipped direction
// has that property after the close-out. The default run's coarse grid, the same clauses (the shared
// harness, ledgerStorms.ts) and the two planted controls that bind here; the full grid stays one sweep
// file per shipped direction.

const LONG = 600_000;
const deps = (id: DirectionId) => stormDeps(id, staticsFor(id, EXTENSIONS as never));
const has = (failures: readonly string[], clause: string) => failures.some((f) => f.includes(clause));

it('the fixture mock: fixture-outer exists, BASE and DIRECTIONS.abyss are the shipped objects, and its neutral placements carry no lobe', () => {
  expect(BASE).toBe(actualTokens().BASE);
  expect(DIRECTIONS.abyss).toBe(actualTokens().DIRECTIONS.abyss);
  expect([deps(FIXTURE_OUTER).config.neutralLobe, deps('abyss' as DirectionId).config.neutralLobe]).toEqual([false, true]);
});

describe('E3 on fixture-outer, the coarse grid: every mode × storm, taps every 17, 143 and 250 ms for 3 s', () => {
  it.each(MODES.flatMap((mode) => STORMS.map((kind) => [mode, kind] as [Mode, Storm])))(
    'fixture-outer, %s, %s',
    (mode, kind) => {
      const { runs, failures } = gridReport(FIXTURE_OUTER, mode, kind, STORM_GRIDS.coarse, deps(FIXTURE_OUTER));
      expect(runs).toBe(3);
      expect(failures).toEqual([]);
    },
    LONG,
  );

  it('neutral3 binds here: some frame holds the rest lobes beside three live neutral placements', () => {
    expect(MODES.some((mode) => storm(FIXTURE_OUTER, mode, 'neutral3', 100, 3000, deps(FIXTURE_OUTER)).restBesideThreeLive)).toBe(true);
  });
});

describe('E3’s planted controls that bind on neutral placements with no lobe, through the harness’s own clauses', () => {
  it('a ledger that admits three swaps makes fixture-outer’s neutral3 overflow: the builder throws, and the demand passes NODE_SLOTS', () => {
    // The three new taps land in one frame, so one start admits all three swaps: 3 entering, 3 leaving
    // and every rest lobe, at least 7. Taps 100 ms apart start one swap at the first tap and two after
    // the spacing, 5 + the rest lobes, which overflowed only while the table had two (law round 2, item 6).
    const three: Admission = { ...ADMISSION, entering: 3, leaving: 3, nodes: 99 };
    const failures = stormFailures('three swaps', 'neutral3', 'settle', storm(FIXTURE_OUTER, 'settle', 'neutral3', 0, 3000, deps(FIXTURE_OUTER), three));
    expect([has(failures, 'the builder threw'), has(failures, 'demand above NODE_SLOTS')]).toEqual([true, true]);
  });

  it('a ledger whose lobe rule disagrees with the builder’s (fixture-outer read as if neutrals bore a lobe): the frame holds more than the demand', () => {
    const wrong = { ...deps(FIXTURE_OUTER), config: { ...deps(FIXTURE_OUTER).config, neutralLobe: true } };
    const failures = stormFailures('wrong lobe rule', 'neutral3', 'settle', storm(FIXTURE_OUTER, 'settle', 'neutral3', 100, 3000, wrong));
    expect(has(failures, 'the demand and the built frame disagree')).toBe(true);
  });
});
