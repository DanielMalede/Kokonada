import { I18nManager } from 'react-native';
import { APP_VERSION } from '../appVersion';

// What a consent grant records about where it was given (MB-062, REG-034): the build, and the
// language the app runs in. With the consent version, the categories and the time, that is enough to
// name the rendered consent screen the grantor saw (GDPR Art. 7(1); EDPB 05/2020 para 108), and no
// more (para 106). The server keeps each value only when it has the expected shape.

export interface GrantProvenance {
  appVersion: string;
  locale?: string;
}

// Java's legacy ISO 639 codes, which older Android versions still report.
const LEGACY_LANGUAGE: Record<string, string> = { iw: 'he', in: 'id', ji: 'yi' };

// A platform locale identifier ("en_US", "sr_RS_#Latn", "en_US@rg=gbzzzz", "zh-Hans_CN") as a BCP 47
// tag of the language and, when there is one, the region: "en-US", "sr-RS", "zh-CN". Anything
// without a recognisable language gives no tag rather than a guess.
export function languageTag(identifier: unknown): string | undefined {
  if (typeof identifier !== 'string') return undefined;
  // Positional: "_US" (a region with no language) must not read "US" as the language.
  const [language, ...subtags] = identifier.split(/[@#]/)[0].split(/[-_]/);
  if (!language || !/^[A-Za-z]{2,3}$/.test(language)) return undefined;
  const lang = LEGACY_LANGUAGE[language.toLowerCase()] ?? language.toLowerCase();
  const region = subtags.find((s) => /^([A-Za-z]{2}|\d{3})$/.test(s));
  return region ? `${lang}-${region.toUpperCase()}` : lang;
}

// Read at the moment of the grant, from this build and this device.
export function grantProvenance(): GrantProvenance {
  const locale = languageTag(I18nManager.getConstants().localeIdentifier);
  return locale ? { appVersion: APP_VERSION, locale } : { appVersion: APP_VERSION };
}
