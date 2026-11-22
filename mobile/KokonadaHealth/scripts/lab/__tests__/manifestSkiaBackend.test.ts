/// <reference types="node" />
import {
  buildRow, ROW_SCHEMA_VERSION, ROW_SCHEMA_VERSIONS, rowSkiaBackend, SKIA_BACKEND_UNRECORDED, SKIA_BACKENDS, skiaBackendProblem,
  validateManifest, validateRow,
} from '../lib/manifest.mjs';
import { makeStamp } from '../lib/stamp.mjs';
import { readSkiaBackend, SKIA_BACKENDS as LAB_BACKENDS } from '../../../src/design/lab/skiaBackend';
import { fakeSkia, type FakeBuild } from '../../../src/design/lab/__tests__/__fixtures__/fakeSkiaBackend';
import { MANIFEST_91D6940, ROW_91D6940 } from './__fixtures__/evidence91d6940';

// UI-276. Every row the harness writes names the Skia backend that drew it: `skiaBackend` { backend, readBy, reason },
// READY's, which the lab reads from react-native-skia on the device (src/design/lab/skiaBackend.ts). A backend comes
// with how it was read; no backend comes with why. The field lands behind the row's schema version (architect ruling A5):
// a row of version 2, which the harness writes, must carry it, and validateRow refuses one without it; a row with no
// version, or version 1, is one written before (every earlier session, the 91d6940 evidence among them), valid as it was
// written, and read as null, "recorded before UI-276", without being rewritten. A model of the device's drawing that
// holds for one backend only (the fallback twin's ring coverage, UI-272) refuses a row of any other through
// skiaBackendProblem.

const H = (c: string) => c.repeat(64);
const SHA = 'a'.repeat(40);
const STAMP = makeStamp({ commit: SHA, porcelain: '', bundleSha256: H('3'), tokens: {}, entry: 'index.lab.js', createdAt: '2026-11-22T11:00:00.000Z' });
const STAGE_PX = { x: 0, y: 0, width: 1080, height: 2340 };
/** What the S22+'s lab reports (react-native-skia 2.6.9 without SK_GRAPHITE): readSkiaBackend on its build. */
const GANESH_GL = readSkiaBackend(fakeSkia('ganesh-gl').skia);

/** READY with no skiaBackend key at all. */
const NO_BACKEND = Symbol('READY names no skiaBackend');
/** One shot's sources, as captureShot holds them, READY carrying readyBackend as its skiaBackend (no key for NO_BACKEND). */
const sources = (readyBackend: unknown = GANESH_GL) => ({
  shot: { id: 'fb-dark', scene: 'fallback.abyss.dark.three', device: { fontScale: 1 }, expect: { direction: 'abyss', face: 'dark', hero: 'three', tier: null } },
  repeat: 1, file: 'fb-dark.1.png', sha256: H('1'), appRegionHash: H('2'),
  build: { head: SHA, stamp: STAMP, apkSha256: H('4'), hermes: true, skiaVersion: '2.6.9' },
  app: { package: 'com.kokonadahealth.lab' },
  facts: { model: 'SM-S906B', fingerprint: 'samsung/g0s:16/x/1:user/release-keys', width: 1080, height: 2340, density: 420, refreshRate: 120, forceDark: false, locale: 'he-IL' },
  frame: { width: 1080, height: 2340, colorSpace: 'sRGB' },
  observed: { fontScale: 1, night: 'yes', animatorScales: { window: 1, transition: 1, animator: 1 } },
  ready: {
    run: 'r', seq: 0, scene: 'fallback.abyss.dark.three', clock: 'fixed', t: 11000, powerSave: false, isRTL: true, fontScale: 1,
    shaderStatus: 'fallback-scene', shaderReason: null, tier: null, pixelRatio: 2.625, sentinel: 's',
    probes: { stage: { dp: { x: 0, y: 0, width: 411.43, height: 891.43 }, px: STAGE_PX } },
    ...(readyBackend === NO_BACKEND ? {} : { skiaBackend: readyBackend }),
  },
  region: { x: 0, y: 84, width: 1080, height: 2130 },
  probes: { inside: {}, excluded: [] },
  timestamps: { launched: new Date('2026-11-22T10:00:00.000Z'), ready: new Date('2026-11-22T10:00:01.000Z'), captured: new Date('2026-11-22T10:00:01.500Z') },
  renderFacts: { renderScale: null, sampling: null },
  render: {
    gl: { renderer: 'Qualcomm, Adreno (TM) 730', gles: 'OpenGL ES 3.2 V@0615.98', reason: null },
    display: { colorMode: 'ColorMode::SRGB (7)', wideColor: true, refreshMode: 'peakRefreshRate 120.00001 Hz, vsyncRate 120.00001 Hz', reason: null },
  },
});
type Row = Record<string, any>;
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const row = (readyBackend?: unknown): Row => copy(buildRow(sources(readyBackend)));
const withBackend = (fact: unknown): Row => ({ ...row(), skiaBackend: fact });
/** The real 91d6940 row (__fixtures__/evidence91d6940.ts), a fresh copy. */
const real = (): Row => copy(ROW_91D6940);
/** A row an earlier session's harness wrote: today's fields, at its own commit, but no version and no skiaBackend. */
const earlier = (): Row => {
  const r = row();
  delete r.schemaVersion;
  delete r.skiaBackend;
  return r;
};

describe('the lab and the harness name the same backends', () => {
  it('src/design/lab/skiaBackend.ts SKIA_BACKENDS is the manifest\'s', () => {
    expect([...LAB_BACKENDS]).toEqual([...SKIA_BACKENDS]);
    expect(SKIA_BACKENDS).toEqual(['ganesh-gl', 'graphite']);
  });

  it('every fact the lab\'s read can make, carried by READY, makes a row validateRow accepts, with that fact', () => {
    const builds: Array<[FakeBuild, object]> = [['ganesh-gl', {}], ['graphite', {}], ['ganesh-metal', {}], ['raster', {}], ['ganesh-gl', { offscreen: 'null' }], ['ganesh-gl', { disposeThrows: true }]];
    const facts = [...builds.map(([b, o]) => readSkiaBackend(fakeSkia(b, o).skia)), readSkiaBackend(undefined)];
    expect(new Set(facts.map((f) => f.backend))).toEqual(new Set(['ganesh-gl', 'graphite', null]));
    for (const f of facts) {
      const r = row(f);
      expect(validateRow(r)).toEqual([]);
      expect(r.skiaBackend).toEqual(f);
    }
  });
});

describe('buildRow: the row is of the current version and states READY\'s backend', () => {
  it('schemaVersion 2 first; READY\'s three facts, as a copy, after skiaVersion', () => {
    const s = sources();
    const r = buildRow(s) as Row;
    expect([ROW_SCHEMA_VERSION, [...ROW_SCHEMA_VERSIONS]]).toEqual([2, [1, 2]]);
    expect(Object.keys(r)[0]).toBe('schemaVersion');
    expect(r.schemaVersion).toBe(2);
    expect(r.skiaBackend).toEqual(GANESH_GL);
    expect(r.skiaBackend).not.toBe(s.ready.skiaBackend);
    const keys = Object.keys(r);
    expect(keys[keys.indexOf('skiaVersion') + 1]).toBe('skiaBackend');
  });

  it.each([
    ['names none', NO_BACKEND],
    ['says null', null],
  ])('a READY that %s: null, and why, never a guess (the row is still one validateRow accepts)', (_label, fact) => {
    const r = row(fact);
    expect(r.skiaBackend).toEqual({ backend: null, readBy: null, reason: 'READY names no Skia backend' });
    expect(validateRow(r)).toEqual([]);
  });

  it.each([
    ['a READY backend that is a string', 'ganesh-gl', /^skiaBackend must be an object$/],
    ['a READY backend without how it was read', { backend: 'ganesh-gl', reason: null }, /^skiaBackend\.readBy is required$/],
    ['a READY backend the manifest does not know', { backend: 'vulkan', readBy: 'x', reason: null }, /^skiaBackend\.backend must be one of ganesh-gl, graphite or null$/],
  ])('%s: a row validateRow refuses, naming the field', (_label, fact, why) => {
    expect(validateRow(row(fact)).join('\n')).toMatch(why);
  });
});

describe('validateRow: a row of the current version carries skiaBackend', () => {
  it('a row with a backend and how it was read passes, and one with null and why', () => {
    expect(validateRow(row())).toEqual([]);
    expect(validateRow(withBackend({ backend: null, readBy: null, reason: 'Skia.hasDevice() threw: no JSI' }))).toEqual([]);
  });

  it('refuses one without it, at any commit, the 91d6940 one too', () => {
    for (const sha of [SHA, ROW_91D6940.commit.sha]) {
      const r: Row = { ...row(), commit: { sha, porcelainEmpty: true } };
      delete r.skiaBackend;
      expect(validateRow(r)).toEqual(['skiaBackend is required']);
    }
  });

  it.each([
    ['null in place of the fact', null, ['skiaBackend must be an object']],
    ['a backend the manifest does not know', { ...GANESH_GL, backend: 'ganesh-vulkan' }, ['skiaBackend.backend must be one of ganesh-gl, graphite or null']],
    ['no backend and no reason', { backend: null, readBy: null, reason: null }, ['skiaBackend.reason must say why a fact is null (backend, readBy)']],
    ['an empty reason', { backend: null, readBy: null, reason: '' }, ['skiaBackend.reason must be a string or null', 'skiaBackend.reason must say why a fact is null (backend, readBy)']],
    ['a reason beside a backend read', { ...GANESH_GL, reason: 'stale' }, ['skiaBackend.reason must be null when every fact is read']],
    ['a backend without how it was read', { backend: 'ganesh-gl', readBy: null, reason: 'x' }, ['skiaBackend.backend and skiaBackend.readBy are both null or both set']],
    ['how it was read without a backend', { backend: null, readBy: 'Skia.hasDevice() is false', reason: 'x' }, ['skiaBackend.backend and skiaBackend.readBy are both null or both set']],
    ['a key the schema does not know', { ...GANESH_GL, glTarget: 3553 }, ['skiaBackend.glTarget is not a manifest field']],
    ['without its reason key', { backend: 'ganesh-gl', readBy: 'r' }, ['skiaBackend.reason is required']],
  ])('refuses %s', (_label, fact, why) => {
    expect(validateRow(withBackend(fact))).toEqual(why);
  });

  it.each([
    ['3', 3],
    ['a string', '2'],
    ['null', null],
    ['0', 0],
  ])('refuses a schema version the harness never wrote (%s)', (_label, version) => {
    expect(validateRow({ ...row(), schemaVersion: version })).toEqual(['schemaVersion must be one of 1, 2']);
  });
});

describe('a row written before UI-276 (no version, or version 1), which has no skiaBackend', () => {
  it('the real 91d6940 row passes validateRow unchanged, and so does its manifest\'s top level validateManifest', () => {
    const r = real();
    expect('schemaVersion' in r || 'skiaBackend' in r).toBe(false);
    expect(validateRow(r)).toEqual([]);
    expect(validateManifest(copy(MANIFEST_91D6940))).toEqual([]);
    expect(r).toEqual(ROW_91D6940);
  });

  it('so does an earlier session\'s row at any commit, and one naming version 1', () => {
    expect(validateRow(earlier())).toEqual([]);
    expect(validateRow({ schemaVersion: 1, ...earlier() })).toEqual([]);
    expect(validateRow({ schemaVersion: 1, ...real() })).toEqual([]);
  });

  it('it is held to the fields it was written with: a version-1 row without one is still refused', () => {
    const r = real();
    delete (r as Record<string, unknown>).pixelRatio;
    expect(validateRow(r)).toEqual(['pixelRatio is required']);
  });

  it('a backend comes only with version 2: a row with no version, or version 1, that carries one is refused', () => {
    expect(validateRow({ ...real(), skiaBackend: GANESH_GL })).toEqual(['skiaBackend is not a manifest field']);
    expect(validateRow({ ...earlier(), schemaVersion: 1, skiaBackend: GANESH_GL })).toEqual(['skiaBackend is not a manifest field']);
  });

  it('is read as null, "recorded before UI-276", and is not rewritten', () => {
    for (const r of [real(), earlier(), { schemaVersion: 1, ...earlier() }]) {
      const before = JSON.stringify(r);
      expect(rowSkiaBackend(r)).toEqual({ backend: null, readBy: null, reason: 'recorded before UI-276' });
      expect(JSON.stringify(r)).toBe(before);
    }
    expect(SKIA_BACKEND_UNRECORDED).toBe('recorded before UI-276');
  });
});

describe('rowSkiaBackend: the backend a report reads from a row', () => {
  it('a row\'s own fact, as a copy', () => {
    const r = row();
    expect(rowSkiaBackend(r)).toEqual(GANESH_GL);
    expect(rowSkiaBackend(r)).not.toBe(r.skiaBackend);
    expect(rowSkiaBackend(withBackend({ backend: null, readBy: null, reason: 'READY names no Skia backend' }))).toEqual({ backend: null, readBy: null, reason: 'READY names no Skia backend' });
  });

  it('never calls a row "recorded before UI-276" unless it is one: a version-2 row without the field is named missing', () => {
    const r = row();
    delete r.skiaBackend;
    expect(rowSkiaBackend(r)).toEqual({ backend: null, readBy: null, reason: 'the row has no skiaBackend, though its schema version 2 requires one (validateRow refuses it)' });
  });

  it('a malformed fact, or one on a row whose version has none, is no backend: null, naming it, never a guess', () => {
    const malformed = { backend: null, readBy: null, reason: 'the row\'s skiaBackend is not one the harness writes (validateRow refuses it)' };
    expect(rowSkiaBackend(withBackend({ backend: 'vulkan', readBy: 'x', reason: null }))).toEqual(malformed);
    expect(rowSkiaBackend(withBackend('ganesh-gl'))).toEqual(malformed);
    expect(rowSkiaBackend(withBackend({ backend: 'ganesh-gl', readBy: null, reason: 'x' }))).toEqual(malformed);
    expect(rowSkiaBackend({ ...real(), skiaBackend: GANESH_GL })).toEqual(malformed);
    expect(rowSkiaBackend({ ...row(), schemaVersion: 3 })).toEqual({ backend: null, readBy: null, reason: 'the row\'s schema version 3 is not one the harness writes (validateRow refuses it)' });
    expect(rowSkiaBackend(null)).toEqual({ backend: null, readBy: null, reason: 'not a row' });
  });
});

describe('skiaBackendProblem: a model refuses a backend it was not validated on', () => {
  const VALIDATED = ['ganesh-gl'];

  it('the backend it was validated on: no problem', () => {
    expect(skiaBackendProblem(row(), VALIDATED)).toBeNull();
  });

  it('another backend: refused, naming both', () => {
    const graphite = row(readSkiaBackend(fakeSkia('graphite').skia));
    expect(skiaBackendProblem(graphite, VALIDATED)).toBe('the row was drawn by graphite (Skia.hasDevice() is true: react-native-skia was built with the Graphite backend (SK_GRAPHITE)), and the model was validated on ganesh-gl only');
  });

  it('a backend that was not read: refused, with why', () => {
    expect(skiaBackendProblem(row(NO_BACKEND), VALIDATED)).toBe('the row names no Skia backend (READY names no Skia backend), and the model was validated on ganesh-gl only');
  });

  it('a row written before UI-276: refused, unless the caller accepts that evidence by name', () => {
    expect(skiaBackendProblem(real(), VALIDATED)).toBe('the row names no Skia backend (recorded before UI-276), and the model was validated on ganesh-gl only');
    expect(skiaBackendProblem(real(), VALIDATED, { acceptRecordedBefore: true })).toBeNull();
    expect(skiaBackendProblem({ schemaVersion: 1, ...earlier() }, VALIDATED, { acceptRecordedBefore: true })).toBeNull();
  });

  it('accepting the rows written before UI-276 accepts nothing else', () => {
    const accept = { acceptRecordedBefore: true };
    expect(skiaBackendProblem(row(NO_BACKEND), VALIDATED, accept)).toMatch(/^the row names no Skia backend \(READY names no Skia backend\)/);
    expect(skiaBackendProblem(row(readSkiaBackend(fakeSkia('graphite').skia)), VALIDATED, accept)).toMatch(/^the row was drawn by graphite/);
    const missing = row();
    delete missing.skiaBackend;
    expect(skiaBackendProblem(missing, VALIDATED, accept)).toMatch(/^the row names no Skia backend \(the row has no skiaBackend, though its schema version 2 requires one/);
    expect(skiaBackendProblem({ ...real(), skiaBackend: GANESH_GL }, VALIDATED, accept)).toMatch(/^the row names no Skia backend \(the row's skiaBackend is not one the harness writes/);
    // A row of the current version that writes the sentence itself is not a row written before UI-276.
    expect(skiaBackendProblem(withBackend({ backend: null, readBy: null, reason: 'recorded before UI-276' }), VALIDATED, accept)).toMatch(/^the row names no Skia backend \(recorded before UI-276\)/);
  });

  it.each([
    ['no backend', []],
    ['a backend the manifest does not know', ['ganesh-vulkan']],
    ['a string', 'ganesh-gl'],
    ['nothing', undefined],
  ])('a model validated on %s is a mistake in the caller: it throws', (_label, validated) => {
    expect(() => skiaBackendProblem(row(), validated as never)).toThrow(/validatedOn must be a non-empty list of ganesh-gl, graphite/);
  });
});
