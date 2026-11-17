/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { RETIRE } from '../retire';
import { APP_ROOT } from '../../testing/guards/productionImports';
import { indexTests, listJestTests, normalizeEol } from '../../testing/guards/contracts';
import { readDecStatus } from '../../testing/guards/retire';
import { type FloorBaseline, checkFloor, measureFloor } from '../../testing/guards/testFloor';

// The interim QA-041 floor (D8 rule 6) on the real tree: jest's own list of the files it runs (every
// project), against the baseline measured on a clean origin/main (../test-floor.json). QA-041 proper,
// numTotalTests in CI, waits for its CI step (OPS-412). Planted controls are in memory (D8 rule 2).

const BASELINE: FloorBaseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-floor.json'), 'utf8'));
const read = (file: string): string | null => {
  const abs = path.join(APP_ROOT, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};

describe('QA-041 interim floor · test files and skips never fall silently', () => {
  let list: string[] = [];
  beforeAll(() => { list = listJestTests(APP_ROOT); }, 150_000);

  it('the inputs are real (an empty list or a hollow baseline must fail, not pass)', () => {
    expect(list.length).toBeGreaterThan(180);
    expect(list).toContain('src/__contracts__/__tests__/testFloor.test.ts');
    expect(BASELINE.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(BASELINE.listTestsCount).toBeGreaterThan(180);
    expect(BASELINE.skipCount).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(BASELINE.measuredAt))).toBe(false);
    expect(BASELINE.command).toContain('--listTests');
  });

  it('the floor holds at this head', () => {
    expect(checkFloor(BASELINE, list, read, RETIRE, readDecStatus)).toEqual([]);
  });

  it('planted: one test file gone with no RETIRE entry is red, and green with a valid one', () => {
    const atToday = { ...BASELINE, listTestsCount: list.length, skipCount: measureFloor(list, read).skipCount };
    const gone = 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx';
    const without = list.filter((f) => f !== gone);
    expect(without).toHaveLength(list.length - 1);
    expect(checkFloor(atToday, without, read, RETIRE, readDecStatus)).toHaveLength(1);
    expect(readDecStatus('DEC-091')).toBe('DECIDED');
    expect(checkFloor(atToday, without, read, [...RETIRE, { kind: 'file', target: gone, dec: 'DEC-091', reason: 'planted' }], readDecStatus)).toEqual([]);
    expect(checkFloor(atToday, without, read, [...RETIRE, { kind: 'file', target: gone, dec: 'DEC-039', reason: 'planted' }], readDecStatus))
      .toContain(`RETIRE file ${gone}: DEC-039 is OPEN, not DECIDED`);
  });

  it('planted: one real test turned it.skip in memory is red', () => {
    const now = measureFloor(list, read);
    const file = 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx';
    const src = normalizeEol(read(file) as string);
    const end = indexTests(src, file)[0].call.expression.getEnd();
    const skipped = src.slice(0, end) + '.skip' + src.slice(end);
    const atToday = { ...BASELINE, skipCount: now.skipCount };
    expect(checkFloor(atToday, list, (f) => (f === file ? skipped : read(f)), RETIRE, readDecStatus))
      .toEqual([`${now.skipCount + 1} skip/todo markers (.skip, x*, .todo); the floor allows ${now.skipCount} (baseline at ${BASELINE.sha.slice(0, 12)})`]);
  });
});
