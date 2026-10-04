// The static import graph of the app's JS/TS, as Metro would follow it, for the Design Lab
// exclusion checks (MB-084).
//
//   · Only RELATIVE specifiers are followed. A bare specifier is a package under node_modules,
//     which is not app code and cannot import the lab.
//   · Every file is parsed by the TypeScript compiler (a real parser, so a quote inside JSX text
//     cannot hide an import from a regex), and every form that reaches a module counts:
//     import/export ... from, import 'x', import type, require('x'), import('x'), import x = require('x').
//   · A specifier resolves across EVERY platform the app builds for (android, ios, native, plain),
//     so a module reachable only on iOS still counts.
//
// Over-including is the safe direction for an exclusion check: an edge that does not exist can
// only make it stricter, while a missed edge would be a false green.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const PLATFORMS = ['android', 'ios', 'native'];
const EXTENSIONS = ['tsx', 'ts', 'jsx', 'js', 'mjs', 'cjs', 'json'];
const PARSED = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// Dependencies and build outputs are never app source. The native project folders are skipped too,
// but only outside src/: a JS folder that happens to be called `android` inside src/ is app code.
const SKIP_ALWAYS = new Set(['node_modules', 'build', '.gradle', '.cxx', 'coverage', '.bundle', 'Pods', '.git']);
const NATIVE_DIRS = new Set(['android', 'ios']);

const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

const kindOf = (file) => ({
  '.tsx': ts.ScriptKind.TSX, '.ts': ts.ScriptKind.TS, '.jsx': ts.ScriptKind.JSX,
}[path.extname(file)] ?? ts.ScriptKind.JS);

/** Every module specifier a source file names, in source order. */
export function moduleSpecifiers(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kindOf(fileName));
  const out = [];
  const literal = (node) => (node && ts.isStringLiteralLike(node) ? node.text : null);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      out.push(literal(node.moduleSpecifier));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      out.push(literal(node.moduleReference.expression));
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamicImport) && node.arguments.length > 0) out.push(literal(node.arguments[0]));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      out.push(literal(node.argument.literal));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.filter((s) => typeof s === 'string');
}

/** Every file a relative specifier can resolve to, on any platform. Empty for a bare specifier. */
export function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../') && spec !== '.' && spec !== '..') return [];
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base];
  for (const stem of [base, path.join(base, 'index')]) {
    for (const ext of EXTENSIONS) {
      for (const platform of PLATFORMS) candidates.push(`${stem}.${platform}.${ext}`);
      candidates.push(`${stem}.${ext}`);
    }
  }
  return [...new Set(candidates.filter(isFile))];
}

/** The files a source file imports, resolved. */
export function importsOf(file) {
  if (!PARSED.has(path.extname(file))) return [];
  const source = fs.readFileSync(file, 'utf8');
  return [...new Set(moduleSpecifiers(source, file).flatMap((spec) => resolveRelative(file, spec)))];
}

/** Every file reachable from `entry` through relative imports, `entry` included. Absolute, sorted. */
export function importClosure(entry) {
  const seen = new Set([path.resolve(entry)]);
  const queue = [path.resolve(entry)];
  while (queue.length) {
    for (const next of importsOf(queue.shift())) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return [...seen].sort();
}

const toPosix = (appRoot, file) => path.relative(appRoot, file).split(path.sep).join('/');

/** Whether an app-relative posix path is Design Lab code: anything under src/design/lab/, or its entry. */
export const isLabPath = (relPosix) => relPosix.startsWith('src/design/lab/') || relPosix === 'index.lab.js';

/** The lab files among `files` (absolute), as app-relative posix paths. */
export function labModules(appRoot, files) {
  return files.map((f) => toPosix(appRoot, f)).filter(isLabPath).sort();
}

// ---- what the lab may import (F-4: deny by default) -----------------------------------------

/**
 * The only app modules outside the lab and v2 that the lab may reach: the circumplex geometry and
 * its own closure (wheelGeometry imports laneCommit, which imports nothing). labExclusion.test.ts
 * pins this list to that closure, so it cannot grow quietly.
 */
export const LAB_SHARED_MODULES = ['src/experience/wheel/wheelGeometry.ts', 'src/state/hot/laneCommit.ts'];

/** The only packages the lab may import. Health, Bluetooth, auth and Spotify are not among them. */
export const LAB_PACKAGES = ['react', 'react-native', 'react-native-reanimated', '@shopify/react-native-skia'];

/** The app modules among `files` (absolute) that the lab may not reach, as app-relative posix paths. */
export function labClosureViolations(appRoot, files) {
  return files
    .map((f) => toPosix(appRoot, f))
    .filter((f) => !isLabPath(f) && !f.startsWith('src/design/v2/') && !LAB_SHARED_MODULES.includes(f))
    .sort();
}

/** The package a bare specifier names: `@scope/name` for a scoped one, else its first segment. */
const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
const isBare = (spec) => !spec.startsWith('.') && !spec.startsWith('/');

/** The packages a source names that are not on LAB_PACKAGES, in source order. */
export function packageViolationsInSource(source, fileName) {
  return moduleSpecifiers(source, fileName).filter(isBare).map(packageOf).filter((p) => !LAB_PACKAGES.includes(p));
}

/** Every package the files (absolute) import, sorted and unique. */
export function barePackages(files) {
  const all = files.filter((f) => PARSED.has(path.extname(f)))
    .flatMap((f) => moduleSpecifiers(fs.readFileSync(f, 'utf8'), f).filter(isBare).map(packageOf));
  return [...new Set(all)].sort();
}

/** Every import of a package that is not on LAB_PACKAGES: [{ file, package }] (absolute file). */
export function labPackageViolations(files) {
  return files.filter((f) => PARSED.has(path.extname(f)))
    .flatMap((f) => packageViolationsInSource(fs.readFileSync(f, 'utf8'), f).map((p) => ({ file: f, package: p })));
}

/** Every parseable source file under the app root, outside dependencies and native build trees. */
export function appSources(appRoot) {
  const out = [];
  const skip = (full, name) =>
    SKIP_ALWAYS.has(name) || (NATIVE_DIRS.has(name) && !toPosix(appRoot, full).startsWith('src/'));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!skip(full, entry.name)) walk(full); }
      else if (PARSED.has(path.extname(entry.name))) out.push(full);
    }
  };
  walk(appRoot);
  return out.sort();
}

/** Every import edge that lands in the lab, from any app source file: [{ from, to }] (absolute). */
export function labImporters(appRoot) {
  const edges = [];
  for (const from of appSources(appRoot)) {
    for (const to of importsOf(from)) {
      if (isLabPath(toPosix(appRoot, to))) edges.push({ from, to });
    }
  }
  return edges;
}
