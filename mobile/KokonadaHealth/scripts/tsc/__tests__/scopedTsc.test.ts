/// <reference types="node" />
import * as path from 'path';
import ts from 'typescript';
import { APP_ROOT } from '../../../src/testing/guards/productionImports';
import { loadTsConfig } from '../../../src/testing/guards/tsProgram';
import { BOUNDARIES, candidateRoots, EXCLUDED_ROOTS, runScopedTsc, scopedFailures, STAGE0_ROOT_DIRS, type ScopedResult } from '../scopedTsc';

// QA-043, scoped half (Stage 0 Q2, D8 rules 1 and 4). Every file under the Stage 0 trees on main, tests
// included, is type-checked in-process with the project's own options, and the diagnostics must be empty,
// unfiltered. The boundary is on the INPUTS: a root whose import closure enters src/health (until OPS-022)
// or src/design/v2 (held by #234's live claim) is left out only through a pinned, exact list, each entry
// with the boundaries it crosses; nothing is ever dropped from the diagnostics. Planted controls are
// in-memory overlays.

const TIMEOUT = 60_000;
const at = (rel: string) => path.join(APP_ROOT, rel);
const parsed = loadTsConfig();
const read = (rel: string) => ts.sys.readFile(at(rel))!;

describe('QA-043 · scoped tsc over the Stage 0 trees', () => {
  it('the roots are every file under the Stage 0 trees, tests included (an empty root set must fail, not pass)', () => {
    expect(STAGE0_ROOT_DIRS).toEqual(['src/testing', 'scripts/tsc']);
    const roots = candidateRoots(parsed);
    expect(roots.length).toBeGreaterThan(30);
    expect(roots).toEqual(expect.arrayContaining([
      'src/testing/backdrop.ts', 'src/testing/__tests__/backdrop.test.tsx', 'src/testing/guards/tsProgram.ts',
      'scripts/tsc/scopedTsc.ts', 'scripts/tsc/__tests__/scopedTsc.test.ts',
    ]));
    expect(roots.every((r) => STAGE0_ROOT_DIRS.some((d) => r.startsWith(`${d}/`)))).toBe(true);
  });

  it('every pinned exclusion names known boundaries, and every boundary carries its reason', () => {
    const ids = BOUNDARIES.map((b) => b.id);
    expect(ids).toEqual(['src/health/', 'src/design/v2/', 'src/experience/profile/profileServices.ts']);
    for (const b of BOUNDARIES) expect(b.reason.length).toBeGreaterThan(20);
    for (const crossed of Object.values(EXCLUDED_ROOTS)) {
      expect(crossed.length).toBeGreaterThan(0);
      for (const id of crossed) expect(ids).toContain(id);
    }
  });

  it('exits clean: zero diagnostics (unfiltered), a closure clear of every boundary, an exact exclusion list', () => {
    const result = runScopedTsc({ parsed });
    console.log([
      `scoped tsc (TypeScript ${ts.version}): ${result.admitted.length} admitted roots of ${result.candidates.length}; `
        + `${result.closure.length} project files in the closure; ${result.diagnostics.length} diagnostics`,
      `excluded roots: ${JSON.stringify(EXCLUDED_ROOTS, null, 2)}`,
      `closure (sorted):\n  ${result.closure.join('\n  ')}`,
    ].join('\n'));
    expect(result.admitted.length).toBeGreaterThan(20);
    expect(result.closure.length).toBeGreaterThan(result.admitted.length);
    expect(scopedFailures(result)).toEqual([]);
  }, TIMEOUT);

  it('planted: contrastRatio renamed in src/design/contrast.ts (in memory) fails, through backdrop.ts', () => {
    const contrast = read('src/design/contrast.ts');
    expect(contrast).toContain('export function contrastRatio(');
    const result = runScopedTsc({ parsed, overlay: { [at('src/design/contrast.ts')]: contrast.replace('export function contrastRatio(', 'export function contrastRatioRenamed(') } });
    const failures = scopedFailures(result);
    expect(failures.join('\n')).toMatch(/src\/testing\/backdrop\.ts\(\d+,\d+\): error TS\d+/);
  }, TIMEOUT);

  it('planted: a type error inside the closure but outside the roots (src/design/contrast.ts, in memory) is reported, unfiltered', () => {
    const contrast = read('src/design/contrast.ts');
    const result = runScopedTsc({ parsed, overlay: { [at('src/design/contrast.ts')]: `${contrast}\nexport const planted: number = 'not a number';\n` } });
    expect(scopedFailures(result).join('\n')).toMatch(/src\/design\/contrast\.ts\(\d+,\d+\): error TS2322/);
  }, TIMEOUT);

  it('planted: an admitted root importing the health lane (in memory) turns the boundary assertion red', () => {
    const backdrop = read('src/testing/backdrop.ts');
    const result = runScopedTsc({ parsed, overlay: { [at('src/testing/backdrop.ts')]: `import '../health/blePermissions';\n${backdrop}` } });
    const failures = scopedFailures(result).join('\n');
    expect(failures).toMatch(/admitted root src\/testing\/backdrop\.ts crosses src\/health\//);
    expect(failures).toMatch(/the scoped program enters src\/health\/: src\/health\/blePermissions\.ts/);
  }, TIMEOUT);

  it('planted: an excluded root that no longer crosses its boundary is a stale exclusion', () => {
    const result = runScopedTsc({ parsed, overlay: { [at('src/testing/__tests__/permissions.test.ts')]: 'export {};\n' } });
    expect(scopedFailures(result).join('\n')).toMatch(/exclusion of src\/testing\/__tests__\/permissions\.test\.ts is stale: pinned \["src\/health\/"\], crosses \[\]/);
  }, TIMEOUT);

  it('planted (synthetic result): a file the program loaded that no recorded edge reaches fails, so crossings are never judged on a partial graph', () => {
    const clean: ScopedResult = {
      candidates: ['src/testing/a.ts'], admitted: ['src/testing/a.ts'], excluded: {}, crossings: {},
      closure: ['src/testing/a.ts'], diagnostics: [], boundaryFiles: [], unreached: [],
    };
    expect(scopedFailures(clean)).toEqual([]);
    expect(scopedFailures({ ...clean, closure: [...clean.closure, 'src/design/x.ts'], unreached: ['src/design/x.ts'] }))
      .toEqual(['the recorded import edges miss files the program loaded: src/design/x.ts']);
  });

  it('planted: a pinned exclusion naming no root is a stale exclusion', () => {
    const result = runScopedTsc({ parsed, excluded: { ...EXCLUDED_ROOTS, 'src/testing/__tests__/gone.test.ts': ['src/health/'] } });
    expect(scopedFailures(result)).toContain('exclusion of src/testing/__tests__/gone.test.ts is stale: no such root');
  }, TIMEOUT);

  it('planted: an empty root set fails', () => {
    expect(() => runScopedTsc({ parsed, roots: [] })).toThrow(/no roots/);
  });
});
