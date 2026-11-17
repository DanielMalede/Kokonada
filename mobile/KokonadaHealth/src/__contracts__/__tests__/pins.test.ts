/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { PINS } from '../pins';
import { RETIRE } from '../retire';
import { indexTests, normalizeEol } from '../../testing/guards/contracts';
import { REPO_ROOT, checkPins, checkRetireEntries, readDecStatus, sha256, statementWindows } from '../../testing/guards/retire';

// QA-118: the v1 pins are retired with a RETIRE entry citing a DECIDED DEC, never re-pointed to v2
// values. The pins are read from the real tree (backend/tests/consent.test.js included); the planted
// controls change the real sources in memory (D8 rule 2).

const read = (file: string): string | null => {
  const abs = path.join(REPO_ROOT, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};
const HEX = /#[0-9a-f]{3,8}\b/i;
const pin = (id: string) => {
  const p = PINS.find((x) => x.id === id);
  if (!p) throw new Error(`no pin ${id}`);
  return p;
};

/** The real source of a pin with its pinned window's text changed in memory by `edit`. */
function plantedEdit(id: string, edit: (window: string) => string): string {
  const p = pin(id);
  const src = normalizeEol(read(p.file) as string);
  const test = indexTests(src, p.file).find((t) => t.fullName === p.fullTitle);
  const window = test && test.call.arguments.slice(1).flatMap((fn) => statementWindows(fn, src, p.statements)).find((w) => sha256(w) === p.sha256);
  if (!window) throw new Error(`planted: the window of ${id} was not found`);
  const changed = edit(window);
  if (changed === window) throw new Error(`planted: the edit left ${id} unchanged`);
  return src.replace(window, () => changed);
}

describe('QA-118 · v1 pins are retired, never re-pointed', () => {
  it('the inputs are real (an empty pin list must fail, not pass)', () => {
    expect(PINS.length).toBeGreaterThanOrEqual(9);
    const files = [...new Set(PINS.map((p) => p.file))];
    expect(files).toEqual(expect.arrayContaining([
      'mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts',
      'mobile/KokonadaHealth/src/__tests__/shadow.healthLane.test.ts',
      'backend/tests/consent.test.js',
    ]));
    for (const f of files) expect([f, read(f) !== null]).toEqual([f, true]);
    for (const p of PINS) {
      expect([p.id, p.statements >= 1, /^[0-9a-f]{64}$/.test(p.sha256), p.ref.length > 0]).toEqual([p.id, true, true, true]);
    }
  });

  it('no pin record spells a colour (the pinned text is held by its hash)', () => {
    expect(PINS.filter((p) => HEX.test(p.description) || HEX.test(p.id) || HEX.test(p.ref)).map((p) => p.id)).toEqual([]);
  });

  it('every RETIRE entry cites a DECIDED DEC', () => {
    expect(checkRetireEntries(RETIRE, readDecStatus)).toEqual([]);
  });

  it('every pin is held at this head, and no RETIRE entry names one still in place', () => {
    expect(checkPins(PINS, read, RETIRE, readDecStatus)).toEqual([]);
  });

  it('planted: one emotion-anchor literal changed in memory is red', () => {
    const p = pin('tokens-emotion-anchors');
    const src = plantedEdit(p.id, (w) => w.replace(/#([0-9A-F])/, (_m, c: string) => '#' + (c === 'F' ? 'E' : 'F')));
    expect(checkPins([p], (f) => (f === p.file ? src : read(f)), RETIRE, readDecStatus)).toEqual([
      `pin ${p.id}: the pinned assertion in ${p.file} ${JSON.stringify(p.fullTitle)} changed (a v1 pin is retired with a RETIRE entry, never re-pointed)`,
    ]);
  });

  it('planted: the backend consent pin re-pointed to accept the adjacent version is red', () => {
    const p = pin('consent-rejects-older');
    const src = plantedEdit(p.id, (w) => w.replace('CURRENT_CONSENT_VERSION - 1', 'CURRENT_CONSENT_VERSION - 2'));
    expect(checkPins([p], (f) => (f === p.file ? src : read(f)), RETIRE, readDecStatus)).toHaveLength(1);
  });

  it('planted: a pinned test deleted is red without a RETIRE entry and green with a valid one', () => {
    const p = pin('appflow-splash-dwell');
    const gone = (f: string) => (f === p.file ? null : read(f));
    expect(checkPins([p], gone, [], readDecStatus)).toEqual([`pin ${p.id}: ${JSON.stringify(p.fullTitle)} is gone from ${p.file} with no RETIRE entry`]);
    const entry = { kind: 'pin' as const, target: p.id, dec: 'DEC-091', reason: 'planted' };
    expect(readDecStatus('DEC-091')).toBe('DECIDED');
    expect(checkPins([p], gone, [entry], readDecStatus)).toEqual([]);
    expect(checkPins([p], gone, [{ ...entry, dec: 'DEC-039' }], readDecStatus)).toEqual(['RETIRE pin appflow-splash-dwell: DEC-039 is OPEN, not DECIDED']);
  });
});
