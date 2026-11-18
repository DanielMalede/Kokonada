/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { appSources, importsOf, resolveRelative } from '../../lab/importGraph.mjs';

// The field preview (src/design/v2/preview/) is debug-only: it must be ABSENT from every release bundle,
// not merely unreachable in it. Two facts make that so, and each is pinned here:
//   1. index.js is its only way in: no module outside src/design/v2/preview/ imports it but index.js;
//   2. index.js reaches it only inside `if (__DEV__)`: Metro's own transform of index.js, with this app's
//      config and transform options and dev false (the release Gradle task's --dev false), collects no
//      dependency in it, while dev true does (the positive control: a transform that never sees the
//      preview would prove nothing). A planted index.js that requires it unguarded is caught.

const APP = path.resolve(__dirname, '../../..');
const PREVIEW = 'src/design/v2/preview/';
const rel = (f: string) => path.relative(APP, f).split(path.sep).join('/');
const INDEX = fs.readFileSync(path.join(APP, 'index.js'), 'utf8');

/** The specifiers Metro collects from `source` as index.js, transformed with dev on or off. */
function metroDeps(source: string, dev: boolean): string[] {
  const r = spawnSync(process.execPath, [path.join(APP, 'scripts/jest/metroDeps.mjs'), APP, 'index.js', String(dev)], {
    cwd: APP, input: source, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`metroDeps.mjs failed (${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout) as string[];
}
const intoPreview = (specs: string[]) =>
  specs.flatMap((s) => resolveRelative(path.join(APP, 'index.js'), s)).map(rel).filter((f) => f.startsWith(PREVIEW));

describe('the release bundle holds no field preview', () => {
  const debug = metroDeps(INDEX, true);
  const release = metroDeps(INDEX, false);

  it('positive control: the debug transform of index.js depends on the preview\'s root swap, and on App', () => {
    expect(intoPreview(debug)).toEqual(['src/design/v2/preview/devRoot.tsx']);
    expect(debug).toContain('./App');
  });

  it('the release transform of index.js (dev false) collects nothing under src/design/v2/preview/, and still App', () => {
    expect(intoPreview(release)).toEqual([]);
    expect(release).toContain('./App');
  });

  it('planted: an index.js that requires the preview outside __DEV__ is caught', () => {
    const planted = `${INDEX}\nrequire('./src/design/v2/preview/devRoot.tsx');\n`;
    expect(intoPreview(metroDeps(planted, false))).toEqual(['src/design/v2/preview/devRoot.tsx']);
  });
});

describe('index.js is the preview\'s only way in', () => {
  const importers = (edges: Array<{ from: string; to: string }>) =>
    edges.filter((e) => e.to.startsWith(PREVIEW) && !e.from.startsWith(PREVIEW)).map((e) => e.from);
  const edges = appSources(APP).flatMap((from: string) => importsOf(from).map((to: string) => ({ from: rel(from), to: rel(to) })));

  it('the scan sees the real tree and the one real edge in', () => {
    expect(edges.length).toBeGreaterThan(500);
    expect(importers(edges)).toContain('index.js');
  });

  it('no module outside the preview imports it but index.js', () => {
    expect([...new Set(importers(edges))]).toEqual(['index.js']);
  });

  it('planted: another importer is flagged', () => {
    expect(importers([...edges, { from: 'src/navigation/AppFlow.tsx', to: `${PREVIEW}FieldPreview.tsx` }])).toContain('src/navigation/AppFlow.tsx');
  });
});
