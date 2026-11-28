/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { checkPagesBoundary, localPackages, unmodelledResolvers } from '../assertPagesBoundary.mjs';
import { loadMutant } from '../../../src/testing/mutant';

// OPS-506. Batch pages (DEC-192, BATCH MODE) are built under src/pages/ and stay lab-only until their
// cutover: the release root App.tsx must not reach any of them, by a relative import or through a local
// package's name. These cases run the guard over fixture trees, then over the real tree, which is what
// makes "runs in CI" true: CI's jest shards run every suite under scripts/lab/__tests__.

const APP = path.resolve(__dirname, '../../..');
const GUARD = path.join(APP, 'scripts/lab/assertPagesBoundary.mjs');
const FIXTURES = path.join(APP, 'scripts/lab/__fixtures__/pagesBoundary');
const fixture = (name: string) => path.join(FIXTURES, name);

// Planting a mutant loads @babel/core inside the test VM on first use (src/testing/mutant.ts).
const MUTANT_TIMEOUT_MS = 30000;

describe('the guard over fixture trees', () => {
  it('a clean tree, with a page on disk that the release graph does not reach, is green', () => {
    const r = checkPagesBoundary(fixture('clean'));
    expect(r.code).toBe(0);
    expect(r.pages).toEqual(['src/pages/alpha/index.tsx']);
    expect(r.closure).toEqual(['App.tsx', 'src/navigation/AppFlow.tsx', 'src/shared/theme.ts']);
    expect(r.lines.join('\n')).toContain('reaches none of the 1 batch page file(s)');
  });

  it('a tree with no src/pages/ is green, and says that no page entry exists', () => {
    const r = checkPagesBoundary(fixture('noPages'));
    expect(r.code).toBe(0);
    expect(r.pages).toEqual([]);
    expect(r.lines.join('\n')).toContain('no batch page entry exists under src/pages/');
  });

  it('a page reached through a planted relative import in a shared module is red, with its import chain', () => {
    const r = checkPagesBoundary(fixture('plantedRelative'));
    expect(r.code).toBe(1);
    expect(r.reached).toEqual([
      { page: 'src/pages/alpha/parts/card.ts', chain: ['App.tsx', 'src/navigation/AppFlow.tsx', 'src/shared/theme.ts', 'src/pages/alpha/parts/card.ts'] },
    ]);
    expect(r.lines.join('\n')).toContain('App.tsx -> src/navigation/AppFlow.tsx -> src/shared/theme.ts -> src/pages/alpha/parts/card.ts');
  });

  it('a page reached through a local package name (a file: dependency) is red', () => {
    const r = checkPagesBoundary(fixture('plantedAlias'));
    expect(r.code).toBe(1);
    expect(r.reached).toEqual([
      { page: 'src/pages/alpha/index.tsx', chain: ['App.tsx', 'modules/shared/src/index.ts', 'src/pages/alpha/index.tsx'] },
    ]);
  });

  it('a page reached only through the Design Lab route (index.lab.js and src/design/lab/) is green', () => {
    const r = checkPagesBoundary(fixture('labRoute'));
    expect(r.code).toBe(0);
    expect(r.pages).toEqual(['src/pages/alpha/index.tsx']);
    expect(r.closure).not.toContain('src/design/lab/LabRoot.tsx');
  });

  it('a tree whose App.tsx is missing is red (exit 2), never a vacuous pass', () => {
    const r = checkPagesBoundary(fixture('missingApp'));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toMatch(/could not run: .*App\.tsx/);
  });

  it('a tree with no package.json is red (exit 2): its local packages, and so its aliased edges, are unknown', () => {
    const r = checkPagesBoundary(fixture('noManifest'));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toMatch(/could not run: .*package\.json/);
  });
});

describe('the aliases the guard follows are the ones Metro resolves', () => {
  it('the real app maps its file: dependencies, @kokonada/spotify-remote among them, to their package folders', () => {
    expect(localPackages(APP)).toEqual([
      { name: '@kokonada/spotify-remote', dir: 'modules/spotify-remote' },
      { name: 'eslint-plugin-kokonada', dir: 'tools/eslint-plugin-kokonada' },
    ]);
  });

  it('a resolver the guard does not model stops it (exit 2) instead of letting an edge go unseen', () => {
    expect(unmodelledResolvers({
      babel: "module.exports = { plugins: [['module-resolver', { alias: { '@app': './src' } }]] };",
      metro: 'module.exports = {};',
    })).toEqual(['babel.config.js names module-resolver']);
    expect(unmodelledResolvers({ babel: 'module.exports = {};', metro: 'resolver: { extraNodeModules: {} }' }))
      .toEqual(['metro.config.js names extraNodeModules']);
    expect(unmodelledResolvers({ babel: 'module.exports = {};', metro: 'resolver: { resolveRequest: f }' }))
      .toEqual(['metro.config.js names resolveRequest']);
    expect(unmodelledResolvers({
      babel: fs.readFileSync(path.join(APP, 'babel.config.js'), 'utf8'),
      metro: fs.readFileSync(path.join(APP, 'metro.config.js'), 'utf8'),
    })).toEqual([]);
  });

  it('a mutant that ignores aliases passes the planted alias, so the red case above kills it', () => {
    const mutant = loadMutant<{ checkPagesBoundary: typeof checkPagesBoundary }>(GUARD, [
      { find: ': resolveAlias(packages, spec)', replace: ': []' },
    ], require);
    expect(mutant.checkPagesBoundary(fixture('plantedRelative')).code).toBe(1); // the mutant still walks
    expect(mutant.checkPagesBoundary(fixture('plantedAlias')).code).toBe(0); // and misses the aliased page
  }, MUTANT_TIMEOUT_MS);
});

describe('the guard over the real tree (CI runs this suite in its jest shards)', () => {
  const r = checkPagesBoundary(APP);

  it('walks the real app, through its local package, and reaches no batch page', () => {
    expect(r.closure).toContain('src/navigation/AppFlow.tsx');
    expect(r.closure).toContain('modules/spotify-remote/src/index.ts');
    expect(r.closure.length).toBeGreaterThan(100);
    expect(r.reached).toEqual([]);
    expect(r.code).toBe(0);
  });

  it('the CLI exits 0 on the real tree, 1 on a planted import and 2 on a missing App.tsx', () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [GUARD, ...args], { cwd: APP, encoding: 'utf8' });
    const real = run();
    expect(real.status).toBe(0);
    expect(real.stdout).toContain('App.tsx');
    expect(run('--root', fixture('plantedRelative')).status).toBe(1);
    expect(run('--root', fixture('missingApp')).status).toBe(2);
    expect(run('--bogus').status).toBe(2);
  });
});
