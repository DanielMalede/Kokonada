import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import type { DirectionId, Face } from '../../tokens/tokens.generated.ts';
import { ADMISSION, type Admission, type Ledger, type LedgerFades } from '../placementLedger.ts';
import {
  MIXED_DTS, MIXED_EVERY, MIXED_FRAMES, MIXED_GRIDS, MIXED_OPS, MIXED_TAIL, MODES, SETTLE, lcg, mixedFailures, mixedReport, mixedStorm,
  plantCutLeaveEarly, plantEnterAboveZero, plantLowRestQuarterSteps, plantNoPlacementsWhileRestRises, plantQuarterStepFades, plantRestQuarterSteps, stormDeps,
  type MixedOutcome, type Mode,
} from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// T10's mixed, lagged storm in the default run (architect T5 r1 §5: "add/undo/clear, with the input seen every
// {1, 17, 50} ms"; resilience round 1 F3, the seeded property storm; reconciliation round 1: one test, R's
// generator with A's input-seen-every dimension). E3 never puts two store changes in one frame; here a read
// holds several, a frame's dt runs from 0 to 5000 ms and backwards and NaN, and the mode flips mid-run. The
// storm and its clauses are the shared harness's (field/ledgerStorms.ts). This file runs the coarse seeds for
// Abyss, on both faces, from both modes, at every input cadence; the generator's and the grids' pins; the
// coverage pins; and the planted controls. The full 200 seeds run in the sweeps project
// (ledgerStorms.abyss.sweeps.test.ts); fixture-outer's coarse seeds, where the rest lobes stay lit beside
// neutral placements, in ledgerStorms.fixture.test.ts.

const ID: DirectionId = 'abyss';
const LONG = 600_000;
const FACES: Face[] = ['dark', 'light'];
const deps = (face: Face) => stormDeps(ID, staticsFor(ID, EXTENSIONS as never), face);
const has = (failures: readonly string[], clause: string) => failures.some((f) => f.includes(clause));
// The planted controls run on the first four coarse seeds.
const CONTROL_SEEDS = MIXED_GRIDS.coarse.seeds.slice(0, 4);

const cases = FACES.flatMap((face) => MODES.flatMap((mode) => MIXED_EVERY.map((every) => [face, mode, every] as [Face, Mode, number])));
// Each coarse case runs once: its own test and the coverage pins read the same report.
const reports = new Map<string, ReturnType<typeof mixedReport>>();
const coarse = (face: Face, mode: Mode, every: number) => {
  const key = `${face} ${mode} ${every}`;
  if (!reports.has(key)) reports.set(key, mixedReport(ID, mode, every, MIXED_GRIDS.coarse.seeds, deps(face)));
  return reports.get(key)!;
};
const outcomes = (keep: (c: [Face, Mode, number]) => boolean = () => true): MixedOutcome[] => cases.filter(keep).flatMap(([face, mode, every]) => coarse(face, mode, every).outcomes);

describe('the mixed storm’s generator and grids', () => {
  it('the frame dts, the input cadences and the seeds are the ruled ones; the coarse seeds are some of the full ones', () => {
    expect(MIXED_DTS).toEqual([0, 1, 8.333, 16.667, 33.3, 120, 5000, -7, Number.NaN]);
    expect(MIXED_EVERY).toEqual([1, 17, 50]);
    expect(MIXED_GRIDS.full).toEqual({ seeds: Array.from({ length: 200 }, (_, i) => i + 1), every: [1, 17, 50] });
    expect(MIXED_GRIDS.coarse.every).toEqual(MIXED_GRIDS.full.every);
    expect(MIXED_GRIDS.coarse.seeds.length).toBeGreaterThan(0);
    expect(MIXED_GRIDS.coarse.seeds.filter((seed) => !MIXED_GRIDS.full.seeds.includes(seed))).toEqual([]);
  });

  it('the generator is resilience’s LCG, seed = (seed · 1664525 + 1013904223) >>> 0, read on [0, 1)', () => {
    const next = lcg(1);
    expect([next(), next(), next(), next(), next()]).toEqual([1015568748, 1586005467, 2165703038, 3027450565, 217083232].map((s) => s / 4294967296));
  });

  it('the operations: adds of five kinds (a quadrant, a neutral, exactly on the neutral radius, on the rim, beyond it), undos and clears', () => {
    expect(MIXED_OPS).toEqual(['quadrant', 'neutral', 'onNeutralRadius', 'rim', 'beyond', 'undo', 'clear']);
    expect(MIXED_FRAMES).toBeGreaterThanOrEqual(30);
  });

  it('the tail runs past the last change’s read for three starts and one spacing more (L19), then 200 ms', () => {
    expect(MIXED_TAIL).toBe(4 * SETTLE + 200);
  });

  it('a storm is a function of its seed: the same seed, the same outcome; another seed, another', () => {
    const a = mixedStorm(ID, 'settle', 3, 17, deps('dark'));
    expect(mixedStorm(ID, 'settle', 3, 17, deps('dark'))).toEqual(a);
    expect(mixedStorm(ID, 'settle', 4, 17, deps('dark'))).not.toEqual(a);
  });

  // babel-jest does not type-check: a misspelt option must throw, not silently run the default ledger.
  it('mixedStorm() refuses an option it does not know', () => {
    expect(() => mixedStorm(ID, 'settle', 1, 17, deps('dark'), { netting: false } as never)).toThrow(/unknown mixed storm option/);
  });
});

describe.each(cases)('the mixed storm on the coarse seeds: abyss, %s face, starting %s, the input seen every %s ms', (face, mode, every) => {
  it(
    'every clause holds on every seed',
    () => {
      const { runs, failures } = coarse(face, mode, every);
      expect(runs).toBe(MIXED_GRIDS.coarse.seeds.length);
      expect(failures).toEqual([]);
    },
    LONG,
  );
});

// The coverage pins: the coarse seeds still reach what the storm is for, so a generator that quietly stops
// batching, lagging, flipping or drawing a kind of frame goes red.
describe('the coarse seeds reach what the mixed storm is for', () => {
  it('at every cadence some read sees two or more store changes; at 50 ms some sees more than one frame applies (four or more)', () => {
    for (const every of MIXED_EVERY) expect([every, outcomes((c) => c[2] === every).some((o) => o.batchedReads > 0)]).toEqual([every, true]);
    expect(Math.max(...outcomes((c) => c[2] === 50).map((o) => o.maxChangesPerRead))).toBeGreaterThanOrEqual(4);
  }, LONG);

  it('every operation and every frame dt is drawn, and some frames see no new input (the lag)', () => {
    const all = outcomes();
    for (const op of MIXED_OPS) expect([op, all.some((o) => o.ops[op] > 0)]).toEqual([op, true]);
    for (const dt of MIXED_DTS) expect([dt, all.some((o) => (o.dts[String(dt)] ?? 0) > 0)]).toEqual([dt, true]);
    expect(all.some((o) => o.reads < o.frames)).toBe(true);
  }, LONG);

  it('the odd seeds flip the mode mid-run, the even ones do not', () => {
    const all = cases.flatMap(([face, mode, every]) => coarse(face, mode, every).outcomes.map((o, i) => [MIXED_GRIDS.coarse.seeds[i], o.flipped] as const));
    expect(all.every(([seed, flipped]) => flipped === (seed % 2 === 1))).toBe(true);
    expect(all.some(([, flipped]) => flipped)).toBe(true);
  }, LONG);

  it('crossfades start, several in a storm, and the waiting queue grows past one swap', () => {
    const all = outcomes();
    expect(Math.max(...all.map((o) => o.starts.length))).toBeGreaterThanOrEqual(3);
    expect(Math.max(...all.map((o) => o.queueMax))).toBeGreaterThanOrEqual(3);
  }, LONG);
});

// Each control asserts the harness's own clause output, on CONTROL_SEEDS.
describe('the mixed storm’s planted controls: each guard bites, through its own clauses', () => {
  const raw: Admission = { ...ADMISSION, netting: false };
  it('a raw first-in-first-out ledger breaks the netting identity and the queue bound', () => {
    const failures = MIXED_EVERY.flatMap((every) => mixedReport(ID, 'settle', every, CONTROL_SEEDS, deps('dark'), { limits: raw }).failures);
    expect([has(failures, 'the netting identity broke'), has(failures, 'the waiting queue held more than six changes')]).toEqual([true, true]);
  }, LONG);

  it('a ledger whose node limit never fits a swap stalls', () => {
    const tight: Admission = { ...ADMISSION, nodes: deps('dark').config.restLobes };
    const failures = mixedReport(ID, 'settle', 17, CONTROL_SEEDS, deps('dark'), { limits: tight }).failures;
    expect(has(failures, 'a frame ended idle with a change waiting past the spacing')).toBe(true);
  }, LONG);

  const plants: Array<[string, () => (ledger: Ledger) => LedgerFades, string]> = [
    ['D6 plantQuarterStepFades', plantQuarterStepFades, 'a fade moved faster than its curve'],
    ['D7 plantEnterAboveZero', plantEnterAboveZero, 'an id entered above 0'],
    ['D8 plantCutLeaveEarly', plantCutLeaveEarly, 'an id left above 0'],
    ['D9 plantRestQuarterSteps', plantRestQuarterSteps, 'a rest-lobe fade moved faster than its curve'],
  ];
  it.each(plants.flatMap(([name, plant, clause]) => MODES.map((mode) => [name, mode, plant, clause] as const)))('%s, starting %s: its clause fires', (_name, mode, plant, clause) => {
    const failures = CONTROL_SEEDS.flatMap((seed) => mixedFailures(`seed ${seed}`, mixedStorm(ID, mode, seed, 17, deps('dark'), { fadesOf: plant() })));
    expect(has(failures, clause)).toBe(true);
  }, LONG);

  // The two rest detectors, each with a plant only it sees: with D9's plant alone each covered for the other
  // (T10's harness mutation run, H9a and H9b survived).
  it('the lower of two rest lobes in quarter steps (the built max untouched): the ledger’s per-lobe rest detector fires', () => {
    const failures = MODES.flatMap((mode) => CONTROL_SEEDS.flatMap((seed) => mixedFailures(`low rest, seed ${seed}`, mixedStorm(ID, mode, seed, 17, deps('light'), { fadesOf: plantLowRestQuarterSteps() }))));
    expect(has(failures, 'a rest-lobe fade moved faster than its curve')).toBe(true);
  }, LONG);

  it('no placement given while the rest lobes rise (the builder draws the rest glow at 1): the built frame’s rest detector fires', () => {
    const failures = FACES.flatMap((face) => CONTROL_SEEDS.flatMap((seed) => mixedFailures(`no placements, seed ${seed}`, mixedStorm(ID, 'settle', seed, 17, deps(face), { fadesOf: plantNoPlacementsWhileRestRises() }))));
    expect(has(failures, 'a rest-lobe fade moved faster than its curve')).toBe(true);
  }, LONG);

  it('a tail cut at the last change’s read leaves frames needed, and the absolute bound unmet', () => {
    const failures = CONTROL_SEEDS.flatMap((seed) => mixedFailures(`no tail, seed ${seed}`, mixedStorm(ID, 'settle', seed, 17, deps('dark'), { tail: 0 })));
    expect([has(failures, 'frames still needed after the tail'), has(failures, 'did not converge')]).toEqual([true, true]);
  }, LONG);
});

// The clauses the mixed storm adds to E3's: each fires on its own defect, on an outcome that otherwise passes.
describe('the mixed storm’s own clauses: each fires on its own defect, and only it', () => {
  let clean: MixedOutcome;
  beforeAll(() => {
    clean = mixedStorm(ID, 'settle', 2, 17, deps('dark'));
  });

  it('a real storm’s outcome passes every clause', () => {
    expect(mixedFailures('clean', clean)).toEqual([]);
    expect(clean.starts.length).toBeGreaterThan(1);
  });

  it.each<[string, Partial<MixedOutcome>, string]>([
    ['a queue of seven', { queueMax: 2 * ADMISSION.live + 1 }, 'the waiting queue held more than six changes'],
    ['frames still needed', { framesNeededAtEnd: true }, 'frames still needed after the tail'],
    ['a late convergence (E3’s clause, on the tail’s mode)', { converged: 2 * SETTLE + SETTLE + 1, mode: 'settle', restBesideThreeLive: false }, 'did not converge within 1800 ms'],
  ])('%s', (_name, defect, clause) => {
    const failures = mixedFailures('planted', { ...clean, ...defect });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(clause);
  });
});
