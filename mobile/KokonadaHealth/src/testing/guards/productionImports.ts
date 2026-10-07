/// <reference types="node" />
// D8 rule 5 (Stage 0 Q3): no production module imports src/testing/**. The fakes and harnesses there
// replace native modules and platform APIs; one reachable from the bundle would make the app run on a
// fake. "Production" is everything the bundle can reach: src/** outside the tests and outside
// src/testing, the app entry files, and the local native modules' JS.

import * as fs from 'fs';
import * as path from 'path';
import { isTestFile, moduleSpecifiers, readSource, walkSources } from './sourceFiles';

export const APP_ROOT = path.resolve(__dirname, '../../..');
export const SRC_ROOT = path.join(APP_ROOT, 'src');
export const TESTING_ROOT = path.join(SRC_ROOT, 'testing');

const ENTRY = /^(App\.tsx|index(\.[a-z]+)?\.js)$/;
const inside = (root: string, file: string) => {
  const r = path.relative(root, file);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

/** The production sources: src/** (minus tests and src/testing), App.tsx, index*.js, modules/<name>/src/**. */
export function productionFiles(): string[] {
  const src = walkSources(SRC_ROOT).filter((f) => !isTestFile(f) && !inside(TESTING_ROOT, f));
  const entries = fs.readdirSync(APP_ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && ENTRY.test(e.name))
    .map((e) => path.join(APP_ROOT, e.name));
  const modulesDir = path.join(APP_ROOT, 'modules');
  const modules = fs.existsSync(modulesDir)
    ? fs.readdirSync(modulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(modulesDir, e.name, 'src')))
      .flatMap((e) => walkSources(path.join(modulesDir, e.name, 'src')).filter((f) => !isTestFile(f)))
    : [];
  return [...entries, ...src, ...modules].sort();
}

/** Each `file -> specifier` whose relative import resolves into src/testing. */
export function productionImportsOfTesting(files: string[], read: (file: string) => string = readSource): string[] {
  const rel = (f: string) => path.relative(APP_ROOT, f).split(path.sep).join('/');
  return files.flatMap((file) => moduleSpecifiers(read(file), file)
    .filter((spec) => spec.startsWith('.') && inside(TESTING_ROOT, path.resolve(path.dirname(file), spec)))
    .map((spec) => `${rel(file)} -> ${spec}`));
}
