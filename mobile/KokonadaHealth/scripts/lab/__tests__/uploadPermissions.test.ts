/// <reference types="node" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkUploadManifest, manifestFacts } from '../assertManifests.mjs';
import { allowedPermissions } from '../uploadPermissions.mjs';

// MB-093 (CMP-113). The permission gate on the MERGED manifest of every variant that can be
// uploaded. The merged manifest is what the APK or AAB declares, after every library's manifest is
// folded in; a check on the source manifest is how rxandroidble's location entries slipped through.
//   · no <uses-permission-sdk-23> (or its alias <uses-permission-sdk-m>) entry for any location
//     permission;
//   · no COARSE or BACKGROUND location, in any form;
//   · ACCESS_FINE_LOCATION, BLUETOOTH and BLUETOOTH_ADMIN only with maxSdkVersion <= 30;
//   · BLUETOOTH_SCAN carries neverForLocation;
//   · every other permission is on an explicit allow-list, derived from the merged release manifest
//     at 55d68cc, so a library cannot add one silently.
//
// The fixture is that merged release manifest, byte for byte except line endings, as Gradle wrote
// it (processReleaseMainManifest) before the fix. Its lines 90-91 are rxandroidble's entries.

const TODAY = fs.readFileSync(path.join(__dirname, '../__fixtures__/merged-release-manifest-55d68cc.xml'), 'utf8');
const RX_ROWS = [
  '<uses-permission-sdk-23 android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission-sdk-23 android:name="android.permission.ACCESS_FINE_LOCATION" />',
];
const without = (xml: string, row: string) => {
  if (!xml.includes(row)) throw new Error(`fixture anchor missing: ${row}`);
  return xml.replace(row, '');
};
// Today's merged release manifest with rxandroidble's two rows taken out: what the fix produces.
const CLEAN = RX_ROWS.reduce(without, TODAY);

const APP_OPEN = '<application';
const plant = (row: string, xml = CLEAN) => {
  if (!xml.includes(APP_OPEN)) throw new Error('fixture anchor missing: <application');
  return xml.replace(APP_OPEN, `${row}\n    ${APP_OPEN}`);
};
// Rewrites the attributes after android:name on the one <uses-permission> naming `name`.
const reattribute = (name: string, attrs: string, xml = CLEAN) => {
  const element = new RegExp(`(<uses-permission\\s+android:name="${name.replace(/\./g, '\\.')}")[^>]*?(\\s*/>)`);
  if (!element.test(xml)) throw new Error(`fixture anchor missing: <uses-permission ${name}>`);
  return xml.replace(element, `$1${attrs ? ` ${attrs}` : ''}$2`);
};

const P = (p: string) => `android.permission.${p}`;
const namesIn = (xml: string) => manifestFacts(xml).permissionEntries.map((e: { name: string }) => e.name).sort();

describe('manifestFacts reads every permission element with the attributes the gate needs', () => {
  it('keeps the element, the name, maxSdkVersion and usesPermissionFlags of each entry', () => {
    const entries = manifestFacts(TODAY).permissionEntries;
    expect(entries).toHaveLength(17);
    expect(entries).toContainEqual({ element: 'uses-permission', name: P('ACCESS_FINE_LOCATION'), maxSdkVersion: '30', flags: null });
    expect(entries).toContainEqual({ element: 'uses-permission-sdk-23', name: P('ACCESS_FINE_LOCATION'), maxSdkVersion: null, flags: null });
    expect(entries).toContainEqual({ element: 'uses-permission-sdk-23', name: P('ACCESS_COARSE_LOCATION'), maxSdkVersion: null, flags: null });
    expect(entries).toContainEqual({ element: 'uses-permission', name: P('BLUETOOTH_SCAN'), maxSdkVersion: null, flags: 'neverForLocation' });
  });

  it('reads <uses-permission-sdk-m> too: the platform parses it exactly as <uses-permission-sdk-23>', () => {
    const facts = manifestFacts(plant(`<uses-permission-sdk-m android:name="${P('CAMERA')}" />`));
    expect(facts.permissionEntries).toContainEqual({ element: 'uses-permission-sdk-m', name: P('CAMERA'), maxSdkVersion: null, flags: null });
    expect(facts.permissions).toContain(P('CAMERA'));
  });
});

describe('the release permission gate on real Gradle output', () => {
  it('today\'s merged release manifest (55d68cc) fails on exactly its two rxandroidble rows, lines 90-91', () => {
    const lines = TODAY.split(/\r?\n/).map((l) => l.trim());
    expect(lines[89]).toBe(RX_ROWS[0]);
    expect(lines[90]).toBe(RX_ROWS[1]);
    const problems = checkUploadManifest(TODAY, 'release');
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/<uses-permission-sdk-23> android\.permission\.ACCESS_COARSE_LOCATION: location for API 23 and up/);
    expect(problems[1]).toMatch(/<uses-permission-sdk-23> android\.permission\.ACCESS_FINE_LOCATION: location for API 23 and up/);
  });

  it('passes once those two rows are gone, with FINE still declared, capped at API 30', () => {
    expect(checkUploadManifest(CLEAN, 'release')).toEqual([]);
    expect(manifestFacts(CLEAN).permissionEntries.filter((e: { name: string }) => /LOCATION/.test(e.name)))
      .toEqual([{ element: 'uses-permission', name: P('ACCESS_FINE_LOCATION'), maxSdkVersion: '30', flags: null }]);
  });

  it('the release allow-list is exactly the permission set of that manifest, less the two refused rows', () => {
    expect([...allowedPermissions('release', 'com.kokonadahealth')].sort()).toEqual(namesIn(CLEAN));
    expect(namesIn(CLEAN)).toHaveLength(15);
  });
});

describe('planted rows, one at a time, into the clean release manifest', () => {
  it.each([
    ['sdk-23 FINE location', plant(`<uses-permission-sdk-23 android:name="${P('ACCESS_FINE_LOCATION')}" />`), /<uses-permission-sdk-23> android\.permission\.ACCESS_FINE_LOCATION: location for API 23 and up/],
    ['sdk-23 COARSE location, even capped at 30', plant(`<uses-permission-sdk-23 android:name="${P('ACCESS_COARSE_LOCATION')}" android:maxSdkVersion="30" />`), /<uses-permission-sdk-23> android\.permission\.ACCESS_COARSE_LOCATION: location for API 23 and up/],
    ['sdk-23 BACKGROUND location', plant(`<uses-permission-sdk-23 android:name="${P('ACCESS_BACKGROUND_LOCATION')}" />`), /<uses-permission-sdk-23> android\.permission\.ACCESS_BACKGROUND_LOCATION/],
    ['sdk-m FINE location (the sdk-23 alias)', plant(`<uses-permission-sdk-m android:name="${P('ACCESS_FINE_LOCATION')}" />`), /<uses-permission-sdk-m> android\.permission\.ACCESS_FINE_LOCATION: location for API 23 and up/],
    ['COARSE location, capped at 30', plant(`<uses-permission android:name="${P('ACCESS_COARSE_LOCATION')}" android:maxSdkVersion="30" />`), /ACCESS_COARSE_LOCATION: COARSE and BACKGROUND location are never declared, in any form/],
    ['BACKGROUND location', plant(`<uses-permission android:name="${P('ACCESS_BACKGROUND_LOCATION')}" />`), /ACCESS_BACKGROUND_LOCATION: COARSE and BACKGROUND location are never declared, in any form/],
    ['FINE with no cap', reattribute(P('ACCESS_FINE_LOCATION'), ''), /ACCESS_FINE_LOCATION with maxSdkVersion=none: it is allowed only up to API 30/],
    ['FINE capped at 31', reattribute(P('ACCESS_FINE_LOCATION'), 'android:maxSdkVersion="31"'), /ACCESS_FINE_LOCATION with maxSdkVersion=31: it is allowed only up to API 30/],
    ['FINE with an empty cap', reattribute(P('ACCESS_FINE_LOCATION'), 'android:maxSdkVersion=""'), /ACCESS_FINE_LOCATION with maxSdkVersion=: it is allowed only up to API 30/],
    ['FINE with a cap that is not a number', reattribute(P('ACCESS_FINE_LOCATION'), 'android:maxSdkVersion="3O"'), /ACCESS_FINE_LOCATION with maxSdkVersion=3O/],
    ['BLUETOOTH with no cap', reattribute(P('BLUETOOTH'), ''), /BLUETOOTH with maxSdkVersion=none/],
    ['BLUETOOTH_ADMIN capped at 32', reattribute(P('BLUETOOTH_ADMIN'), 'android:maxSdkVersion="32"'), /BLUETOOTH_ADMIN with maxSdkVersion=32/],
    ['BLUETOOTH_SCAN without neverForLocation', reattribute(P('BLUETOOTH_SCAN'), ''), /BLUETOOTH_SCAN without usesPermissionFlags="neverForLocation"/],
    ['BLUETOOTH_SCAN with an empty flag', reattribute(P('BLUETOOTH_SCAN'), 'android:usesPermissionFlags=""'), /BLUETOOTH_SCAN without usesPermissionFlags="neverForLocation"/],
    ['a permission no one chose (CAMERA)', plant(`<uses-permission android:name="${P('CAMERA')}" />`), /android\.permission\.CAMERA, which is not on the release permission allow-list/],
    ['a health type the app does not read', plant(`<uses-permission android:name="${P('health.READ_STEPS')}" />`), /android\.permission\.health\.READ_STEPS, which is not on the release permission allow-list/],
    ['a permission no one chose, requested for API 23 and up (BODY_SENSORS)', plant(`<uses-permission-sdk-23 android:name="${P('BODY_SENSORS')}" />`), /android\.permission\.BODY_SENSORS, which is not on the release permission allow-list/],
    ['another package\'s receiver permission', plant('<uses-permission android:name="com.example.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" />'), /com\.example\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION, which is not on the release permission allow-list/],
    ['the debug overlay permission in release', plant(`<uses-permission android:name="${P('SYSTEM_ALERT_WINDOW')}" />`), /SYSTEM_ALERT_WINDOW, which is not on the release permission allow-list/],
    ['a permission element with no name', plant('<uses-permission android:maxSdkVersion="30" />'), /a <uses-permission> with no android:name/],
  ])('fails with %s', (_label, xml, why) => {
    const problems = checkUploadManifest(xml, 'release');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(why);
  });

  it.each([
    ['FINE capped at 30', reattribute(P('ACCESS_FINE_LOCATION'), 'android:maxSdkVersion="30"')],
    ['FINE capped lower, at 29', reattribute(P('ACCESS_FINE_LOCATION'), 'android:maxSdkVersion="29"')],
    ['BLUETOOTH_ADMIN capped at 28', reattribute(P('BLUETOOTH_ADMIN'), 'android:maxSdkVersion="28"')],
  ])('passes with %s', (_label, xml) => {
    expect(checkUploadManifest(xml, 'release')).toEqual([]);
  });
});

describe('the debug build types', () => {
  const overlay = plant(`<uses-permission android:name="${P('SYSTEM_ALERT_WINDOW')}" />`);

  it('may also hold SYSTEM_ALERT_WINDOW, which react-android\'s debug library declares for its dev overlay', () => {
    expect(checkUploadManifest(overlay, 'debug')).toEqual([]);
    expect(checkUploadManifest(overlay, 'debugOptimized')).toEqual([]);
  });

  it('a variant the gate does not know gets the release allow-list, the strictest', () => {
    expect(checkUploadManifest(overlay, 'staging').join('\n')).toMatch(/SYSTEM_ALERT_WINDOW, which is not on the release permission allow-list/);
  });

  it('every other rule holds for debug too', () => {
    expect(checkUploadManifest(TODAY, 'debug')).toHaveLength(2);
    expect(checkUploadManifest(plant(`<uses-permission android:name="${P('CAMERA')}" />`), 'debug').join('\n')).toMatch(/CAMERA, which is not on the debug permission allow-list/);
  });
});

describe('the CLI runs the gate on every merged manifest of an uploadable variant', () => {
  const LAB = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.kokonadahealth.lab">
    <application android:name="com.kokonadahealth.MainApplication" android:usesCleartextTraffic="false">
        <activity android:name="com.kokonadahealth.lab.DesignLabActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;
  const SCRIPT = path.resolve(__dirname, '../assertManifests.mjs');
  let build: string;
  beforeEach(() => { build = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-permissions-')); });
  afterEach(() => { fs.rmSync(build, { recursive: true, force: true }); });
  const place = (variant: string, xml: string, kind = 'merged_manifest') => {
    const dir = path.join(build, 'intermediates', kind, variant, `process${variant[0].toUpperCase()}${variant.slice(1)}MainManifest`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'AndroidManifest.xml'), xml);
  };
  const cli = () => spawnSync(process.execPath, [SCRIPT, '--build-dir', build], { encoding: 'utf8' });

  it('exits 1 on today\'s merged release manifest and names both rows', () => {
    place('release', TODAY);
    place('lab', LAB);
    const r = cli();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/release \(merged_manifest\)/);
    expect(r.stderr).toMatch(/<uses-permission-sdk-23> android\.permission\.ACCESS_COARSE_LOCATION/);
    expect(r.stderr).toMatch(/<uses-permission-sdk-23> android\.permission\.ACCESS_FINE_LOCATION/);
  });

  it('exits 1 when only the debug manifest carries a permission off its allow-list', () => {
    place('release', CLEAN);
    place('lab', LAB);
    place('debug', plant(`<uses-permission android:name="${P('CAMERA')}" />`));
    const r = cli();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/debug \(merged_manifest\)[\s\S]*CAMERA, which is not on the debug permission allow-list/);
  });

  it('exits 0 on the fixed manifests and says how many permissions it checked', () => {
    place('release', CLEAN);
    place('lab', LAB);
    place('debug', plant(`<uses-permission android:name="${P('SYSTEM_ALERT_WINDOW')}" />`));
    const r = cli();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/release \(merged_manifest\): no Design Lab; 15 permissions, all on the release allow-list/);
    expect(r.stdout).toMatch(/debug \(merged_manifest\): no Design Lab; 16 permissions, all on the debug allow-list/);
  });
});
