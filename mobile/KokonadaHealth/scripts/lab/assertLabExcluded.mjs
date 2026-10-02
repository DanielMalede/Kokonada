// The Design Lab exclusion check (MB-084 · QA-077 · Apple 2.3.1(a) with 2.2 · Play Deceptive
// Behavior). The lab must be ABSENT from every build that can be uploaded to Play Console (any
// track) or App Store Connect (TestFlight included), not merely unreachable in it.
//
//   node scripts/lab/assertLabExcluded.mjs                    the full check (CI, `npm run lab:excluded`)
//   node scripts/lab/assertLabExcluded.mjs --closure-only     the static import closure only (fast)
//   node scripts/lab/assertLabExcluded.mjs --entry <file>     treat <file> as the release entry (a planted test)
//   node scripts/lab/assertLabExcluded.mjs --platform ios     bundle for iOS instead of Android
//   node scripts/lab/assertLabExcluded.mjs --scan <path>...   scan built outputs: an APK, an AAB, a .apks set,
//                                                             a bundle, or a directory of compiled classes
//
// The full check:
//   1. the import closure of index.js holds no lab module, and is the real app (not an empty scan);
//   2. Metro bundles index.js with the release Gradle task's own flags (--dev false, --minify false,
//      --reset-cache), and hermesc compiles it with the task's own flags; the JS, its sourcemap and
//      the Hermes bytecode hold no lab marker;
//   3. POSITIVE CONTROL: the same pipeline over index.lab.js must show the sentinel in the JS and
//      in the bytecode, and the lab's sources in the sourcemap. If it cannot, step 2 proves nothing.
//
// Exit codes: 0 clean · 1 a lab trace was found, or the positive control could not see the lab ·
// 2 the check could not run (a missing input, a bundler failure). 2 is never a pass.
//
// Never set the ENTRY_FILE environment variable: the React Native Gradle plugin applies it to EVERY
// variant, release included. android/app/build.gradle refuses to configure while it is set.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { importClosure, labModules } from './importGraph.mjs';
import { isZip, readZipEntries } from './lib/zip.mjs';

const SENTINEL_SOURCE = 'src/design/lab/sentinel.ts';
const SENTINEL_DECLARATION = /^export const LAB_SENTINEL = '([a-z0-9-]{16,})';$/m;

/** The sentinel, read from its single source. Throws when it is no longer a plain literal. */
export function readSentinel(appRoot) {
  const match = fs.readFileSync(path.join(appRoot, SENTINEL_SOURCE), 'utf8').match(SENTINEL_DECLARATION);
  if (!match) throw new Error(`${SENTINEL_SOURCE} must declare LAB_SENTINEL as one plain string literal`);
  return match[1];
}

/**
 * What a trace of the lab looks like in a built output: the sentinel, the lab activity's class
 * name and package path, the lab entry, and the lab's source folder in either slash direction.
 */
export function labMarkers(appRoot) {
  return [
    readSentinel(appRoot),
    'DesignLabActivity',
    'com/kokonadahealth/lab/',
    'index.lab',
    'design/lab/',
    'design\\lab\\',
  ];
}

/** Every marker present in `buf`, as UTF-8 (JS, Hermes, dex, proto XML) and UTF-16LE (binary XML). */
export function findMarkers(markers, buf) {
  const found = [];
  for (const marker of markers) {
    for (const encoding of ['utf8', 'utf16le']) {
      if (buf.indexOf(Buffer.from(marker, encoding)) >= 0) found.push({ marker, encoding });
    }
  }
  return found;
}

/** The lab sources a sourcemap lists. Throws on a map with no sources: an empty map proves nothing. */
export function labSourcesInMap(json) {
  const sources = JSON.parse(json).sources;
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('the sourcemap lists no sources');
  return sources.filter((s) => {
    const posix = String(s).split('\\').join('/');
    return posix.includes('/src/design/lab/') || posix.startsWith('src/design/lab/')
      || posix === 'index.lab.js' || posix.endsWith('/index.lab.js');
  });
}

const ARCHIVE = /\.(apk|aab|apks|zip|jar|aar)$/i;

/**
 * Every lab trace in a file, a directory, or an archive (nested archives included):
 * [{ where, marker, encoding }]. Paths count as content, so a planted class is found by its name too.
 * Throws when the path is missing or holds nothing to read.
 */
export function scanPath(markers, target) {
  if (!fs.existsSync(target)) throw new Error(`not found: ${target}`);
  const findings = [];
  let read = 0;
  const scanBytes = (where, name, buf) => {
    read += 1;
    for (const m of findMarkers(markers, Buffer.from(name, 'utf8'))) findings.push({ where, ...m });
    if (ARCHIVE.test(name) || isZip(buf)) {
      for (const entry of readZipEntries(buf)) scanBytes(`${where}!/${entry.name}`, entry.name, entry.data);
      return;
    }
    for (const m of findMarkers(markers, buf)) findings.push({ where, ...m });
  };
  const walk = (p) => {
    if (fs.statSync(p).isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) walk(path.join(p, name));
    } else {
      scanBytes(p, (path.relative(target, p) || path.basename(p)).split(path.sep).join('/'), fs.readFileSync(p));
    }
  };
  walk(target);
  if (read === 0) throw new Error(`nothing to scan under ${target}`);
  return findings.filter((f, i, all) => all.findIndex((g) => g.where === f.where && g.marker === f.marker) === i);
}

// ---- the release pipeline, as the React Native Gradle plugin runs it --------------------------

const HERMESC_DIRS = { win32: ['win64-bin', 'hermesc.exe'], linux: ['linux64-bin', 'hermesc'], darwin: ['osx-bin', 'hermesc'] };

function run(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-25).join('\n');
    throw new Error(`${path.basename(command)} ${args.slice(0, 2).join(' ')} failed (exit ${r.status}):\n${out}`);
  }
}

/** Metro then hermesc, with the flags of BundleHermesCTask. Returns the three outputs' paths. */
export function releaseBundle(appRoot, entry, platform, outDir) {
  const require = createRequire(path.join(appRoot, 'package.json'));
  const cli = require.resolve('react-native/cli.js');
  const [binDir, binName] = HERMESC_DIRS[process.platform] || [];
  if (!binDir) throw new Error(`no hermesc for ${process.platform}`);
  const hermesc = path.join(path.dirname(require.resolve('hermes-compiler/package.json')), 'hermesc', binDir, binName);

  fs.mkdirSync(outDir, { recursive: true });
  const bundle = path.join(outDir, `index.${platform}.bundle`);
  const map = `${bundle}.map`;
  const hbc = `${bundle}.hbc`;
  run(process.execPath, [cli, 'bundle', '--platform', platform, '--dev', 'false', '--reset-cache',
    '--entry-file', entry, '--bundle-output', bundle, '--assets-dest', path.join(outDir, 'res'),
    '--sourcemap-output', map, '--minify', 'false'], appRoot);
  run(hermesc, ['-w', '-emit-binary', '-max-diagnostic-width=80', '-out', hbc, bundle, '-O', '-output-source-map'], appRoot);
  return { bundle, map, hbc };
}

// ---- the CLI ---------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { closureOnly: false, entry: 'index.js', platform: 'android', scan: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--closure-only') args.closureOnly = true;
    else if (a === '--entry') args.entry = argv[++i];
    else if (a === '--platform') args.platform = argv[++i];
    else if (a === '--scan') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.scan.push(argv[++i]); }
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.entry || !['android', 'ios'].includes(args.platform)) throw new Error('bad --entry or --platform');
  return args;
}

const relTo = (appRoot, f) => path.relative(appRoot, f).split(path.sep).join('/');

function checkClosure(appRoot, entry) {
  const closure = importClosure(path.resolve(appRoot, entry));
  const leaked = labModules(appRoot, closure);
  if (leaked.length) return { ok: false, lines: [`the import closure of ${entry} reaches the Design Lab:`, ...leaked.map((f) => `  ${f}`)] };
  if (entry === 'index.js' && !closure.some((f) => relTo(appRoot, f) === 'src/navigation/AppFlow.tsx')) {
    throw new Error('the closure of index.js no longer reaches src/navigation/AppFlow.tsx; the scan is not seeing the app');
  }
  return { ok: true, lines: [`closure of ${entry}: ${closure.length} modules, none in the Design Lab`] };
}

function checkReleaseBundle(appRoot, markers, entry, platform, tmp) {
  const out = releaseBundle(appRoot, entry, platform, path.join(tmp, 'release'));
  const findings = [
    ...findMarkers(markers, fs.readFileSync(out.bundle)).map((m) => ({ where: 'JS bundle', ...m })),
    ...findMarkers(markers, fs.readFileSync(out.hbc)).map((m) => ({ where: 'Hermes bytecode', ...m })),
    ...labSourcesInMap(fs.readFileSync(out.map, 'utf8')).map((s) => ({ where: 'sourcemap', marker: s, encoding: 'source' })),
  ];
  if (findings.length) return { ok: false, lines: [`the ${platform} release bundle of ${entry} holds the Design Lab:`, ...findings.map((f) => `  ${f.where}: ${f.marker} (${f.encoding})`)] };
  return { ok: true, lines: [`${platform} release bundle of ${entry} (JS, Hermes bytecode, sourcemap): no lab marker`] };
}

function checkPositiveControl(appRoot, markers, platform, tmp) {
  const out = releaseBundle(appRoot, 'index.lab.js', platform, path.join(tmp, 'lab'));
  const sentinel = markers[0];
  const seen = {
    js: findMarkers([sentinel], fs.readFileSync(out.bundle)).length > 0,
    hbc: findMarkers([sentinel], fs.readFileSync(out.hbc)).length > 0,
    map: labSourcesInMap(fs.readFileSync(out.map, 'utf8')).length > 0,
  };
  const ok = seen.js && seen.hbc && seen.map;
  return { ok, lines: [ok
    ? 'positive control: the lab bundle shows the sentinel (JS and Hermes) and its sources (sourcemap)'
    : `positive control FAILED, so a clean release result proves nothing: ${JSON.stringify(seen)}`] };
}

function main(argv) {
  const appRoot = path.resolve(path.dirname(process.argv[1]), '../..');
  let args;
  try { args = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }

  try {
    const markers = labMarkers(appRoot);
    if (args.scan.length) {
      const findings = args.scan.flatMap((t) => scanPath(markers, path.resolve(t)));
      if (findings.length) {
        console.error('Design Lab traces in a scanned build output:');
        for (const f of findings) console.error(`  ${f.where}: ${f.marker} (${f.encoding})`);
        return 1;
      }
      console.log(`scanned ${args.scan.length} path(s): no Design Lab trace`);
      return 0;
    }

    const steps = [() => checkClosure(appRoot, args.entry)];
    let tmp = null;
    if (!args.closureOnly) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-excluded-'));
      steps.push(() => checkReleaseBundle(appRoot, markers, args.entry, args.platform, tmp));
      steps.push(() => checkPositiveControl(appRoot, markers, args.platform, tmp));
    }
    try {
      let failed = false;
      for (const step of steps) {
        const r = step();
        (r.ok ? console.log : console.error)(r.lines.join('\n'));
        if (!r.ok) failed = true;
      }
      return failed ? 1 : 0;
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`the Design Lab exclusion check could not run: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && /assertLabExcluded\.mjs$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
