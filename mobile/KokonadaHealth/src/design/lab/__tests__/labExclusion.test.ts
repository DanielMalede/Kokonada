/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { importClosure, labImporters, labModules, moduleSpecifiers } from '../../../../scripts/lab/importGraph.mjs';

// MB-084 · QA-077 · Apple 2.3.1(a) with 2.2 · Play Deceptive Behavior. The Design Lab must be
// ABSENT from every build that can be uploaded, not merely unreachable in it. That is decided by
// structure: the release entry (index.js) never imports the lab, and the lab has its own entry
// (index.lab.js), its own Android build type and its own package. These static checks pin the JS
// half; scripts/lab/assertLabExcluded.mjs proves it again on a real Metro + Hermes release bundle.

const APP = path.resolve(__dirname, '../../../..');
const rel = (f: string) => path.relative(APP, f).split(path.sep).join('/');

describe('the import scan sees every way a module reaches another', () => {
  // A form the scan misses is an edge it cannot see, and a missed edge is a false green.
  it.each([
    ['import ... from', "import { a } from './m';", './m'],
    ['a side-effect import', "import './m';", './m'],
    ['export ... from', "export { a } from './m';", './m'],
    ['export * from', "export * from './m';", './m'],
    ['import type', "import type { A } from './m';", './m'],
    ['require()', "const m = require('./m');", './m'],
    ['a dynamic import()', "const m = import('./m');", './m'],
    ['import x = require()', "import m = require('./m');", './m'],
    ['an import type node', "type T = typeof import('./m');", './m'],
  ])('%s', (_form, source, spec) => {
    expect(moduleSpecifiers(source, 'f.ts')).toEqual([spec]);
  });

  it('a quote in JSX text does not hide a require() that follows it', () => {
    const source = "const A = () => <Text>Don't stop</Text>;\nconst m = require('./m');";
    expect(moduleSpecifiers(source, 'f.tsx')).toEqual(['./m']);
  });
});

describe('the release entry never reaches the Design Lab (MB-084)', () => {
  const closure = importClosure(path.join(APP, 'index.js')).map(rel);

  it('the closure follows the real app (a scan that finds nothing must fail, not pass)', () => {
    expect(closure).toContain('App.tsx');
    expect(closure).toContain('src/navigation/AppFlow.tsx');
    expect(closure.length).toBeGreaterThan(100);
  });

  it('the import closure of index.js holds no module under src/design/lab/ and not index.lab.js', () => {
    expect(labModules(APP, closure.map((f) => path.join(APP, f)))).toEqual([]);
  });

  it('a planted import of the lab is found: the check bites', () => {
    const planted = importClosure(path.join(APP, 'scripts/lab/__fixtures__/sentinelEntry.js'));
    expect(labModules(APP, planted)).toEqual(['src/design/lab/sentinel.ts']);
  });
});

describe('nothing outside the lab imports it', () => {
  // The lab may be reached only from inside itself, from its own entry, and from its own tooling
  // (scripts/lab, which holds the planted fixture above). v2 is "outside" like every other folder:
  // the foundations never depend on the lab that exercises them.
  const ALLOWED = (f: string) => f.startsWith('src/design/lab/') || f === 'index.lab.js' || f.startsWith('scripts/lab/');

  it('every import edge into the lab starts inside the lab, its entry or its tooling', () => {
    const edges = labImporters(APP).map(({ from, to }: { from: string; to: string }) => ({ from: rel(from), to: rel(to) }));
    expect(edges.filter((e: { from: string }) => !ALLOWED(e.from))).toEqual([]);
  });

  it('the edge scan sees the planted importer (an edge scan that finds nothing must fail, not pass)', () => {
    const edges = labImporters(APP).map(({ from }: { from: string }) => rel(from));
    expect(edges).toContain('scripts/lab/__fixtures__/sentinelEntry.js');
  });
});

describe('the lab has its own entry and its own Android activity', () => {
  const ACTIVITY = path.join(APP, 'android/app/src/lab/java/com/kokonadahealth/lab/DesignLabActivity.kt');

  it('index.lab.js reaches the sentinel, so the lab bundle carries it (the positive control needs it)', () => {
    expect(labModules(APP, importClosure(path.join(APP, 'index.lab.js')))).toContain('src/design/lab/sentinel.ts');
  });

  it('index.lab.js registers exactly the component the lab activity launches, never the real app', () => {
    const entry = fs.readFileSync(path.join(APP, 'index.lab.js'), 'utf8');
    const registered = [...entry.matchAll(/registerComponent\(\s*'([^']+)'/g)].map((m) => m[1]);
    const launched = fs.readFileSync(ACTIVITY, 'utf8').match(/getMainComponentName\(\): String = "([^"]+)"/)?.[1];
    expect(registered).toEqual([launched]);
    expect(launched).not.toBe(JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8')).name);
  });

  it('lab Android code lives only in the lab source set, and no Gradle file points another source set at it', () => {
    const ANDROID = path.join(APP, 'android');
    const SKIP = new Set(['build', '.gradle', '.cxx', '.idea']);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full); } else if (/\.(kt|java|xml|gradle|kts|properties|pro)$/.test(e.name)) files.push(full);
      }
    };
    walk(ANDROID);
    expect(files.map(rel)).toContain('android/app/src/main/AndroidManifest.xml'); // the walk sees the real tree
    const naming = files.filter((f) => /DesignLabActivity|kokonadahealth[./]lab\b/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(naming.filter((f) => !f.startsWith('android/app/src/lab/'))).toEqual([]);
    expect(naming).toContain('android/app/src/lab/AndroidManifest.xml');
    const gradle = files.filter((f) => /\.(gradle|kts)$/.test(f)).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n'));
    expect(gradle.filter((line) => /srcDirs?\b/.test(line) && /\blab\b/.test(line))).toEqual([]);
  });
});
