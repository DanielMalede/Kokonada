/// <reference types="node" />
// B8-8b (the architect's B8 plan at 199b138): scripts/lab/reports/neverRed.mts, on planted capture runs. Every pixel of
// every capture is tested by the v2 definition of red (redBand.ts isRed over neverRedSweeps.ts CHECK_BAND, through
// lib/evidence.mts isCheckBandRed): the band must hold 0 pixels. A planted red patch and a single (2, 0, 0) pixel are
// flagged; (1, 0, 0), just under the band's chroma floor, is the control that must not be. It exits 1 on any pixel in
// the band, 2 on an input it cannot use (naming the field), writes a text report and never overwrites one.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withValue, without } from '../reports/__fixtures__/rows';
import { CHECK_BAND } from '../../../src/design/v2/tokens/neverRedSweeps';

jest.setTimeout(180000);

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/lab/reports/neverRed.mts');
const MAKE = path.join(APP, 'scripts/lab/reports/__fixtures__/makeFixtures.mts');
const PX = 103 * 229; // a whole capture: the app region the system bars leave

let root: string;
let fixtures: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'never-red-'));
  fixtures = path.join(root, 'fx');
  const r = spawnSync(process.execPath, ['--no-warnings', MAKE, fixtures], { cwd: APP, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the fixtures were not made: ${r.stderr}`);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function copySet(name: string): string {
  const dir = fs.mkdtempSync(path.join(root, `${name}-`));
  for (const f of fs.readdirSync(path.join(fixtures, name))) fs.copyFileSync(path.join(fixtures, name, f), path.join(dir, f));
  return dir;
}
const editManifest = (dir: string, edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[], top: Record<string, unknown> = {}) => {
  const file = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...m, ...top, rows: edit(m.rows) }));
};
function run(dir: string, out = path.join(dir, 'never-red.txt')) {
  const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--manifest', path.join(dir, 'manifest.json'), '--out', out], { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, report: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null };
}
const lastLine = (report: string | null) => (report ?? '').trimEnd().split(/\r?\n/).pop();

describe('neverRed on captures with no red pixel', () => {
  it('the law twins of field and fallback scenes, both faces: exit 0, 0 in the band on every row, the report printed and written', () => {
    const r = run(copySet('parity-pass'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toBe(r.report);
    expect(r.report).toContain(`band: isRed over CHECK_BAND (hue ${CHECK_BAND.hueFrom} to ${CHECK_BAND.hueTo}°, chroma ≥ ${CHECK_BAND.chromaFloor})`);
    for (const shot of ['dark-one-joy-still.1', 'light-three-low.1', 'fb-dark-one-c-right.1', 'fb-light-rest.1']) {
      expect(r.report).toMatch(new RegExp(`^row ${shot.replace(/\./g, '\\.')} \\S+: ${PX} px, in the check band: 0$`, 'm'));
    }
    expect(lastLine(r.report)).toBe(`PASS: 4 rows, ${4 * PX} px, none in the check band`);
  });

  it('the control: one (1, 0, 0) pixel, under the band’s chroma floor, is not flagged', () => {
    const r = run(copySet('neverred-100'));
    expect(r.status).toBe(0);
    expect(r.report).toContain(`row dark-one-joy-still.1 field.abyss.dark.one.joy.still: ${PX} px, in the check band: 0`);
  });
});

describe('neverRed flags planted red', () => {
  it('a planted 6 × 4 red patch: exit 1, all 24 pixels listed, their bounding box, FAIL', () => {
    const dir = copySet('neverred-patch');
    const planted: Array<{ x: number; y: number }> = JSON.parse(fs.readFileSync(path.join(dir, 'planted.json'), 'utf8'));
    expect(planted).toHaveLength(24);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.report).toContain(`row dark-one-joy-still.1 field.abyss.dark.one.joy.still: ${PX} px, in the check band: 24`);
    const listed = r.report!.split(/\r?\n/).filter((l) => l.startsWith('  in band · '));
    expect(listed).toEqual(planted.map((p) => `  in band · (${p.x}, ${p.y}) (200, 30, 40)`));
    expect(r.report).toContain('  bounding box: (40, 50) to (45, 53)');
    expect(r.report).toContain('  FAIL: 24 px in the check band');
    expect(lastLine(r.report)).toBe('FAIL: 1 of 1 rows have pixels in the check band (dark-one-joy-still.1): 24 px');
  });

  it('a single (2, 0, 0) pixel: exit 1, the pixel listed', () => {
    const r = run(copySet('neverred-200'));
    expect(r.status).toBe(1);
    expect(r.report).toContain(`row dark-one-joy-still.1 field.abyss.dark.one.joy.still: ${PX} px, in the check band: 1`);
    expect(r.report!.split(/\r?\n/).filter((l) => l.startsWith('  in band · '))).toEqual(['  in band · (71, 140) (2, 0, 0)']);
    expect(lastLine(r.report)).toBe('FAIL: 1 of 1 rows have pixels in the check band (dark-one-joy-still.1): 1 px');
  });

  it('a row the harness would not have written (no expect, no stage) is not evidence: exit 2, naming the fields, no report', () => {
    const dir = copySet('neverred-200');
    editManifest(dir, (rows) => rows.map((x) => without(without(x, 'expect'), 'stage')));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/validateRow.*"expect" is required.*"stage" is required/);
    expect(r.report).toBeNull();
  });
});

// The witness scene (B8-2) plants patches that are wrong on purpose (the P3-misread, double-encoded and skip-encode
// bytes) and may land in the band. Rule for now, to be confirmed by the designer: never-red judges field.*, fallback.*,
// grain.*, cost.* and storm.* rows in full (and any other row: none is exempt but the witness); a witness.* row would be
// judged outside its patches' rectangles, but the witness layout (src/design/lab/witness/witnessLayout.ts) is not in
// this tree and the manifest carries no patch rectangle, so a witness.* row is listed as not judged, named, with a count,
// never skipped silently.
describe('neverRed and the witness rows (planted patches)', () => {
  const asScene = (x: Record<string, unknown>, shot: string, scene: string, facts: Record<string, unknown> = {}) =>
    ({ ...withValue(withValue(x, 'shot', shot), 'scene', scene), ...facts });
  const asWitness = (x: Record<string, unknown>) =>
    asScene(x, 'witness-dark', 'witness.abyss.dark', { expect: { direction: 'abyss', face: 'dark', hero: null, tier: null }, renderScale: null, sampling: null });
  const NOT_JUDGED = 'not judged: witness-dark.1 witness.abyss.dark (planted patches: the witness layout is not in this tree and the manifest names no patch rectangle, so none can be excluded)';

  it('a witness row with a planted red patch is not judged: named, counted, its pixels not listed, and with no other row nothing is proved', () => {
    const dir = copySet('neverred-patch');
    editManifest(dir, (rows) => [asWitness(rows[0])]);
    const r = run(dir);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 1, stderr: '' });
    expect(r.report).toContain(NOT_JUDGED);
    expect(r.report!.split(/\r?\n/).filter((l) => l.startsWith('  in band · '))).toEqual([]);
    expect(lastLine(r.report)).toBe('FAIL: no row judged; 1 witness.* row not judged (planted patches), named above');
  });

  it('beside a witness row the other rows are still judged in full, and the verdict names the rows not judged', () => {
    const dir = copySet('neverred-100');
    editManifest(dir, (rows) => [rows[0], asWitness(rows[0])]);
    const r = run(dir);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report).toContain(`row dark-one-joy-still.1 field.abyss.dark.one.joy.still: ${PX} px, in the check band: 0`);
    expect(r.report).toContain(NOT_JUDGED);
    expect(lastLine(r.report)).toBe(`PASS: 1 rows, ${PX} px, none in the check band; 1 witness.* row not judged (planted patches), named above`);
  });

  it.each([
    ['field.abyss.dark.one.joy.still', {}],
    ['fallback.abyss.dark.rest', { expect: { direction: 'abyss', face: 'dark', hero: null, tier: null }, renderScale: null, sampling: null }],
    ['grain.abyss.dark.full', { expect: { direction: 'abyss', face: 'dark', hero: null, tier: 'full' } }],
    ['cost.abyss.dark.three.full.storm', { expect: { direction: 'abyss', face: 'dark', hero: 'three', tier: 'full' } }],
    ['storm.abyss.dark.burst', { expect: { direction: 'abyss', face: 'dark', hero: null, tier: null }, renderScale: null, sampling: null }],
  ])('a %s row is judged in full: its planted red patch is flagged, beside a witness row that is not', (scene, facts) => {
    const dir = copySet('neverred-patch');
    editManifest(dir, (rows) => [asScene(rows[0], 's', scene, facts), asWitness(rows[0])]);
    const r = run(dir);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 1, stderr: '' });
    expect(r.report).toContain(`row s.1 ${scene}: ${PX} px, in the check band: 24`);
    expect(r.report).toContain(NOT_JUDGED);
    expect(lastLine(r.report)).toBe('FAIL: 1 of 1 judged rows have pixels in the check band (s.1): 24 px; 1 witness.* row not judged (planted patches), named above');
  });
});

describe('neverRed refuses what it cannot use, and never overwrites', () => {
  it('an existing report: exit 2, left as it was', () => {
    const dir = copySet('neverred-200');
    const out = path.join(dir, 'never-red.txt');
    fs.writeFileSync(out, 'an earlier report\n');
    const r = run(dir, out);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(out);
    expect(fs.readFileSync(out, 'utf8')).toBe('an earlier report\n');
  });

  it.each(['file', 'sha256', 'region', 'scene'])('a row without "%s": exit 2, naming the field, no report', (field) => {
    const dir = copySet('neverred-100');
    editManifest(dir, (rows) => rows.map((x) => without(x, field)));
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`"${field}"`);
    expect(r.report).toBeNull();
  });

  it('a run whose capture failed: exit 1, saying so', () => {
    const dir = copySet('neverred-100');
    editManifest(dir, (rows) => rows, { outcome: 'failed', failure: 'planted failure' });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.report).toContain('the capture run failed: planted failure');
  });

  it('a run with no rows proves nothing: exit 1', () => {
    const dir = copySet('neverred-100');
    editManifest(dir, () => []);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(lastLine(r.report)).toBe('FAIL: no row to check');
  });

  it('no --manifest: exit 2 with the usage', () => {
    const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--out', path.join(root, 'x.txt')], { cwd: APP, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
  });
});
