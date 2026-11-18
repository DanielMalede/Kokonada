/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { NODE_SLOTS } from '../fieldLaw.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { ADMISSION, emptyLedger, fades, reconcile, type Admission, type Ledger, type LedgerFades } from '../placementLedger.ts';
import {
  MODES, QUAD, STORMS, STORM_GRIDS, frameState, geometry, gridReport, plantCutLeaveEarly, plantEnterAboveZero, plantNaNFadeMidRamp, plantQuarterStepFades, plantRestQuarterSteps,
  storm, store, stormDeps, stormFailures, type Mode, type Outcome, type Storm,
} from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';
import { packFrame } from '../uniforms.ts';

// QA-068, the event path: E3 and E5 in the default run. E3's text, its storms and its clauses live in
// the shared harness (field/ledgerStorms.ts); this file runs the coarse grid, the planted controls
// whose clauses run here (each asserting the harness's own clause output), reemit on the coarse
// cadences and the law half of E5; the sweeps project runs the full grid and the controls whose
// clauses run there (ledgerStorms.<id>.sweeps.test.ts, one per shipped direction). neutral3 runs in every
// direction; its binding case, neutral placements with no lobe beside the lit rest lobes, runs on the
// fixture direction fixture-outer (ledgerStorms.fixture.test.ts), with the two controls that bind there.
// E5's real-Skia half is in fieldShader.skia.test.ts.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const BASE_SETTLE = BASE.motion.settle.duration;
const LONG = 600_000;
// A storm runs on one face: the ledger counts that face's rest lobes, and the builder draws them (UI-112:
// Abyss's rest table is per face, one lobe on dark and two on light).
const FACES: Face[] = ['dark', 'light'];
const deps = (id: DirectionId, face: Face) => stormDeps(id, staticsFor(id, EXTENSIONS as never), face);
const config = (id: DirectionId) => deps(id, 'dark').config;

const cases = IDS.flatMap((id) => FACES.flatMap((face) => MODES.flatMap((mode) => STORMS.map((kind) => [id, face, mode, kind] as [DirectionId, Face, Mode, Storm]))));
// Each coarse case runs once: its own test and the coverage pins read the same report.
const reports = new Map<string, ReturnType<typeof gridReport>>();
const coarse = (id: DirectionId, face: Face, mode: Mode, kind: Storm) => {
  const key = `${id} ${face} ${mode} ${kind}`;
  if (!reports.has(key)) reports.set(key, gridReport(id, mode, kind, STORM_GRIDS.coarse, deps(id, face)));
  return reports.get(key)!;
};

describe('a storm’s face: the ledger’s rest count and the built frame are the same face’s', () => {
  it('stormDeps counts the face’s own rest lobes: Abyss one on dark, two on light', () => {
    expect(FACES.map((face) => [deps('abyss', face).face, deps('abyss', face).config.restLobes])).toEqual([['dark', 1], ['light', 2]]);
  });

  // L7: the ledger's ω reads the same face's rest centres, on the storms' plate.
  it('stormDeps places the face’s own rest lobes for the overlap law, on the storms’ plate', () => {
    for (const face of FACES) {
      const d = deps('abyss', face);
      expect(d.config.overlap.rest).toEqual(staticsFor('abyss', EXTENSIONS as never).restLobes[face]);
      expect(d.config.overlap.beadRadius).toBe(DIRECTIONS.abyss.bead.diameter / 2 / (geometry.radiusPx / geometry.pxPerDp));
    }
  });

  it('the storm builds on the deps’ face: a ledger counting dark’s one rest lobe, built on light’s two, is caught', () => {
    const crossed = { ...deps('abyss', 'light'), config: deps('abyss', 'dark').config };
    const failures = stormFailures('crossed', 'toggle', 'settle', storm('abyss', 'settle', 'toggle', 250, 3000, crossed));
    expect(failures.some((f) => f.includes('the demand and the built frame disagree'))).toBe(true);
    expect(stormFailures('own', 'toggle', 'settle', storm('abyss', 'settle', 'toggle', 250, 3000, deps('abyss', 'light')))).toEqual([]);
  });
});

describe('E3 in the default run: the coarse grid, every direction × mode × storm, taps every 17, 143 and 250 ms for 3 s', () => {
  it('the grids are the ruled ones: the coarse here, the full in the sweeps project', () => {
    expect(STORM_GRIDS).toEqual({ coarse: { every: [17, 143, 250], span: [3000] }, full: { every: [17, 50, 100, 143, 167, 250], span: [3000, 10000] } });
  });

  it.each(cases)(
    '%s, %s face, %s, %s',
    (id, face, mode, kind) => {
      const { runs, failures, outcomes } = coarse(id, face, mode, kind);
      expect([runs, outcomes.length]).toEqual([3, 3]);
      expect(failures).toEqual([]);
    },
    LONG,
  );

  // E3's coverage pins (resilience, law round 2 (d)): the coarse grid still reaches what its clauses
  // guard. Demand at NODE_SLOTS and a rest lobe lit beside three live placements bind on fixture-outer
  // (ledgerStorms.fixture.test.ts): Abyss, the only shipped direction, reaches neither, and its reach is
  // pinned below (law round 2 D9, RA-3), so a change that moves it goes red and the pins are re-ruled.
  const abyssCoarse = (keep: (c: [DirectionId, Face, Mode, Storm]) => boolean) =>
    cases.filter((c) => c[0] === 'abyss' && keep(c)).flatMap(([id, face, mode, kind]) => coarse(id, face, mode, kind).outcomes);

  it('Abyss’s measured reach on the coarse grid: demand peaks at exactly 5', () => {
    expect(Math.max(...abyssCoarse(() => true).map((o) => o.maxDemand))).toBe(5);
  }, LONG);

  it('Abyss’s measured reach on the coarse grid: no settle storm lights a rest lobe beside three live placements', () => {
    const settle = abyssCoarse(([, , mode]) => mode === 'settle');
    expect(settle).toHaveLength(FACES.length * STORMS.length * 3);
    expect(settle.filter((o) => o.restBesideThreeLive)).toHaveLength(0);
  }, LONG);

  // The ledger's rest promise, which no clause of E3 reads (law round 2 D9, RA-2): wherever the ledger
  // gives no lobe-bearing placement, every rest fade it gives is exactly 1. The builder draws the rest
  // glow at 1 there whatever it is given (fieldFrame.ts), so a ledger leaving its rest lobes short of 1
  // after the last leave passes every clause; only this pin sees it.
  it('wherever the ledger gives no lobe-bearing placement, every rest fade it gives is exactly 1, at every frame of every coarse Abyss storm', () => {
    const outcomes = abyssCoarse(() => true);
    expect(outcomes).toHaveLength(FACES.length * MODES.length * STORMS.length * 3);
    expect(outcomes.map((o) => o.restShortWithoutLobe)).toEqual(outcomes.map(() => 0));
    // Not vacuous: the storms do reach frames with no lobe-bearing placement.
    expect(outcomes.filter((o) => o.framesWithoutLobe > 0).length).toBeGreaterThan(0);
  }, LONG);

  it('the rest pin bites: a driver leaving the rest lobes at 0.99 where no lobe-bearing placement is given is counted, and passes every E3 clause', () => {
    const short = (ledger: Ledger): LedgerFades => {
      const f = fades(ledger);
      return f.placements.length === 0 ? { ...f, restFades: f.restFades.map(() => 0.99) } : f;
    };
    const o = storm('abyss', 'settle', 'toggle', 250, 3000, deps('abyss', 'dark'), { fadesOf: short });
    expect(o.restShortWithoutLobe).toBeGreaterThan(0);
    expect(stormFailures('rest short', 'toggle', 'settle', o)).toEqual([]);
  });
  it('the full grid holds the coarse one: every coarse cadence and span runs in the sweeps project too', () => {
    expect(STORM_GRIDS.coarse.every.filter((e) => !STORM_GRIDS.full.every.includes(e))).toEqual([]);
    expect(STORM_GRIDS.coarse.span.filter((s) => !STORM_GRIDS.full.span.includes(s))).toEqual([]);
  });

  it.each(MODES)('%s: some coarse storm makes three or more starts', (mode) => {
    const starts = cases.filter((c) => c[2] === mode).flatMap(([id, face, , kind]) => coarse(id, face, mode, kind).outcomes.map((o) => o.starts.length));
    expect(Math.max(...starts)).toBeGreaterThanOrEqual(3);
  }, LONG);

  it.each(MODES)('%s: reemit’s fades are bit-identical to one tap sent once, at the coarse cadences (the full set runs in the sweeps project)', (mode) => {
    for (const every of STORM_GRIDS.coarse.every) {
      const re = storm('abyss', mode, 'reemit', every, 3000, deps('abyss', 'dark'), { keepSeries: true });
      const once = storm('abyss', mode, 'reemit', 1e9, 3000, deps('abyss', 'dark'), { keepSeries: true });
      expect(re.series).toEqual(once.series);
    }
  });
});

// Each control asserts the harness's own clause output (resilience, rulings after T5d, §1), and runs
// where its clause runs (§2): the one-sided clause and the full cadence sets are in the sweeps project.
describe('E3’s planted controls: each guard is shown to bite, through the harness’s own clauses', () => {
  const has = (failures: readonly string[], clause: string) => failures.some((f) => f.includes(clause));

  it.each(FACES)('%s face: a ledger whose node limit can never fit a swap stalls: a frame ends idle with a change waiting past the spacing', (face) => {
    // One below a toggle's smallest swap, one placement and every rest lobe beside it (one on dark, two
    // on light, UI-112), so it holds whatever the face's rest table.
    const tight: Admission = { ...ADMISSION, nodes: deps('abyss', face).config.restLobes };
    const failures = stormFailures('tight', 'toggle', 'settle', storm('abyss', 'settle', 'toggle', 250, 3000, deps('abyss', face), { limits: tight }));
    expect(has(failures, 'a frame ended idle with a change waiting past the spacing')).toBe(true);
  });

  const raw: Admission = { ...ADMISSION, netting: false };
  it('a raw first-in-first-out ledger breaks the netting identity at every coarse cadence (the full set runs in the sweeps project)', () => {
    const { runs, failures } = gridReport('abyss', 'settle', 'toggle', STORM_GRIDS.coarse, deps('abyss', 'dark'), raw);
    expect(runs).toBe(3);
    expect(STORM_GRIDS.coarse.every.map((every) => has(failures.filter((f) => f.includes(`every ${every} ms`)), 'the netting identity broke'))).toEqual([true, true, true]);
  });

  it('a raw ledger at 143 ms never converges inside the window: the absolute bound fires (17 and 50 ms run in the sweeps project)', () => {
    const o = storm('abyss', 'settle', 'toggle', 143, 3000, deps('abyss', 'dark'), { limits: raw });
    expect(has(stormFailures('raw 143', 'toggle', 'settle', o), 'did not converge')).toBe(true);
  });
});

// The fades driver (resilience, law round 2 (d)): storm() reads the ledger's fades through an injectable
// fadesOf, the ledger's own by default, so the four fade detectors (D6–D9) each bite on a real plant
// driven through a real storm, not only on a planted outcome. Each plant is a factory, made fresh per
// storm, and each must fail with exactly its one clause, but one measured case: D8 under settle.
describe('E3’s fades driver: each fade detector bites on its own real plant, and only it', () => {
  const SLOPE_CLAUSE = 'a fade moved faster than its curve';
  const REST_CLAUSE = 'a rest-lobe fade moved faster than its curve';
  // D8 under settle also breaks the rest-lobe slope, for real: where the cut leave was the frame's only
  // placement, the builder draws the rest glow at 1 (fieldFrame.ts, no placement carries a lobe) while
  // the ledger's rest lobe is at 0.9901, a 0.0099 step in one ms against settle's 0.00667. Under reduced
  // the step is 0.00667, inside its 0.01333 (runs/d9-probe-d8-46e0324.txt, wip/d9-probe-d8.mts at 46e0324).
  const plants: Array<[string, () => (ledger: Ledger) => LedgerFades, Record<Mode, string[]>]> = [
    ['D6 plantQuarterStepFades', plantQuarterStepFades, { settle: [SLOPE_CLAUSE], reduced: [SLOPE_CLAUSE] }],
    ['D7 plantEnterAboveZero', plantEnterAboveZero, { settle: ['an id entered above 0'], reduced: ['an id entered above 0'] }],
    ['D8 plantCutLeaveEarly', plantCutLeaveEarly, { settle: ['an id left above 0', REST_CLAUSE], reduced: ['an id left above 0'] }],
    ['D9 plantRestQuarterSteps', plantRestQuarterSteps, { settle: [REST_CLAUSE], reduced: [REST_CLAUSE] }],
  ];

  // babel-jest does not type-check: an old positional call, storm(…, deps, limits), would hand the
  // admission limits in as the options and silently run the default ledger.
  it('storm() refuses an option it does not know: admission limits passed where the options go throw', () => {
    expect(() => storm('abyss', 'settle', 'toggle', 250, 3000, deps('abyss', 'dark'), { ...ADMISSION, netting: false } as never)).toThrow(/unknown storm option/);
  });

  it('the default path deep-equals an explicit fadesOf: fades', () => {
    const d = deps('abyss', 'dark');
    const implicit = storm('abyss', 'settle', 'toggle', 250, 3000, d, { keepSeries: true });
    expect(implicit.series.length).toBeGreaterThan(3000);
    expect(storm('abyss', 'settle', 'toggle', 250, 3000, d, { keepSeries: true, fadesOf: fades })).toEqual(implicit);
  });

  // Each planted storm runs once here; the factory pin below runs one more, with a fresh plant.
  const planted = new Map<string, Outcome>();
  const plantedStorm = (name: string, mode: Mode, plant: () => (ledger: Ledger) => LedgerFades) => {
    const key = `${name} ${mode}`;
    if (!planted.has(key)) planted.set(key, storm('abyss', mode, 'toggle', 250, 3000, deps('abyss', 'dark'), { fadesOf: plant() }));
    return planted.get(key)!;
  };

  it.each(plants.flatMap(([name, plant, clauses]) => MODES.map((mode) => [name, mode, plant, clauses[mode]] as const)))(
    '%s, %s, Abyss, toggle every 250 ms for 3 s: exactly its clauses',
    (name, mode, plant, clauses) => {
      const label = `${name} ${mode}`;
      const failures = stormFailures(label, 'toggle', mode, plantedStorm(name, mode, plant));
      expect(failures).toHaveLength(clauses.length);
      expect(failures.map((f, i) => f.startsWith(`${label}: ${clauses[i]}: `))).toEqual(clauses.map(() => true));
    },
  );

  // RA-25 (resilience T10, UI-198): |a − b| > bound is false for NaN; a NaN fade mid-ramp must still break the slope.
  it.each(MODES)('%s: a NaN fade planted mid-ramp breaks "a fade moved faster than its curve"', (mode) => {
    const failures = stormFailures('NaN', 'toggle', mode, storm('abyss', mode, 'toggle', 250, 3000, deps('abyss', 'dark'), { fadesOf: plantNaNFadeMidRamp() }));
    expect(failures.some((f) => f.includes('a fade moved faster than its curve'))).toBe(true);
  });

  // A plant that kept state between storms would bite on the first and pass the second (the S10-1
  // parity class): the same plant, made fresh, gives the same outcome again.
  it.each(plants)('%s is a factory: each call is a fresh driver, and a second storm bites as the first did', (name, plant) => {
    expect(plant()).not.toBe(plant());
    const first = plantedStorm(name, 'settle', plant);
    expect(storm('abyss', 'settle', 'toggle', 250, 3000, deps('abyss', 'dark'), { fadesOf: plant() })).toEqual(first);
  });
});

// The harness mutation run deletes each clause line in stormFailures, one at a time; each one fires
// here on its own planted defect, on an outcome that otherwise passes every clause.
describe('E3’s clauses: each fires on its own defect, and only it', () => {
  let clean: Outcome;
  let cleanReemit: Outcome;
  beforeAll(() => {
    clean = storm('abyss', 'settle', 'toggle', 250, 3000, deps('abyss', 'dark'));
    cleanReemit = storm('abyss', 'settle', 'reemit', 250, 3000, deps('abyss', 'dark'));
  });

  it('a real storm’s outcomes pass every clause', () => {
    expect([stormFailures('clean', 'toggle', 'settle', clean), stormFailures('clean', 'reemit', 'settle', cleanReemit)]).toEqual([[], []]);
    expect(clean.starts.length).toBeGreaterThan(1);
  });

  const defects: Array<[string, Partial<Outcome>, string]> = [
    ['a throw', { threw: 'RangeError at 5 ms: planted' }, 'the builder threw'],
    ['demand over the slots', { maxDemand: NODE_SLOTS + 1 }, 'demand above NODE_SLOTS'],
    ['a frame over its demand', { demandMismatch: 1 }, 'the demand and the built frame disagree'],
    ['a fast fade', { slopeBreaks: ['id 0 at 5 ms: 0 → 1'] }, 'a fade moved faster than its curve'],
    ['an enter above 0', { entersNotAtZero: [7] }, 'an id entered above 0'],
    ['a leave above 0', { leavesNotAtZero: [7] }, 'an id left above 0'],
    ['a fast rest lobe', { restBreaks: 1 }, 'a rest-lobe fade moved faster than its curve'],
    ['two starts 300 ms apart', { starts: [1, 301], admittedAtStarts: [1, 1] }, 'starts closer than motion.settle.duration'],
    ['an empty start', { starts: [1], admittedAtStarts: [0] }, 'a start admitted nothing'],
    ['a netting break', { netBreaks: 1 }, 'the netting identity broke'],
    ['a stall', { stalls: 1 }, 'a frame ended idle with a change waiting past the spacing'],
    ['no convergence', { converged: null }, 'did not converge within'],
    ['a late convergence', { converged: 2 * BASE_SETTLE + 600 + 1 }, 'did not converge within'],
  ];
  it.each(defects)('%s', (_, defect, clause) => {
    const failures = stormFailures('planted', 'toggle', 'settle', { ...clean, ...defect });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(clause);
  });

  it('reemit with two starts', () => {
    const failures = stormFailures('planted', 'reemit', 'settle', { ...cleanReemit, starts: [1, 701], admittedAtStarts: [1, 1] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('reemit did not give exactly one start');
  });
});

describe('E5: the halo is bound to the ledger', () => {
  // Same ledger output, one built while the store holds an extra tap that is not yet admitted. Under
  // reduced motion the first ramp ends at 150 ms, so only the spacing keeps the tap out until 601 ms.
  it.each(IDS.flatMap((id) => MODES.map((mode) => [id, mode] as const)))('%s, %s: a frame built while the store holds an unadmitted tap is byte-identical to one built without it', (id, mode) => {
    const a = store();
    const b = store();
    let la = emptyLedger(config(id));
    let lb = emptyLedger(config(id));
    let checked = 0;
    for (let t = 0; t <= 500; t++) {
      if (t === 1) { a.add(QUAD[3]); b.add(QUAD[3]); }
      if (t === 100) b.add(QUAD[1]); // waits for the spacing: not admitted before 601 ms
      la = reconcile(la, { seq: a.seq(), taps: a.taps() }, t, mode);
      lb = reconcile(lb, { seq: b.seq(), taps: b.taps() }, t, mode);
      if (t >= 100 && t % 50 === 0) {
        expect(fades(lb)).toEqual(fades(la));
        const fa = buildFieldFrame(frameState(id, 'dark', fades(la)), geometry, staticsFor(id, EXTENSIONS as never));
        const fb = buildFieldFrame(frameState(id, 'dark', fades(lb)), geometry, staticsFor(id, EXTENSIONS as never));
        expect(packFrame(fb)).toEqual(packFrame(fa));
        checked++;
      }
    }
    expect(checked).toBe(9);
  });

  const DESIGN = path.resolve(__dirname, '../../..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(e.name) && !full.includes(`${path.sep}__tests__${path.sep}`)) out.push(full);
    }
    return out;
  };
  /**
   * A plate or bead source that reads field.halo or draws a halo of its own; or any source outside
   * v2/field and the generated tokens that reads field.halo, whatever its name (resilience round 1 F10).
   */
  const offends = (file: string, source: string) => (/(plate|bead)/i.test(path.basename(file)) && /field\.halo|\bhalo\b|Halo\b/.test(source)) || (!file.includes(`${path.sep}v2${path.sep}field${path.sep}`) && !/tokens(\.extensions)?\.generated\.ts$/.test(file) && /\bfield\.halo\b/.test(source));

  /** The legitimate readers of field.halo outside v2/field, each with its reason (resilience round 1 F10). */
  const HALO_READERS: Record<string, string> = {
    [path.join('v2', 'tokens', 'neverRedSweeps.ts')]: 'the never-red sweep bounds k by the halo peak (field.halo.peakDark and peakLight); it draws nothing',
  };

  it('the static guard: no plate or bead file reads field.halo or draws a halo, and nothing else outside v2/field reads field.halo', () => {
    const files = [...walk(path.join(DESIGN, 'v2')), ...walk(path.join(DESIGN, 'lab'))];
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => offends(f, fs.readFileSync(f, 'utf8'))).map((f) => path.relative(DESIGN, f)).filter((f) => !(f in HALO_READERS))).toEqual([]);
  });

  it('each allowlisted reader still exists and still reads field.halo, so the list cannot rot', () => {
    for (const file of Object.keys(HALO_READERS)) expect([file, offends(path.join(DESIGN, file), fs.readFileSync(path.join(DESIGN, file), 'utf8'))]).toEqual([file, true]);
  });

  it('the static guard bites on planted sources', () => {
    expect(offends('lab/v1hero/Beads.tsx', 'const r = BASE.field.halo.diameter / 2;')).toBe(true);
    expect(offends('lab/v1hero/Plate.tsx', '<Circle r={22} color={haloColour} /> // the Halo')).toBe(true);
    expect(offends('lab/v1hero/VoiceLine.tsx', 'const halo = 1;')).toBe(false);
    expect(offends('lab/v1hero/PlacementMarks.tsx', 'const d = BASE.field.halo.diameter;')).toBe(true);
  });
});
