/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { readSkiaVersion, validateRow } from '../lib/manifest.mjs';
import { makeStamp, verifyStampChain } from '../lib/stamp.mjs';

// OPS-100. Every capture is a manifest row, checked against its schema before it is written: a row
// is evidence only if it says exactly what was on the device, from which build. And before anything
// touches the device, the stamp chain must hold, end to end:
//   git HEAD + empty porcelain  ->  lab-stamp.json (written by bundleLab)  ->  the bundle in the APK
//   ->  the APK installed on the phone  ->  READY's sentinel.
// Any break, and the harness refuses.

const H = (c: string) => c.repeat(64);
const SHA = 'a'.repeat(40);

const ROW = {
  // UI-276: the row schema the harness writes (a row of no version is one written before it: manifestSkiaBackend.test.ts).
  schemaVersion: 2,
  shot: 'smoke-fixed', repeat: 1, file: 'smoke-fixed.1.png', sha256: H('1'), appRegionHash: H('2'),
  commit: { sha: SHA, porcelainEmpty: true },
  stamp: { bundleSha256: H('3'), tokens: {} },
  device: { model: 'SM-S906B', fingerprint: 'samsung/g0sxeea/g0s:16/x/1:user/release-keys', width: 1080, height: 2340, density: 450, refreshRate: 120 },
  app: { package: 'com.kokonadahealth.lab', apkSha256: H('4'), buildType: 'lab', hermes: true, dev: false },
  scene: 'smoke', direction: null, face: null,
  fontScale: { requested: 1, observed: 1, app: 1 },
  motion: { reduceMotionObserved: false, powerSaveObserved: false, tier: null },
  locale: 'he-IL', isRTL: true,
  clock: { mode: 'fixed', t: 1500, seq: 0 },
  shaderStatus: null,
  uimode: 'night', animatorScales: { window: 1, transition: 1, animator: 1 }, forceDark: false, colorSpace: 'sRGB',
  region: { x: 0, y: 84, width: 1080, height: 2130 },
  probes: { inside: { mark: { x: 1, y: 2, width: 3, height: 4 } }, excluded: [] },
  timestamps: { launched: '2026-10-04T12:00:00.000Z', ready: '2026-10-04T12:00:01.000Z', captured: '2026-10-04T12:00:01.500Z' },
  // B8-5a (F4, F5, UI-216, UI-226): the scene facts from the shot's expect, the render facts derived from them, the GPU
  // and display facts from adb (null only with a reason), Skia's version from the lockfile at HEAD, READY's shader
  // reason and READY's stage rect in px.
  expect: { direction: 'abyss', face: 'dark', hero: 'three', tier: 'full' },
  renderScale: 0.5,
  sampling: { filter: 'linear', mipmap: 'none' },
  gl: { renderer: 'Qualcomm, Adreno (TM) 730', gles: 'OpenGL ES 3.2 V@0615.65', reason: null },
  display: { colorMode: 'ColorMode::SRGB (7)', wideColor: true, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: null },
  skiaVersion: '2.6.9',
  // UI-276: READY's Skia backend, as the lab reads it from react-native-skia (src/design/lab/skiaBackend.ts).
  skiaBackend: { backend: 'ganesh-gl', readBy: 'Skia.hasDevice() is false (Ganesh), and a 1x1 Skia.Surface.MakeOffscreen surface\'s native texture is a GL texture on target 0xde1', reason: null },
  shaderReason: null,
  stage: { x: 0, y: 0, width: 1080, height: 2340 },
  // UI-240: READY's pixel ratio (PixelRatio.get()), the px per dp every report reads.
  pixelRatio: 2.8125,
};

// The smoke scene draws no field: no scene facts, no render facts.
const SMOKE_ROW = { ...ROW, expect: { direction: null, face: null, hero: null, tier: null }, renderScale: null, sampling: null };

describe('a manifest row is checked against its schema', () => {
  it('a complete row passes', () => {
    expect(validateRow(ROW)).toEqual([]);
  });

  it('a row of a scene that draws no field passes with null scene and render facts', () => {
    expect(validateRow(SMOKE_ROW)).toEqual([]);
  });

  it.each(['expect', 'renderScale', 'sampling', 'gl', 'display', 'skiaVersion', 'skiaBackend', 'shaderReason', 'stage', 'pixelRatio'])('refuses a row without %s', (key) => {
    const row: Record<string, unknown> = { ...ROW };
    delete row[key];
    expect(validateRow(row)).toEqual([`${key} is required`]);
  });

  it.each([
    ['expect without its tier', { ...ROW, expect: { direction: 'abyss', face: 'dark', hero: 'three' } }, /expect\.tier is required/],
    ['expect with a key it does not know', { ...ROW, expect: { ...ROW.expect, taps: '1' } }, /expect\.taps is not a manifest field/],
    ['a tier that is not a motion tier', { ...ROW, expect: { ...ROW.expect, tier: 'medium' } }, /expect\.tier must be one of full, low, still or null/],
    ['a face that is not a face', { ...ROW, expect: { ...ROW.expect, face: 'dusk' } }, /expect\.face must be one of dark, light or null/],
    ['a render scale of zero', { ...ROW, renderScale: 0 }, /renderScale must be a finite number > 0 or null/],
    ['a sampling filter Skia does not have', { ...ROW, sampling: { filter: 'cubic', mipmap: 'none' } }, /sampling\.filter must be one of/],
    ['a sampling without its mipmap', { ...ROW, sampling: { filter: 'linear' } }, /sampling\.mipmap is required/],
    ['a render scale without its sampling', { ...ROW, sampling: null }, /renderScale and sampling are both null or both set/],
    ['a sampling without its render scale', { ...ROW, renderScale: null }, /renderScale and sampling are both null or both set/],
    ['a GL renderer of null without a reason', { ...ROW, gl: { ...ROW.gl, renderer: null } }, /gl\.reason must say why a fact is null/],
    ['a GL reason beside complete facts', { ...ROW, gl: { ...ROW.gl, reason: 'stale' } }, /gl\.reason must be null when every fact is read/],
    ['a display colour mode of null without a reason', { ...ROW, display: { ...ROW.display, colorMode: null } }, /display\.reason must say why a fact is null/],
    ['a wide-colour fact that is not a boolean', { ...ROW, display: { ...ROW.display, wideColor: 'yes' } }, /display\.wideColor must be a boolean or null/],
    ['a display reason beside complete facts', { ...ROW, display: { ...ROW.display, reason: 'x' } }, /display\.reason must be null when every fact is read/],
    ['a Skia version that is not a version', { ...ROW, skiaVersion: 'latest' }, /skiaVersion must be a semver version/],
    ['a shader reason that is empty', { ...ROW, shaderReason: '' }, /shaderReason must be a string or null/],
    ['a stage without its height', { ...ROW, stage: { x: 0, y: 0, width: 1080 } }, /stage\.height is required/],
    ['a stage of null', { ...ROW, stage: null }, /stage must be an object/],
    ['a pixel ratio of zero', { ...ROW, pixelRatio: 0 }, /^pixelRatio must be a finite number > 0$/],
    ['a pixel ratio that is a string', { ...ROW, pixelRatio: '2.8125' }, /^pixelRatio must be a finite number > 0$/],
    ['a pixel ratio of null', { ...ROW, pixelRatio: null }, /^pixelRatio must be a finite number > 0$/],
  ])('fails %s', (_label, row, why) => {
    expect(validateRow(row).join('\n')).toMatch(why);
  });

  it('a null GL or display fact is accepted with its reason', () => {
    expect(validateRow({ ...ROW, gl: { renderer: null, gles: null, reason: 'no GLES line in dumpsys SurfaceFlinger' } })).toEqual([]);
    expect(validateRow({ ...ROW, display: { colorMode: null, wideColor: null, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: 'no colour mode line' } })).toEqual([]);
  });

  it.each([
    ['a missing field, by its path', { ...ROW, device: { ...ROW.device, fingerprint: undefined } }, /device\.fingerprint is required/],
    ['a wrong type', { ...ROW, isRTL: 'yes' }, /isRTL must be a boolean or null/],
    ['a font scale without the one the app reported at READY', { ...ROW, fontScale: { requested: 1, observed: 1 } }, /fontScale\.app is required/],
    ['a wrong type in a required boolean', { ...ROW, forceDark: 'no' }, /forceDark must be a boolean/],
    ['a build type other than lab (never G11 evidence)', { ...ROW, app: { ...ROW.app, buildType: 'release' } }, /app\.buildType must be "lab"/],
    ['a dev bundle', { ...ROW, app: { ...ROW.app, dev: true } }, /app\.dev must be false/],
    ['a hash that is not sha256 hex', { ...ROW, sha256: 'xyz' }, /sha256 must be 64 lowercase hex/],
    ['a commit that is not a full sha', { ...ROW, commit: { ...ROW.commit, sha: 'abc' } }, /commit\.sha must be 40 lowercase hex/],
    ['a dirty tree', { ...ROW, commit: { ...ROW.commit, porcelainEmpty: false } }, /commit\.porcelainEmpty must be true/],
    ['a colour space other than sRGB', { ...ROW, colorSpace: 'Display P3' }, /colorSpace must be "sRGB"/],
    ['an unknown clock mode', { ...ROW, clock: { ...ROW.clock, mode: 'wall' } }, /clock\.mode must be one of/],
    ['a timestamp that is not ISO 8601', { ...ROW, timestamps: { ...ROW.timestamps, ready: 'yesterday' } }, /timestamps\.ready must be an ISO 8601/],
    ['a field the schema does not know', { ...ROW, colour: 'red' }, /colour is not a manifest field/],
    ['an excluded probe without its reason', { ...ROW, probes: { inside: {}, excluded: [{ id: 'x' }] } }, /probes\.excluded\[0\]\.reason is required/],
  ])('fails %s', (_label, row, why) => {
    expect(validateRow(row).join('\n')).toMatch(why);
  });
});

describe('the Skia version, from the lockfile at HEAD', () => {
  const lock = (packages: unknown) => JSON.stringify({ name: 'KokonadaHealth', lockfileVersion: 3, packages });

  it('reads the installed @shopify/react-native-skia', () => {
    expect(readSkiaVersion(lock({ '': {}, 'node_modules/@shopify/react-native-skia': { version: '2.6.9' } }))).toEqual({ version: '2.6.9', reason: null });
  });

  it('is the lockfile this tree holds', () => {
    const real = fs.readFileSync(path.resolve(__dirname, '../../../package-lock.json'), 'utf8');
    expect(readSkiaVersion(real)).toEqual({ version: JSON.parse(real).packages['node_modules/@shopify/react-native-skia'].version, reason: null });
  });

  it.each([
    ['text that is not JSON', 'garbage{', /not JSON/],
    ['a lockfile without packages', JSON.stringify({ lockfileVersion: 1, dependencies: {} }), /no packages/],
    ['a lockfile without Skia', lock({ 'node_modules/react': { version: '19.0.0' } }), /@shopify\/react-native-skia is not in the lockfile/],
    ['a Skia entry without a version', lock({ 'node_modules/@shopify/react-native-skia': {} }), /no semver version/],
    ['a Skia version that is a range', lock({ 'node_modules/@shopify/react-native-skia': { version: '^2.6.9' } }), /no semver version/],
  ])('is null with a reason for %s, never a guess', (_label, text, why) => {
    const r = readSkiaVersion(text);
    expect(r.version).toBeNull();
    expect(r.reason).toMatch(why);
  });
});

describe('the stamp chain', () => {
  // UI-278: the sha256 of the token files, by their path from the repository root (bundleLab, lib/tokenHashes.mjs).
  const tokens = { 'design-tokens/base.tokens.json': H('5'), 'mobile/KokonadaHealth/src/design/v2/tokens/tokens.generated.ts': H('6') };
  const stamp = makeStamp({ commit: SHA, porcelain: '', bundleSha256: H('3'), tokens, entry: 'index.lab.js', createdAt: '2026-10-04T11:00:00.000Z' });
  const ok = {
    head: SHA, porcelain: '', stamp,
    apk: { bundleSha256: H('3'), stamp: JSON.parse(JSON.stringify(stamp)) },
    builtApkSha256: H('4'), installedApkSha256: H('4'),
  };

  it('a stamp is refused from a dirty tree', () => {
    expect(() => makeStamp({ ...stamp, commit: SHA, porcelain: ' M src/x.ts', bundleSha256: H('3'), tokens: {}, entry: 'index.lab.js', createdAt: stamp.createdAt }))
      .toThrow(/uncommitted/);
  });

  it('records that the bundle was built for release (--dev false) from its entry', () => {
    expect(stamp).toMatchObject({ commit: SHA, porcelainEmpty: true, dev: false, entry: 'index.lab.js' });
  });

  it('holds end to end', () => {
    expect(verifyStampChain(ok)).toEqual([]);
  });

  it.each([
    ['the tree changed since bundling (porcelain)', { ...ok, porcelain: '?? scratch.txt' }, /uncommitted/],
    ['HEAD moved since bundling (SHA)', { ...ok, head: 'b'.repeat(40) }, /built from a{40}.*HEAD is b{40}/],
    ['the APK carries another bundle', { ...ok, apk: { ...ok.apk, bundleSha256: H('9') } }, /APK carries another bundle/],
    ['the APK carries no stamp, or another one', { ...ok, apk: { ...ok.apk, stamp: null } }, /APK carries no lab-stamp/],
    ['the installed APK is not the built one', { ...ok, installedApkSha256: H('8') }, /installed lab is not this APK/],
  ])('refuses when %s', (_label, input, why) => {
    expect(verifyStampChain(input).join('\n')).toMatch(why);
  });

  it('refuses a stamp that is not complete', () => {
    expect(verifyStampChain({ ...ok, stamp: { ...stamp, bundleSha256: undefined } }).join('\n')).toMatch(/stamp/);
  });

  // UI-278: a stamp without the token files' hashes is what made every manifest record `stamp.tokens: {}`, which no check
  // against the token files can read. The same stamp sits on disk and in the APK here, so the hashes are the only fault.
  const withTokens = (t: unknown) => {
    const s = JSON.parse(JSON.stringify({ ...stamp, tokens: t }));
    return { ...ok, stamp: s, apk: { ...ok.apk, stamp: JSON.parse(JSON.stringify(s)) } };
  };
  it.each([
    ['no token hashes (the empty map every manifest recorded)', {}],
    ['no tokens field', undefined],
    ['tokens that are not a map', ['design-tokens/base.tokens.json']],
    ['a token hash that is not a sha256', { ...tokens, 'design-tokens/direction.abyss.tokens.json': 'abc' }],
  ])('refuses a stamp with %s', (_label, t) => {
    expect(verifyStampChain(withTokens(t))).toEqual(['the lab stamp does not carry the sha256 of the token files (UI-278): run node scripts/lab/bundleLab.mjs']);
  });
});
