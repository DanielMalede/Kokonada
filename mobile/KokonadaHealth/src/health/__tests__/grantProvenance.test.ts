/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { I18nManager } from 'react-native';
import { grantProvenance, languageTag } from '../grantProvenance';
import { APP_VERSION } from '../../appVersion';

// MB-062 (REG-034): what a consent grant says about where it was given — the build (APP_VERSION) and
// the language the app is running in, as a BCP 47 tag. The language comes from React Native's
// I18nManager, which reports the platform's own identifier ("en_US" on Android and iOS,
// "sr_RS_#Latn" for a scripted Java locale, "en_US@rg=gbzzzz" with iOS keywords). The tag keeps the
// language and region only — enough to name the screen that was shown, nothing more (EDPB 05/2020
// para 106).

describe('languageTag — a platform locale identifier as a BCP 47 language tag', () => {
  it.each([
    ['en_US', 'en-US'],
    ['he_IL', 'he-IL'],
    ['en', 'en'],
    ['es_419', 'es-419'],
    ['sr_RS_#Latn', 'sr-RS'],
    ['en_US@rg=gbzzzz', 'en-US'],
    ['zh-Hans_CN', 'zh-CN'],
    ['en_US_POSIX', 'en-US'],
    ['en-us', 'en-US'],
    ['iw_IL', 'he-IL'], // Java's legacy code for Hebrew
    ['in_ID', 'id-ID'], // …for Indonesian
    ['ji', 'yi'],       // …for Yiddish
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

  it('the build, and the language the app runs in', () => {
    withLocale('he_IL');
    expect(grantProvenance()).toEqual({ appVersion: APP_VERSION, locale: 'he-IL' });
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
});
