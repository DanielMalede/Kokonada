/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { PRIVACY_POLICY_URL } from '../legalLinks';

// HX DT-7 (HX-5): the privacy-policy address and its host are spelled in exactly two files across
// mobile/ — legalLinks.ts and the Android string resource. A third spelling is how the address in a
// screen, the rationale and Play Console come apart. The scan covers the app's source and tests,
// the Android project and mobile/native-snippets (the copy-me files that put the wrong rationale
// wiring in place once already). Build outputs and dependencies are not source and are skipped.

const MOBILE = path.resolve(__dirname, '../../../..');
const APP = path.join(MOBILE, 'KokonadaHealth');
const SKIP_DIRS = new Set(['node_modules', 'build', '.gradle', '.cxx', '.idea', 'Pods', '.bundle']);
const BINARY = /\.(png|jpe?g|webp|gif|ico|ttf|otf|jar|aar|keystore|jks|so|apk|aab|zip|pdf|bin|class|dex|mp3|wav|bundle|hbc)$/i;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, out); }
    else if (!BINARY.test(e.name) && fs.statSync(full).size < 2_000_000) out.push(full);
  }
  return out;
};
const FILES = walk(MOBILE);
const rel = (f: string) => path.relative(MOBILE, f).split(path.sep).join('/');
const read = (f: string) => fs.readFileSync(f, 'utf8');
const filesContaining = (needle: string) => FILES.filter((f) => read(f).toLowerCase().includes(needle.toLowerCase())).map(rel).sort();

const SOURCES = ['KokonadaHealth/android/app/src/main/res/values/strings.xml', 'KokonadaHealth/src/legal/legalLinks.ts'];
const RATIONALE = [
  'KokonadaHealth/android/app/src/main/java/com/kokonadahealth/PermissionsRationaleActivity.kt',
  'native-snippets/PermissionsRationaleActivity.kt',
];
// Built, not written out, so this file never matches its own scan.
const DEVELOPER_PAGE = ['developer.android.com', 'health-and-fitness'].join('/');

describe('the privacy-policy address is spelled in exactly two files (HX DT-7)', () => {
  it('the scan sees the real tree (a walk that finds nothing must fail, not pass)', () => {
    expect(FILES.length).toBeGreaterThan(200);
    const seen = FILES.map(rel);
    for (const f of [...SOURCES, ...RATIONALE, 'native-snippets/AndroidManifest.additions.xml']) expect(seen).toContain(f);
    expect(fs.existsSync(path.join(APP, 'node_modules'))).toBe(true); // …and it really skipped them
    expect(seen.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('the full address appears only in legalLinks.ts and strings.xml', () => {
    expect(filesContaining(PRIVACY_POLICY_URL)).toEqual(SOURCES);
  });

  it('its host appears only in legalLinks.ts and strings.xml', () => {
    expect(filesContaining(new URL(PRIVACY_POLICY_URL).hostname)).toEqual(SOURCES);
  });

  it('Google’s Health Connect developer page (the old stand-in) appears nowhere', () => {
    expect(filesContaining(DEVELOPER_PAGE)).toEqual([]);
  });
});

describe('the rationale screen reads the resource and spells no address', () => {
  it.each(RATIONALE)('%s loads R.string.privacy_policy_url and contains no http(s):// literal', (file) => {
    const kt = read(path.join(MOBILE, file));
    expect(kt).toMatch(/R\.string\.privacy_policy_url\b/);
    expect(kt).not.toMatch(/https?:\/\//i);
  });
});
