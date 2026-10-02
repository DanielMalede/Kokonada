/// <reference types="node" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { findMarkers, labMarkers, labSourcesInMap, scanPath } from '../assertLabExcluded.mjs';
import { readZipEntries } from '../lib/zip.mjs';
import { LAB_SENTINEL } from '../../../src/design/lab/sentinel';

// The scanner behind `npm run lab:excluded` (MB-084). It reads what a store upload is made of — a
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
    const clean = put('cli/clean.apk', zip([{ name: 'classes.dex', data: Buffer.from('Lcom/kokonadahealth/MainActivity;'), deflate: true }]));
    expect(run('--scan', planted).status).toBe(1);
    expect(run('--scan', clean).status).toBe(0);
    expect(run('--scan', path.join(tmp, 'cli/missing.aab')).status).toBe(2);
  });
});
