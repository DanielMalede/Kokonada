/// <reference types="node" />
// B8-8c (the architect's B8 plan at 199b138; TASKS UI-071): the reports' common library, scripts/lab/reports/lib/
// evidence.mts. It reads a capture run's manifest and PNGs (lib/png.mjs), crops by probe, and builds the law twin of a
// shot from its manifest row: the scene from `expect` {direction, face, hero, tier} (fork F4: never from tap coordinates
// on a lab line), the frame time from the plan's args (`t`), and READY's device facts (the stage rect, pxPerDp, the font
// scale, renderScale, sampling). A row that lacks what a report needs is refused, naming the field: never a default.
//
// The library is an ES module the reports run under node (type-stripped .mts, as scripts/field/bandEvidence.mts), so
// these tests call it in a child node process. The pins below hold its twin inputs to the lab's own scenes: the props the
// real FieldScene and FallbackScene hand FieldView and FieldFallback, read by mounting them.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { PixelRatio } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { decodePng, encodePng } from '../lib/png.mjs';
import { row, withValue, without, type Rect } from '../reports/__fixtures__/rows';
import { srgbToOklab } from '../../../src/design/v2/color/oklab';
import { isRed } from '../../../src/design/v2/color/redBand';
import { CHECK_BAND } from '../../../src/design/v2/tokens/neverRedSweeps';
import { renderScaleFor } from '../../../src/design/v2/field/fieldDriver';

jest.mock('@shopify/react-native-skia', () => require('../../../src/design/lab/__tests__/__fixtures__/skiaHeadless').skiaHeadless());
jest.mock('../../../src/design/v2/field/effect', () => ({
  fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }),
}));
jest.mock('../../../src/design/v2/field/FieldView', () => ({ FieldView: jest.fn(() => null) }));
jest.mock('../../../src/design/v2/field/FieldFallback', () => ({ FieldFallback: jest.fn(() => null) }));

import { FieldView } from '../../../src/design/v2/field/FieldView';
import { FieldFallback } from '../../../src/design/v2/field/FieldFallback';
import { FIELD_SCENES } from '../../../src/design/lab/fieldScenes';
import { ProbeRegistry } from '../../../src/design/lab/probe/Probe';
import { FieldScene } from '../../../src/design/lab/scenes/FieldScene';
import { FallbackScene } from '../../../src/design/lab/scenes/FallbackScene';
import type { LabParams } from '../../../src/design/lab/params';

jest.setTimeout(120000);

const APP = path.resolve(__dirname, '../../..');
const LIB = path.join(APP, 'scripts/lab/reports/lib/evidence.mts');

/** Runs `body` (an async function body that sees E, the library, and input) in a child node and returns its JSON result. */
function lib<T>(body: string, input: unknown = null): T {
  const code = `const E = await import(${JSON.stringify(pathToFileURL(LIB).href)});
const input = JSON.parse(process.env.EVIDENCE_INPUT);
try { const out = await (async () => { ${body} })(); process.stdout.write(JSON.stringify({ ok: out === undefined ? null : out })); }
catch (e) { process.stdout.write(JSON.stringify({ error: { name: e?.name ?? null, message: String(e?.message ?? e), isInput: e instanceof E.EvidenceInputError } })); }`;
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], {
    cwd: APP, encoding: 'utf8', env: { ...process.env, EVIDENCE_INPUT: JSON.stringify(input) }, maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`the library did not run (exit ${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout) as T;
}
type Result<T> = { ok?: T; error?: { name: string | null; message: string; isInput: boolean } };

const REGION: Rect = { x: 0, y: 24, width: 103, height: 235 };
const STAGE: Rect = { x: 0, y: 30, width: 103, height: 229 };
const fieldRow = (over: Partial<Parameters<typeof row>[0]> = {}) =>
  row({
    shot: 'dark-one-joy-still', scene: 'field.abyss.dark.one.joy.still',
    expect: { direction: 'abyss', face: 'dark', hero: 'one.joy', tier: 'still' },
    file: 'dark-one-joy-still.1.png', sha256: 'b'.repeat(64), region: REGION, stage: STAGE, pxPerDp: 0.25,
    renderScale: 0.5, shaderStatus: 'ready', ...over,
  });
const fallbackRow = (over: Partial<Parameters<typeof row>[0]> = {}) =>
  row({
    shot: 'fb-dark-one-c-right', scene: 'fallback.abyss.dark.one.C.right',
    expect: { direction: 'abyss', face: 'dark', hero: null, tier: null },
    file: 'fb-dark-one-c-right.1.png', sha256: 'c'.repeat(64), region: REGION, stage: STAGE, pxPerDp: 0.25,
    shaderStatus: 'fallback-scene', shaderReason: 'the lab fallback scene: FieldFallback mounted directly', ...over,
  });

// ---------------------------------------------------------------------------------------- the typed reader

/** Every field lawParity reads from a field row: each one missing is refused by name (a has-cases guard below). */
const FIELD_NEEDS = [
  'file', 'sha256', 'scene', 'region', 'region.x', 'region.y', 'region.width', 'region.height',
  'expect', 'expect.direction', 'expect.face', 'expect.hero', 'expect.tier',
  'args', 'args.clock', 'args.t', 'renderScale', 'sampling', 'sampling.filter', 'sampling.mipmap',
  'stage', 'stage.x', 'stage.y', 'stage.width', 'stage.height', 'pxPerDp', 'shaderStatus', 'fontScale', 'fontScale.app',
];
const FALLBACK_NEEDS = [
  'file', 'sha256', 'scene', 'region', 'expect', 'expect.direction', 'expect.face',
  'stage', 'stage.x', 'stage.y', 'stage.width', 'stage.height', 'pxPerDp', 'shaderStatus', 'fontScale', 'fontScale.app',
];

describe('B8-8c: the typed reader of a manifest row', () => {
  it('reads a field row: the scene from expect, t from the plan args, the stage relative to the PNG', () => {
    const r = lib<Result<unknown>>('return E.readFieldShot(input, "lawParity");', fieldRow());
    expect(r.error).toBeUndefined();
    expect(r.ok).toEqual({
      name: 'dark-one-joy-still.1', scene: 'field.abyss.dark.one.joy.still', file: 'dark-one-joy-still.1.png', sha256: 'b'.repeat(64),
      region: REGION, direction: 'abyss', face: 'dark', hero: 'one.joy', tier: 'still', renderScale: 0.5, pxPerDp: 0.25, fontScale: 1,
      tMs: 11000, stage: { x: 0, y: 6, width: 103, height: 229 },
    });
  });

  it('reads a fallback row: the fallback scene from the id, direction and face from expect', () => {
    const r = lib<Result<unknown>>('return E.readFallbackShot(input, "lawParity");', fallbackRow());
    expect(r.error).toBeUndefined();
    expect(r.ok).toEqual({
      name: 'fb-dark-one-c-right.1', scene: 'fallback.abyss.dark.one.C.right', file: 'fb-dark-one-c-right.1.png', sha256: 'c'.repeat(64),
      region: REGION, direction: 'abyss', face: 'dark', fallbackScene: 'one.C.right', pxPerDp: 0.25, fontScale: 1,
      stage: { x: 0, y: 6, width: 103, height: 229 },
    });
  });

  it('the guard: the need lists are not empty, and every listed field is in the planted rows', () => {
    expect(FIELD_NEEDS.length).toBeGreaterThanOrEqual(25);
    expect(FALLBACK_NEEDS.length).toBeGreaterThanOrEqual(14);
    for (const p of FIELD_NEEDS) expect(() => without(fieldRow(), p)).not.toThrow();
  });

  it('a field row missing any field the report needs is refused, naming the field and the row: never a default', () => {
    const rows = FIELD_NEEDS.map((p) => without(fieldRow(), p));
    const out = lib<Result<Array<Result<unknown>>>>('return input.map((r) => { try { E.readFieldShot(r, "lawParity"); return { ok: true }; } catch (e) { return { error: { message: e.message, isInput: e instanceof E.EvidenceInputError } }; } });', rows).ok!;
    expect(out).toHaveLength(FIELD_NEEDS.length);
    out.forEach((r, i) => {
      expect({ field: FIELD_NEEDS[i], ...r }).toEqual({ field: FIELD_NEEDS[i], error: { message: expect.stringContaining(`"${FIELD_NEEDS[i]}"`), isInput: true } });
      expect(r.error?.message).toContain('dark-one-joy-still.1');
      expect(r.error?.message).toContain('lawParity');
    });
  });

  it('a fallback row missing any field the report needs is refused, naming the field', () => {
    const rows = FALLBACK_NEEDS.map((p) => without(fallbackRow(), p));
    const out = lib<Result<Array<Result<unknown>>>>('return input.map((r) => { try { E.readFallbackShot(r, "lawParity"); return { ok: true }; } catch (e) { return { error: { message: e.message, isInput: e instanceof E.EvidenceInputError } }; } });', rows).ok!;
    expect(out).toHaveLength(FALLBACK_NEEDS.length);
    out.forEach((r, i) => expect({ field: FALLBACK_NEEDS[i], ...r }).toEqual({ field: FALLBACK_NEEDS[i], error: { message: expect.stringContaining(`"${FALLBACK_NEEDS[i]}"`), isInput: true } }));
  });

  // Each value the twin cannot be built from, with the field the refusal must name.
  const BAD_FIELD: Array<[string, Record<string, unknown>, string]> = [
    ['a tier that is not full, low or still', withValue(fieldRow(), 'expect.tier', 'fast'), 'expect.tier'],
    ['a hero scene that is not a lab scene', withValue(withValue(fieldRow(), 'expect.hero', 'two'), 'scene', 'field.abyss.dark.two.still'), 'expect.hero'],
    ['a scene id that is not the one expect names', withValue(fieldRow(), 'scene', 'field.abyss.dark.three.still'), 'scene'],
    ['a face that is not dark or light', withValue(fieldRow(), 'expect.face', 'dim'), 'expect.face'],
    ['a clock that is not fixed', withValue(fieldRow(), 'args.clock', 'realtime'), 'args.clock'],
    ['a frame time that is not a number', withValue(fieldRow(), 'args.t', 'soon'), 'args.t'],
    ['READY drew another time than the plan asked', withValue(fieldRow(), 'clock.t', 7000), 'clock.t'],
    ['a renderScale that is not the tier’s', withValue(fieldRow(), 'renderScale', 0.33), 'renderScale'],
    ['a renderScale that is a string', withValue(fieldRow(), 'renderScale', '0.5'), 'renderScale'],
    ['a nearest upscale', withValue(fieldRow(), 'sampling.filter', 'nearest'), 'sampling'],
    ['mipmaps on the upscale', withValue(fieldRow(), 'sampling.mipmap', 'linear'), 'sampling'],
    ['a field drawn by its fallback', withValue(fieldRow(), 'shaderStatus', 'fallback'), 'shaderStatus'],
    ['a stage not on whole pixels of the PNG', withValue(fieldRow(), 'stage.y', 30.5), 'stage'],
    ['a stage outside the app region', withValue(fieldRow(), 'stage.height', 400), 'stage'],
    ['a density that is not a positive number', withValue(fieldRow(), 'pxPerDp', 0), 'pxPerDp'],
    ['a font scale that is not a positive number', withValue(fieldRow(), 'fontScale.app', -1), 'fontScale.app'],
  ];
  it.each(BAD_FIELD)('a field row with %s is refused, naming the field', (_, bad, field) => {
    const r = lib<Result<unknown>>('return E.readFieldShot(input, "lawParity");', bad);
    expect(r.error).toEqual({ name: expect.anything(), message: expect.stringContaining(`"${field}"`), isInput: true });
  });

  it('sampling may be written as Skia’s enum values (FilterMode.Linear 1, MipmapMode.None 0)', () => {
    const r = lib<Result<{ renderScale: number }>>('return E.readFieldShot(input, "lawParity");', withValue(fieldRow(), 'sampling', { filter: 1, mipmap: 0 }));
    expect(r.error).toBeUndefined();
  });

  const BAD_FALLBACK: Array<[string, Record<string, unknown>, string]> = [
    ['a fallback scene the lab does not have', withValue(fallbackRow(), 'scene', 'fallback.abyss.dark.one.X'), 'scene'],
    ['a scene of another face than expect', withValue(fallbackRow(), 'expect.face', 'light'), 'scene'],
    ['a field scene', withValue(fallbackRow(), 'scene', 'field.abyss.dark.rest.still'), 'scene'],
    ['a surface that is not the lab fallback scene', withValue(fallbackRow(), 'shaderStatus', 'ready'), 'shaderStatus'],
  ];
  it.each(BAD_FALLBACK)('a fallback row with %s is refused, naming the field', (_, bad, field) => {
    const r = lib<Result<unknown>>('return E.readFallbackShot(input, "lawParity");', bad);
    expect(r.error).toEqual({ name: expect.anything(), message: expect.stringContaining(`"${field}"`), isInput: true });
  });

  it('a manifest with no rows list is refused, naming "rows"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
    try {
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ plan: 'x', outcome: 'passed' }));
      const r = lib<Result<unknown>>('return E.loadManifest(input);', path.join(dir, 'manifest.json'));
      expect(r.error).toEqual({ name: expect.anything(), message: expect.stringContaining('"rows"'), isInput: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------- PNGs and probes

describe('B8-8c: the capture behind a row, and its crops', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function plant(width: number, height: number, pixel: (x: number, y: number) => number[]) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([...pixel(x, y), 255], (y * width + x) * 4);
    const png = await encodePng({ width, height, rgba });
    fs.writeFileSync(path.join(dir, 'shot.1.png'), png);
    return require('node:crypto').createHash('sha256').update(png).digest('hex') as string;
  }
  const captureRow = (sha: string, region: Rect) => ({ shot: 'shot', repeat: 1, file: 'shot.1.png', sha256: sha, region, scene: 'smoke' });

  it('loads the PNG of a row, checked against its sha256 and its region’s size, and crops a rect of it', async () => {
    const sha = await plant(6, 5, (x, y) => [x, y, 7]);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ rows: [captureRow(sha, { x: 3, y: 9, width: 6, height: 5 })] }));
    const r = lib<Result<{ width: number; height: number; crop: number[] }>>(
      'const m = E.loadManifest(input); const img = await E.loadCapture(m, E.readCaptureRow(m.rows[0], "test")); const c = E.cropRgba(img, { x: 2, y: 1, width: 2, height: 2 }); return { width: img.width, height: img.height, crop: Array.from(c.rgba) };',
      path.join(dir, 'manifest.json'),
    );
    expect(r.error).toBeUndefined();
    expect(r.ok).toEqual({ width: 6, height: 5, crop: [2, 1, 7, 255, 3, 1, 7, 255, 2, 2, 7, 255, 3, 2, 7, 255] });
  });

  it('a PNG whose bytes are not the row’s sha256 is refused, naming "sha256"', async () => {
    await plant(6, 5, () => [1, 2, 3]);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ rows: [captureRow('d'.repeat(64), { x: 0, y: 0, width: 6, height: 5 })] }));
    const r = lib<Result<unknown>>('const m = E.loadManifest(input); return await E.loadCapture(m, E.readCaptureRow(m.rows[0], "test"));', path.join(dir, 'manifest.json'));
    expect(r.error).toEqual({ name: expect.anything(), message: expect.stringContaining('"sha256"'), isInput: true });
  });

  it('a PNG of another size than its region is refused, naming "region"', async () => {
    const sha = await plant(6, 5, () => [1, 2, 3]);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ rows: [captureRow(sha, { x: 0, y: 0, width: 6, height: 6 })] }));
    const r = lib<Result<unknown>>('const m = E.loadManifest(input); return await E.loadCapture(m, E.readCaptureRow(m.rows[0], "test"));', path.join(dir, 'manifest.json'));
    expect(r.error).toEqual({ name: expect.anything(), message: expect.stringContaining('"region"'), isInput: true });
  });

  it('magnify repeats each pixel factor × factor times (nearest), for the ×8 crops', () => {
    const r = lib<Result<{ width: number; height: number; rgba: number[] }>>(
      'const m = E.magnify({ width: 2, height: 1, rgba: new Uint8Array([1, 1, 1, 255, 9, 9, 9, 255]) }, 2); return { width: m.width, height: m.height, rgba: Array.from(m.rgba) };',
    );
    expect(r.ok).toEqual({ width: 4, height: 2, rgba: [1, 1, 1, 255, 1, 1, 1, 255, 9, 9, 9, 255, 9, 9, 9, 255, 1, 1, 1, 255, 1, 1, 1, 255, 9, 9, 9, 255, 9, 9, 9, 255] });
  });

  it('writeNewFile never overwrites: an existing report is refused and left as it was', () => {
    const file = path.join(dir, 'report.txt');
    fs.writeFileSync(file, 'the earlier report\n');
    const r = lib<Result<unknown>>('E.writeNewFile(input, "a new report\\n");', file);
    expect(r.error).toEqual({ name: expect.anything(), message: expect.stringContaining(file), isInput: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('the earlier report\n');
    const fresh = path.join(dir, 'fresh.txt');
    expect(lib<Result<unknown>>('E.writeNewFile(input, "x\\n");', fresh).error).toBeUndefined();
    expect(fs.readFileSync(fresh, 'utf8')).toBe('x\n');
  });

  it('png.mjs round-trips what the library crops (the decode the reports use)', async () => {
    const sha = await plant(3, 2, (x, y) => [10 * x, 20 * y, 30]);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    const img = await decodePng(fs.readFileSync(path.join(dir, 'shot.1.png')));
    expect(Array.from(img.rgba.slice(4, 8))).toEqual([10, 0, 30, 255]);
  });
});

// ---------------------------------------------------------------------------------------- never-red, by the sources' definition

describe('B8-8c: a pixel in the check band, by the v2 definition (isRed over CHECK_BAND), not restated', () => {
  it('(2, 0, 0) is in the check band and (1, 0, 0) is not; black and the token-free greys are not', () => {
    const r = lib<Result<boolean[]>>('return input.map(([r, g, b]) => E.isCheckBandRed(r, g, b));', [[2, 0, 0], [1, 0, 0], [255, 0, 0], [0, 0, 0], [128, 128, 128]]);
    expect(r.ok).toEqual([true, false, true, false, false]);
  });

  it('agrees with isRed(srgbToOklab(rgb), CHECK_BAND) on a grid of 4096 colours, with both answers present', () => {
    const colours: number[][] = [];
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) colours.push([r, g, b]);
    for (let r = 0; r < 16; r++) colours.push([r, 0, 0]);
    const want = colours.map(([r, g, b]) => isRed(srgbToOklab([r / 255, g / 255, b / 255]), CHECK_BAND));
    expect(want.filter(Boolean).length).toBeGreaterThan(50);
    expect(want.filter((x) => !x).length).toBeGreaterThan(50);
    const got = lib<Result<boolean[]>>('return input.map(([r, g, b]) => E.isCheckBandRed(r, g, b));', colours);
    expect(got.ok).toEqual(want);
  });
});

// ---------------------------------------------------------------------------------------- the twin's inputs = the lab's own

const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 11000, stepMs: 0, frames: 10 });

/** The props the lab scene gives FieldView or FieldFallback, at a measured size, density and font scale. */
function mountedProps(id: string, kind: 'field' | 'fallback', width: number, height: number, k: number, fontScale: number) {
  const get = jest.spyOn(PixelRatio, 'get').mockReturnValue(k);
  const fs1 = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(fontScale);
  const target = (kind === 'field' ? FieldView : FieldFallback) as unknown as jest.Mock;
  target.mockClear();
  const clock = { mode: 'fixed', t: { value: 11000 } } as never;
  let r!: ReactTestRenderer.ReactTestRenderer;
  try {
    act(() => {
      const scene = kind === 'field'
        ? React.createElement(FieldScene, { clock, params: paramsOf(id) } as never)
        : React.createElement(FallbackScene, { params: paramsOf(id) });
      r = ReactTestRenderer.create(React.createElement(ProbeRegistry, { onMeasure: () => {} }, scene));
    });
    const view = r.root.find((n) => n.props.testID === `${kind === 'field' ? 'field' : 'fallback'}-scene.view` && typeof n.type !== 'string');
    act(() => view.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
    const calls = target.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0] as Record<string, unknown>;
  } finally {
    act(() => r.unmount());
    get.mockRestore();
    fs1.mockRestore();
  }
}

describe('B8-8c: the twin is built from the lab’s own scene, for every lab field and fallback scene', () => {
  const ids = Object.keys(FIELD_SCENES);
  const fieldIds = ids.filter((id) => FIELD_SCENES[id].kind === 'field');
  const fallbackIds = ids.filter((id) => FIELD_SCENES[id].kind === 'fallback');
  // Whole numbers of px at k = 2, so dp = px / k is exact.
  const SIZES: Array<{ width: number; height: number; k: number; fontScale: number }> = [
    { width: 412, height: 916, k: 2, fontScale: 1 },
    { width: 360, height: 780, k: 2, fontScale: 1.3 },
  ];

  it('the guard: both kinds, both faces, every tier', () => {
    expect(fieldIds.length).toBe(24);
    expect(fallbackIds.length).toBeGreaterThanOrEqual(20);
  });

  it.each(SIZES)('field scenes at $width × $height dp, k $k, font scale $fontScale: the twin’s inputs are FieldView’s props', (size) => {
    const rows = fieldIds.map((id) => {
      const s = FIELD_SCENES[id];
      return row({
        shot: 's', scene: id, expect: { direction: s.direction, face: s.face, hero: s.hero, tier: s.tier }, file: 'x.png', sha256: 'b'.repeat(64),
        region: { x: 0, y: 0, width: size.width * size.k, height: size.height * size.k }, stage: { x: 0, y: 0, width: size.width * size.k, height: size.height * size.k },
        pxPerDp: size.k, fontScale: size.fontScale, renderScale: renderScaleFor(s.tier as never), shaderStatus: 'ready',
      });
    });
    const got = lib<Result<Array<Record<string, unknown>>>>('return input.map((r) => E.fieldTwinInputs(E.readFieldShot(r, "test")));', rows);
    expect(got.error).toBeUndefined();
    fieldIds.forEach((id, i) => {
      const p = mountedProps(id, 'field', size.width, size.height, size.k, size.fontScale);
      const twin = got.ok![i];
      expect({ id, ...twin }).toEqual({
        id, direction: p.direction, face: p.face, taps: p.taps, layout: JSON.parse(JSON.stringify(p.layout)), pxPerDp: p.pxPerDp, tier: p.tier,
        renderScale: p.renderScale ?? renderScaleFor(p.tier as never), stress: p.stress, confidence: p.confidence, genesis: p.genesis, tMs: 11000,
      });
    });
  });

  it.each(SIZES)('fallback scenes at $width × $height dp, k $k, font scale $fontScale: the twin’s inputs are FieldFallback’s props', (size) => {
    const rows = fallbackIds.map((id) => {
      const s = FIELD_SCENES[id];
      return row({
        shot: 's', scene: id, expect: { direction: s.direction, face: s.face, hero: null, tier: null }, file: 'x.png', sha256: 'b'.repeat(64),
        region: { x: 0, y: 0, width: size.width * size.k, height: size.height * size.k }, stage: { x: 0, y: 0, width: size.width * size.k, height: size.height * size.k },
        pxPerDp: size.k, fontScale: size.fontScale, shaderStatus: 'fallback-scene',
      });
    });
    const got = lib<Result<Array<Record<string, unknown>>>>('return input.map((r) => E.fallbackTwinInputs(E.readFallbackShot(r, "test")));', rows);
    expect(got.error).toBeUndefined();
    fallbackIds.forEach((id, i) => {
      const p = mountedProps(id, 'fallback', size.width, size.height, size.k, size.fontScale);
      expect({ id, ...got.ok![i] }).toEqual({
        id, direction: p.direction, face: p.face, taps: p.taps, layout: JSON.parse(JSON.stringify(p.layout)), pxPerDp: p.pxPerDp, quietPresence: p.quietPresence ?? null,
      });
    });
  });
});
