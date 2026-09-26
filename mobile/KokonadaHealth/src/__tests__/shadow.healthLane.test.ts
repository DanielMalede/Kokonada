/// <reference types="node" />
// SHADOW QA — permanent static guards for H2 (DT-6): live heart rate, the whr_ mint, any Bluetooth
// use and any Health Connect data read happen ONLY behind the health lane, and the Spotify player is
// connected only from its gated call sites. The behaviour is proven in the lane / services /
// bootstrap suites; these scans stop a FUTURE edit from opening a second door around the gate — the
// way the boot path used to call startBiometrics directly, with no consent and no wearable check.
//
// Pure fs scans over PRODUCTION files (tests excluded), with comments stripped first so a comment
// that names an API is never mistaken for a call. The detectors are exercised on synthetic sources
// below, so a guard that silently matches nothing fails loudly instead of passing.

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => path.relative(SRC_ROOT, f).replace(/\\/g, '/');

// Block comments, then line comments (not the `//` inside a URL like https://).
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

// Every module a file imports or requires AT RUNTIME, resolved to a src-relative path (no
// extension). Type-only imports are erased at compile time and open no path, so they are skipped.
export function importsOf(file: string, code: string): string[] {
  const runtime = code.replace(/\b(import|export)\s+type\s[^;]*?from\s+['"][^'"]+['"]\s*;?/g, '');
  const specs = [
    ...runtime.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...runtime.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...runtime.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
  return specs
    .filter((s) => s.startsWith('.'))
    .map((s) => path.relative(SRC_ROOT, path.resolve(path.dirname(file), s)).replace(/\\/g, '/'));
}

const PROD = walk(SRC_ROOT).map((f) => ({ file: rel(f), code: stripComments(fs.readFileSync(f, 'utf8')), abs: f }));
const filesMatching = (re: RegExp) => PROD.filter((p) => re.test(p.code)).map((p) => p.file).sort();
const importersOf = (target: string) =>
  PROD.filter((p) => importsOf(p.abs, p.code).includes(target)).map((p) => p.file).sort();

describe('the detectors are not vacuous', () => {
  it('stripComments drops comments that name an API but keeps real calls and URLs', () => {
    const code = stripComments([
      '// requestMultiple( in a line comment',
      '/* startLiveHr( in a block */',
      "const u = 'https://example.com/x';",
      'await PermissionsAndroid.requestMultiple(perms);',
    ].join('\n'));
    expect(code).toContain('requestMultiple(perms)');
    expect(code).toContain('https://example.com/x');
    expect(code).not.toMatch(/startLiveHr\(/);
    expect(code.match(/requestMultiple\(/g)).toHaveLength(1);
  });

  it('importsOf resolves relative imports and requires to src paths', () => {
    const file = path.join(SRC_ROOT, 'health', 'x.ts');
    const code = "import { a } from './liveHr';\nconst b = require('../state/store');";
    expect(importsOf(file, code)).toEqual(['health/liveHr', 'state/store']);
  });

  it('importsOf skips type-only imports (erased at compile time) but keeps mixed ones', () => {
    const file = path.join(SRC_ROOT, 'health', 'x.ts');
    const code = [
      "import type { LiveHrSession } from './liveHr';",
      "import { startLiveHr, type LiveHrSession as S } from './liveHrClient';",
    ].join('\n');
    expect(importsOf(file, code)).toEqual(['health/liveHrClient']);
  });

  it('the scan sees the production tree, including every module it guards', () => {
    const files = PROD.map((p) => p.file);
    expect(files.length).toBeGreaterThan(100);
    for (const f of ['health/liveHr.ts', 'health/biometricsWiring.ts', 'health/healthLaneServices.ts', 'health/blePermissions.ts', 'prodBootstrap.ts']) {
      expect(files).toContain(f);
    }
  });
});

describe('Bluetooth: the lane only CHECKS the grant — nothing asks until P6 ships the disclosure', () => {
  it('requestMultiple( and requestBlePermissions( exist only inside their own definition', () => {
    expect(filesMatching(/\brequestMultiple\(/)).toEqual(['health/blePermissions.ts']);
    expect(filesMatching(/\brequestBlePermissions\(/)).toEqual(['health/blePermissions.ts']);
  });

  it('a BleManager is constructed only by the BLE feed', () => {
    expect(filesMatching(/new\s+BleManager\(/)).toEqual(['health/bleHeartRate.ts']);
  });
});

describe('the live-HR chain has exactly one entrance: the health lane', () => {
  it('liveHr is imported only by biometricsWiring, and biometricsWiring only by the lane services', () => {
    expect(importersOf('health/liveHr')).toEqual(['health/biometricsWiring.ts']);
    expect(importersOf('health/biometricsWiring')).toEqual(['health/healthLaneServices.ts']);
  });

  it('the whr_ mint (getWatchToken) is reached only from startLiveHr', () => {
    expect(filesMatching(/\bgetWatchToken\b/)).toEqual(['health/liveHr.ts', 'health/liveHrClient.ts']);
  });

  it('the lane is built once, in the services module', () => {
    expect(filesMatching(/\bcreateHealthLane\(/)).toEqual(['health/healthLane.ts', 'health/healthLaneServices.ts']);
  });

  it('the bootstraps never reach the feed directly', () => {
    for (const f of ['prodBootstrap.ts', 'appBootstrap.ts']) {
      const code = PROD.find((p) => p.file === f)!.code;
      expect({ f, hits: code.match(/\b(startLiveHr|getWatchToken|requestBlePermissions|startBleHeartRate|startRestFallback)\b|startBiometrics\(\s*\{/g) })
        .toEqual({ f, hits: null });
    }
  });

  it('a Health Connect DATA read happens only in the history sync and the lane\'s fallback', () => {
    expect(filesMatching(/\breadRecords\(/)).toEqual(['health/fetchHistory.ts', 'health/restFallback.ts']);
  });

  it('Generate (the Live toggle, the "Listen to your heart" CTA) never reaches the lane or the feed', () => {
    const generate = PROD.filter((p) => p.file.startsWith('experience/generate/'));
    expect(generate.length).toBeGreaterThan(0);
    const forbidden = ['health/healthLaneServices', 'health/healthLane', 'health/liveHrSwitch', 'health/biometricsWiring', 'health/liveHr', 'health/liveHrClient', 'health/blePermissions'];
    const offenders = generate.flatMap((p) => importsOf(p.abs, p.code).filter((i) => forbidden.includes(i)).map((i) => `${p.file} → ${i}`));
    expect(offenders).toEqual([]);
  });
});

// Review H2-C1: the wearable opt-in is the account's link on THIS phone, and only an explicit
// wearable action creates it — a real Health Connect grant through the consent wall
// (connectController.runSync → onWearableLinked). No other path may write it, and the lane may not
// open on the phone's Health Connect grant alone.
describe('the per-account wearable link changes only through the named triggers', () => {
  it('the link is written only by the lane services (a wearable link, a Disconnect, a withdrawal)', () => {
    expect(filesMatching(/\bliveHrSwitch\.markLinked\(/)).toEqual(['health/healthLaneServices.ts']);
    expect(filesMatching(/\bliveHrSwitch\.switchOff\(/)).toEqual(['health/healthLaneServices.ts']);
    expect(filesMatching(/\bliveHrSwitch\.unlink\(/)).toEqual(['health/healthLaneServices.ts']);
    expect(importersOf('health/liveHrSwitch')).toEqual(['health/healthLaneServices.ts', 'prodBootstrap.ts']);
  });

  it('markLinked runs only inside onWearableLinked', () => {
    const svc = PROD.find((p) => p.file === 'health/healthLaneServices.ts')!.code;
    const body = svc.match(/export function onWearableLinked\(\)[^{]*\{([\s\S]*?)\n\}/);
    expect(body?.[1]).toMatch(/liveHrSwitch\.markLinked\(\)/);
    expect(svc.match(/\bmarkLinked\(/g)).toHaveLength(1);
  });

  it('onWearableLinked is reached only from the two hosts of the connect controller, as its onWearableLinked step', () => {
    expect(importersOf('health/healthLaneServices').filter((f) => PROD.find((p) => p.file === f)!.code.includes('onWearableLinked')))
      .toEqual(['experience/connect/ConnectServicesScreen.tsx', 'experience/profile/ProfileScreen.tsx']);
    for (const f of ['experience/connect/ConnectServicesScreen.tsx', 'experience/profile/ProfileScreen.tsx']) {
      const code = PROD.find((p) => p.file === f)!.code;
      expect({ f, calls: code.match(/\bonWearableLinked\(\)/g) }).toEqual({ f, calls: ['onWearableLinked()'] });
      expect(code).toMatch(/onWearableLinked:\s*\(\)\s*=>\s*\{\s*void onWearableLinked\(\);\s*\}/);
    }
  });

  it('the lane opens on the account\'s link here, never on the phone\'s Health Connect grant alone', () => {
    const svc = PROD.find((p) => p.file === 'health/healthLaneServices.ts')!.code;
    expect(svc).not.toMatch(/hasWearableOptIn:\s*hasHealthConnectLink/);
    const optIn = svc.match(/export async function hasWearableOptIn\(\)[^{]*\{([\s\S]*?)\n\}/);
    expect(optIn?.[1]).toMatch(/liveHrSwitch\.isLinkedHere\(\)/);
  });
});

describe('the Spotify player connects only from its gated call sites', () => {
  // prodBootstrap: behind a session AND a server-confirmed link (playerBootGate). spotifyLinkBack:
  // the user's own return from Spotify's OAuth. playbackServices: the dead startPlayback() — no
  // caller, flagged for the custodian; it must not be re-wired.
  it('player.connect( appears only in prodBootstrap, spotifyLinkBack and the dead startPlayback', () => {
    expect(filesMatching(/\bplayer\.connect\(/)).toEqual([
      'experience/playback/playbackServices.ts',
      'experience/player/spotifyLinkBack.ts',
      'prodBootstrap.ts',
    ]);
  });

  it('startPlayback stays uncalled', () => {
    expect(filesMatching(/\bstartPlayback\(/)).toEqual(['experience/playback/playbackServices.ts']);
  });
});
