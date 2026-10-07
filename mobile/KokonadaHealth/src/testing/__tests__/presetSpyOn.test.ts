/// <reference types="node" />
import * as path from 'path';
import { APP_ROOT } from '../guards/productionImports';
import { isTestFile, walkSources } from '../guards/sourceFiles';
import { SPYON_GUARD_ROOTS, presetMockedSpyOns, spyOnSites, spyOnSitesIn } from '../guards/presetSpyOn';

// QA-112: tests never jest.spyOn a member the preset (or jest.setup.js) already mocks. On an existing
// mock, spyOn installs nothing and returns the SHARED mock (jest-mock/build/index.js:737), so
// mockReturnValue mutates it for every later test in the file and mockRestore() strips its
// implementation (OPS-017, OPS-031). Capture and restore the implementation instead (src/testing/faces.ts).
//
// "Already mocked" is read from the module registry before any test runs, here in the unit project,
// so the guard follows the preset and jest.setup.js as they are, with no list to keep in step.

const pristine = (id: string) => require(id);
const quote = String.fromCharCode(39);
const q = (s: string) => quote + s + quote;
const file = (name: string) => path.join(APP_ROOT, 'src/testing/__tests__', name);

describe('QA-112 · the spyOn guard over the opt-in roots', () => {
  it('scans real test files under every opt-in root (an empty input set must fail, not pass)', () => {
    expect(SPYON_GUARD_ROOTS.map((r) => path.relative(APP_ROOT, r).split(path.sep).join('/'))).toEqual(['src/testing']);
    const files = SPYON_GUARD_ROOTS.flatMap((r) => walkSources(r)).filter(isTestFile);
    expect(files.length).toBeGreaterThan(1);
    expect(files.map((f) => path.basename(f))).toContain('presetSpyOn.test.ts');
  });

  it('the scanner sees real call sites: across src/, it resolves jest.spyOn calls on packages', () => {
    const all = walkSources(path.join(APP_ROOT, 'src')).filter(isTestFile);
    expect(all.length).toBeGreaterThan(150);
    const sites = spyOnSitesIn(all);
    expect(sites.filter((s) => s.module === 'react-native').length).toBeGreaterThan(5);
  });

  it('finds 0 spyOn calls on a preset-mocked member in the opt-in roots', () => {
    const files = SPYON_GUARD_ROOTS.flatMap((r) => walkSources(r)).filter(isTestFile);
    expect(presetMockedSpyOns(spyOnSitesIn(files), pristine).map((s) => s.text)).toEqual([]);
  });
});

describe('QA-112 · planted sources (assembled in memory)', () => {
  const flagged = (source: string) =>
    presetMockedSpyOns(spyOnSites(source, file('planted.test.tsx')), pristine).map((s) => `${[s.module, ...s.chain, s.member].join('.')}`);

  it.each([
    // OPS-017's shape: a namespace import and the preset useColorScheme
    ['import * as RN from ' + q('react-native') + ';\njest.spyOn(RN, ' + q('useColorScheme') + ').mockReturnValue(' + q('dark') + ');', 'react-native.useColorScheme'],
    // OPS-031's shape: a named import and the preset AccessibilityInfo member
    ['import { AccessibilityInfo } from ' + q('react-native') + ';\nconst s = jest.spyOn(AccessibilityInfo, ' + q('isReduceMotionEnabled') + ');\ns.mockRestore();', 'react-native.AccessibilityInfo.isReduceMotionEnabled'],
    ['import * as RN from ' + q('react-native') + ';\njest.spyOn(RN.AppState, ' + q('addEventListener') + ');', 'react-native.AppState.addEventListener'],
    ['import { Linking as L } from ' + q('react-native') + ';\njest.spyOn(L, ' + q('openURL') + ');', 'react-native.Linking.openURL'],
    ['const RN = require(' + q('react-native') + ');\njest.spyOn(RN.AccessibilityInfo, ' + q('addEventListener') + ');', 'react-native.AccessibilityInfo.addEventListener'],
    ['const { AccessibilityInfo: A11y } = require(' + q('react-native') + ');\njest.spyOn(A11y, ' + q('isScreenReaderEnabled') + ');', 'react-native.AccessibilityInfo.isScreenReaderEnabled'],
    ['jest.spyOn(require(' + q('react-native') + ').Vibration, ' + q('vibrate') + ');', 'react-native.Vibration.vibrate'],
    // jest.setup.js's global mocks share the failure mode
    ['import { SpotifyRemote } from ' + q('@kokonada/spotify-remote') + ';\njest.spyOn(SpotifyRemote, ' + q('isSpotifyInstalled') + ').mockResolvedValue(true);', '@kokonada/spotify-remote.SpotifyRemote.isSpotifyInstalled'],
    ['import * as HC from ' + q('react-native-health-connect') + ';\njest.spyOn(HC, ' + q('requestPermission') + ');', 'react-native-health-connect.requestPermission'],
  ])('flags %#', (source, member) => {
    expect(flagged(source)).toEqual([member]);
  });

  it('passes a spyOn on a real (unmocked) member, a global, an app module and a planted string', () => {
    const source = [
      'import { Keyboard, Dimensions } from ' + q('react-native') + ';',
      'import { warmStore } from ' + q('../../state/store') + ';',
      'jest.spyOn(Keyboard, ' + q('addListener') + ');',
      'jest.spyOn(Dimensions, ' + q('addEventListener') + ');',
      'jest.spyOn(console, ' + q('error') + ');',
      'jest.spyOn(warmStore, ' + q('subscribe') + ');',
      'const text = ' + q('jest.spyOn(RN, "useColorScheme")') + ';',
    ].join('\n');
    expect(flagged(source)).toEqual([]);
    // …and the scanner did see the four real calls (it is not blind to them)
    expect(spyOnSites(source, file('planted.test.tsx')).length).toBe(4);
  });
});
