// The src/pages boundary guard (OPS-506). Batch pages (DEC-192, /page BATCH MODE) are built under
// src/pages/ and stay lab-only until their cutover, so the release root App.tsx must reach none of them.
//
//   node scripts/lab/assertPagesBoundary.mjs                  the real app
//   node scripts/lab/assertPagesBoundary.mjs --root <dir>     another app root (a planted fixture tree)
//
// The walk starts at App.tsx and follows every edge Metro would follow into app code:
//   · a relative specifier, resolved on every platform (importGraph.mjs's moduleSpecifiers and
//     resolveRelative: every import form, parsed by the TypeScript compiler);
//   · a local package's name: a `file:` or `link:` dependency in package.json (today
//     @kokonada/spotify-remote -> modules/spotify-remote), resolved by the package's own main fields in
//     Metro's order (react-native, browser, main), or a subpath of it. Its source is app code that can
//     import a page, so a walk that stopped at bare specifiers would be a false green.
// A resolver the walk does not model (babel's module-resolver, Metro's extraNodeModules or
// resolveRequest, a local package with an `exports` map) stops the check instead of hiding its edges.
//
// "Outside the Design Lab route": the Design Lab route is the lab's own entry index.lab.js and the
// modules under src/design/lab/ (importGraph.mjs's isLabPath, the definition assertLabExcluded.mjs and
// labExclusion.test.ts use). The release graph never enters it, which assertLabExcluded.mjs proves, so
// this walk does not stop at a lab module: any page App.tsx reaches, by whatever path, is outside the
// lab route. A page reached only from index.lab.js is inside it.
//
// Exit codes: 0 no batch page reached · 1 a batch page reached · 2 the check could not run (no App.tsx,
// no package.json, an unresolvable local package, an unmodelled resolver). 2 is never a pass.

import fs from 'node:fs';
import path from 'node:path';
import { moduleSpecifiers, resolveRelative } from './importGraph.mjs';

const ENTRY = 'App.tsx';
const PAGES_DIR = 'src/pages';
const PARSED = /\.(tsx?|jsx?|mjs|cjs)$/;
const MAIN_FIELDS = ['react-native', 'browser', 'main'];
const LOCAL_PROTOCOLS = ['file:', 'link:'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

const toPosix = (appRoot, file) => path.relative(appRoot, file).split(path.sep).join('/');
const isRelative = (spec) => spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../');
/** A batch page file: anything under src/pages/ (case-insensitive, so no casing slips past on Windows). */
export const isPagePath = (relPosix) => /^src\/pages\//i.test(relPosix);

const readJson = (file, what) => {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new Error(`cannot read ${what} (${file})`); }
  try { return JSON.parse(text); } catch { throw new Error(`${what} is not JSON (${file})`); }
};

/** The local packages package.json names (file: and link: dependencies): [{ name, dir }], dir app-relative. */
export function localPackages(appRoot) {
  const manifest = readJson(path.join(appRoot, 'package.json'), 'package.json');
  const out = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, value] of Object.entries(manifest[field] ?? {})) {
      const protocol = LOCAL_PROTOCOLS.find((p) => typeof value === 'string' && value.startsWith(p));
      if (!protocol) continue;
      const dir = path.resolve(appRoot, value.slice(protocol.length));
      // A package outside the app root is not app code this walk can attribute; it is still walked.
      out.push({ name, dir: toPosix(appRoot, dir) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The resolvers the walk does not model, named in babel.config.js or metro.config.js source. */
export function unmodelledResolvers({ babel, metro }) {
  const found = [];
  if (/module-resolver/.test(babel)) found.push('babel.config.js names module-resolver');
  for (const key of ['extraNodeModules', 'resolveRequest']) {
    if (new RegExp(`\\b${key}\\b`).test(metro)) found.push(`metro.config.js names ${key}`);
  }
  return found;
}

const readIfThere = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

/** The files a local package specifier resolves to; throws when it resolves to nothing. */
function resolveAlias(packages, spec) {
  const pkg = packages.find((p) => spec === p.name || spec.startsWith(`${p.name}/`));
  if (!pkg) return [];
  const manifestFile = path.join(pkg.abs, 'package.json');
  let targets;
  if (spec === pkg.name) {
    const manifest = readJson(manifestFile, `${pkg.name}'s package.json`);
    if (manifest.exports !== undefined) throw new Error(`${pkg.name} has an exports map, which this walk does not model`);
    const field = MAIN_FIELDS.find((f) => typeof manifest[f] === 'string');
    targets = resolveRelative(manifestFile, `./${field ? manifest[field] : 'index'}`);
  } else {
    targets = resolveRelative(manifestFile, `./${spec.slice(pkg.name.length + 1)}`);
  }
  if (targets.length === 0) throw new Error(`${spec} names the local package ${pkg.name} but resolves to no file`);
  return targets;
}

/**
 * The guard. Returns { code, lines, closure, pages, reached }: the closure of App.tsx and the page files
 * on disk as app-relative posix paths, and every page reached with the import chain that reaches it.
 */
export function checkPagesBoundary(appRoot) {
  const root = path.resolve(appRoot);
  const fail = (e) => ({ code: 2, lines: [`the src/pages boundary guard could not run: ${e.message}`], closure: [], pages: [], reached: [] });
  try {
    const entry = path.join(root, ENTRY);
    if (!fs.existsSync(entry) || !fs.statSync(entry).isFile()) throw new Error(`no ${ENTRY} at ${root}, so the release graph cannot be read`);
    const packages = localPackages(root).map((p) => ({ ...p, abs: path.resolve(root, p.dir) }));
    const unmodelled = unmodelledResolvers({
      babel: readIfThere(path.join(root, 'babel.config.js')),
      metro: readIfThere(path.join(root, 'metro.config.js')),
    });
    if (unmodelled.length) throw new Error(`a resolver this walk does not model: ${unmodelled.join('; ')}`);

    const parent = new Map([[entry, null]]);
    const queue = [entry];
    while (queue.length) {
      const file = queue.shift();
      if (!PARSED.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const spec of moduleSpecifiers(source, file)) {
        const targets = isRelative(spec) ? resolveRelative(file, spec) : resolveAlias(packages, spec);
        for (const next of targets) {
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

    const head = `the import graph of ${ENTRY}: ${closure.length} modules, through ${packages.length} local package(s)`;
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
  let root = path.resolve(path.dirname(process.argv[1]), '../..');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) root = path.resolve(argv[++i]);
    else { console.error(`unknown argument: ${argv[i]}`); return 2; }
  }
  const r = checkPagesBoundary(root);
  (r.code === 0 ? console.log : console.error)(r.lines.join('\n'));
  return r.code;
}

if (process.argv[1] && /assertPagesBoundary\.mjs$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
