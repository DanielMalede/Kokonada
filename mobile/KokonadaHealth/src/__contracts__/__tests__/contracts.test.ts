/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { CONTRACTS } from '../manifest';
import { APP_ROOT } from '../../testing/guards/productionImports';
import { checkManifest, indexTests, listJestTests, normalizeEol } from '../../testing/guards/contracts';

// QA-040: every contract ID in the manifest has a running test, in a file jest runs. The contracts
// live inside v1 screen tests that a rewrite deletes; this turns that deletion red. The set of files
// jest runs is jest's own answer (`jest --listTests --json`, every project). Planted controls are
// built in memory from the real sources and the real list (D8 rule 2).

const read = (file: string): string | null => {
  const abs = path.join(APP_ROOT, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};
const NOW_PLAYING_TEST = 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx';
const failingIds = (failures: string[]) => [...new Set(failures.map((f) => f.slice(0, f.indexOf(':'))))].sort();

/** The real source of a manifest reference, with its test call changed in memory by `edit`. */
function planted(ref: { file: string; fullTitle: string }, edit: (src: string, call: { calleeEnd: number; titleStart: number; titleEnd: number }) => string): string {
  const src = normalizeEol(read(ref.file) as string);
  const test = indexTests(src, ref.file).find((t) => !t.dynamic && t.fullName === ref.fullTitle);
  if (!test) throw new Error(`planted: ${ref.fullTitle} not found in ${ref.file}`);
  const title = test.call.arguments[0];
  return edit(src, { calleeEnd: test.call.expression.getEnd(), titleStart: title.getStart(), titleEnd: title.getEnd() });
}

describe('QA-040 · every contract ID has a running test', () => {
  let list: string[] = [];
  beforeAll(() => { list = listJestTests(APP_ROOT); }, 150_000);

  it('the inputs are real (an empty list or manifest must fail, not pass)', () => {
    expect(list.length).toBeGreaterThan(180);
    expect(list).toContain('src/__contracts__/__tests__/contracts.test.ts');
    expect(list).toContain('src/design/v2/__tests__/skiaSmoke.skia.test.ts'); // both projects are listed
    const ids = Object.keys(CONTRACTS);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids).toEqual(expect.arrayContaining(['S10-1', 'NP-ATTR', 'M1', 'T8', 'T9', 'T10', 'Fork-4A', 'honest-empty']));
    for (const id of ids) expect([id, CONTRACTS[id].length > 0]).toEqual([id, true]);
  });

  it('every reference names a running, statically titled test in a file jest runs', () => {
    expect(checkManifest(CONTRACTS, list, read)).toEqual([]);
  });

  it('planted: NowPlayingScreen.tsx deleted with its test turns S10-1, NP-ATTR and M1 red', () => {
    const without = list.filter((f) => f !== NOW_PLAYING_TEST);
    expect(without).toHaveLength(list.length - 1);
    const gone = (f: string) => (f === NOW_PLAYING_TEST || f === 'src/experience/playback/NowPlayingScreen.tsx' ? null : read(f));
    expect(failingIds(checkManifest(CONTRACTS, without, gone))).toEqual(['M1', 'NP-ATTR', 'S10-1']);
  });

  it('planted: a referenced test turned it.skip is red', () => {
    const ref = CONTRACTS['S10-1'][0];
    const src = planted(ref, (s, c) => s.slice(0, c.calleeEnd) + '.skip' + s.slice(c.calleeEnd));
    expect(checkManifest({ 'S10-1': [ref] }, list, (f) => (f === ref.file ? src : read(f))))
      .toEqual([`S10-1: ${JSON.stringify(ref.fullTitle)} in ${ref.file} is skipped`]);
  });

  it('planted: a referenced title made dynamic (a template with an expression) is red', () => {
    const ref = CONTRACTS['S10-1'][0];
    const bt = String.fromCharCode(96);
    const src = planted(ref, (s, c) => s.slice(0, c.titleStart) + bt + '${' + JSON.stringify(s.slice(c.titleStart + 1, c.titleEnd - 1)) + '}' + bt + s.slice(c.titleEnd));
    expect(checkManifest({ 'S10-1': [ref] }, list, (f) => (f === ref.file ? src : read(f))))
      .toEqual([`S10-1: ${ref.file} has no test named ${JSON.stringify(ref.fullTitle)}`]);
  });

  it('planted: a manifest file outside the files jest runs is red', () => {
    const ref = { file: 'src/testing/guards/contracts.ts', fullTitle: CONTRACTS.T10[0].fullTitle };
    expect(read(ref.file)).not.toBeNull();
    expect(checkManifest({ T10: [ref] }, list, read)).toEqual(['T10: src/testing/guards/contracts.ts is not among the files jest runs']);
  });
});
