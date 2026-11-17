/// <reference types="node" />
import * as path from 'path';
import ts from 'typescript';
import { APP_ROOT } from '../../../src/testing/guards/productionImports';
import { loadTsConfig } from '../../../src/testing/guards/tsProgram';
import { diagnosticMultiset, measureFullProject, ratchetFailures, readBaseline, validateBaseline } from '../fullTsc';

// QA-043, full-project half (Stage 0 Q2). The whole tsconfig project is type-checked in-process and its
// diagnostics, as a (file, TS code) -> count multiset, must EXACTLY equal scripts/tsc/tsc-baseline.json.
// Nothing is filtered by path. A new error fails; so does a fixed one, because the baseline only shrinks
// and is shrunk on purpose (OPS-022, OPS-421). Planted controls are in-memory overlays.

const TIMEOUT = 120_000;
const at = (rel: string) => path.join(APP_ROOT, rel);
const parsed = loadTsConfig();
const read = (rel: string) => ts.sys.readFile(at(rel))!;

describe('QA-043 · the full-project tsc ratchet', () => {
  it('the baseline file has the recorded shape', () => {
    const baseline = readBaseline();
    expect(baseline.typescript).toBe(ts.version);
    expect(baseline.total).toBe(Object.values(baseline.diagnostics).reduce((a, b) => a + b, 0));
    expect(() => validateBaseline({ ...baseline, total: baseline.total + 1 })).toThrow(/total/);
    expect(() => validateBaseline({ ...baseline, diagnostics: { 'src/x.ts|TS0': 0 } })).toThrow(/count/);
    expect(() => validateBaseline({ ...baseline, diagnostics: { 'src/x.ts': 1 } })).toThrow(/key/);
  });

  it('counts every diagnostic of the program (none filtered), keyed by file and code', () => {
    const planted = [
      { file: undefined, code: 5023 },
      { file: { fileName: at('src/a.ts') }, code: 2322 },
      { file: { fileName: at('src/a.ts') }, code: 2322 },
      { file: { fileName: at('src/b.tsx') }, code: 7006 },
    ] as unknown as ts.Diagnostic[];
    expect(diagnosticMultiset(planted)).toEqual({ '<global>|TS5023': 1, 'src/a.ts|TS2322': 2, 'src/b.tsx|TS7006': 1 });
  });

  it('planted: a baseline measured by another TypeScript version fails, even with equal counts (a compiler bump re-records)', () => {
    const baseline = readBaseline();
    const failures = ratchetFailures(baseline.diagnostics, { ...baseline, typescript: '0.0.1' });
    expect(failures[0]).toBe(`the baseline was measured with TypeScript 0.0.1, this is ${ts.version}`);
    expect(ratchetFailures(baseline.diagnostics, baseline)).toEqual([]);
  });

  it('the whole project matches the baseline exactly', () => {
    const measured = measureFullProject(parsed);
    console.log(`full tsc (TypeScript ${ts.version}): ${measured.rootCount} root files, ${measured.diagnostics.length} diagnostics in `
      + `${new Set(Object.keys(measured.multiset).map((k) => k.split('|')[0])).size} files\n${JSON.stringify(measured.multiset, null, 2)}`);
    expect(measured.rootCount).toBeGreaterThan(300);
    expect(Object.values(measured.multiset).reduce((a, b) => a + b, 0)).toBe(measured.diagnostics.length);
    expect(ratchetFailures(measured.multiset, readBaseline())).toEqual([]);
  }, TIMEOUT);

  it('planted: one token key renamed in src/design/tokens.ts (in memory) fails the ratchet', () => {
    const tokens = read('src/design/tokens.ts');
    expect(tokens.match(/\bcanvasTop\b/g)!.length).toBeGreaterThanOrEqual(3);
    const measured = measureFullProject(parsed, { [at('src/design/tokens.ts')]: tokens.replace(/\bcanvasTop\b/g, 'canvasTopRenamed') });
    const failures = ratchetFailures(measured.multiset, readBaseline());
    expect(failures.join('\n')).toMatch(/new: src\/experience\/aurora\/LivingAurora\.tsx\|TS2339/);
  }, TIMEOUT);

  it('planted: the blePermissions.ts:57 error removed (in memory) fails the ratchet: a fix shrinks the baseline', () => {
    const ble = read('src/health/blePermissions.ts');
    const fixed = ble.replace('result[p] === PermissionsAndroid.RESULTS.GRANTED', '(result as Record<string, string>)[p] === PermissionsAndroid.RESULTS.GRANTED');
    expect(fixed).not.toBe(ble);
    const measured = measureFullProject(parsed, { [at('src/health/blePermissions.ts')]: fixed });
    const failures = ratchetFailures(measured.multiset, readBaseline());
    expect(failures.join('\n')).toMatch(/fixed: src\/health\/blePermissions\.ts\|TS7053 \(1 -> 0\)/);
    expect(failures.join('\n')).toMatch(/re-record/);
  }, TIMEOUT);
});
