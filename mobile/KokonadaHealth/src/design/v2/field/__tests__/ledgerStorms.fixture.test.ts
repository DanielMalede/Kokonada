jest.mock('../../tokens/tokens.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule());
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());

import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { FIXTURE_OUTER, actualTokens } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { NODE_SLOTS } from '../fieldLaw.ts';
import { ADMISSION, type Admission } from '../placementLedger.ts';
import { MIXED_EVERY, MIXED_GRIDS, MODES, STORMS, STORM_GRIDS, gridReport, mixedFailures, mixedReport, mixedStorm, storm, stormDeps, stormFailures, type Mode, type Storm } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// QA-068 E3's binding neutral3 case, on the test-only fixture-outer direction (__fixtures__/fixtureTokens.ts):
// neutral placements carry no lobe there (neutralLobe 0), so with three neutral placements the rest lobes
// stay lit beside them, and the ledger's lobe rule must agree with the builder's. No shipped direction
// has that property after the close-out. The default run's coarse grid, the same clauses (the shared
// harness, ledgerStorms.ts) and the two planted controls that bind here; the full grid stays one sweep
// file per shipped direction.

const LONG = 600_000;
// fixture-outer carries Abyss's rest table, per face (UI-112): one lobe on dark, two on light.
const FACES: Face[] = ['dark', 'light'];
const deps = (id: DirectionId, face: Face = 'dark') => stormDeps(id, staticsFor(id, EXTENSIONS as never), face);
const has = (failures: readonly string[], clause: string) => failures.some((f) => f.includes(clause));

it('the fixture mock: fixture-outer exists, BASE and DIRECTIONS.abyss are the shipped objects, and its neutral placements carry no lobe', () => {
  expect(BASE).toBe(actualTokens().BASE);
  expect(DIRECTIONS.abyss).toBe(actualTokens().DIRECTIONS.abyss);
  expect([deps(FIXTURE_OUTER).config.neutralLobe, deps('abyss' as DirectionId).config.neutralLobe]).toEqual([false, true]);
});

const cases = FACES.flatMap((face) => MODES.flatMap((mode) => STORMS.map((kind) => [face, mode, kind] as [Face, Mode, Storm])));
// Each coarse case runs once: its own test and the coverage pins read the same report.
const reports = new Map<string, ReturnType<typeof gridReport>>();
const coarse = (face: Face, mode: Mode, kind: Storm) => {
  const key = `${face} ${mode} ${kind}`;
  if (!reports.has(key)) reports.set(key, gridReport(FIXTURE_OUTER, mode, kind, STORM_GRIDS.coarse, deps(FIXTURE_OUTER, face)));
  return reports.get(key)!;
};
const coarseOutcomes = (keep: (c: [Face, Mode, Storm]) => boolean) => cases.filter(keep).flatMap(([face, mode, kind]) => coarse(face, mode, kind).outcomes);

describe('E3 on fixture-outer, the coarse grid: every mode × storm, taps every 17, 143 and 250 ms for 3 s', () => {
  it.each(cases)(
    'fixture-outer, %s face, %s, %s',
    (face, mode, kind) => {
      const { runs, failures, outcomes } = coarse(face, mode, kind);
      expect([runs, outcomes.length]).toEqual([3, 3]);
      expect(failures).toEqual([]);
    },
    LONG,
  );

  // E3's coverage pins (resilience, law round 2 (d)) that bind only here, Abyss reaching neither: the default
  // run's coarse grid reaches demand at NODE_SLOTS, and a settle storm lights a rest lobe beside three
  // live placements (F8's three-crossfade allowance). The shipped grid's pins are in ledgerStorms.test.ts.
  it('some coarse storm reaches demand NODE_SLOTS (6)', () => {
    expect([NODE_SLOTS, Math.max(...coarseOutcomes(() => true).map((o) => o.maxDemand))]).toEqual([6, 6]);
  }, LONG);

  it('some settle storm of the coarse grid lights a rest lobe beside three live placements', () => {
    expect(coarseOutcomes(([, mode]) => mode === 'settle').some((o) => o.restBesideThreeLive)).toBe(true);
  }, LONG);

  it.each(FACES)('%s face: neutral3 binds here: some frame holds the rest lobes beside three live neutral placements', (face) => {
    expect(MODES.some((mode) => storm(FIXTURE_OUTER, mode, 'neutral3', 100, 3000, deps(FIXTURE_OUTER, face)).restBesideThreeLive)).toBe(true);
  });
});

describe('E3’s planted controls that bind on neutral placements with no lobe, through the harness’s own clauses', () => {
  it.each(FACES)('%s face: a ledger that admits three swaps makes fixture-outer’s neutral3 overflow: the builder throws, and the demand passes NODE_SLOTS', (face) => {
    // The three new taps land in one frame, so one start admits all three swaps: 3 entering, 3 leaving
    // and every rest lobe, at least 7. Taps 100 ms apart start one swap at the first tap and two after
    // the spacing, 5 + the rest lobes, which overflow only where the face's table has two (law round 2,
    // item 6; UI-112: the light face), so the plant lands its taps in one frame on both faces.
    const three: Admission = { ...ADMISSION, entering: 3, leaving: 3, nodes: 99 };
    const failures = stormFailures('three swaps', 'neutral3', 'settle', storm(FIXTURE_OUTER, 'settle', 'neutral3', 0, 3000, deps(FIXTURE_OUTER, face), { limits: three }));
    expect([has(failures, 'the builder threw'), has(failures, 'demand above NODE_SLOTS')]).toEqual([true, true]);
  });

  it('a ledger whose lobe rule disagrees with the builder’s (fixture-outer read as if neutrals bore a lobe): the frame holds more than the demand', () => {
    const wrong = { ...deps(FIXTURE_OUTER), config: { ...deps(FIXTURE_OUTER).config, neutralLobe: true } };
    const failures = stormFailures('wrong lobe rule', 'neutral3', 'settle', storm(FIXTURE_OUTER, 'settle', 'neutral3', 100, 3000, wrong));
    expect(has(failures, 'the demand and the built frame disagree')).toBe(true);
  });
});

// T10's mixed, lagged storm (ledgerStorms.ts; its pins, coverage and controls are in ledgerStorms.mixed.test.ts)
// on fixture-outer, the coarse seeds: here neutral placements carry no lobe, so the rest lobes stay lit beside
// them, the case that needs F8's third crossfade and fills every node slot. Shipped Abyss reaches neither.
describe('the mixed storm on fixture-outer, the coarse seeds: every face × start mode × input cadence', () => {
  const mixedCases = FACES.flatMap((face) => MODES.flatMap((mode) => MIXED_EVERY.map((every) => [face, mode, every] as [Face, Mode, number])));
  const mixed = new Map<string, ReturnType<typeof mixedReport>>();
  const mixedCoarse = (face: Face, mode: Mode, every: number) => {
    const key = `${face} ${mode} ${every}`;
    if (!mixed.has(key)) mixed.set(key, mixedReport(FIXTURE_OUTER, mode, every, MIXED_GRIDS.coarse.seeds, deps(FIXTURE_OUTER, face)));
    return mixed.get(key)!;
  };

  it.each(mixedCases)(
    'fixture-outer, %s face, starting %s, the input seen every %s ms: every clause on every seed',
    (face, mode, every) => {
      const { runs, failures } = mixedCoarse(face, mode, every);
      expect(runs).toBe(MIXED_GRIDS.coarse.seeds.length);
      expect(failures).toEqual([]);
    },
    LONG,
  );

  it('some seed fills every node slot, and some lights a rest lobe beside three live placements after its last change', () => {
    const all = mixedCases.flatMap(([face, mode, every]) => mixedCoarse(face, mode, every).outcomes);
    expect([NODE_SLOTS, Math.max(...all.map((o) => o.maxDemand))]).toEqual([6, 6]);
    expect(all.some((o) => o.restBesideThreeLive)).toBe(true);
  }, LONG);

  // F7's cross-check in the mixed storm, on its own plant (T10's harness mutation run: H13 survived without it).
  it('planted: a ledger whose lobe rule disagrees with the builder’s (fixture-outer read as if neutrals bore a lobe): the frame holds more than the demand', () => {
    const wrong = { ...deps(FIXTURE_OUTER), config: { ...deps(FIXTURE_OUTER).config, neutralLobe: true } };
    const failures = MIXED_GRIDS.coarse.seeds.slice(0, 4).flatMap((seed) => mixedFailures(`wrong lobe rule, seed ${seed}`, mixedStorm(FIXTURE_OUTER, 'settle', seed, 17, wrong)));
    expect(has(failures, 'the demand and the built frame disagree')).toBe(true);
  }, LONG);
});
