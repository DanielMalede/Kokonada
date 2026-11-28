import { CopyError, createCopyPort, PSEUDO_LOCALE, type CopyMode, type CopySpec } from '../CopyPort.ts';

// The pseudo-locale (F7; QA-082): the en text with every Latin letter accented, at least 40% longer,
// in brackets, so a capture shows text that did not come through the port (it is unaccented), text
// that truncates (its closing bracket is missing) and text that will not fit a longer language.
// B1's RTL evidence is forced RTL plus this locale (charter §0.3). It derives from the en catalogue,
// selects plurals by en's rule, and leaves values alone: they stay exact inside their isolates.

const FSI = '\u2068';
const PDI = '\u2069';
const iso = (value: string) => FSI + value + PDI;
const BIDI = /[\u200E\u200F\u061C\u2066-\u2069]/g;
const isAscii = (char: string) => (char.codePointAt(0) ?? 0) < 0x80;
const visibleLength = (text: string) => [...text.replace(BIDI, '')].length;

const SPEC = {
  'shell.offline.title': { class: 'N' },
  'shell.offline.retry': { class: 'N' },
  'archive.count': { class: 'N' },
  'archive.source': { class: 'N' },
  'signIn.tagline': { class: 'R', budget: { chars: 48, lines: 2 } },
} as const satisfies CopySpec;

const EN = {
  'shell.offline.title': 'You are offline',
  'shell.offline.retry': 'OK',
  'archive.count': '{count, plural, one {# session} other {# sessions}}',
  'archive.source': 'From {app} via Health Connect',
};

const pseudo = (mode: CopyMode = 'strict') => createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode, locale: PSEUDO_LOCALE });
const en = () => createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: 'strict' });

/** The text between the brackets. */
function inner(text: string): string {
  expect(text.startsWith('[')).toBe(true);
  expect(text.endsWith(']')).toBe(true);
  return text.slice(1, -1);
}

describe('the pseudo-locale', () => {
  it('is en-XA, chosen with the locale option, and the port reports it', () => {
    expect(PSEUDO_LOCALE).toBe('en-XA');
    expect(pseudo().locale).toBe('en-XA');
  });

  it('brackets the text, accents every letter, and keeps every other character in place', () => {
    const shown = inner(pseudo().text('shell.offline.title'));
    const source = 'You are offline';
    const head = [...shown].slice(0, source.length);
    expect(head).toHaveLength(source.length);
    head.forEach((char, i) => {
      if (/[A-Za-z]/.test(source[i])) {
        expect([source[i], isAscii(char)]).toEqual([source[i], false]);
      } else {
        expect(char).toBe(source[i]);
      }
    });
    expect(shown).not.toMatch(/[A-Za-z]/);
  });

  it('maps each of the 52 letters to its own accented letter, one to one, so a capture can be read back', () => {
    const port = createCopyPort({
      spec: { 'a.b': { class: 'N' } },
      catalogs: { en: { 'a.b': 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ' } },
      mode: 'strict',
      locale: PSEUDO_LOCALE,
    });
    const letters = [...inner(port.text('a.b'))].slice(0, 53).filter((c) => c !== ' ');
    expect(letters).toHaveLength(52);
    expect(new Set(letters).size).toBe(52);
    expect(letters.filter((c) => isAscii(c))).toEqual([]);
    const source = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    letters.forEach((char, i) => {
      const base = char.normalize('NFD')[0];
      if (base !== char) {
        expect([char, base]).toEqual([char, source[i]]);
      }
    });
  });

  it('is at least 40% longer than the en text, for short and long text alike', () => {
    for (const source of ['OK', 'You are offline', 'A much longer line of neutral copy that wraps across the column twice over']) {
      const port = createCopyPort({ spec: { 'a.b': { class: 'N' } }, catalogs: { en: { 'a.b': source } }, mode: 'strict', locale: PSEUDO_LOCALE });
      const shown = inner(port.text('a.b'));
      expect([source, visibleLength(shown) >= Math.ceil(visibleLength(source) * 1.4)]).toEqual([source, true]);
    }
  });

  it('leaves values exact inside their isolates, and selects plurals as en does', () => {
    expect(pseudo().text('archive.source', { app: 'Garmin Connect' })).toContain(iso('Garmin Connect'));
    const one = pseudo().text('archive.count', { count: 1 });
    const many = pseudo().text('archive.count', { count: 1000 });
    expect(one).toContain(iso('1'));
    expect(many).toContain(iso('1,000'));
    expect(visibleLength(inner(many))).toBeGreaterThan(visibleLength(inner(one)));
    expect(en().text('archive.count', { count: 1 })).toBe(`${iso('1')} session`);
  });

  it('keeps an R key reserved, and fails a missing key as en does', () => {
    expect(pseudo().resolve('signIn.tagline')).toEqual({ kind: 'reserved', reason: 'regulated', budget: { chars: 48, lines: 2 } });
    let caught: unknown;
    try {
      pseudo().text('shell.offline.body' as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CopyError);
    expect((caught as CopyError).code).toBe('missing-key');
    expect(pseudo('release').text('shell.offline.body' as never)).toBe('…');
  });

  it('can be chosen in a release build, which is what G11e captures run on', () => {
    expect(pseudo('release').locale).toBe('en-XA');
    expect(pseudo('release').text('shell.offline.title')).toBe(pseudo('strict').text('shell.offline.title'));
    expect(inner(pseudo('release').text('shell.offline.retry')).length).toBeGreaterThan(2);
  });

  it('gives the same text every time', () => {
    expect(pseudo().text('shell.offline.title')).toBe(pseudo().text('shell.offline.title'));
    expect(pseudo().resolve('shell.offline.title')).toEqual({ kind: 'text', text: pseudo().text('shell.offline.title') });
  });
});
