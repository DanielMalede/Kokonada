// The src/pages boundary guard (OPS-506). Batch pages (DEC-192, /page BATCH MODE) are built under
// src/pages/ and stay lab-only until their cutover, so the release graph must reach none of them.
//
//   node scripts/lab/assertPagesBoundary.mjs                  the real app (with a floor: the walk must reach AppFlow)
//   node scripts/lab/assertPagesBoundary.mjs --root <dir>     another app root (a planted fixture tree)
//
// The walk starts at App.tsx and at the release entry index.js, when it exists. In index.js, the one edge
// named in DEV_ONLY_EDGES is skipped when every occurrence of it sits inside `if (__DEV__) { ... }`: Metro
// folds that branch away with --dev false (scripts/jest/__tests__/devPreviewExcluded.test.ts). Every other
// edge out of index.js is walked. The walk follows every edge Metro would follow into app code:
//   · a relative specifier, resolved on every platform (importGraph.mjs's moduleSpecifiers and
//     resolveRelative: every import form, parsed by the TypeScript compiler);
//   · a local package's name: a `file:` or `link:` dependency in package.json (today
//     @kokonada/spotify-remote -> modules/spotify-remote), resolved by the package's own main fields in
//     Metro's order (react-native, browser, main), or a subpath of it.
// Every resolved file is reduced to its real path first, so a symlink or junction into src/pages/ is seen
// as the page it is (Metro follows symlinks).
//
// Anything the walk does not model stops the check (exit 2) instead of hiding its edges. The resolver
// configuration is read against an allowlist:
//   · metro.config.js may set only resolver.blockList and require only @react-native/metro-config;
//   · babel.config.js may set only presets and plugins, and name only the two it names today;
//   · no other babel or metro config file, no babel or metro key in package.json, no workspaces, no local
//     peer, no workspace: or portal: dependency;
//   · a local package with an exports map, or a main field that is not a string;
//   · an absolute specifier, or a relative import of a directory that has its own package.json.
//
// "Outside the Design Lab route": the Design Lab route is the lab's own entry index.lab.js and the
// modules under src/design/lab/ (importGraph.mjs's isLabPath, the definition assertLabExcluded.mjs and
// labExclusion.test.ts use). The release graph never enters it, which assertLabExcluded.mjs proves, so
// this walk does not stop at a lab module: any page the release graph reaches, by whatever path, is
// outside the lab route. A page reached only from index.lab.js is inside it.
//
// Exit codes: 0 no batch page reached · 1 a batch page reached · 2 the check could not run. 2 is never a pass.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { moduleSpecifiers, resolveRelative } from './importGraph.mjs';

const REQUIRED_ENTRY = 'App.tsx';
const ENTRIES = ['App.tsx', 'index.js'];
const DEV_ONLY_EDGES = ['./src/design/v2/preview/devRoot.tsx'];
const PAGES_DIR = 'src/pages';
const PARSED = /\.(tsx?|jsx?|mjs|cjs)$/;
const MAIN_FIELDS = ['react-native', 'browser', 'main'];
const LOCAL_PROTOCOLS = ['file:', 'link:'];
const UNMODELLED_PROTOCOLS = ['workspace:', 'portal:'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const OTHER_CONFIGS = [
  '.babelrc', '.babelrc.js', '.babelrc.cjs', '.babelrc.mjs', '.babelrc.json', '.babelrc.cts',
  'babel.config.json', 'babel.config.cjs', 'babel.config.mjs', 'babel.config.cts', 'babel.config.ts',
  'metro.config.cjs', 'metro.config.mjs', 'metro.config.json', 'metro.config.ts',
  '.config/metro.js', '.config/metro.cjs', '.config/metro.mjs', '.config/metro.json', 'rn-cli.config.js',
];
const BABEL_KEYS = ['presets', 'plugins'];
const BABEL_NAMES = ['module:@react-native/babel-preset', 'react-native-reanimated/plugin'];
const METRO_KEYS = ['resolver', 'blockList'];
const METRO_REQUIRES = ['@react-native/metro-config'];
const METRO_NAMES = ['@react-native/metro-config'];
const METRO_CALLS = ['getDefaultConfig', 'mergeConfig'];
const BABEL_CALLS = ['api.cache'];
const BABELRC = ['.babelrc', '.babelrc.js', '.babelrc.cjs', '.babelrc.mjs', '.babelrc.json', '.babelrc.cts'];

const real = (p) => fs.realpathSync.native(p);
const toPosix = (appRoot, file) => path.relative(appRoot, file).split(path.sep).join('/');
const isRelative = (spec) => spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../');
const isAbsolute = (spec) => spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec);
/** A batch page file: anything under src/pages/ (case-insensitive, so no casing slips past on Windows). */
export const isPagePath = (relPosix) => /^src\/pages\//i.test(relPosix);

const readJson = (file, what) => {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new Error(`cannot read ${what} (${file})`); }
  try { return JSON.parse(text); } catch { throw new Error(`${what} is not JSON (${file})`); }
};
const isDirectory = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** The local packages package.json names (file: and link: dependencies): [{ name, dir }], dir app-relative. */
export function localPackages(appRoot) {
  const manifest = readJson(path.join(appRoot, 'package.json'), 'package.json');
  const out = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, value] of Object.entries(manifest[field] ?? {})) {
      const protocol = LOCAL_PROTOCOLS.find((p) => typeof value === 'string' && value.startsWith(p));
      if (!protocol) continue;
      out.push({ name, dir: toPosix(appRoot, path.resolve(appRoot, value.slice(protocol.length))) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** What package.json sets that the walk does not model. */
function manifestRefusals(manifest) {
  const found = [];
  for (const key of ['workspaces', 'babel', 'metro', 'browser', 'react-native']) if (manifest[key] !== undefined) found.push(`package.json sets ${key}`);
  for (const [name, value] of Object.entries(manifest.peerDependencies ?? {})) {
    if (typeof value === 'string' && LOCAL_PROTOCOLS.some((p) => value.startsWith(p))) found.push(`package.json names the local peer ${name}`);
  }
  for (const field of [...DEPENDENCY_FIELDS, 'peerDependencies']) {
    for (const [name, value] of Object.entries(manifest[field] ?? {})) {
      if (typeof value === 'string' && UNMODELLED_PROTOCOLS.some((p) => value.startsWith(p))) found.push(`package.json names ${name} as ${value}`);
    }
  }
  return found;
}

const keyText = (name) => (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : null);
const requireSpec = (node) => {
  if (!ts.isCallExpression(node)) return undefined;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  if (!isRequire && !isImport) return undefined;
  const arg = node.arguments[0];
  return arg && ts.isStringLiteralLike(arg) ? arg.text : '<a non-literal specifier>';
};

/** What a config source does beyond its allowlist: object keys, required modules, member writes, names. */
function configRefusals(file, source, { keys, requires, names, calls }) {
  if (!source.trim()) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const visit = (node) => {
    const spec = requireSpec(node);
    if (spec !== undefined) {
      if (!requires.includes(spec)) found.push(`${file} requires ${spec}`);
      return;
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (!requires.includes(node.moduleSpecifier.text)) found.push(`${file} requires ${node.moduleSpecifier.text}`);
      return;
    }
    if (ts.isObjectLiteralElementLike(node) && ts.isObjectLiteralExpression(node.parent)) {
      if (ts.isSpreadAssignment(node)) found.push(`${file} spreads ${node.expression.getText(sf)}`);
      else {
        const key = keyText(node.name);
        if (key === null) found.push(`${file} sets a computed key`);
        else if (!keys.includes(key)) found.push(`${file} sets ${key}`);
      }
      if (ts.isPropertyAssignment(node)) visit(node.initializer);
      else if (!ts.isShorthandPropertyAssignment(node)) ts.forEachChild(node, visit);
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(sf);
      if (calls && !calls.includes(callee)) found.push(`${file} ${ts.isNewExpression(node) ? 'constructs' : 'calls'} ${callee}`);
    }
    if (ts.isTemplateExpression(node)) found.push(`${file} composes a string from a template`);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
      && node.left.getText(sf) !== 'module.exports') {
      found.push(`${file} assigns ${node.left.getText(sf)}`);
    }
    if (names && ts.isStringLiteralLike(node) && !names.includes(node.text)) found.push(`${file} names "${node.text}", which is not on its allowlist`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The resolver configuration babel.config.js and metro.config.js set beyond what the walk models. */
export function unmodelledResolvers({ babel, metro }) {
  return [
    ...configRefusals('babel.config.js', babel, { keys: BABEL_KEYS, requires: [], names: BABEL_NAMES, calls: BABEL_CALLS }),
    ...configRefusals('metro.config.js', metro, { keys: METRO_KEYS, requires: METRO_REQUIRES, names: METRO_NAMES, calls: METRO_CALLS }),
  ];
}

const readIfThere = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

/** The specifiers of `source` whose every occurrence sits inside the then-branch of `if (__DEV__)`. */
function devOnlySpecifiers(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const inDev = [];
  const visit = (node) => {
    if (ts.isIfStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === '__DEV__') {
      inDev.push(...moduleSpecifiers(node.thenStatement.getText(sf), fileName));
      if (node.elseStatement) visit(node.elseStatement);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const all = moduleSpecifiers(source, fileName);
  const count = (list, s) => list.filter((x) => x === s).length;
  return new Set(inDev.filter((s) => count(inDev, s) === count(all, s)));
}

const DEV_DECLARATIONS = [
  ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.Parameter,
  ts.SyntaxKind.ImportSpecifier, ts.SyntaxKind.ImportClause, ts.SyntaxKind.NamespaceImport, ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.ImportEqualsDeclaration,
];

/** Whether `source` declares a binding named __DEV__ or writes to one, so `if (__DEV__)` is not Metro's flag. */
function declaresOwnDev(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found = false;
  const isDev = (n) => (ts.isIdentifier(n) && n.text === '__DEV__') || (ts.isPropertyAccessExpression(n) && n.name.text === '__DEV__');
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === '__DEV__' && DEV_DECLARATIONS.includes(node.parent.kind) && node.parent.name === node) found = true;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && isDev(node.left)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The files a local package specifier resolves to; throws on what the walk does not model or cannot resolve. */
function resolveAlias(packages, spec) {
  const pkg = packages.find((p) => spec === p.name || spec.startsWith(`${p.name}/`));
  if (!pkg) return [];
  const manifestFile = path.join(pkg.abs, 'package.json');
  const manifest = readJson(manifestFile, `${pkg.name}'s package.json`);
  if (manifest.exports !== undefined) throw new Error(`${pkg.name} has an exports map, which this walk does not model`);
  for (const f of MAIN_FIELDS) {
    if (manifest[f] !== undefined && typeof manifest[f] !== 'string') throw new Error(`${pkg.name}'s ${f} field is not a string, which this walk does not model`);
  }
  const field = MAIN_FIELDS.find((f) => typeof manifest[f] === 'string');
  const target = spec === pkg.name ? (field ? manifest[field] : 'index') : spec.slice(pkg.name.length + 1);
  const targets = resolveRelative(manifestFile, `./${target}`);
  if (targets.length === 0) throw new Error(`${spec} names the local package ${pkg.name} but resolves to no file`);
  return targets;
}

/** The files a relative specifier resolves to; throws on a directory that carries its own package.json. */
function resolveLocal(file, spec) {
  const base = path.resolve(path.dirname(file), spec);
  if (isDirectory(base) && fs.existsSync(path.join(base, 'package.json'))) {
    throw new Error(`${spec} (from ${path.basename(file)}) names a directory with its own package.json, which this walk does not model`);
  }
  return resolveRelative(file, spec);
}

/**
 * The guard. Returns { code, lines, closure, pages, reached }: the closure of the entries and the page
 * files on disk as app-relative posix paths, and every page reached with the import chain that reaches it.
 * `mustReach` (app-relative) is a floor: a walk that does not reach it could not run.
 */
export function checkPagesBoundary(appRoot, { mustReach } = {}) {
  const fail = (e) => ({ code: 2, lines: [`the src/pages boundary guard could not run: ${e.message}`], closure: [], pages: [], reached: [] });
  try {
    const given = path.resolve(appRoot);
    const required = path.join(given, REQUIRED_ENTRY);
    if (!fs.existsSync(required) || !fs.statSync(required).isFile()) throw new Error(`no ${REQUIRED_ENTRY} at ${given}, so the release graph cannot be read`);
    const root = real(given);
    const manifest = readJson(path.join(root, 'package.json'), 'package.json');
    const packages = localPackages(root).map((p) => ({ ...p, abs: path.resolve(root, p.dir) }));
    const unmodelled = [
      ...manifestRefusals(manifest),
      ...OTHER_CONFIGS.filter((f) => fs.existsSync(path.join(root, f))).map((f) => `${f} exists`),
      ...unmodelledResolvers({
        babel: readIfThere(path.join(root, 'babel.config.js')),
        metro: readIfThere(path.join(root, 'metro.config.js')),
      }),
    ];
    if (unmodelled.length) throw new Error(`a resolver this walk does not model: ${unmodelled.join('; ')}`);

    const entries = ENTRIES.map((e) => path.join(root, e)).filter((f) => fs.existsSync(f)).map(real);
    const releaseEntry = path.join(root, 'index.js');
    // A .babelrc or a package.json in a directory between a walked file and the root changes how Metro
    // transforms or resolves that file. A local package's own manifest is exempt: resolveAlias checks it.
    const localDirs = new Set(packages.map((p) => (fs.existsSync(p.abs) ? real(p.abs) : p.abs)));
    const checked = new Set();
    const checkDirectories = (file) => {
      for (let dir = path.dirname(file); dir !== root; dir = path.dirname(dir)) {
        const rel = path.relative(root, dir);
        if (rel.startsWith('..') || path.isAbsolute(rel) || checked.has(dir)) break;
        checked.add(dir);
        if (BABELRC.some((f) => fs.existsSync(path.join(dir, f)))) throw new Error(`${toPosix(root, dir)}/ holds a .babelrc, which this walk does not model`);
        if (!localDirs.has(dir) && fs.existsSync(path.join(dir, 'package.json'))) throw new Error(`${toPosix(root, dir)}/package.json is not a local package's manifest, and this walk does not model it`);
      }
    };
    const parent = new Map(entries.map((e) => [e, null]));
    const queue = [...entries];
    while (queue.length) {
      const file = queue.shift();
      checkDirectories(file);
      if (!PARSED.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      const declaresDev = file === releaseEntry && declaresOwnDev(source, file);
      if (declaresDev) throw new Error('index.js declares or sets its own __DEV__, so its if (__DEV__) branch is not the build flag');
      const devOnly = file === releaseEntry ? devOnlySpecifiers(source, file) : new Set();
      for (const spec of moduleSpecifiers(source, file)) {
        if (DEV_ONLY_EDGES.includes(spec) && devOnly.has(spec)) continue;
        if (isAbsolute(spec)) throw new Error(`${toPosix(root, file)} imports the absolute specifier ${spec}, which this walk does not model`);
        const targets = isRelative(spec) ? resolveLocal(file, spec) : resolveAlias(packages, spec);
        for (const next of targets.map(real)) {
          if (!parent.has(next)) { parent.set(next, file); queue.push(next); }
        }
      }
    }

    const chainTo = (file) => {
      const chain = [];
      for (let f = file; f; f = parent.get(f)) chain.unshift(toPosix(root, f));
      return chain;
    };
    const closure = [...parent.keys()].map((f) => toPosix(root, f)).sort();
    if (mustReach && !closure.includes(mustReach)) throw new Error(`the walk did not reach ${mustReach}, so it is not seeing the app`);
    const reached = [...parent.keys()].filter((f) => isPagePath(toPosix(root, f)))
      .map((f) => ({ page: toPosix(root, f), chain: chainTo(f) }))
      .sort((a, b) => a.page.localeCompare(b.page));

    const pagesDir = path.join(root, PAGES_DIR);
    const pages = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full); else pages.push(toPosix(root, full));
      }
    };
    if (fs.existsSync(pagesDir)) walk(pagesDir);
    pages.sort();

    const names = entries.map((e) => toPosix(root, e)).join(' and ');
    const head = `the import graph of ${names}: ${closure.length} modules, through ${packages.length} local package(s)`;
    if (reached.length) {
      return { code: 1, closure, pages, reached, lines: [
        `${head}; it reaches ${reached.length} batch page file(s) outside the Design Lab route:`,
        ...reached.map((r) => `  ${r.chain.join(' -> ')}`),
      ] };
    }
    const tail = pages.length === 0
      ? 'no batch page entry exists under src/pages/ yet'
      : `it reaches none of the ${pages.length} batch page file(s) under src/pages/`;
    return { code: 0, closure, pages, reached, lines: [`${head}; ${tail}`] };
  } catch (e) {
    return fail(e);
  }
}

function main(argv) {
  let root = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) root = path.resolve(argv[++i]);
    else { console.error(`unknown argument: ${argv[i]}`); return 2; }
  }
  // The real app has a floor: a walk of it that never reaches AppFlow is not seeing the app.
  const r = root
    ? checkPagesBoundary(root)
    : checkPagesBoundary(path.resolve(path.dirname(process.argv[1]), '../..'), { mustReach: 'src/navigation/AppFlow.tsx' });
  (r.code === 0 ? console.log : console.error)(r.lines.join('\n'));
  return r.code;
}

if (process.argv[1] && /assertPagesBoundary\.mjs$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
