/// <reference types="node" />
import { androidDensity, buildManifest, buildRow, rowPixelRatio, validateManifest, validateRow } from '../lib/manifest.mjs';
import { makeStamp } from '../lib/stamp.mjs';

// UI-240. The manifest row and the manifest are built by one pair of functions (lib/manifest.mjs buildRow and
// buildManifest), used by the harness (capture.mjs) and by the reports' fixtures (reports/__fixtures__/rows.ts), so a
// fixture can never drift from what the harness writes. The manifest's top level has a validator of its own,
// validateManifest, which the harness runs before it writes and every report's reader runs before it reads a row.

const H = (c: string) => c.repeat(64);
const SHA = 'a'.repeat(40);
const STAMP = makeStamp({ commit: SHA, porcelain: '', bundleSha256: H('3'), tokens: {}, entry: 'index.lab.js', createdAt: '2026-10-04T11:00:00.000Z' });
const BUILD = { head: SHA, stamp: STAMP, apkSha256: H('4'), hermes: true, skiaVersion: '2.6.9' };
const FACTS = { model: 'SM-S906B', fingerprint: 'samsung/g0s:16/x/1:user/release-keys', width: 1080, height: 2340, density: 420, refreshRate: 120, forceDark: false, locale: 'he-IL' };
const RENDER = {
  gl: { renderer: 'Adreno (TM) 730', gles: 'OpenGL ES 3.2', reason: null },
  display: { colorMode: 'ColorMode::SRGB (7)', wideColor: true, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: null },
};
const STAGE_PX = { x: 0, y: 0, width: 1080, height: 2340 };

/** The sources one shot's row is built from, as captureShot holds them. */
const sources = (over: Record<string, unknown> = {}) => ({
  shot: { id: 'dark-three', scene: 'field.abyss.dark.three.full', device: { fontScale: 1.15 }, expect: { direction: 'abyss', face: 'dark', hero: 'three', tier: 'full' } },
  repeat: 2,
  file: 'dark-three.2.png',
  sha256: H('1'),
  appRegionHash: H('2'),
  build: BUILD,
  app: { package: 'com.kokonadahealth.lab', activity: 'com.kokonadahealth.lab.DesignLabActivity' },
  facts: FACTS,
  frame: { width: 1080, height: 2340, colorSpace: 'sRGB' },
  observed: { fontScale: 1.15, night: 'yes', animatorScales: { window: 1, transition: 0, animator: 0 } },
  ready: {
    run: 'r', seq: 4, scene: 'field.abyss.dark.three.full', clock: 'fixed', t: 11000, powerSave: true, tier: 'full', isRTL: true, fontScale: 1.149,
    shaderStatus: 'ready', shaderReason: '', pixelRatio: 2.625, sentinel: 's',
    probes: { stage: { dp: { x: 0, y: 0, width: 411.43, height: 891.43 }, px: STAGE_PX } },
  },
  region: { x: 0, y: 84, width: 1080, height: 2130 },
  probes: { inside: {}, excluded: [{ id: 'stage', reason: 'partly under the system bars', px: STAGE_PX }] },
  timestamps: { launched: new Date('2026-11-15T10:00:00.000Z'), ready: new Date('2026-11-15T10:00:01.000Z'), captured: new Date('2026-11-15T10:00:01.500Z') },
  renderFacts: { renderScale: 0.5, sampling: { filter: 'linear', mipmap: 'none' } },
  render: RENDER,
  ...over,
});

describe('buildRow: one row from the sources the harness holds', () => {
  it('maps every source to its field, and the row is one validateRow accepts', () => {
    const row = buildRow(sources());
    expect(row).toEqual({
      shot: 'dark-three', repeat: 2, file: 'dark-three.2.png', sha256: H('1'), appRegionHash: H('2'),
      commit: { sha: SHA, porcelainEmpty: true },
      stamp: { bundleSha256: H('3'), tokens: {} },
      device: { model: FACTS.model, fingerprint: FACTS.fingerprint, width: 1080, height: 2340, density: 420, refreshRate: 120 },
      app: { package: 'com.kokonadahealth.lab', apkSha256: H('4'), buildType: 'lab', hermes: true, dev: false },
      scene: 'field.abyss.dark.three.full', direction: 'abyss', face: 'dark',
      fontScale: { requested: 1.15, observed: 1.15, app: 1.149 },
      motion: { reduceMotionObserved: true, powerSaveObserved: true, tier: 'full' },
      locale: 'he-IL',
      isRTL: true,
      clock: { mode: 'fixed', t: 11000, seq: 4 },
      shaderStatus: 'ready',
      uimode: 'night',
      animatorScales: { window: 1, transition: 0, animator: 0 },
      forceDark: false,
      colorSpace: 'sRGB',
      region: { x: 0, y: 84, width: 1080, height: 2130 },
      probes: { inside: {}, excluded: [{ id: 'stage', reason: 'partly under the system bars', px: STAGE_PX }] },
      timestamps: { launched: '2026-11-15T10:00:00.000Z', ready: '2026-11-15T10:00:01.000Z', captured: '2026-11-15T10:00:01.500Z' },
      expect: { direction: 'abyss', face: 'dark', hero: 'three', tier: 'full' },
      renderScale: 0.5,
      sampling: { filter: 'linear', mipmap: 'none' },
      gl: RENDER.gl,
      display: RENDER.display,
      skiaVersion: '2.6.9',
      shaderReason: null,
      stage: STAGE_PX,
      pixelRatio: 2.625,
    });
    expect(validateRow(row)).toEqual([]);
  });

  it('keeps the harness\'s field order (the bytes it writes)', () => {
    expect(Object.keys(buildRow(sources()))).toEqual([
      'shot', 'repeat', 'file', 'sha256', 'appRegionHash', 'commit', 'stamp', 'device', 'app', 'scene', 'direction', 'face', 'fontScale',
      'motion', 'locale', 'isRTL', 'clock', 'shaderStatus', 'uimode', 'animatorScales', 'forceDark', 'colorSpace', 'region', 'probes',
      'timestamps', 'expect', 'renderScale', 'sampling', 'gl', 'display', 'skiaVersion', 'shaderReason', 'stage', 'pixelRatio',
    ]);
  });

  it.each([
    ['a day face', { observed: { fontScale: 1.15, night: 'no', animatorScales: { window: 1, transition: 1, animator: 1 } } }, (r: any) => [r.uimode, r.motion.reduceMotionObserved], ['day', false]],
    ['a READY with no tier, t, shader status or reason', { ready: { ...sources().ready, tier: undefined, t: undefined, shaderStatus: undefined, shaderReason: undefined } }, (r: any) => [r.motion.tier, r.clock.t, r.shaderStatus, r.shaderReason], [null, null, null, null]],
    ['a READY saying power save false', { ready: { ...sources().ready, powerSave: false } }, (r: any) => r.motion.powerSaveObserved, false],
    ['a READY whose shader reason is a sentence', { ready: { ...sources().ready, shaderReason: 'the effect did not compile' } }, (r: any) => r.shaderReason, 'the effect did not compile'],
    ['a stamp without tokens', { build: { ...BUILD, stamp: { ...STAMP, tokens: undefined } } }, (r: any) => r.stamp.tokens, {}],
    ['a scene with no tier', { renderFacts: { renderScale: null, sampling: null } }, (r: any) => [r.renderScale, r.sampling], [null, null]],
    ['READY\'s pixel ratio, as READY sent it (never the density\'s)', { ready: { ...sources().ready, pixelRatio: 2.6250004 } }, (r: any) => r.pixelRatio, 2.6250004],
    ['a READY with no pixel ratio: none (validateRow refuses the row)', { ready: { ...sources().ready, pixelRatio: undefined } }, (r: any) => 'pixelRatio' in r && r.pixelRatio !== undefined, false],
  ])('%s', (_label, over, pick, want) => {
    expect(pick(buildRow(sources(over)))).toEqual(want);
  });

  it('the stage is READY\'s stage px, its four edges only (a copy, not READY\'s own object)', () => {
    const s = sources({ ready: { ...sources().ready, probes: { stage: { dp: {}, px: { ...STAGE_PX, extra: 1 } } } } });
    const row = buildRow(s) as { stage: unknown };
    expect(row.stage).toEqual(STAGE_PX);
    expect(row.stage).not.toBe((s.ready as { probes: { stage: { px: unknown } } }).probes.stage.px);
  });
});

const TOP_ORDER = [
  'plan', 'outcome', 'failure', 'restoreFailures', 'commit', 'stamp', 'apkSha256', 'device', 'render', 'skiaVersion', 'startedAt',
  'finishedAt', 'rows', 'determinism', 'proofs', 'checks', 'results', 'records', 'moving', 'settleFailures',
];
const OUT = { proofs: [{ shot: 's', kind: 'zero-frames', seconds: 10, frames: 0, passed: true }], checks: [], results: [], records: [], moving: [], settleFailures: [] };
const parts = (over: Record<string, unknown> = {}) => ({
  planId: 'smoke', failure: null, restoreFailures: [], build: BUILD, facts: FACTS, render: RENDER,
  startedAt: '2026-11-15T10:00:00.000Z', finishedAt: '2026-11-15T10:01:00.000Z',
  rows: [buildRow(sources())], determinism: [{ shot: 'dark-three', equal: true, hashes: [H('2'), H('2')] }], out: OUT, ...over,
});

describe('buildManifest: the run\'s manifest around its rows', () => {
  it('a passed run: every top-level field in the harness\'s order, and the manifest validateManifest accepts', () => {
    const m = buildManifest(parts());
    expect(Object.keys(m)).toEqual(TOP_ORDER);
    expect(m).toMatchObject({
      plan: 'smoke', outcome: 'passed', failure: null, restoreFailures: [], commit: SHA, stamp: STAMP, apkSha256: H('4'),
      device: FACTS, render: RENDER, skiaVersion: '2.6.9', startedAt: '2026-11-15T10:00:00.000Z', finishedAt: '2026-11-15T10:01:00.000Z',
      proofs: OUT.proofs,
    });
    expect(validateManifest(m)).toEqual([]);
  });

  it('a failure is the failure\'s message, and the run failed', () => {
    const m = buildManifest(parts({ failure: new Error('QA-078: s differs') }));
    expect([m.outcome, m.failure]).toEqual(['failed', 'QA-078: s differs']);
    expect(validateManifest(m)).toEqual([]);
  });

  it('a restore that failed fails the run, though no shot did', () => {
    const m = buildManifest(parts({ restoreFailures: ['settings put system font_scale 0.8: denied'] }));
    expect([m.outcome, m.failure, m.restoreFailures]).toEqual(['failed', null, ['settings put system font_scale 0.8: denied']]);
    expect(validateManifest(m)).toEqual([]);
  });
});

describe('validateManifest: the manifest\'s top level', () => {
  const good = () => JSON.parse(JSON.stringify(buildManifest(parts()))) as Record<string, any>;

  it.each(TOP_ORDER)('refuses a manifest without %s', (key) => {
    const m = good();
    delete m[key];
    expect(validateManifest(m)).toEqual([`${key} is required`]);
  });

  it.each([
    ['not an object', null, /must be an object/],
    ['a list', [], /must be an object/],
    ['a field it does not know', { colour: 'red' }, /^colour is not a manifest field$/],
    ['an outcome that is neither', { outcome: 'partly' }, /^outcome must be one of passed, failed$/],
    ['a passed run with a failure', { failure: 'x' }, /^outcome is "passed", but failure is not null or restoreFailures is not empty$/],
    ['a passed run with a restore failure', { restoreFailures: ['x'] }, /^outcome is "passed", but failure is not null or restoreFailures is not empty$/],
    ['a failed run with nothing that failed', { outcome: 'failed' }, /^outcome is "failed", but failure is null and restoreFailures is empty$/],
    ['an empty failure', { outcome: 'failed', failure: '' }, /^failure must be a string or null$/],
    ['a restore failure that is not a sentence', { outcome: 'failed', restoreFailures: [3] }, /^restoreFailures\[0\] must be a non-empty string$/],
    ['a commit that is not a full sha', { commit: 'abc' }, /^commit must be 40 lowercase hex/],
    ['a stamp of another commit', { stamp: { ...STAMP, commit: 'b'.repeat(40) } }, /^stamp\.commit must be the manifest's commit/],
    ['a stamp of a dirty tree', { stamp: { ...STAMP, porcelainEmpty: false } }, /^stamp\.porcelainEmpty must be true$/],
    ['a stamp of a dev bundle', { stamp: { ...STAMP, dev: true } }, /^stamp\.dev must be false$/],
    ['a stamp with a field it does not know', { stamp: { ...STAMP, extra: 1 } }, /^stamp\.extra is not a manifest field$/],
    ['an APK hash that is not sha256', { apkSha256: 'x' }, /^apkSha256 must be 64 lowercase hex/],
    ['a device without its density', { device: { ...FACTS, density: undefined } }, /^device\.density is required$/],
    ['a device density of zero', { device: { ...FACTS, density: 0 } }, /^device\.density must be an integer >= 1$/],
    ['a device without its locale', { device: { ...FACTS, locale: '' } }, /^device\.locale must be a non-empty string$/],
    ['a device force-dark that is not a boolean', { device: { ...FACTS, forceDark: 'no' } }, /^device\.forceDark must be a boolean$/],
    ['a GL renderer of null without a reason', { render: { ...RENDER, gl: { ...RENDER.gl, renderer: null } } }, /^render\.gl\.reason must say why a fact is null \(renderer\)$/],
    ['a display reason beside complete facts', { render: { ...RENDER, display: { ...RENDER.display, reason: 'x' } } }, /^render\.display\.reason must be null when every fact is read$/],
    ['a Skia version that is not one', { skiaVersion: 'latest' }, /^skiaVersion must be a semver version$/],
    ['a start that is not ISO 8601', { startedAt: 'today' }, /^startedAt must be an ISO 8601/],
    ['a finish before the start', { finishedAt: '2026-11-15T09:00:00.000Z' }, /^finishedAt must not be before startedAt$/],
    ['rows that are not a list', { rows: {} }, /^rows must be a list$/],
    ['a row that is not an object', { rows: ['x'] }, /^rows\[0\] must be an object$/],
    ['determinism that is not a list', { determinism: {} }, /^determinism must be a list$/],
    ['a determinism entry that is not an object', { determinism: ['x'] }, /^determinism\[0\] must be an object$/],
    ['proofs that are not a list', { proofs: null }, /^proofs must be a list$/],
    ['a check that is not an object', { checks: [1] }, /^checks\[0\] must be an object$/],
    ['results that are not a list', { results: 'x' }, /^results must be a list$/],
    ['a record that is not an object', { records: [[]] }, /^records\[0\] must be an object$/],
    ['moving that is not a list', { moving: {} }, /^moving must be a list$/],
    ['a settle failure that is not an object', { settleFailures: [null] }, /^settleFailures\[0\] must be an object$/],
  ])('refuses %s', (_label, over, why) => {
    const m = over === null || Array.isArray(over) ? over : { ...good(), ...over };
    const errors = validateManifest(m);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: string) => why.test(e))).toBe(true);
  });

  it('a null GL fact is accepted with its reason', () => {
    expect(validateManifest({ ...good(), render: { ...RENDER, gl: { renderer: null, gles: null, reason: 'dumpsys SurfaceFlinger: timeout' } } })).toEqual([]);
  });

  it('a row is the readers\' and validateRow\'s to judge, not the top level\'s; an entry of another list its report\'s', () => {
    expect(validateManifest({ ...good(), rows: [{ shot: 'x' }] })).toEqual([]);
    expect(validateManifest({ ...good(), determinism: [{ shot: 's', equal: true }] })).toEqual([]);
  });
});

// UI-240: a row's px per dp is READY's pixel ratio (PixelRatio.get(), which is Android's DisplayMetrics.density), never one
// derived from the density. The density is kept only as a cross-check: Android's float density for the row's dpi
// (densityDpi × (1f / 160) in float) must agree with the pixel ratio within 1e-6, or the row is refused.
describe('rowPixelRatio: the px per dp every report reads', () => {
  const at = (pixelRatio: unknown, density: unknown = 420) => ({ pixelRatio, device: { density } });

  it.each([[40, 0.25], [160, 1], [420, 2.625], [450, 2.8125], [411, 2.5687501430511475], [393, 2.456249952316284]])('Android\'s float density at %i dpi is %d', (dpi, k) => {
    expect(androidDensity(dpi)).toBe(k);
  });

  it('is READY\'s pixel ratio when the density agrees', () => {
    expect(rowPixelRatio(at(2.625))).toEqual({ pixelRatio: 2.625 });
    expect(rowPixelRatio(at(2.5687501430511475, 411))).toEqual({ pixelRatio: 2.5687501430511475 });
  });

  it('is READY\'s own value within 1e-6 of the density\'s, not the density\'s', () => {
    expect(rowPixelRatio(at(2.625 + 9e-7))).toEqual({ pixelRatio: 2.625 + 9e-7 });
    expect(rowPixelRatio(at(2.625 - 9e-7))).toEqual({ pixelRatio: 2.625 - 9e-7 });
    // Float noise only: 411 / 160 is 1.4e-7 from Android's float density, inside the agreement, and the row's value stands.
    expect(rowPixelRatio(at(2.56875, 411))).toEqual({ pixelRatio: 2.56875 });
  });

  it.each([
    ['a pixel ratio 2e-6 off the density\'s', at(2.625 + 2e-6), 'pixelRatio', /^is 2\.625002, not Android's density 2\.625 for device\.density 420 dpi: they must agree within 1e-6$/],
    ['a pixel ratio of another density (420 dpi read as 2.75)', at(2.75), 'pixelRatio', /^is 2\.75, not Android's density 2\.625 for device\.density 420 dpi/],
    ['a row with no pixel ratio', { device: { density: 420 } }, 'pixelRatio', /^is missing: the px per dp is READY's pixel ratio, never one derived from the density$/],
    ['a pixel ratio of zero', at(0), 'pixelRatio', /^must be READY's pixel ratio, a finite number above 0, got 0$/],
    ['a pixel ratio that is a string', at('2.625'), 'pixelRatio', /^must be READY's pixel ratio, a finite number above 0, got "2\.625"$/],
    ['a row with no density to check it by', { pixelRatio: 2.625, device: {} }, 'device.density', /^must be a dpi above 0, got null$/],
    ['a density of zero', at(2.625, 0), 'device.density', /^must be a dpi above 0, got 0$/],
    ['a row that is not an object', null, 'pixelRatio', /^is missing/],
  ])('refuses %s, naming the field', (_label, row, field, why) => {
    const r = rowPixelRatio(row) as { field: string; why: string };
    expect(r.field).toBe(field);
    expect(r.why).toMatch(why);
  });
});
