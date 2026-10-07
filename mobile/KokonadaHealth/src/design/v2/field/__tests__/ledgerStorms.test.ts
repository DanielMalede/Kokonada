/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { ADMISSION, emptyLedger, fades, reconcile, type Admission } from '../placementLedger.ts';
import { MODES, QUAD, SETTLE, STORMS, STORM_GRIDS, frameState, geometry, gridReport, storm, store, stormDeps, type Mode, type Storm } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';
import { packFrame } from '../uniforms.ts';

// QA-068, the event path: E3 and E5 in the default run. E3's text, its storms and its clauses live in
// the shared harness (field/ledgerStorms.ts); this file runs the coarse grid, every planted control,
// reemit and the law half of E5, and the sweeps project runs the full grid
// (ledgerStorms.{abyss,linen,basin}.sweeps.test.ts). neutral3 runs in every direction; it is the
// binding case in Linen, where neutral placements have no lobe and the rest lobes stay lit. E5's
// real-Skia half is in fieldShader.skia.test.ts.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
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

  it.each(MODES)('%s: reemit’s fades are bit-identical to one tap sent once', (mode) => {
    for (const every of STORM_GRIDS.full.every) {
      const re = storm('abyss', mode, 'reemit', every, 3000, deps('abyss'), ADMISSION, true);
      const once = storm('abyss', mode, 'reemit', 1e9, 3000, deps('abyss'), ADMISSION, true);
      expect(re.series).toEqual(once.series);
    }
  });
});

describe('E3’s planted controls: each guard is shown to bite', () => {
  it('a ledger that admits three swaps makes Linen’s neutral3 overflow, and the builder throws a RangeError', () => {
    const three: Admission = { ...ADMISSION, entering: 3, leaving: 3, nodes: 99 };
    const o = storm('linen', 'settle', 'neutral3', 100, 3000, deps('linen'), three);
    expect(o.threw).toMatch(/^RangeError/);
    expect(storm('linen', 'settle', 'neutral3', 100, 3000, deps('linen')).threw).toBeNull();
  });

  // Resilience round 1 F2: three controls, each proving one clause.
  const raw: Admission = { ...ADMISSION, netting: false };
  // Measured (runs/v1b-b4-T5b-E3-convergence-table.txt §1): at 250 ms the raw ledger converges at 1450 ms
  // after the 3 s storm and 2850 ms after the 10 s one; at 300 ms and slower the two coincide.
  const SLOW_RAW_CADENCE = 250;
  it('a raw first-in-first-out ledger breaks the netting identity at every cadence', () => {
    for (const every of STORM_GRIDS.full.every) expect(storm('abyss', 'settle', 'toggle', every, 3000, deps('abyss'), raw).netBreaks).toBeGreaterThan(0);
    expect(storm('abyss', 'settle', 'toggle', 17, 3000, deps('abyss')).netBreaks).toBe(0);
  });
  it('at fast cadences a raw ledger never converges inside the window (the absolute bound bites)', () => {
    for (const every of [17, 50]) expect(storm('abyss', 'settle', 'toggle', every, 3000, deps('abyss'), raw).converged).toBeNull();
  });
  it('the one-sided backlog clause bites on its own: a raw ledger at a slow cadence converges after both storms, the long one more than 600 ms later', () => {
    const [short, long] = STORM_GRIDS.full.span.map((span) => storm('abyss', 'settle', 'toggle', SLOW_RAW_CADENCE, span, deps('abyss'), raw, false, 30_000));
    expect(short.converged).not.toBeNull();
    expect(long.converged).not.toBeNull();
    expect(long.converged! - short.converged!).toBeGreaterThan(SETTLE);
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
