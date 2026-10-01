/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { I18nManager } from 'react-native';
import { grantProvenance, languageTag } from '../grantProvenance';
import { APP_VERSION } from '../../appVersion';

// MB-062 (REG-034): what a consent grant says about where it was given — the build (APP_VERSION) and
// the device's language setting, as a BCP 47 tag. The setting comes from React Native's
// I18nManager, which reports the platform's own identifier ("en_US" on Android and iOS,
// "sr_RS_#Latn" for a scripted Java locale, "en_US@rg=gbzzzz" with iOS keywords). The tag keeps the
// language only, and drops region, script, variants and keywords (DEC-120).

describe('languageTag — a platform locale identifier as a BCP 47 language tag', () => {
  it.each([
    ['en_US', 'en'],
    ['he_IL', 'he'],
    ['en', 'en'],
    ['es_419', 'es'],
    ['sr_RS_#Latn', 'sr'],
    ['en_US@rg=gbzzzz', 'en'],
    ['zh-Hans_CN', 'zh'],
    ['en_US_POSIX', 'en'],
    ['en-us', 'en'],
    ['iw_IL', 'he'], // Java's legacy code for Hebrew
    ['in_ID', 'id'], // …for Indonesian
    ['ji', 'yi'],    // …for Yiddish
  ])('%s → %s', (identifier, tag) => {
    expect(languageTag(identifier)).toBe(tag);
  });

  it.each([undefined, null, '', '_US', '#Latn', 'english please', 42, {}])('%p → no tag', (identifier) => {
    expect(languageTag(identifier)).toBeUndefined();
  });
});

describe('grantProvenance — read from this device and this build', () => {
  afterEach(() => { jest.restoreAllMocks(); });
  const withLocale = (localeIdentifier: string | undefined) =>
    jest.spyOn(I18nManager, 'getConstants').mockReturnValue({ isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier });

  it('the build, and the device language setting', () => {
    withLocale('he_IL');
    expect(grantProvenance()).toEqual({ appVersion: APP_VERSION, locale: 'he' });
  });

  it('no locale key at all when the platform reports none (never a guess)', () => {
    withLocale(undefined);
    expect(grantProvenance()).toEqual({ appVersion: APP_VERSION });
    expect('locale' in grantProvenance()).toBe(false);
  });
});

// The server keeps a grant's provenance only when it has the shape it expects (backend
// services/privacy/consent.js), and drops it otherwise. Read the server's own patterns, so a client
// that drifts from them fails here, not silently in production.
describe('the server accepts what this client sends (cross-package contract)', () => {
  const service = fs.readFileSync(path.resolve(__dirname, '../../../../../backend/app/services/privacy/consent.js'), 'utf8');
  const shape = (name: string) => {
    const m = service.match(new RegExp(`const ${name} = /(.+)/;`));
    expect(m).not.toBeNull();
    return new RegExp(m![1]);
  };

  it('APP_VERSION matches the server’s APP_VERSION_SHAPE', () => {
    expect(shape('APP_VERSION_SHAPE').test(APP_VERSION)).toBe(true);
  });

  it('every tag languageTag produces matches the server’s LOCALE_SHAPE', () => {
    const LOCALE_SHAPE = shape('LOCALE_SHAPE');
    for (const id of ['en_US', 'he_IL', 'es_419', 'sr_RS_#Latn', 'zh-Hans_CN', 'en', 'iw_IL']) {
      expect(LOCALE_SHAPE.test(languageTag(id)!)).toBe(true);
    }
  });

  // A client value the server silently drops is lost provenance: whatever the platform reports,
  // languageTag gives either nothing or a value the server keeps (5,000 seeded random identifiers).
  it('for any identifier, languageTag gives nothing or a value matching LOCALE_SHAPE', () => {
    const LOCALE_SHAPE = shape('LOCALE_SHAPE');
    let seed = 0x5eed;
    const random = () => { // mulberry32: deterministic, so a failure reproduces
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ALPHABET = 'abcXYZ_-@#=019 ';
    for (let i = 0; i < 5000; i += 1) {
      const id = Array.from({ length: Math.floor(random() * 11) }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('');
      const tag = languageTag(id);
      if (tag !== undefined) expect([id, LOCALE_SHAPE.test(tag)]).toEqual([id, true]);
    }
  });
});

describe('every production grant carries its provenance (MB-062)', () => {
  const SRC = path.resolve(__dirname, '../..');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(f, out); } else if (/\.tsx?$/.test(e.name)) out.push(f);
    }
    return out;
  };
  it('outside tests, grantConsent is used only as grantConsent(grantProvenance())', () => {
    const importers = walk(SRC).filter((f) => /\bgrantConsent\b[^;]*from\s*['"][^'"]*consentApi['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(importers.map((f) => path.relative(SRC, f).split(path.sep).join('/')).sort())
      .toEqual(['experience/connect/ConnectServicesScreen.tsx', 'experience/profile/ProfileScreen.tsx']);
    for (const f of importers) {
      const src = fs.readFileSync(f, 'utf8');
      const wrapped = (src.match(/\bgrantConsent\(grantProvenance\(\)\)/g) ?? []).length;
      expect(wrapped).toBeGreaterThan(0);
      expect((src.match(/\bgrantConsent\b/g) ?? []).length - 1 - (src.match(/\bgrantConsent\s*:/g) ?? []).length).toBe(wrapped);
    }
  });
});
