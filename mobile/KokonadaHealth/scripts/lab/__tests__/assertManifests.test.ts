/// <reference types="node" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkLabManifest, checkUploadManifest, findMergedManifests, manifestFacts, parseXml } from '../assertManifests.mjs';

// The merged-manifest half of the Design Lab exclusion (MB-084). The merged manifest is what an
// APK or an AAB of a variant actually declares, after every library manifest is folded in, so it
// is checked as AGP writes it rather than as the source manifests read.
//   · every variant that can be uploaded (release, any other non-lab variant) declares no lab
//     activity and is not the lab package;
//   · the lab declares its own launcher and nothing of the real app: no MainActivity, no network,
//     no health or Bluetooth permission, no Health Connect rationale, and no scheme of the real app
//     (kokonada:// is its OAuth return, kokonadahealth:// its Spotify redirect).

const RELEASE = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.kokonadahealth" android:versionCode="1" android:versionName="1.0">
    <!-- a comment the parser must skip -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.health.READ_HEART_RATE" />
    <application android:name="com.kokonadahealth.MainApplication" android:usesCleartextTraffic="false">
        <activity android:name="com.kokonadahealth.MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="kokonada" android:host="integrations" />
            </intent-filter>
        </activity>
        <activity android:name="com.spotify.sdk.android.auth.LoginActivity" android:exported="true">
            <intent-filter>
                <data android:scheme="kokonadahealth" android:host="spotify-callback" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

const LAB = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.kokonadahealth.lab">
    <application android:name="com.kokonadahealth.MainApplication" android:usesCleartextTraffic="false">
        <activity android:name="com.kokonadahealth.lab.DesignLabActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <activity android:name="com.spotify.sdk.android.auth.LoginActivity" android:exported="true">
            <intent-filter>
                <data android:scheme="kokonadalab-unused" android:host="never" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

// Each defect is planted into an otherwise-clean lab manifest, one at a time.
const plantInLab = (find: string, replace: string) => {
  if (!LAB.includes(find)) throw new Error(`fixture anchor missing: ${find}`);
  return LAB.replace(find, replace);
};
const APP_OPEN = '<application android:name="com.kokonadahealth.MainApplication" android:usesCleartextTraffic="false">';

describe('parseXml / manifestFacts', () => {
  it('reads the package, activities, launchers, permissions, schemes and cleartext flag', () => {
    const facts = manifestFacts(RELEASE);
    expect(facts.package).toBe('com.kokonadahealth');
    expect(facts.components.map((c: { name: string }) => c.name)).toEqual(['com.kokonadahealth.MainActivity', 'com.spotify.sdk.android.auth.LoginActivity']);
    expect(facts.launchers).toEqual(['com.kokonadahealth.MainActivity']);
    expect(facts.permissions).toEqual(['android.permission.INTERNET', 'android.permission.health.READ_HEART_RATE']);
    expect(facts.schemes.sort()).toEqual(['kokonada', 'kokonadahealth']);
    expect(facts.cleartext).toBe('false');
  });

  it('refuses a document that is not a manifest rather than finding nothing in it', () => {
    expect(() => manifestFacts('<resources/>')).toThrow(/manifest/);
    expect(() => parseXml('<manifest><application></manifest>')).toThrow(/xml/i);
    expect(() => parseXml('<a><b></a></b>')).toThrow(/does not close/);
  });
});

describe('a variant that can be uploaded', () => {
  it('passes the real app', () => {
    expect(checkUploadManifest(RELEASE)).toEqual([]);
  });

  it('fails when the lab activity is merged in, under any name it may take', () => {
    const planted = RELEASE.replace('</application>', '<activity android:name="com.kokonadahealth.lab.DesignLabActivity" /></application>');
    expect(checkUploadManifest(planted).join('\n')).toMatch(/DesignLabActivity/);
  });

  it('fails on any component in the lab package, and on an alias that targets the lab activity', () => {
    const service = RELEASE.replace('</application>', '<service android:name="com.kokonadahealth.lab.LabProbeService" /></application>');
    expect(checkUploadManifest(service).join('\n')).toMatch(/LabProbeService/);
    const alias = RELEASE.replace('</application>', '<activity-alias android:name="com.kokonadahealth.Door" android:targetActivity="com.kokonadahealth.lab.DesignLabActivity" /></application>');
    expect(checkUploadManifest(alias).join('\n')).toMatch(/Door/);
  });

  it('fails when it is the lab package', () => {
    expect(checkUploadManifest(RELEASE.replace('package="com.kokonadahealth"', 'package="com.kokonadahealth.lab"')).join('\n')).toMatch(/lab package/);
  });
});

describe('the lab variant', () => {
  it('passes the lab as designed', () => {
    expect(checkLabManifest(LAB)).toEqual([]);
  });

  it.each([
    ['the real app package', 'package="com.kokonadahealth.lab"', 'package="com.kokonadahealth"', /lab package/],
    ['MainActivity', '</application>', '<activity android:name="com.kokonadahealth.MainActivity" /></application>', /MainActivity/],
    ['the Health Connect rationale', '</application>', '<activity android:name="com.kokonadahealth.PermissionsRationaleActivity" /></application>', /PermissionsRationaleActivity/],
    ['the rationale alias', '</application>', '<activity-alias android:name="com.kokonadahealth.ViewPermissionUsageActivity" android:targetActivity="x" /></application>', /ViewPermissionUsageActivity/],
    ['INTERNET', APP_OPEN, `<uses-permission android:name="android.permission.INTERNET" />${APP_OPEN}`, /INTERNET/],
    ['a health permission', APP_OPEN, `<uses-permission android:name="android.permission.health.READ_SLEEP" />${APP_OPEN}`, /health/],
    ['a Bluetooth permission', APP_OPEN, `<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />${APP_OPEN}`, /BLUETOOTH_SCAN/],
    ['the real Spotify redirect scheme', 'android:scheme="kokonadalab-unused"', 'android:scheme="kokonadahealth"', /kokonadahealth/],
    ['the real OAuth return scheme', 'android:scheme="kokonadalab-unused"', 'android:scheme="kokonada"', /kokonada\b/],
    ['cleartext traffic', 'android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"', /cleartext/],
    ['no launcher', '<category android:name="android.intent.category.LAUNCHER" />', '', /launcher/],
  ])('fails with %s', (_label, find, replace, why) => {
    expect(checkLabManifest(plantInLab(find, replace)).join('\n')).toMatch(why);
  });

  it('fails with a second launcher (the lab activity must be the only way in)', () => {
    const second = '<activity android:name="x.Other"><intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter></activity></application>';
    expect(checkLabManifest(plantInLab('</application>', second)).join('\n')).toMatch(/launcher/);
  });
});

describe('findMergedManifests and the CLI', () => {
  let build: string;
  beforeAll(() => { build = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-manifests-')); });
  afterAll(() => { fs.rmSync(build, { recursive: true, force: true }); });
  const place = (variant: string, xml: string, kind = 'merged_manifest') => {
    const task = `process${variant[0].toUpperCase()}${variant.slice(1)}MainManifest`;
    const dir = path.join(build, 'intermediates', kind, variant, task);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'AndroidManifest.xml'), xml);
  };
  const SCRIPT = path.resolve(__dirname, '../assertManifests.mjs');
  const cli = () => spawnSync(process.execPath, [SCRIPT, '--build-dir', build], { encoding: 'utf8' });

  it('exits 2 when release or lab has not been merged: nothing checked is never a pass', () => {
    place('release', RELEASE);
    expect(cli().status).toBe(2);
  });

  it('finds every merged manifest by variant, and exits 0 on a clean release and lab', () => {
    place('lab', LAB);
    place('debug', RELEASE);
    expect(findMergedManifests(build).map((m: { variant: string }) => m.variant).sort()).toEqual(['debug', 'lab', 'release']);
    const r = cli();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('exits 1 when any uploadable variant (here a bundle manifest of release) carries the lab activity', () => {
    place('release', RELEASE.replace('</application>', '<activity android:name="com.kokonadahealth.lab.DesignLabActivity" /></application>'), 'bundle_manifest');
    const r = cli();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/release/);
  });
});
