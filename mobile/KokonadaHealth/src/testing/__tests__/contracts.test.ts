/// <reference types="node" />
import * as path from 'path';
import { APP_ROOT } from '../guards/productionImports';
import { checkManifest, indexTests, parseListTests } from '../guards/contracts';

// QA-040's reader, on sources assembled in memory (D8 rule 2: nothing planted is written to disk).
// The real manifest is checked against the real tree in src/__contracts__/__tests__/contracts.test.ts.

const q = (s: string) => String.fromCharCode(39) + s + String.fromCharCode(39);
const bt = String.fromCharCode(96);
const SRC = [
  'describe(' + q('outer') + ', () => {',
  '  it(' + q('runs') + ', () => {});',
  '  it.skip(' + q('skipped') + ', () => {});',
  '  xit(' + q('x skipped') + ', () => {});',
  '  it.todo(' + q('later') + ');',
  '  test(' + bt + 'plain template' + bt + ', () => {});',
  '  test(' + bt + 'with ${1 + 1} inside' + bt + ', () => {});',
  '  it.each([1])(' + q('each %s') + ', () => {});',
  '  describe(' + q('inner') + ', () => {',
  '    it(' + q('deep') + ', () => {});',
  '  });',
  '  describe.skip(' + q('off') + ', () => {',
  '    it(' + q('under a skipped describe') + ', () => {});',
  '  });',
  '  describe.each([[1]])(' + q('table %s') + ', () => {',
  '    it(' + q('under a table') + ', () => {});',
  '  });',
  '  const s = ' + q('it("not a test")') + ';',
  '});',
  'xdescribe(' + q('xd') + ', () => { test(' + q('t') + ', () => {}); });',
].join('\n');

describe('indexTests (QA-040: a full name is the describe path plus the title)', () => {
  const tests = indexTests(SRC, 'planted.test.ts');
  const byName = (n: string) => tests.find((t) => t.fullName === n);

  it('reads every test with its full name, and nothing that only looks like one', () => {
    expect(tests.map((t) => t.fullName)).toEqual([
      'outer runs', 'outer skipped', 'outer x skipped', 'outer later', 'outer plain template',
      'outer <dynamic>', 'outer <dynamic>', 'outer inner deep', 'outer off under a skipped describe',
      'outer <dynamic> under a table', 'xd t',
    ]);
  });

  it('marks skips through x*, .skip, .todo and a skipped describe ancestor', () => {
    expect(byName('outer runs')?.skipped).toBe(false);
    expect(byName('outer inner deep')?.skipped).toBe(false);
    expect(byName('outer plain template')?.skipped).toBe(false);
    for (const n of ['outer skipped', 'outer x skipped', 'outer later', 'outer off under a skipped describe', 'xd t']) {
      expect([n, byName(n)?.skipped]).toEqual([n, true]);
    }
  });

  it('marks titles it cannot resolve: .each tables, templates with expressions, and their descendants', () => {
    expect(tests.filter((t) => t.dynamic).map((t) => t.fullName)).toEqual(['outer <dynamic>', 'outer <dynamic>', 'outer <dynamic> under a table']);
    expect(tests.filter((t) => !t.dynamic)).toHaveLength(8);
  });

  it('reads it.failing and test.failing as skipped: they pass only while their body fails', () => {
    const failing = ['it.failing(' + q('a') + ', () => {});', 'test.failing(' + q('b') + ', () => {});'].join(String.fromCharCode(10));
    expect(indexTests(failing, 'planted.test.ts').map((t) => [t.fullName, t.skipped])).toEqual([['a', true], ['b', true]]);
  });

  it('reads CRLF sources the same as LF', () => {
    expect(indexTests(SRC.split('\n').join('\r\n'), 'planted.test.ts').map((t) => t.fullName)).toEqual(tests.map((t) => t.fullName));
  });
});

describe('checkManifest (QA-040: every contract ID has a running test)', () => {
  const FILE = 'src/x/__tests__/planted.test.ts';
  const read = (f: string) => (f === FILE ? SRC : null);
  const list = [FILE, 'src/y/__tests__/other.test.ts'];

  it('passes when every reference names a running, statically titled test in a file jest runs', () => {
    expect(checkManifest({ A: [{ file: FILE, fullTitle: 'outer runs' }], B: [{ file: FILE, fullTitle: 'outer inner deep' }] }, list, read)).toEqual([]);
  });

  it.each([
    ['an empty reference list', { A: [] }, 'A: no test reference'],
    ['a file jest does not run', { A: [{ file: 'src/z/__tests__/gone.test.ts', fullTitle: 'outer runs' }] }, 'A: src/z/__tests__/gone.test.ts is not among the files jest runs'],
    ['a title that is not there', { A: [{ file: FILE, fullTitle: 'outer renamed' }] }, 'A: src/x/__tests__/planted.test.ts has no test named "outer renamed"'],
    ['a skipped test', { A: [{ file: FILE, fullTitle: 'outer skipped' }] }, 'A: "outer skipped" in src/x/__tests__/planted.test.ts is skipped'],
    ['a test under a skipped describe', { A: [{ file: FILE, fullTitle: 'outer off under a skipped describe' }] }, 'A: "outer off under a skipped describe" in src/x/__tests__/planted.test.ts is skipped'],
    ['a test under a .each table', { A: [{ file: FILE, fullTitle: 'outer table %s under a table' }] }, 'A: src/x/__tests__/planted.test.ts has no test named "outer table %s under a table"'],
    ['a backslash path', { A: [{ file: 'src\\x\\__tests__\\planted.test.ts', fullTitle: 'outer runs' }] }, 'A: src\\x\\__tests__\\planted.test.ts is not a posix path relative to the app'],
  ])('red on %s', (_label, manifest, failure) => {
    expect(checkManifest(manifest as never, list, read)).toEqual([failure]);
  });

  it('red when one of an ID’s references holds and another does not', () => {
    expect(checkManifest({ A: [{ file: FILE, fullTitle: 'outer runs' }, { file: FILE, fullTitle: 'outer skipped' }] }, list, read))
      .toEqual(['A: "outer skipped" in src/x/__tests__/planted.test.ts is skipped']);
  });

  it('red when the list says jest runs a file that cannot be read', () => {
    expect(checkManifest({ A: [{ file: 'src/y/__tests__/other.test.ts', fullTitle: 'x' }] }, list, read))
      .toEqual(['A: src/y/__tests__/other.test.ts cannot be read']);
  });
});

describe('parseListTests (D8 rule 1: a spawned list is refused unless it is a real list)', () => {
  const abs = (rel: string) => path.join(APP_ROOT, rel);
  const real = [abs('src/testing/__tests__/contracts.test.ts'), abs('src/testing/__tests__/mutant.test.ts')];
  const ok = { status: 0, stdout: JSON.stringify(real), stderr: '', error: undefined };

  it('returns posix paths relative to the app, sorted', () => {
    expect(parseListTests(ok, APP_ROOT)).toEqual(['src/testing/__tests__/contracts.test.ts', 'src/testing/__tests__/mutant.test.ts']);
  });

  it.each([
    ['a spawn error', { ...ok, error: new Error('ENOENT') }, /did not run/],
    ['a timeout (no status)', { ...ok, status: null }, /exited null/],
    ['a non-zero exit', { ...ok, status: 1 }, /exited 1/],
    ['output that is not JSON', { ...ok, stdout: 'Determining test suites...' }, /no JSON list/],
    ['JSON that is not an array', { ...ok, stdout: '{}' }, /not a list of test files/],
    ['an entry that does not exist', { ...ok, stdout: JSON.stringify([abs('src/nope.test.ts')]) }, /not a list of test files/],
    ['a relative entry', { ...ok, stdout: JSON.stringify(['src/testing/__tests__/mutant.test.ts']) }, /not a list of test files/],
  ])('refuses %s', (_label, result, message) => {
    expect(() => parseListTests(result as never, APP_ROOT)).toThrow(message);
  });
});
