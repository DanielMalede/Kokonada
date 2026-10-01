/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import {
  PRIVACY_POLICY_URL,
  PRIVACY_POLICY_LABEL,
  PRIVACY_POLICY_HINT,
  PRIVACY_POLICY_OPEN_FAILED,
  PRIVACY_POLICY_HOSTED,
} from '../legalLinks';

// HX DT-7 (HX-5): the privacy-policy address has ONE value, spelled in exactly two files: the TS
// constant the app's links import, and the Android string resource the Health Connect rationale
// screen loads. Health Connect requires the rationale to show "the same privacy policy you provide
// for your app in the Google Play Console", so the two can never be allowed to drift apart.
// No test spells the address itself: that would be a third spelling.

const APP = path.resolve(__dirname, '../../..');
const ANDROID_SRC = path.join(APP, 'android/app/src');
const STRINGS = path.join(ANDROID_SRC, 'main/res/values/strings.xml');
const strings = fs.readFileSync(STRINGS, 'utf8');

// One <string> element by name: its attributes and its text, or null when it is absent.
const stringResource = (name: string) => {
  const m = strings.match(new RegExp(`<string\\s+name="${name}"([^>]*)>([^<]*)</string>`));
  return m ? { attrs: m[1], value: m[2] } : null;
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

describe('the privacy-policy address is one value in two files (HX DT-7)', () => {
  it('the Android resource privacy_policy_url equals PRIVACY_POLICY_URL, character for character', () => {
    const res = stringResource('privacy_policy_url');
    expect(res).not.toBeNull();
    expect(res!.value).toBe(PRIVACY_POLICY_URL);
  });

  it('the resource is marked translatable="false": no language may point at a different page', () => {
    expect(stringResource('privacy_policy_url')!.attrs).toMatch(/\btranslatable="false"/);
  });

  it('the resource is defined in exactly one file under android/app/src (no per-locale or per-variant override)', () => {
    const files = walk(ANDROID_SRC).filter((f) => f.endsWith('.xml'));
    expect(files.length).toBeGreaterThan(0); // a walk that finds nothing must fail, not pass
    const defining = files
      .filter((f) => /name="privacy_policy_url"/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ANDROID_SRC, f).split(path.sep).join('/'));
    expect(defining).toEqual(['main/res/values/strings.xml']);
  });
});

describe('the address is a real, final, static https address — never a stand-in', () => {
  const url = new URL(PRIVACY_POLICY_URL);
  const host = url.hostname;

  it('is https, in canonical form, with no user, query or fragment (nothing identifying rides along)', () => {
    expect(url.protocol).toBe('https:');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.port).toBe('');
    // Canonical: lower-case host and an explicit path, so the rationale's exact host+path match
    // (PermissionsRationaleActivity) compares like with like.
    expect(url.href).toBe(PRIVACY_POLICY_URL);
  });

  it('names a registered host: not an IP, not localhost, not a reserved or documentation name', () => {
    expect(host).not.toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    expect(host.startsWith('[')).toBe(false);
    expect(host).not.toBe('localhost');
    expect(host).not.toBe('developer.android.com');
    expect(host).not.toMatch(/(^|\.)example\.[a-z]+$/);
    expect(host).not.toMatch(/(^|\.)example$/);
    expect(host).not.toMatch(/\.(test|invalid|local|localhost)$/);
    expect(host).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
  });

  it('carries no placeholder wording', () => {
    expect(PRIVACY_POLICY_URL.toLowerCase()).not.toMatch(/todo|placeholder|your-|changeme/);
  });
});

describe('one name for the policy on every surface', () => {
  it('the label is "Privacy policy" (the owner’s term; the hosted page is titled the same)', () => {
    expect(PRIVACY_POLICY_LABEL).toBe('Privacy policy');
  });

  it('the rationale screen’s fallback title is the same label, from the resource', () => {
    expect(stringResource('privacy_policy_label')?.value).toBe(PRIVACY_POLICY_LABEL);
  });

  it('the screen-reader hint says where the link goes', () => {
    expect(PRIVACY_POLICY_HINT).toBe('Opens in your browser');
  });

  it('a failed open explains itself and leads into the address (never a dead end)', () => {
    expect(PRIVACY_POLICY_OPEN_FAILED).toBe('We couldn’t open a browser. It’s at:');
  });

  it('the rationale fallback gives the reason, and leaves the noun to its heading (designer, round 1)', () => {
    expect(stringResource('privacy_policy_unavailable')?.value)
      .toBe('We couldn’t load it because of a connection or server problem. It’s at:');
  });

  it('no wording frames the policy as something to agree to', () => {
    const all = [PRIVACY_POLICY_LABEL, PRIVACY_POLICY_HINT, PRIVACY_POLICY_OPEN_FAILED].join(' ').toLowerCase();
    expect(all).not.toMatch(/agree|accept|consent/);
  });
});

// TRIPWIRE (DEC-117, the regulatory brief's O2 conditions). The consent sheet renders its link only
// when this flag says the policy page is hosted. It stays false until DAN-015 hosts the page. Turning
// it on changes the rendered consent screen, so the same change must bring, and this test must be
// edited to name: the hosted page answering 200 at the address; a build identity (APP_VERSION) that
// no earlier build carried, so the consent record shows which grants saw the link (MB-062); the
// REG-034 archive entry for that build's rendered sheet, per language and theme, at font 1.0 and
// 2.0; and the owner's DEC.
describe('the consent-sheet link waits for the hosted page', () => {
  it('PRIVACY_POLICY_HOSTED is false until DAN-015 hosts the page', () => {
    expect(PRIVACY_POLICY_HOSTED).toBe(false);
  });
});
