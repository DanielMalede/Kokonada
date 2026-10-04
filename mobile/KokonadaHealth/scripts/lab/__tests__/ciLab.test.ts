/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

// MB-084 (round-1 review: C5, N2, SF-3). What CI runs for the Design Lab, pinned line by line,
// because a CI step that quietly stops checking still reports green.
//   · the mobile job runs the exclusion check on every PR, with no path filter;
//   · the Android job merges both manifests, compiles both variants' Kotlin, and runs the REAL
//     release JS task (createBundleReleaseJsAndAssets), so the react {} configuration is covered;
//   · it scans the release classes (exit 0) and, as a positive control, the lab classes (exit 1
//     exactly: 0 or 2 would mean the scan cannot see a lab class);
//   · it scans the release task's own bundle and sourcemaps, after checking they exist;
//   · the Android job also runs when modules/ (spotify-remote's manifest and AAR) or an index*.js changes.

const REPO = path.resolve(__dirname, '../../../../..');
const ci = fs.readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8').split(/\r?\n/);
const commands = ci.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));

const ANDROID_LAB_STEP = [
  './gradlew :app:processReleaseMainManifest :app:processLabMainManifest :app:compileLabKotlin :app:compileReleaseKotlin :app:createBundleReleaseJsAndAssets --console=plain',
  'node ../scripts/lab/assertManifests.mjs',
  'node ../scripts/lab/assertLabExcluded.mjs --scan app/build/tmp/kotlin-classes/release',
  'rc=0; node ../scripts/lab/assertLabExcluded.mjs --scan app/build/tmp/kotlin-classes/lab || rc=$?',
  'test "$rc" -eq 1',
  'test -s app/build/generated/assets/react/release/index.android.bundle',
  'test -s app/build/intermediates/sourcemaps/react/release/index.android.bundle.packager.map',
  'node ../scripts/lab/assertLabExcluded.mjs --scan app/build/generated/assets/react/release app/build/intermediates/sourcemaps/react/release app/build/generated/sourcemaps/react/release',
];

describe('the Design Lab steps in CI', () => {
  it('the mobile job runs the exclusion check directly', () => {
    expect(commands).toContain('run: node scripts/lab/assertLabExcluded.mjs');
  });

  it('the Android lab step runs exactly these commands, in this order', () => {
    const start = commands.indexOf(ANDROID_LAB_STEP[0]);
    expect(start).toBeGreaterThan(-1);
    expect(commands.slice(start, start + ANDROID_LAB_STEP.length)).toEqual(ANDROID_LAB_STEP);
  });

  it('the Android job also runs when modules/, an index*.js or the lab scripts change', () => {
    const filter = ci.map((l) => l.trim());
    for (const glob of ['android/**', 'modules/**', 'index*.js', 'scripts/lab/**']) {
      expect(filter).toContain(`- 'mobile/KokonadaHealth/${glob}'`);
    }
  });
});
