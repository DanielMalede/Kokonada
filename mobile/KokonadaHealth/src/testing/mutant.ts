/// <reference types="node" />
// In-memory planted mutants of production code (D8 rule 2: nothing planted is written under src/).
//
// A pass rule like "a planted removal of runOnJS(commitTap) fails" (QA-089/QA-110) needs the REAL
// module with one line changed. loadMutant reads the real source, applies exact find/replace
// mutations, compiles the result with the app's own babel config (the same presets and the worklets
// plugin jest uses), and evaluates it with a require that resolves the module's relative imports to
// the original files through the caller's jest registry, so every dependency is the same instance the
// test already holds, mocks included. Nothing touches the disk.

import * as fs from 'fs';
import * as path from 'path';
import { APP_ROOT } from './guards/productionImports';

export interface Mutation { find: string; replace: string }

const occurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n += 1;
  return n;
};

/**
 * Load `file` (absolute) with `mutations` applied. `req` is the caller's `require` (jest's), so the
 * mutant shares the caller's module registry. Each mutation must match exactly once.
 */
export function loadMutant<T = Record<string, any>>(file: string, mutations: Mutation[], req: (id: string) => unknown): T {
  let source = fs.readFileSync(file, 'utf8');
  for (const m of mutations) {
    const n = occurrences(source, m.find);
    if (n !== 1) throw new Error(`loadMutant: the mutation ${JSON.stringify(m.find)} matches ${n} times in ${path.relative(APP_ROOT, file)} (it must match exactly once).`);
    source = source.replace(m.find, m.replace);
  }
  // Required lazily: only a test that plants a mutant pays for loading babel.
  const babel = require('@babel/core') as typeof import('@babel/core');
  const out = babel.transformSync(source, {
    filename: file,
    cwd: APP_ROOT,
    root: APP_ROOT,
    configFile: path.join(APP_ROOT, 'babel.config.js'),
    babelrc: false,
    envName: 'test',
    sourceType: 'module',
  });
  if (!out?.code) throw new Error(`loadMutant: babel produced no code for ${file}`);
  const dir = path.dirname(file);
  const localRequire = (spec: string) => req(spec.startsWith('.') ? path.resolve(dir, spec) : spec);
  const module = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func -- evaluates the compiled mutant in memory (D8 rule 2)
  const run = new Function('require', 'module', 'exports', '__filename', '__dirname', out.code);
  run(localRequire, module, module.exports, file, dir);
  return module.exports as T;
}
