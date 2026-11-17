/// <reference types="node" />
import { checkFloor, countMarkers, measureFloor } from '../guards/testFloor';

// The interim QA-041 floor (D8 rule 6), on lists and sources assembled in memory (D8 rule 2): the
// number of test files jest runs never drops below the recorded baseline minus RETIRE-listed files,
// the skip/todo markers never rise, and nothing is focused. The real tree is checked in
// src/__contracts__/__tests__/testFloor.test.ts.

const q = (s: string) => String.fromCharCode(39) + s + String.fromCharCode(39);
const t = (call: string) => call + '(' + q('t') + ', () => {});';

describe('countMarkers (calls, never text)', () => {
  it.each([
    ['it.skip', t('it.skip'), 1, 0],
    ['test.skip', t('test.skip'), 1, 0],
    ['describe.skip', t('describe.skip'), 1, 0],
    ['xit', t('xit'), 1, 0],
    ['xtest', t('xtest'), 1, 0],
    ['xdescribe', t('xdescribe'), 1, 0],
    ['it.todo', 'it.todo(' + q('later') + ');', 1, 0],
    ['test.todo', 'test.todo(' + q('later') + ');', 1, 0],
    ['it.skip.each, counted once', 'it.skip.each([1, 2])(' + q('t %s') + ', () => {});', 1, 0],
    ['a conditional skip', 'const maybe = flag ? it : it.skip;', 1, 0],
    ['it.only', t('it.only'), 0, 1],
    ['test.only', t('test.only'), 0, 1],
    ['describe.only', t('describe.only'), 0, 1],
    ['fit', t('fit'), 0, 1],
    ['fdescribe', t('fdescribe'), 0, 1],
    ['a plain test', t('it') + t('test') + t('describe'), 0, 0],
    ['a skip spelled in a string', 'const s = ' + q('it.skip(x) xit( fit(') + ';', 0, 0],
    ['.skip on something else', 'player.skip(); queue.only(1);', 0, 0],
    ['a property named like a marker', 'const o = { xit: 1, fit: 2 }; o.fit;', 0, 0],
  ])('%s', (_label, source, skip, only) => {
    expect(countMarkers(source, 'planted.test.ts')).toEqual({ skip, only });
  });
});

describe('checkFloor (QA-041 interim floor)', () => {
  const FILES = ['src/a/__tests__/a.test.ts', 'src/b/__tests__/b.test.ts', 'src/c/__tests__/c.test.ts'];
  const plain = t('it');
  const sources: Record<string, string> = { [FILES[0]]: plain, [FILES[1]]: plain + t('it.skip'), [FILES[2]]: plain };
  const read = (f: string) => sources[f] ?? null;
  const baseline = { sha: '0'.repeat(40), listTestsCount: 3, skipCount: 1, measuredAt: '2026-11-17T00:00:00Z', command: 'planted' };
  const decided = (dec: string) => (dec === 'DEC-091' ? 'DECIDED' : dec === 'DEC-039' ? 'OPEN' : null);
  const retireC = { kind: 'file' as const, target: FILES[2], dec: 'DEC-091', reason: 'planted' };

  it('measures the list and its markers', () => {
    expect(measureFloor(FILES, read)).toEqual({ listTestsCount: 3, skipCount: 1, onlyCount: 0, onlyFiles: [], unreadable: [] });
  });

  it('passes at the baseline, and above it (no ratchet: more tests never fail)', () => {
    expect(checkFloor(baseline, FILES, read, [], decided)).toEqual([]);
    const more = [...FILES, 'src/d/__tests__/d.test.ts'];
    expect(checkFloor(baseline, more, (f) => (f === more[3] ? plain : read(f)), [], decided)).toEqual([]);
  });

  it('planted: a list missing one file with no RETIRE entry is red', () => {
    expect(checkFloor(baseline, FILES.slice(0, 2), read, [], decided)).toEqual([
      'jest runs 2 test files; the floor is 3 (baseline 3 at 000000000000, minus 0 retired): a test file was removed without a RETIRE entry',
    ]);
  });

  it('planted: the same list with a valid RETIRE entry for the missing file is green', () => {
    expect(checkFloor(baseline, FILES.slice(0, 2), read, [retireC], decided)).toEqual([]);
  });

  it('planted: a RETIRE entry citing a missing or not-DECIDED DEC is red and lowers nothing', () => {
    expect(checkFloor(baseline, FILES.slice(0, 2), read, [{ ...retireC, dec: 'DEC-039' }], decided)).toEqual([
      'RETIRE file src/c/__tests__/c.test.ts: DEC-039 is OPEN, not DECIDED',
      'jest runs 2 test files; the floor is 3 (baseline 3 at 000000000000, minus 0 retired): a test file was removed without a RETIRE entry',
    ]);
    expect(checkFloor(baseline, FILES.slice(0, 2), read, [{ ...retireC, dec: 'DEC-998' }], decided)[0]).toBe('RETIRE file src/c/__tests__/c.test.ts: DEC-998 does not exist');
  });

  it('red on a RETIRE entry for a file jest still runs', () => {
    expect(checkFloor(baseline, FILES, read, [retireC], decided)).toEqual(['RETIRE file src/c/__tests__/c.test.ts: jest still runs it']);
  });

  it('planted: one more it.skip in a source is red', () => {
    const skipped = (f: string) => (f === FILES[0] ? plain + t('it.skip') : read(f));
    expect(checkFloor(baseline, FILES, skipped, [], decided)).toEqual(['2 skip/todo markers (.skip, x*, .todo); the floor allows 1 (baseline at 000000000000)']);
  });

  it('planted: a focused test is red at any count', () => {
    const focused = (f: string) => (f === FILES[2] ? t('fit') : read(f));
    expect(checkFloor(baseline, FILES, focused, [], decided)).toEqual(['1 focused marker (.only, fit, fdescribe), the floor allows none: src/c/__tests__/c.test.ts']);
  });

  it('red on a listed file that cannot be read', () => {
    const missing = [...FILES, 'src/e/__tests__/e.test.ts'];
    expect(checkFloor(baseline, missing, read, [], decided)).toEqual(['src/e/__tests__/e.test.ts is listed by jest but cannot be read']);
  });

  it('ignores RETIRE entries of other kinds', () => {
    expect(checkFloor(baseline, FILES, read, [{ kind: 'pin', target: 'x', dec: 'DEC-998', reason: 'r' }], decided)).toEqual([]);
  });
});
