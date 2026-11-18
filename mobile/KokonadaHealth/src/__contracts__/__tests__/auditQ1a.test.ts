/// <reference types="node" />
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CONTRACTS } from '../manifest';
import { PINS } from '../pins';
import { TEST_FLOOR } from '../testFloor.baseline';
import { APP_ROOT } from '../../testing/guards/productionImports';
import { indexTests, listJestTests, normalizeEol } from '../../testing/guards/contracts';
import { REPO_ROOT, checkPins, checkRetireEntries, pinState, readDecStatus, sha256, statementWindows } from '../../testing/guards/retire';
import { checkFloor, countMarkers } from '../../testing/guards/testFloor';

// The resilience audit of #291 (RA-1 to RA-4, RA-6, RA-8): each case is a way the Q1a checks could
// pass with nothing checked. Planted inputs are in memory or in os.tmpdir() (D8 rule 2). The RETIRE
// signatures in planted controls come from an injected stub, never from live decision records.

const readApp = (file: string): string | null => {
  const abs = path.join(APP_ROOT, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};
const readRepo = (file: string): string | null => {
  const abs = path.join(REPO_ROOT, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};
const stub = (dec: string) => (dec === 'DEC-900' || dec === 'DEC-1000' ? 'DECIDED' : dec === 'DEC-901' ? 'OPEN' : null);
const AT = TEST_FLOOR.sha.slice(0, 12);
const NOW_PLAYING = 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx';
const THIS = 'src/__contracts__/__tests__/auditQ1a.test.ts';

describe('RA-1 · the floor holds every baseline file, not a count', () => {
  let list: string[] = [];
  beforeAll(() => { list = listJestTests(APP_ROOT); }, 150_000);

  it('the baseline records its files: sorted, unique, posix, as many as its count', () => {
    expect(TEST_FLOOR.paths.length).toBe(TEST_FLOOR.listTestsCount);
    expect([...TEST_FLOOR.paths].sort()).toEqual([...TEST_FLOOR.paths]);
    expect(new Set(TEST_FLOOR.paths).size).toBe(TEST_FLOOR.paths.length);
    expect(TEST_FLOOR.paths.filter((p) => p.includes('\\') || path.isAbsolute(p))).toEqual([]);
    expect(TEST_FLOOR.paths).toContain(NOW_PLAYING);
    expect(TEST_FLOOR.paths).not.toContain(THIS); // new files never join the baseline
  });

  it('planted: one baseline file gone with no RETIRE entry is red against the real baseline, whatever the count', () => {
    const without = list.filter((f) => f !== NOW_PLAYING);
    expect(without.length).toBeGreaterThan(TEST_FLOOR.listTestsCount); // the count alone would pass
    expect(checkFloor(TEST_FLOOR, without, readApp, [], stub)).toEqual([
      `${NOW_PLAYING}: in the baseline at ${AT}, jest no longer runs it, and no RETIRE entry names it`,
    ]);
    expect(checkFloor(TEST_FLOOR, without, readApp, [{ kind: 'file', target: NOW_PLAYING, dec: 'DEC-900', reason: 'planted' }], stub)).toEqual([]);
  });

  it('planted: six baseline files gone unsigned are six failures, not hidden by the new files', () => {
    const six = TEST_FLOOR.paths.slice(0, 6);
    expect(checkFloor(TEST_FLOOR, list.filter((f) => !six.includes(f)), readApp, [], stub)).toHaveLength(6);
  });

  it('planted: a RETIRE file entry for a path never in the baseline is red and lowers nothing', () => {
    const without = list.filter((f) => f !== THIS);
    expect(checkFloor(TEST_FLOOR, without, readApp, [{ kind: 'file', target: THIS, dec: 'DEC-900', reason: 'planted' }], stub)).toEqual([
      `RETIRE file ${THIS}: not in the baseline at ${AT} (only a baseline test file is retired)`,
    ]);
  });
});

describe('RA-2 · the rule DECs never sign a RETIRE entry', () => {
  it.each(['DEC-091', 'DEC-142'])('%s is refused as a signature, though DECIDED', (dec) => {
    expect(readDecStatus(dec)).toBe('DECIDED');
    expect(checkRetireEntries([{ kind: 'pin', target: 'p', dec, reason: 'r' }], readDecStatus))
      .toEqual([`RETIRE pin p: ${dec} is the RETIRE rule itself, not a signature`]);
    const pin = PINS[0];
    expect(checkPins([pin], () => null, [{ kind: 'pin', target: pin.id, dec, reason: 'r' }], readDecStatus))
      .toEqual([`RETIRE pin ${pin.id}: ${dec} is the RETIRE rule itself, not a signature`]);
  });
});

describe('RA-3 · it.failing and test.failing count as skipped', () => {
  const q = (s: string) => String.fromCharCode(39) + s + String.fromCharCode(39);
  it.each(['it.failing', 'test.failing', 'it.concurrent.failing'])('%s', (call) => {
    const src = 'describe(' + q('d') + ', () => { ' + call + '(' + q('t') + ', () => {}); });';
    expect(indexTests(src, 'x.test.ts').map((t) => [t.fullName, t.skipped])).toEqual([['d t', true]]);
    expect(countMarkers(src, 'x.test.ts')).toEqual({ skip: 1, only: 0 });
  });
});

// RA-4: every pin proves its window holds its value. Each edit is applied to the hashed window's own
// text (so it must land inside it) and must turn the pin `changed`.
const flipHex = (w: string): string => w.replace(/#([0-9A-Fa-f])/, (_m, c: string) => '#' + (c.toUpperCase() === 'F' ? 'E' : 'F'));
const sub = (find: string, replace: string, last = false) => (w: string): string => {
  const i = last ? w.lastIndexOf(find) : w.indexOf(find);
  if (i < 0) throw new Error(`the edit ${JSON.stringify(find)} is not inside the window`);
  return w.slice(0, i) + replace + w.slice(i + find.length);
};
const EDITS: Record<string, Array<(w: string) => string>> = {
  'tokens-emotion-anchors': [flipHex],
  'tokens-content-muted': [flipHex],
  'tokens-gold-ink': [flipHex],
  'tokens-cta-pair': [flipHex, sub('16.74', '16.75')],
  'tokens-text-scrim': [sub('to: 0.55', 'to: 0.5')],
  'tokens-aurora-surfaces': [flipHex],
  'tokens-aurora-blobs': [sub('15000', '15001'), flipHex],
  'appflow-splash-dwell': [sub('/ 3', '/ 4')],
  'bioaura-breath-floor-ceiling': [sub('4200', '4800'), sub('6300', '6900')],
  'bootsplash-one-face': [flipHex],
  'onboarding-one-way': [sub('.toBe(true)', '.toBe(false)', true)],
  'legal-consent-sheet-no-notice': [sub('.not.toMatch', '.toMatch')],
  'consent-rejects-older': [sub('CURRENT_CONSENT_VERSION - 1', 'CURRENT_CONSENT_VERSION - 2')],
  'consent-rejects-newer': [sub('CURRENT_CONSENT_VERSION + 1', 'CURRENT_CONSENT_VERSION + 2')],
  'healthlane-ble-request-only-in-definition': [sub('health/blePermissions.ts', 'health/bleElsewhere.ts')],
};

describe('RA-4 · every pin’s window covers its value', () => {
  it('every pin has at least one planted edit, and no edit names a pin that is not listed', () => {
    expect(Object.keys(EDITS).sort()).toEqual(PINS.map((p) => p.id).sort());
  });

  it('planted: an edit outside the window (BioAura’s first assertion, in the test but not pinned) is refused', () => {
    const p = PINS.find((x) => x.id === 'bioaura-breath-floor-ceiling')!;
    const src = normalizeEol(readRepo(p.file) as string);
    const test = indexTests(src, p.file).find((t) => t.fullName === p.fullTitle)!;
    const window = test.call.arguments.slice(1).flatMap((fn) => statementWindows(fn, src, p.statements)).find((w) => sha256(w) === p.sha256)!;
    expect(src.slice(test.call.getStart(), test.call.getEnd())).toContain('breathMsForArousal(0)');
    expect(() => sub('breathMsForArousal(0)', 'breathMsForArousal(1)')(window)).toThrow('is not inside the window');
  });

  const cases = PINS.flatMap((p) => (EDITS[p.id] ?? []).map((edit, i) => [p.id, i, edit] as const));
  it.each(cases)('%s, edit %d, lands inside the hashed window and turns the pin changed', (id, _i, edit) => {
    const p = PINS.find((x) => x.id === id)!;
    const src = normalizeEol(readRepo(p.file) as string);
    const test = indexTests(src, p.file).find((t) => t.fullName === p.fullTitle)!;
    const window = test.call.arguments.slice(1).flatMap((fn) => statementWindows(fn, src, p.statements)).find((w) => sha256(w) === p.sha256)!;
    expect(window).toBeDefined();
    const changed = edit(window);
    expect(changed).not.toBe(window);
    expect(pinState(p, src.replace(window, () => changed))).toBe('changed');
  });
});

describe('RA-6 · the data is pinned exactly, not by a floor', () => {
  it('the fifteen pins', () => {
    expect(PINS.map((p) => p.id)).toEqual([
      'tokens-emotion-anchors', 'tokens-content-muted', 'tokens-gold-ink', 'tokens-cta-pair', 'tokens-text-scrim',
      'tokens-aurora-surfaces', 'tokens-aurora-blobs', 'appflow-splash-dwell', 'bioaura-breath-floor-ceiling',
      'bootsplash-one-face', 'onboarding-one-way', 'legal-consent-sheet-no-notice', 'consent-rejects-older',
      'consent-rejects-newer', 'healthlane-ble-request-only-in-definition',
    ]);
  });

  it('the eight contract IDs and their twenty references', () => {
    expect(Object.fromEntries(Object.entries(CONTRACTS).map(([id, refs]) => [id, refs.length]))).toEqual({
      'S10-1': 1, 'NP-ATTR': 4, M1: 2, T8: 3, T9: 3, T10: 1, 'Fork-4A': 2, 'honest-empty': 4,
    });
    expect(Object.values(CONTRACTS).flat()).toHaveLength(20);
  });
});

describe('RA-8 · decision ids and statuses without live records', () => {
  it('a DEC id of four digits or more is a valid signature', () => {
    expect(checkRetireEntries([{ kind: 'pin', target: 'p', dec: 'DEC-1000', reason: 'r' }], stub)).toEqual([]);
    expect(checkRetireEntries([{ kind: 'pin', target: 'p', dec: 'DEC-12', reason: 'r' }], stub)).toEqual(['RETIRE pin p: DEC-12 is not a DEC-nnn id']);
  });

  it('readDecStatus reads a planted decisions folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q1a-decisions-'));
    try {
      fs.writeFileSync(path.join(dir, 'DEC-900.md'), '---\nid: DEC-900\nstatus: DECIDED\n---\n');
      fs.writeFileSync(path.join(dir, 'DEC-901.md'), '---\nid: DEC-901\nstatus: OPEN\n---\n');
      expect(readDecStatus('DEC-900', dir)).toBe('DECIDED');
      expect(readDecStatus('DEC-901', dir)).toBe('OPEN');
      expect(readDecStatus('DEC-902', dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #291 audit RA-9: the interim QA-041 baseline is measured data. Shrinking it alongside a deleted test
// must fail here; a deletion is recorded as a RETIRE `file` entry, never by editing the baseline. The
// list's SHA-256 (paths joined by LF) was computed from the measurement run (q1a-floor-baseline-paths),
// not from this data, so a mid-list swap is caught too.
const MEASURED_PATHS_SHA256 = '5288cabcde32024961c28cc67b81927aa7f3c3377d5f5f075983532158337238';
const shape = (f: typeof TEST_FLOOR) => ({
  sha: f.sha,
  listTestsCount: f.listTestsCount,
  paths: f.paths.length,
  skipCount: f.skipCount,
  first: f.paths[0],
  last: f.paths[f.paths.length - 1],
  pathsSha256: sha256(f.paths.join(String.fromCharCode(10))),
});
const MEASURED = {
  sha: '988bab3e44f214fd24ce11f6663431c6ffe2afa7',
  listTestsCount: 219,
  paths: 219,
  skipCount: 2,
  first: '__tests__/App.test.tsx',
  last: 'tools/eslint-plugin-kokonada/__tests__/tokenIndex.test.js',
  pathsSha256: MEASURED_PATHS_SHA256,
};

describe('RA-9 · the QA-041 baseline is pinned as measured at 988bab3', () => {
  it('sha, counts, the ends of the path list and its hash are the measured ones', () => {
    expect(shape(TEST_FLOOR)).toEqual(MEASURED);
    expect(TEST_FLOOR.paths[218]).toBe('tools/eslint-plugin-kokonada/__tests__/tokenIndex.test.js');
  });

  it('planted: a copy shrunk with its deleted test (218 files) is caught', () => {
    const shrunk = { ...TEST_FLOOR, listTestsCount: 218, paths: TEST_FLOOR.paths.filter((p) => p !== NOW_PLAYING) };
    expect(shrunk.paths).toHaveLength(218);
    expect(shape(shrunk)).not.toEqual(MEASURED);
  });

  it('planted: a mid-list swap at the same length is caught by the hash', () => {
    const swapped = [...TEST_FLOOR.paths];
    [swapped[100], swapped[101]] = [swapped[101], swapped[100]];
    const s = shape({ ...TEST_FLOOR, paths: swapped });
    expect([s.paths, s.first, s.last]).toEqual([219, MEASURED.first, MEASURED.last]);
    expect(s.pathsSha256).not.toBe(MEASURED.pathsSha256);
  });
});
