/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { checkPagesBoundary, localPackages, unmodelledResolvers } from '../assertPagesBoundary.mjs';
import { moduleSpecifiers } from '../importGraph.mjs';
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

  it('a resolver the guard does not model stops it (exit 2): babel and metro configs are read against an allowlist (RA-5)', () => {
    expect(unmodelledResolvers({
      babel: "module.exports = { plugins: [['module-resolver', { alias: { '@app': './src' } }]] };",
      metro: 'module.exports = {};',
    })).toEqual(expect.arrayContaining(['babel.config.js names "module-resolver", which is not on its allowlist']));
    expect(unmodelledResolvers({ babel: 'module.exports = {};', metro: 'module.exports = { resolver: { extraNodeModules: {} } };' }))
      .toEqual(['metro.config.js sets extraNodeModules']);
    expect(unmodelledResolvers({ babel: 'module.exports = {};', metro: 'module.exports = { resolver: { resolveRequest: f } };' }))
      .toEqual(['metro.config.js sets resolveRequest']);
    expect(unmodelledResolvers({ babel: 'module.exports = {};', metro: 'module.exports = { resolver: { nodeModulesPaths: [] }, watchFolders: [] };' }))
      .toEqual(['metro.config.js sets nodeModulesPaths', 'metro.config.js sets watchFolders']);
    expect(unmodelledResolvers({ babel: 'module.exports = {};', metro: "const c = require('./other');\nc.resolver.x = 1;\nmodule.exports = c;" }))
      .toEqual(['metro.config.js requires ./other', 'metro.config.js assigns c.resolver.x']);
    expect(unmodelledResolvers({ babel: "module.exports = { plugins: [require('babel-plugin-module-resolver')], env: {} };", metro: '' }))
      .toEqual(['babel.config.js requires babel-plugin-module-resolver', 'babel.config.js sets env']);
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

// The resilience audit of #315 at 87ba175 (RA-1 to RA-7): boundary cases over trees built under os.tmpdir().
const made: string[] = [];
afterAll(() => { for (const r of made) fs.rmSync(r, { recursive: true, force: true }); });

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-boundary-'));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const PAGE = { 'src/pages/alpha/index.tsx': 'export const AlphaPage = () => null;\n' };
const MANIFEST = (extra: object = {}) => JSON.stringify({ private: true, ...extra });
const BASE = { ...PAGE, 'package.json': MANIFEST(), 'App.tsx': 'export default null;\n' };
const withLocal = (pkg: object, files: Record<string, string> = {}) => ({
  'package.json': MANIFEST({ dependencies: { '@fx/shared': 'file:./modules/shared' } }),
  'modules/shared/package.json': JSON.stringify({ private: true, ...pkg }),
  ...files,
});
const DEV_ROOT = './src/design/v2/preview/devRoot.tsx';
const symlinked = () => {
  const root = tree({ ...BASE, 'App.tsx': "export * from './src/shared/alias';\n" });
  fs.mkdirSync(path.join(root, 'src/shared'), { recursive: true });
  fs.symlinkSync(path.join(root, 'src/pages/alpha'), path.join(root, 'src/shared/alias'), 'junction');
  return root;
};

describe('RA-1: the release entry index.js is walked too', () => {
  it('a page that index.js imports beside App is red', () => {
    const r = checkPagesBoundary(tree({ ...BASE, 'index.js': "import App from './App';\nimport './src/pages/alpha';\nexport default App;\n" }));
    expect(r.code).toBe(1);
    expect(r.reached).toEqual([{ page: 'src/pages/alpha/index.tsx', chain: ['index.js', 'src/pages/alpha/index.tsx'] }]);
  });

  it('the devRoot edge inside if (__DEV__) is debug-only, so a page only it reaches is green', () => {
    const r = checkPagesBoundary(tree({ ...BASE,
      'index.js': `import App from './App';\nlet Root = App;\nif (__DEV__) {\n  Root = require('${DEV_ROOT}').withFieldPreview(App);\n}\nexport default Root;\n`,
      'src/design/v2/preview/devRoot.tsx': "export * from '../../../pages/alpha';\n" }));
    expect(r.code).toBe(0);
    expect(r.closure).not.toContain('src/design/v2/preview/devRoot.tsx');
  });

  it('the devRoot edge outside if (__DEV__) is walked, and so is any other edge inside it', () => {
    const files = { ...BASE, 'src/design/v2/preview/devRoot.tsx': "export * from '../../../pages/alpha';\n", 'src/dev/other.ts': "export * from '../pages/alpha';\n" };
    expect(checkPagesBoundary(tree({ ...files, 'index.js': `import App from './App';\nimport '${DEV_ROOT}';\n` })).code).toBe(1);
    expect(checkPagesBoundary(tree({ ...files, 'index.js': "import App from './App';\nif (__DEV__) { require('./src/dev/other'); }\n" })).code).toBe(1);
    expect(checkPagesBoundary(tree({ ...files, 'index.js': `import App from './App';\nif (!__DEV__) { require('${DEV_ROOT}'); }\n` })).code).toBe(1);
    expect(checkPagesBoundary(tree({ ...files, 'index.js': `import App from './App';\nif (__DEV__) {} else { require('${DEV_ROOT}'); }\n` })).code).toBe(1);
  });

  it('the real index.js names no app module beyond App, app.json and the __DEV__ devRoot', () => {
    const file = path.join(APP, 'index.js');
    const rel = moduleSpecifiers(fs.readFileSync(file, 'utf8'), file).filter((s: string) => s.startsWith('.')).sort();
    expect(rel).toEqual(['./App', './app.json', DEV_ROOT]);
    expect(checkPagesBoundary(APP).closure).toContain('index.js');
  });
});

describe('RA-2: a symlink into src/pages', () => {
  it('a page reached through a symlinked directory is red, under its real path', () => {
    const r = checkPagesBoundary(symlinked());
    expect(r.code).toBe(1);
    expect(r.reached.map((x: { page: string }) => x.page)).toEqual(['src/pages/alpha/index.tsx']);
    expect(r.closure).not.toContain('src/shared/alias/index.tsx');
  });
});

describe('RA-3: an exports map behind a subpath', () => {
  it('a subpath import of a local package that has an exports map stops the check', () => {
    const r = checkPagesBoundary(tree(withLocal({ main: 'src/index.ts', exports: { './sub': './src/bridge.ts' } }, {
      ...PAGE,
      'App.tsx': "import '@fx/shared/sub';\n",
      'modules/shared/sub.ts': 'export {};\n',
      'modules/shared/src/index.ts': 'export {};\n',
      'modules/shared/src/bridge.ts': "export * from '../../../src/pages/alpha';\n",
    })));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('exports map');
  });
});

describe('RA-4: the fail-closed exits, end to end', () => {
  it('a local package with an exports map, imported by name, exits 2', () => {
    const r = checkPagesBoundary(tree(withLocal({ main: 'src/index.ts', exports: { '.': './src/index.ts' } }, {
      'App.tsx': "import '@fx/shared';\n", 'modules/shared/src/index.ts': 'export {};\n' })));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('exports map');
  });

  it('a local package whose main names no file exits 2', () => {
    const r = checkPagesBoundary(tree(withLocal({ main: 'src/missing.ts' }, { 'App.tsx': "import '@fx/shared';\n" })));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('resolves to no file');
  });

  it.each([
    ['babel.config.js', "module.exports = { plugins: [['module-resolver', { alias: { '@app': './src' } }]] };\n"],
    ['metro.config.js', 'module.exports = { resolver: { extraNodeModules: {} } };\n'],
    ['metro.config.js', 'module.exports = { resolver: { resolveRequest: () => null } };\n'],
  ])('%s naming an unmodelled resolver exits 2 from checkPagesBoundary itself', (file, body) => {
    const r = checkPagesBoundary(tree({ ...BASE, [file]: body }));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('a resolver this walk does not model');
  });
});

describe('RA-5: resolver forms the walk does not model stop it', () => {
  it.each([
    ['metro nodeModulesPaths', { 'metro.config.js': "module.exports = { resolver: { nodeModulesPaths: [__dirname + '/src'] } };\n" }],
    ['metro resolverMainFields', { 'metro.config.js': "module.exports = { resolver: { resolverMainFields: ['main'] } };\n" }],
    ['metro watchFolders', { 'metro.config.js': 'module.exports = { watchFolders: [] };\n' }],
    ['metro require.context', { 'metro.config.js': 'module.exports = { transformer: { unstable_allowRequireContext: true } };\n' }],
    ['a root .babelrc', { '.babelrc': JSON.stringify({ plugins: [['module-resolver', { alias: { '@p': './src/pages' } }]] }) }],
    ['babel.config.json', { 'babel.config.json': '{}' }],
    ['a metro.config.cjs', { 'metro.config.cjs': 'module.exports = {};\n' }],
    ['a babel key in package.json', { 'package.json': MANIFEST({ babel: { plugins: ['module-resolver'] } }) }],
    ['npm workspaces', { 'package.json': MANIFEST({ workspaces: ['modules/*'] }) }],
    ['a file: peer', { 'package.json': MANIFEST({ peerDependencies: { '@fx/shared': 'file:./modules/shared' } }) }],
    ['a workspace: dependency', { 'package.json': MANIFEST({ dependencies: { '@fx/shared': 'workspace:*' } }) }],
  ])('%s exits 2', (_what, files) => {
    expect(checkPagesBoundary(tree({ ...BASE, ...files })).code).toBe(2);
  });

  it('a local package whose main field is not a string (a browser map) exits 2', () => {
    const r = checkPagesBoundary(tree(withLocal({ browser: { './x.ts': '../../src/pages/alpha/index.tsx' }, main: 'x.ts' }, {
      ...PAGE, 'App.tsx': "import '@fx/shared';\n", 'modules/shared/x.ts': 'export {};\n' })));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('browser');
  });

  it('an absolute specifier exits 2', () => {
    const root = tree({ ...BASE });
    fs.writeFileSync(path.join(root, 'App.tsx'), `export * from ${JSON.stringify(path.join(root, 'src/pages/alpha').split(path.sep).join('/'))};\n`);
    const r = checkPagesBoundary(root);
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('absolute specifier');
  });

  it('a relative import of a directory that has its own package.json exits 2 (Metro reads its main)', () => {
    const r = checkPagesBoundary(tree({ ...BASE, 'App.tsx': "export * from './src/shared/dir';\n",
      'src/shared/dir/package.json': JSON.stringify({ main: '../../pages/alpha/index.tsx' }),
      'src/shared/dir/index.ts': 'export {};\n' }));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('package.json');
  });
});

describe('RA-6: the floor on the walk of the real app', () => {
  it('a tree that does not reach the floor passes without it and exits 2 with it; the real app reaches it', () => {
    const root = tree({ ...BASE });
    expect(checkPagesBoundary(root).code).toBe(0);
    const r = checkPagesBoundary(root, { mustReach: 'src/navigation/AppFlow.tsx' });
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('src/navigation/AppFlow.tsx');
    expect(checkPagesBoundary(APP, { mustReach: 'src/navigation/AppFlow.tsx' }).code).toBe(0);
  });
});

describe('RA-7: mutation pins', () => {
  it('a page under src/Pages/ (another casing) is red', () => {
    expect(checkPagesBoundary(tree({ 'src/Pages/alpha/index.tsx': 'export const A = 1;\n', 'package.json': MANIFEST(),
      'App.tsx': "export * from './src/Pages/alpha';\n" })).code).toBe(1);
  });

  it('a .js page reached through a dynamic import() and a .js module is red', () => {
    const r = checkPagesBoundary(tree({ 'src/pages/alpha/index.js': 'export const AlphaPage = null;\n', 'package.json': MANIFEST(),
      'App.tsx': "export const load = () => import('./src/shared/bridge');\n",
      'src/shared/bridge.js': "module.exports = require('../pages/alpha/index.js');\n" }));
    expect(r.code).toBe(1);
    expect(r.reached.map((x: { page: string }) => x.page)).toEqual(['src/pages/alpha/index.js']);
  });

  it('a local package resolves its react-native field before main', () => {
    expect(checkPagesBoundary(tree(withLocal({ 'react-native': 'rn.ts', main: 'main.ts' }, { ...PAGE,
      'App.tsx': "import '@fx/shared';\n",
      'modules/shared/rn.ts': "export * from '../../src/pages/alpha';\n",
      'modules/shared/main.ts': 'export {};\n' }))).code).toBe(1);
  });

  it('a page only the lab reaches stays green when the page and App.tsx share a module', () => {
    const r = checkPagesBoundary(tree({ 'package.json': MANIFEST(),
      'App.tsx': "import { tint } from './src/shared/theme';\nexport default tint;\n",
      'src/shared/theme.ts': "export const tint = 'abyss';\n",
      'src/pages/alpha/index.tsx': "import { tint } from '../../shared/theme';\nexport const AlphaPage = tint;\n",
      'index.lab.js': "export * from './src/design/lab/LabRoot';\n",
      'src/design/lab/LabRoot.tsx': "export * from '../../pages/alpha';\n" }));
    expect(r.code).toBe(0);
    expect(r.pages).toEqual(['src/pages/alpha/index.tsx']);
  });
});

describe('every hardened boundary kills its mutant', () => {
  // Each mutant plants one weakening of the guard in memory (src/testing/mutant.ts). The tree it names must
  // then get the weaker verdict, which proves that tree's case is what pins the boundary.
  type Case = [string, { find: string; replace: string }, () => string, number, number, { mustReach?: string }?];
  const CASES: Case[] = [
    ['RA-1 index.js not walked', { find: "const ENTRIES = ['App.tsx', 'index.js'];", replace: "const ENTRIES = ['App.tsx'];" },
      () => tree({ ...BASE, 'index.js': "import './src/pages/alpha';\n" }), 1, 0],
    ['RA-1 every __DEV__ edge skipped', { find: 'DEV_ONLY_EDGES.includes(spec) && ', replace: '' },
      () => tree({ ...BASE, 'index.js': "if (__DEV__) { require('./src/pages/alpha'); }\n" }), 1, 0],
    ['RA-2 no realpath', { find: 'const real = (p) => fs.realpathSync.native(p);', replace: 'const real = (p) => p;' }, symlinked, 1, 0],
    ['RA-3 exports refused on the package name only', { find: 'if (manifest.exports !== undefined) throw', replace: 'if (spec === pkg.name && manifest.exports !== undefined) throw' },
      () => tree(withLocal({ exports: { './sub': './sub.ts' } }, { 'App.tsx': "import '@fx/shared/sub';\n", 'modules/shared/sub.ts': 'export {};\n' })), 2, 0],
    ['RA-4 the resolver throw removed', { find: 'if (unmodelled.length) throw', replace: 'if (false) throw' },
      () => tree({ ...BASE, 'metro.config.js': 'module.exports = { resolver: { extraNodeModules: {} } };\n' }), 2, 0],
    ['RA-4 a package that resolves to no file is not refused', { find: 'if (targets.length === 0) throw', replace: 'if (false) throw' },
      () => tree(withLocal({ main: 'src/missing.ts' }, { 'App.tsx': "import '@fx/shared';\n" })), 2, 0],
    ['RA-6 the floor removed', { find: 'if (mustReach && !closure.includes(mustReach)) throw', replace: 'if (false) throw' },
      () => tree({ ...BASE }), 2, 0, { mustReach: 'src/navigation/AppFlow.tsx' }],
    ['RA-7 casing', { find: '/^src\\/pages\\//i', replace: '/^src\\/pages\\//' },
      () => tree({ 'src/Pages/alpha/index.tsx': 'export const A = 1;\n', 'package.json': MANIFEST(), 'App.tsx': "export * from './src/Pages/alpha';\n" }), 1, 0],
    ['RA-7 .js not parsed', { find: 'const PARSED = /\\.(tsx?|jsx?|mjs|cjs)$/;', replace: 'const PARSED = /\\.(tsx?)$/;' },
      () => tree({ ...BASE, 'App.tsx': "import './src/shared/bridge.js';\n", 'src/shared/bridge.js': "require('../pages/alpha');\n" }), 1, 0],
    ['RA-7 main fields reordered', { find: "const MAIN_FIELDS = ['react-native', 'browser', 'main'];", replace: "const MAIN_FIELDS = ['main', 'browser', 'react-native'];" },
      () => tree(withLocal({ 'react-native': 'rn.ts', main: 'main.ts' }, { ...PAGE, 'App.tsx': "import '@fx/shared';\n",
        'modules/shared/rn.ts': "export * from '../../src/pages/alpha';\n", 'modules/shared/main.ts': 'export {};\n' })), 1, 0],
  ];

  // A rest parameter: jest-each hands `done` to a test function with more parameters than a row has values.
  it.each(CASES)('%s', (...row: Case) => {
    const [, mutation, makeTree, realCode, mutantCode, options] = row;
    const root = makeTree();
    const mutant = loadMutant<{ checkPagesBoundary: typeof checkPagesBoundary }>(GUARD, [mutation], require);
    expect(checkPagesBoundary(root, options).code).toBe(realCode);
    expect(mutant.checkPagesBoundary(root, options).code).toBe(mutantCode);
  }, MUTANT_TIMEOUT_MS);
});
