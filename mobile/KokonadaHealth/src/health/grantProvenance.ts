import { I18nManager } from 'react-native';
import { APP_VERSION } from '../appVersion';

// What a consent grant records about where it was given (MB-062, REG-034): the build, which with the
// consent version, the categories and the time names the rendered consent screen (EDPB 05/2020
// para 108), and the device's language setting as I18nManager reports it. The app has no
// translations yet, so that setting is not the language of the screen; the owner ruled that a grant
// keeps the language only, never the region (DEC-120). The server keeps each value only when it has the expected shape.

export interface GrantProvenance {
  appVersion: string;
  locale?: string;
}

// Java's legacy ISO 639 codes, which older Android versions still report.
const LEGACY_LANGUAGE: Record<string, string> = { iw: 'he', in: 'id', ji: 'yi' };

// A platform locale identifier ("en_US", "sr_RS_#Latn", "en_US@rg=gbzzzz", "zh-Hans_CN") as a BCP 47
// lower-case ISO 639 code of the language only ("en", "sr", "zh"); the owner ruled that a grant never
// stores the region. Anything without a recognisable language gives none rather than a guess.
export function languageTag(identifier: unknown): string | undefined {
  if (typeof identifier !== 'string') return undefined;
  // Positional: "_US" (a region with no language) must not read "US" as the language.
  const [language] = identifier.split(/[@#]/)[0].split(/[-_]/);
  if (!language || !/^[A-Za-z]{2,3}$/.test(language)) return undefined;
  return LEGACY_LANGUAGE[language.toLowerCase()] ?? language.toLowerCase();
}

// Read at the moment of the grant, from this build and this device.
export function grantProvenance(): GrantProvenance {
  const locale = languageTag(I18nManager.getConstants().localeIdentifier);
  return locale ? { appVersion: APP_VERSION, locale } : { appVersion: APP_VERSION };
}
