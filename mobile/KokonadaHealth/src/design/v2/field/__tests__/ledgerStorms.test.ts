/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId } from '../../tokens/tokens.generated.ts';
import { NODE_SLOTS } from '../fieldLaw.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { ADMISSION, emptyLedger, fades, reconcile, type Admission } from '../placementLedger.ts';
import { MODES, QUAD, STORMS, STORM_GRIDS, frameState, geometry, gridReport, storm, store, stormDeps, stormFailures, type Mode, type Outcome, type Storm } from '../ledgerStorms.ts';
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
const deps = (id: DirectionId) => stormDeps(id, staticsFor(id, EXTENSIONS as never));
const config = (id: DirectionId) => deps(id).config;

const cases = IDS.flatMap((id) => MODES.flatMap((mode) => STORMS.map((kind) => [id, mode, kind] as [DirectionId, Mode, Storm])));

describe('E3 in the default run: the coarse grid, every direction × mode × storm, taps every 17, 143 and 250 ms for 3 s', () => {
  it('the grids are the ruled ones: the coarse here, the full in the sweeps project', () => {
    expect(STORM_GRIDS).toEqual({ coarse: { every: [17, 143, 250], span: [3000] }, full: { every: [17, 50, 100, 143, 167, 250], span: [3000, 10000] } });
  });

  it.each(cases)(
    '%s, %s, %s',
    (id, mode, kind) => {
      const { runs, failures } = gridReport(id, mode, kind, STORM_GRIDS.coarse, deps(id));
      expect(runs).toBe(3);
      expect(failures).toEqual([]);
    },
    LONG,
  );

  it.each(MODES)('%s: reemit’s fades are bit-identical to one tap sent once, at the coarse cadences (the full set runs in the sweeps project)', (mode) => {
    for (const every of STORM_GRIDS.coarse.every) {
      const re = storm('abyss', mode, 'reemit', every, 3000, deps('abyss'), ADMISSION, true);
      const once = storm('abyss', mode, 'reemit', 1e9, 3000, deps('abyss'), ADMISSION, true);
      expect(re.series).toEqual(once.series);
    }
  });
});

// Each control asserts the harness's own clause output (resilience, rulings after T5d, §1), and runs
// where its clause runs (§2): the one-sided clause and the full cadence sets are in the sweeps project.
describe('E3’s planted controls: each guard is shown to bite, through the harness’s own clauses', () => {
  const has = (failures: readonly string[], clause: string) => failures.some((f) => f.includes(clause));

  it('a ledger whose node limit can never fit a swap stalls: a frame ends idle with a change waiting past the spacing', () => {
    // One below a toggle's smallest swap, one placement and every rest lobe beside it (2 before law
    // round 2, item 6 left Abyss one rest lobe), so it holds whatever the rest table.
    const tight: Admission = { ...ADMISSION, nodes: deps('abyss').config.restLobes };
    const failures = stormFailures('tight', 'toggle', 'settle', storm('abyss', 'settle', 'toggle', 250, 3000, deps('abyss'), tight));
    expect(has(failures, 'a frame ended idle with a change waiting past the spacing')).toBe(true);
  });

  const raw: Admission = { ...ADMISSION, netting: false };
  it('a raw first-in-first-out ledger breaks the netting identity at every coarse cadence (the full set runs in the sweeps project)', () => {
    const { runs, failures } = gridReport('abyss', 'settle', 'toggle', STORM_GRIDS.coarse, deps('abyss'), raw);
    expect(runs).toBe(3);
    expect(STORM_GRIDS.coarse.every.map((every) => has(failures.filter((f) => f.includes(`every ${every} ms`)), 'the netting identity broke'))).toEqual([true, true, true]);
  });

  it('a raw ledger at 143 ms never converges inside the window: the absolute bound fires (17 and 50 ms run in the sweeps project)', () => {
    const o = storm('abyss', 'settle', 'toggle', 143, 3000, deps('abyss'), raw);
    expect(has(stormFailures('raw 143', 'toggle', 'settle', o), 'did not converge')).toBe(true);
  });
});

// The harness mutation run deletes each clause line in stormFailures, one at a time; each one fires
// here on its own planted defect, on an outcome that otherwise passes every clause.
describe('E3’s clauses: each fires on its own defect, and only it', () => {
  let clean: Outcome;
  let cleanReemit: Outcome;
  beforeAll(() => {
    clean = storm('abyss', 'settle', 'toggle', 250, 3000, deps('abyss'));
    cleanReemit = storm('abyss', 'settle', 'reemit', 250, 3000, deps('abyss'));
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
