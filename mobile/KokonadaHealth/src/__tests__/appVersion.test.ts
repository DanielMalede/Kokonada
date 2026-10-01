/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { APP_VERSION, APP_VERSION_NAME, APP_VERSION_CODE } from '../appVersion';

// MB-062 (REG-034): each consent grant records the build it was given in. JS cannot read the
// installed package's version without a native module, so the build identity is a constant here,
// pinned to the native version fields it mirrors — bump them together, and this fails if one moves
// alone. (HX DT-7's pattern: one value, its native twin, a drift test.)

const APP = path.resolve(__dirname, '../..');
const gradle = fs.readFileSync(path.join(APP, 'android/app/build.gradle'), 'utf8');
const pbxproj = fs.readFileSync(path.join(APP, 'ios/KokonadaHealth.xcodeproj/project.pbxproj'), 'utf8');

describe('APP_VERSION mirrors the native build', () => {
  it('matches android/app/build.gradle versionName and versionCode', () => {
    expect(gradle.match(/^\s*versionName\s+"([^"]+)"/m)?.[1]).toBe(APP_VERSION_NAME);
    expect(Number(gradle.match(/^\s*versionCode\s+(\d+)/m)?.[1])).toBe(APP_VERSION_CODE);
  });

  it('matches every iOS MARKETING_VERSION and CURRENT_PROJECT_VERSION', () => {
    const marketing = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim());
    const build = [...pbxproj.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => Number(m[1].trim()));
    expect(marketing.length).toBeGreaterThan(0);
    expect(new Set(marketing)).toEqual(new Set([APP_VERSION_NAME]));
    expect(new Set(build)).toEqual(new Set([APP_VERSION_CODE]));
  });

  it('reads as "<versionName> (<versionCode>)"', () => {
    expect(APP_VERSION).toBe(`${APP_VERSION_NAME} (${APP_VERSION_CODE})`);
  });
});
