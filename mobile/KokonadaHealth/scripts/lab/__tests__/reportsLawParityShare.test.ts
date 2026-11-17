/// <reference types="node" />
// UI-239: lawParity renders each law twin once per distinct input and shares it across the rows whose twins are the same
// (lib/twinShare.mjs), and its report must be the one it wrote when every row had a twin of its own. The oracle is that
// row alone (__fixtures__/rowsAlone.ts): a manifest of one row cannot share anything, so its section for the row and its
// ×8 crops are the row's own. A run's section for each row must be that, byte for byte, and its exit code and verdict
// what the rows' own verdicts make them.
//
// The planted run (makeFixtures.mts's parity-pass rows over the parity-fail captures, pixels over 1 on a field and a
// fallback row) is made to share: three shots captured twice, and rows that differ from another row in one twin input
// alone (the face of a field and of a fallback scene, the frame time, the density, the font scale, the stage), each
// captured as its base's PNG, so a twin wrongly shared shows. The guard: each such row's own report differs from its
// base's, so a shared twin could not pass unseen. The renders are counted by the CanvasKit surfaces the run makes (two
// per field twin, one per fallback twin, countSurfaces.cjs). reportsHarness.test.ts holds the harness's own v1-field run
// to the same oracle.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withValue } from '../reports/__fixtures__/rows';
import { againstRowsAlone } from './__fixtures__/rowsAlone';

jest.setTimeout(600000);

const APP = path.resolve(__dirname, '../../..');
const MAKE = path.join(APP, 'scripts/lab/reports/__fixtures__/makeFixtures.mts');

type Row = Record<string, unknown>;

let root: string;
let result: Awaited<ReturnType<typeof againstRowsAlone>>;
let byName: Map<string, (typeof result)['rows'][number]>;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-parity-share-'));
  const fixtures = path.join(root, 'fx');
  const r = spawnSync(process.execPath, ['--no-warnings', MAKE, fixtures], { cwd: APP, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the fixtures were not made: ${r.stderr}`);
  const share = path.join(root, 'share');
  fs.mkdirSync(share);
  const fail = JSON.parse(fs.readFileSync(path.join(fixtures, 'parity-fail', 'manifest.json'), 'utf8')) as { rows: Row[] } & Row;
  for (const f of fs.readdirSync(path.join(fixtures, 'parity-fail'))) if (f.endsWith('.png')) fs.copyFileSync(path.join(fixtures, 'parity-fail', f), path.join(share, f));
  const [fieldDark, fieldLow, fbDark, fbLight] = fail.rows;
  const as = (base: Row, shot: string, edits: Array<[string, unknown]>) => edits.reduce((x, [k, v]) => withValue(x, k, v), withValue(base, 'shot', shot));
  const rows: Row[] = [
    fieldDark, fieldLow, fbDark, fbLight,
    withValue(fieldDark, 'repeat', 2), withValue(fbDark, 'repeat', 2), withValue(fieldLow, 'repeat', 2),
    as(fieldDark, 'v-face', [['scene', 'field.abyss.light.one.joy.still'], ['expect.face', 'light'], ['face', 'light'], ['uimode', 'day']]),
    as(fbDark, 'v-fb-face', [['scene', 'fallback.abyss.light.one.C.right'], ['expect.face', 'light'], ['face', 'light'], ['uimode', 'day']]),
    as(fieldLow, 'v-time', [['clock.t', 12500]]),
    as(fieldLow, 'v-density', [['device.density', 44]]),
    as(fieldLow, 'v-font', [['fontScale.requested', 1.3], ['fontScale.observed', 1.3], ['fontScale.app', 1.3]]),
    as(fbDark, 'v-fb-density', [['device.density', 44]]),
    as(fieldLow, 'v-stage', [['stage', { ...(fieldLow.stage as object), height: 240 }]]),
  ];
  fs.writeFileSync(path.join(share, 'manifest.json'), JSON.stringify({ ...fail, rows }));
  result = await againstRowsAlone(path.join(share, 'manifest.json'), fs.mkdtempSync(path.join(root, 'out-')));
  byName = new Map(result.rows.map((x) => [x.name, x]));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('lawParity shares twins, and its report is the one each row gets alone', () => {
  it('the guard: every row was compared, alone and in the run, and nothing was refused', () => {
    expect(result.whole.stderr).toBe('');
    expect(result.rows.map((x) => [x.name, x.stderr, x.own.length > 0, x.shared.length > 0])).toEqual(result.rows.map((x) => [x.name, '', true, true]));
  });

  it.each([['v-face.1', 'dark-one-joy-still.1'], ['v-fb-face.1', 'fb-dark-one-c-right.1'], ['v-time.1', 'light-three-low.1'], ['v-density.1', 'light-three-low.1'], ['v-font.1', 'light-three-low.1'], ['v-fb-density.1', 'fb-dark-one-c-right.1'], ['v-stage.1', 'light-three-low.1']])(
    'the guard: %s, its base\'s capture under one changed twin input, is not judged as %s is',
    (variant, base) => {
      const judged = (lines: string[]) => lines.slice(1).filter((l) => !l.startsWith('  crop ')).join('\n');
      expect(judged(byName.get(variant)!.own)).not.toBe(judged(byName.get(base)!.own));
    },
  );

  it('renders each distinct twin once: 7 field twins and 4 fallback twins for 14 rows', () => {
    // Alone, each row renders its own: 9 field rows and 5 fallback rows.
    expect(result.rows.reduce((n, x) => n + (x.cropsOwn.length > 0 ? 2 : 1), 0)).toBe(2 * 9 + 5);
    expect(result.whole.surfaces).toBe(2 * 7 + 4);
  });

  it('each row\'s section of the run\'s report is its own report\'s, byte for byte', () => {
    for (const x of result.rows) expect({ row: x.name, section: x.shared.join('\n') }).toEqual({ row: x.name, section: x.own.join('\n') });
  });

  it('each field row\'s ×8 crops are its own, byte for byte', () => {
    expect(result.rows.filter((x) => x.cropsOwn.length > 0).map((x) => x.name)).toEqual(['dark-one-joy-still.1', 'light-three-low.1', 'dark-one-joy-still.2', 'light-three-low.2', 'v-face.1', 'v-time.1', 'v-density.1', 'v-font.1', 'v-stage.1']);
    for (const x of result.rows) expect({ row: x.name, crops: x.cropsShared }).toEqual({ row: x.name, crops: x.cropsOwn });
    expect(result.whole.crops.size).toBe(result.rows.reduce((n, x) => n + x.cropsOwn.length, 0));
  });

  it('the run\'s exit code and verdict follow its rows\' own: 1, naming exactly the rows that fail alone', () => {
    const failing = result.rows.filter((x) => x.status === 1).map((x) => x.name);
    expect(failing.length).toBeGreaterThan(0);
    expect(result.rows.every((x) => x.status === 0 || x.status === 1)).toBe(true);
    expect(result.whole.status).toBe(1);
    expect(result.whole.report.trimEnd().split('\n').pop()).toBe(`FAIL: ${failing.length} of ${result.rows.length} rows have pixels over ±1 (${failing.join(', ')}); the designer rules`);
  });
});
