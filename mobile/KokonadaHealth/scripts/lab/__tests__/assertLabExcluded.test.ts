/// <reference types="node" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findMarkers, labMarkers, labSourcesInMap, scanPath } from '../assertLabExcluded.mjs';
import { readZipEntries } from '../lib/zip.mjs';
import { LAB_SENTINEL } from '../../../src/design/lab/sentinel';

// The scanner behind `node scripts/lab/assertLabExcluded.mjs` (MB-084). It reads what a store upload is made of — a
// JS or Hermes bundle, its sourcemap, compiled classes, an APK or an AAB — and reports any trace
// of the Design Lab. Every check is shown to BITE on a planted trace before a clean result is
// allowed to mean anything.

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/lab/assertLabExcluded.mjs');
const MARKERS = labMarkers(APP);

// A minimal zip writer (stored and deflated entries), so the reader is tested on real deflate
// streams from zlib. The closing evidence on a real AGP-built APK is in the MB-084 runs.
function zip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const body = e.deflate ? zlib.deflateRawSync(e.data) : e.data;
    const crc = zlib.crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const utf16 = (s: string) => Buffer.from(s, 'utf16le');
const HBC_RELEASE = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.from('the app, compiled')]);
let tmp: string;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-excluded-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
const put = (rel: string, data: Buffer | string) => {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return full;
};

describe('markers', () => {
  it('the sentinel is one of the markers, read from its single source (sentinel.ts) and equal to it', () => {
    expect(MARKERS).toContain(LAB_SENTINEL);
    expect(MARKERS).toContain('DesignLabActivity');
  });

  it('refuses a sentinel source it cannot read, rather than scanning for nothing', () => {
    const fake = path.join(tmp, 'fake-app');
    fs.mkdirSync(path.join(fake, 'src/design/lab'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'src/design/lab/sentinel.ts'), 'export const LAB_SENTINEL = makeIt();\n');
    expect(() => labMarkers(fake)).toThrow(/LAB_SENTINEL/);
  });

  it('finds the sentinel in UTF-8 (JS, Hermes, dex) and UTF-16LE (binary XML string pools)', () => {
    expect(findMarkers(MARKERS, Buffer.from(`x${LAB_SENTINEL}y`))).toEqual([{ marker: LAB_SENTINEL, encoding: 'utf8' }]);
    expect(findMarkers(MARKERS, Buffer.concat([utf16('ab'), utf16('DesignLabActivity')])))
      .toEqual([{ marker: 'DesignLabActivity', encoding: 'utf16le' }]);
  });

  it('finds lab source paths in either slash direction, and passes their near neighbours', () => {
    expect(findMarkers(MARKERS, Buffer.from('/app/src/design/lab/LabRoot.tsx')).map((m: { marker: string }) => m.marker)).toEqual(['design/lab/']);
    expect(findMarkers(MARKERS, Buffer.from('C:\\app\\src\\design\\lab\\LabRoot.tsx')).map((m: { marker: string }) => m.marker)).toEqual(['design\\lab\\']);
    expect(findMarkers(MARKERS, Buffer.from('src/design/labels.ts src/design/tokens.ts index.js'))).toEqual([]);
  });
});

describe('sourcemaps', () => {
  it('flags a lab source and the lab entry, on posix and Windows paths', () => {
    const map = JSON.stringify({ version: 3, sources: [
      '/app/src/navigation/AppFlow.tsx', '/app/src/design/lab/sentinel.ts', 'C:\\app\\src\\design\\lab\\x.ts', '/app/index.lab.js',
    ] });
    expect(labSourcesInMap(map)).toEqual(['/app/src/design/lab/sentinel.ts', 'C:\\app\\src\\design\\lab\\x.ts', '/app/index.lab.js']);
  });

  it('passes a release map, and refuses a map with no sources (an empty map proves nothing)', () => {
    expect(labSourcesInMap(JSON.stringify({ version: 3, sources: ['/app/index.js', '/app/App.tsx'] }))).toEqual([]);
    expect(() => labSourcesInMap(JSON.stringify({ version: 3, sources: [] }))).toThrow(/no sources/);
  });

  // Metro 0.87 (React Native 0.88) writes an index map: no top-level `sources`, one section per module,
  // each with its own map (`{version, sections: [{offset, map: {sources, ...}}]}`).
  const section = (line: number, sources: string[]) => ({ offset: { line, column: 0 }, map: { version: 3, sources, names: [], mappings: '' } });

  it('reads an index map (sections), the form Metro 0.87 writes, and flags a lab source in any section', () => {
    const map = JSON.stringify({ version: 3, sections: [
      section(0, ['__prelude__']), section(4, ['/app/src/navigation/AppFlow.tsx']),
      section(9, ['/app/src/design/lab/sentinel.ts']), section(12, ['C:\\app\\index.lab.js']),
    ] });
    expect(labSourcesInMap(map)).toEqual(['/app/src/design/lab/sentinel.ts', 'C:\\app\\index.lab.js']);
  });

  it('passes a release index map, and refuses one whose sections list no sources', () => {
    expect(labSourcesInMap(JSON.stringify({ version: 3, sections: [section(0, ['__prelude__']), section(3, ['/app/index.js'])] }))).toEqual([]);
    expect(() => labSourcesInMap(JSON.stringify({ version: 3, sections: [section(0, []), section(3, [])] }))).toThrow(/no sources/);
    expect(() => labSourcesInMap(JSON.stringify({ version: 3, sections: [] }))).toThrow(/no sources/);
  });

  it('refuses a section it cannot read (a url section, or one with no map) rather than skipping what it holds', () => {
    expect(() => labSourcesInMap(JSON.stringify({ version: 3, sections: [section(0, ['/app/index.js']), { offset: { line: 5, column: 0 }, url: 'lab.map' }] })))
      .toThrow(/section 1 .*no map/);
    expect(() => labSourcesInMap(JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 } }] }))).toThrow(/section 0 .*no map/);
  });
});

describe('zip archives (APK, AAB, nested APKs)', () => {
  it('reads stored and deflated entries byte for byte', () => {
    const data = Buffer.from('x'.repeat(5000) + LAB_SENTINEL);
    const entries = readZipEntries(zip([
      { name: 'assets/index.android.bundle', data, deflate: true },
      { name: 'AndroidManifest.xml', data: Buffer.from('<manifest/>') },
    ]));
    expect(entries.map((e: { name: string }) => e.name)).toEqual(['assets/index.android.bundle', 'AndroidManifest.xml']);
    expect(entries[0].data.equals(data)).toBe(true);
  });

  it('refuses what it cannot read rather than reporting it clean', () => {
    expect(() => readZipEntries(Buffer.from('PK\u0003\u0004 truncated'))).toThrow(/zip/i);
  });
});

describe('scanPath', () => {
  it('finds a planted class in a directory of compiled classes, by path and by content', () => {
    const dir = path.join(tmp, 'classes-planted');
    put('classes-planted/com/kokonadahealth/MainActivity.class', Buffer.from('com/kokonadahealth/MainActivity'));
    put('classes-planted/com/kokonadahealth/lab/DesignLabActivity.class', Buffer.from('com/kokonadahealth/lab/DesignLabActivity'));
    const found = scanPath(MARKERS, dir).map((f: { where: string }) => f.where.split(path.sep).join('/'));
    expect(found.some((w: string) => w.endsWith('com/kokonadahealth/lab/DesignLabActivity.class'))).toBe(true);
  });

  it('finds a lab file by its path alone when its bytes say nothing (obfuscated or opaque content)', () => {
    const dir = path.join(tmp, 'classes-opaque');
    put('classes-opaque/com/kokonadahealth/lab/a.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    const found = scanPath(MARKERS, dir);
    expect(found.map((f: { marker: string }) => f.marker)).toEqual(['com/kokonadahealth/lab/']);
  });

  it('finds the sentinel inside a deflated bundle inside an APK inside an archive', () => {
    const apk = zip([{ name: 'assets/index.android.bundle', data: Buffer.from(`hbc${LAB_SENTINEL}`), deflate: true }]);
    const outer = put('nested.apks', zip([{ name: 'splits/base-master.apk', data: apk }]));
    const found = scanPath(MARKERS, outer);
    expect(found).toHaveLength(1);
    expect(found[0].where).toBe(`${outer}!/splits/base-master.apk!/assets/index.android.bundle`);
  });

  it('reports a clean archive clean, and counts what it read (a scan that reads nothing must not pass)', () => {
    const clean = put('clean.aab', zip([{ name: 'base/assets/index.android.bundle', data: Buffer.from('release'), deflate: true }]));
    expect(scanPath(MARKERS, clean)).toEqual([]);
    expect(() => scanPath(MARKERS, path.join(tmp, 'empty-dir-that-does-not-exist'))).toThrow(/not found/);
    fs.mkdirSync(path.join(tmp, 'empty-dir'));
    expect(() => scanPath(MARKERS, path.join(tmp, 'empty-dir'))).toThrow(/nothing to scan/);
  });
});

describe('the React Native CLI the release pipeline bundles with (resolved by a real node process)', () => {
  // React Native 0.87 narrowed the package's `exports`: 0.86's `./*` and `./*.js` catch-alls are gone,
  // so `require.resolve('react-native/cli.js')` throws ERR_PACKAGE_PATH_NOT_EXPORTED and the full check
  // exited 2 before Metro ran. The CLI is the file the package's own `bin` names, reached through the
  // package.json the map still exports, as npm itself links node_modules/.bin/react-native.
  // Node, not jest, resolves here: inside jest, module.createRequire is jest's resolver, which reads no
  // `exports` the way node does, and CI runs the script under node.
  const node = (source: string) => spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });
  const resolveCli = (app: string) => node([
    `import { reactNativeCli } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};`,
    `try { process.stdout.write(reactNativeCli(${JSON.stringify(app)})); }`,
    'catch (e) { process.stderr.write(e.message); process.exitCode = 3; }',
  ].join('\n'));
  const fixtureApp = (name: string, rnPackage: Record<string, unknown>, files: Record<string, string>) => {
    put(`${name}/package.json`, JSON.stringify({ name: 'fixture-app', private: true }));
    put(`${name}/node_modules/react-native/package.json`, JSON.stringify({ name: 'react-native', version: '0.0.0-fixture', ...rnPackage }));
    for (const [rel, text] of Object.entries(files)) put(`${name}/node_modules/react-native/${rel}`, text);
    return path.join(tmp, name);
  };
  const EXPORTS_WITHOUT_CLI = { '.': './index.js', './package.json': './package.json' };

  it('is the file the bin entry names, found through an exports map that does not list ./cli.js', () => {
    const app = fixtureApp('rn-exports', { bin: { 'react-native': 'cli.js' }, exports: EXPORTS_WITHOUT_CLI }, {
      'cli.js': '// the fixture CLI\n', 'index.js': 'module.exports = {};\n',
    });
    // The fixture reproduces the constraint under node: the file path itself cannot be resolved.
    const direct = node(`import { createRequire } from 'node:module'; createRequire(${JSON.stringify(path.join(app, 'package.json'))}).resolve('react-native/cli.js');`);
    expect(direct.status).not.toBe(0);
    expect(direct.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    const r = resolveCli(app);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(path.join(app, 'node_modules', 'react-native', 'cli.js'));
  });

  it('reads a bin given as a single path too', () => {
    const app = fixtureApp('rn-bin-string', { bin: './cli.js', exports: EXPORTS_WITHOUT_CLI }, {
      'cli.js': '// the fixture CLI\n', 'index.js': 'module.exports = {};\n',
    });
    expect(resolveCli(app).stdout).toBe(path.join(app, 'node_modules', 'react-native', 'cli.js'));
  });

  it('refuses a package whose bin names no file, rather than handing node a path that is not there', () => {
    const missing = resolveCli(fixtureApp('rn-bin-missing', { bin: { 'react-native': 'cli.js' }, exports: EXPORTS_WITHOUT_CLI }, { 'index.js': 'module.exports = {};\n' }));
    expect(missing.status).toBe(3);
    expect(missing.stderr).toMatch(/cli\.js, which is not there/);
    const none = resolveCli(fixtureApp('rn-bin-none', { exports: EXPORTS_WITHOUT_CLI }, { 'index.js': 'module.exports = {};\n' }));
    expect(none.status).toBe(3);
    expect(none.stderr).toMatch(/names no react-native bin/);
  });

  it('is the installed react-native CLI: the file its bin names, on disk', () => {
    const rnRoot = path.join(APP, 'node_modules', 'react-native');
    const { bin } = JSON.parse(fs.readFileSync(path.join(rnRoot, 'package.json'), 'utf8'));
    const r = resolveCli(APP);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(path.join(rnRoot, typeof bin === 'string' ? bin : bin['react-native']));
    expect(fs.statSync(r.stdout).isFile()).toBe(true);
  });
});

describe('the CLI (a real process; its exit code is what CI reads)', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: APP, encoding: 'utf8' });

  it('exits 0 on the release entry, closure only', () => {
    const r = run('--closure-only');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('exits 1 on a planted entry, and names the lab module it reached', () => {
    const r = run('--closure-only', '--entry', 'scripts/lab/__fixtures__/sentinelEntry.js');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('src/design/lab/sentinel.ts');
  });

  it('exits 1 on a planted artifact, 0 on a clean one, and 2 on a path that is not there', () => {
    const planted = put('cli/planted.apk', zip([{ name: 'classes.dex', data: Buffer.from('Lcom/kokonadahealth/lab/DesignLabActivity;'), deflate: true }]));
    const clean = put('cli/clean.apk', zip([
      { name: 'classes.dex', data: Buffer.from('Lcom/kokonadahealth/MainActivity;'), deflate: true },
      { name: 'assets/index.android.bundle', data: HBC_RELEASE, deflate: true },
    ]));
    expect(run('--scan', planted).status).toBe(1);
    expect(run('--scan', clean).status).toBe(0);
    expect(run('--scan', path.join(tmp, 'cli/missing.aab')).status).toBe(2);
  });

  it('exits 2 on --scan with no path: a scan that reads nothing is never a pass (MF-1)', () => {
    expect(run('--scan').status).toBe(2);
    expect(run('--scan', '--closure-only').status).toBe(2);
  });

  it('exits 2 on an app artifact it read no app in: an Android one needs a JS bundle and a dex, an IPA a JS bundle', () => {
    const dex = { name: 'classes.dex', data: Buffer.from('dex\n035 Lcom/kokonadahealth/MainActivity;'), deflate: true };
    const bundle = { name: 'assets/index.android.bundle', data: HBC_RELEASE, deflate: true };
    const noBundle = put('cli/nobundle.apk', zip([dex]));
    const noDex = put('cli/nodex.apk', zip([bundle]));
    const aab = put('cli/app.aab', zip([{ ...dex, name: 'base/dex/classes.dex' }, { ...bundle, name: 'base/assets/index.android.bundle' }]));
    const ipa = put('cli/app.ipa', zip([{ name: 'Payload/KokonadaHealth.app/main.jsbundle', data: HBC_RELEASE, deflate: true }]));
    const ipaEmpty = put('cli/empty.ipa', zip([{ name: 'Payload/KokonadaHealth.app/Info.plist', data: Buffer.from('plist') }]));
    expect(run('--scan', noBundle).stderr).toMatch(/no JS bundle/);
    expect(run('--scan', noBundle).status).toBe(2);
    expect(run('--scan', noDex).stderr).toMatch(/no dex/);
    expect(run('--scan', noDex).status).toBe(2);
    expect(run('--scan', aab).status).toBe(0);
    expect(run('--scan', ipa).status).toBe(0);
    expect(run('--scan', ipaEmpty).status).toBe(2);
  });

  it('holds a build-output directory to no such rule (classes and bundle folders are scanned as they are)', () => {
    const classes = put('cli/classes/com/kokonadahealth/MainActivity.class', Buffer.from('com/kokonadahealth/MainActivity'));
    expect(run('--scan', path.dirname(path.dirname(path.dirname(classes)))).status).toBe(0);
  });
});
