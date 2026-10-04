/// <reference types="node" />
import { validateRow } from '../lib/manifest.mjs';
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
};

describe('a manifest row is checked against its schema', () => {
  it('a complete row passes', () => {
    expect(validateRow(ROW)).toEqual([]);
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

describe('the stamp chain', () => {
  const stamp = makeStamp({ commit: SHA, porcelain: '', bundleSha256: H('3'), tokens: {}, entry: 'index.lab.js', createdAt: '2026-10-04T11:00:00.000Z' });
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
});
