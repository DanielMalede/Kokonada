/// <reference types="node" />
import * as path from 'path';
import { APP_ROOT, SRC_ROOT, TESTING_ROOT, productionFiles, productionImportsOfTesting } from '../guards/productionImports';
import { moduleSpecifiers } from '../guards/sourceFiles';

// Stage 0 Q3, D8 rule 5: src/testing/** is test infrastructure. No production module may import it,
// or a fake ships in the bundle and the app runs on it. The scan reads the real production tree;
// the planted sources below are assembled in memory and never written to disk.

const rel = (f: string) => path.relative(APP_ROOT, f).split(path.sep).join('/');
const quote = String.fromCharCode(39);
const at = (relPath: string) => path.join(APP_ROOT, relPath);

describe('no production module imports src/testing/**', () => {
  const files = productionFiles();

  it('the scan sees the real production tree (a walk that finds nothing must fail, not pass)', () => {
    expect(files.length).toBeGreaterThan(150);
    const seen = files.map(rel);
    expect(seen).toEqual(expect.arrayContaining(['App.tsx', 'index.js', 'src/net/socketClient.ts', 'src/navigation/RootNavigator.tsx']));
    // and it is the production tree: no test file, nothing under src/testing itself
    expect(seen.filter((f) => /__tests__|\.test\.[jt]sx?$/.test(f))).toEqual([]);
    expect(seen.filter((f) => f.startsWith('src/testing/'))).toEqual([]);
  });

  it('the scan reads real imports from those files', () => {
    const specs = moduleSpecifiers("import { KokonadaSocket } from '../net/socketClient';\nconst x = require('react-native');", 'x.ts');
    expect(specs).toEqual(['../net/socketClient', 'react-native']);
  });

  it('no production file imports anything under src/testing', () => {
    expect(productionImportsOfTesting(files)).toEqual([]);
  });

  // Planted: every way a module names another, aimed at src/testing from a production path.
  it.each([
    ['src/net/planted.ts', 'import { installPlatformFakes } from ', '../testing/platform', ';'],
    ['src/net/planted.ts', 'export * from ', '../testing/faces', ';'],
    ['src/experience/generate/planted.tsx', 'const f = require(', '../../testing/socket', ');'],
    ['src/planted.ts', 'const lazy = import(', './testing', ');'],
    ['App.planted.tsx', 'import ', './src/testing/motion', ';'],
  ])('flags a planted production import of src/testing (%s: %s%s)', (file, before, spec, after) => {
    const source = before + quote + spec + quote + after;
    expect(productionImportsOfTesting([at(file)], () => source)).toEqual([`${file} -> ${spec}`]);
  });

  it('does not flag a sibling whose name only starts with "testing", or a package', () => {
    const source = [
      'import a from ' + quote + '../testingNotes' + quote + ';',
      'import b from ' + quote + 'testing-library' + quote + ';',
      'import c from ' + quote + '../net/socketClient' + quote + ';',
    ].join('\n');
    expect(productionImportsOfTesting([at('src/experience/planted.ts')], () => source)).toEqual([]);
  });

  it('pins its own roots', () => {
    expect(rel(SRC_ROOT)).toBe('src');
    expect(rel(TESTING_ROOT)).toBe('src/testing');
  });
});
