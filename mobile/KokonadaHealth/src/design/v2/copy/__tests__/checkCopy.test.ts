import { checkCopy, CopyError, createCopyPort, type CopySpec } from '../CopyPort.ts';

// The catalogues are checked when a strict port is built: a spec or catalogue a strict build would
// trip over later fails at once, with every problem listed. A release build skips the check and
// relies on each key failing closed on its own (D2-A).

const SPEC = {
  'shell.offline.title': { class: 'N' },
  'shell.offline.retry': { class: 'N' },
  'signIn.tagline': { class: 'R', budget: { chars: 48, lines: 2 } },
} as const satisfies CopySpec;

const EN = { 'shell.offline.title': 'You are offline', 'shell.offline.retry': 'Try again' };

/** The CopyError `fn` throws; anything else (or nothing) fails the test. */
function copyErrorOf(fn: () => unknown): CopyError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CopyError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a CopyError, and nothing was thrown');
}

const codes = (spec: unknown, catalogs: unknown) =>
  checkCopy(spec as CopySpec, catalogs as { en: Record<string, string> }).map((p) => [p.code, p.key, p.locale]);

describe('checkCopy', () => {
  it('passes a well-formed spec and catalogue', () => {
    expect(checkCopy(SPEC, { en: EN })).toEqual([]);
  });

  it('every N key needs en text', () => {
    expect(codes(SPEC, { en: { 'shell.offline.title': 'You are offline' } })).toEqual([['missing-text', 'shell.offline.retry', 'en']]);
  });

  it('text for a key the spec does not declare is a missing key', () => {
    expect(codes(SPEC, { en: { ...EN, 'shell.offline.body': 'Check the connection' } })).toEqual([['missing-key', 'shell.offline.body', 'en']]);
  });

  it('empty or blank text is a bad message, never shipped as ""', () => {
    for (const blank of ['', ' ', '\n\t ']) {
      expect(codes(SPEC, { en: { ...EN, 'shell.offline.retry': blank } })).toEqual([['bad-message', 'shell.offline.retry', 'en']]);
    }
  });

  it('text that is not a string is a bad message', () => {
    expect(codes(SPEC, { en: { ...EN, 'shell.offline.retry': 7 } })).toEqual([['bad-message', 'shell.offline.retry', 'en']]);
  });

  it('the supported set is {en} (D4-B): an he catalogue is an unsupported locale until the held branch adds it', () => {
    expect(codes(SPEC, { en: EN, he: EN })).toEqual([['unsupported-locale', null, 'he']]);
    expect(codes(SPEC, { en: EN, 'en-XA': EN })).toEqual([['unsupported-locale', null, 'en-XA']]);
  });

  it('no en catalogue means no N key has text', () => {
    expect(codes(SPEC, {})).toEqual([['missing-text', 'shell.offline.title', 'en'], ['missing-text', 'shell.offline.retry', 'en']]);
  });

  it('a key is dotted camelCase segments, the first starting lower-case', () => {
    for (const good of ['a', 'shell.offline.title', 'signIn.google.a11y', 'onboarding.step.1.line']) {
      expect(codes({ [good]: { class: 'N' } }, { en: { [good]: 'Text' } })).toEqual([]);
    }
    for (const bad of ['', ' a', 'A.b', 'a..b', 'a.', '.a', 'a-b', 'a b', 'a/b']) {
      expect(codes({ [bad]: { class: 'N' } }, { en: {} })).toEqual([['bad-spec', bad, null]]);
    }
  });

  it('a class is exactly N or R, and a bad entry is reported once', () => {
    for (const entry of [{}, { class: 'n' }, { class: 'neutral' }, { class: 'X' }, null, 'N', 3]) {
      expect(codes({ 'a.b': entry }, { en: { 'a.b': 'Text' } })).toEqual([['bad-spec', 'a.b', null]]);
    }
  });

  it('an R budget is whole positive chars and lines, and nothing else', () => {
    const budgets = [
      { chars: 0, lines: 1 },
      { chars: 48, lines: 0 },
      { chars: -1, lines: 1 },
      { chars: 1.5, lines: 1 },
      { chars: Number.NaN, lines: 1 },
      { chars: Number.POSITIVE_INFINITY, lines: 1 },
      { chars: '48', lines: 1 },
      { chars: 48 },
      { lines: 1 },
      { chars: 48, lines: 1, text: 'Proposal' },
      null,
      undefined,
    ];
    for (const budget of budgets) {
      expect(codes({ 'a.b': { class: 'R', budget } }, { en: {} })).toEqual([['bad-spec', 'a.b', null]]);
    }
    expect(codes({ 'a.b': { class: 'R', budget: { chars: 1, lines: 1 } } }, { en: {} })).toEqual([]);
  });

  it('lists every problem, not only the first, one per cause', () => {
    const spec = { ...SPEC, 'bad key': { class: 'N' } };
    expect(codes(spec, { en: { 'shell.offline.title': '', 'shell.offline.body': 'Extra', 'bad key': 'Text' }, he: {} })).toEqual([
      ['bad-spec', 'bad key', null],
      ['unsupported-locale', null, 'he'],
      ['missing-text', 'shell.offline.retry', 'en'],
      ['bad-message', 'shell.offline.title', 'en'],
      ['missing-key', 'shell.offline.body', 'en'],
    ]);
  });
});

describe('building a port', () => {
  it('a strict build throws invalid-copy with checkCopy’s problems', () => {
    const en = { 'shell.offline.title': 'You are offline' };
    const error = copyErrorOf(() => createCopyPort({ spec: SPEC, catalogs: { en }, mode: 'strict' }));
    expect(error.code).toBe('invalid-copy');
    expect(error.problems).toEqual(checkCopy(SPEC, { en }));
    expect(error.problems).toHaveLength(1);
    expect(error.message).toContain('shell.offline.retry');
  });

  it('a release build does not throw on a bad catalogue: each key fails closed instead', () => {
    const port = createCopyPort({ spec: SPEC, catalogs: { en: { 'shell.offline.title': 'You are offline' } }, mode: 'release' });
    expect(port.text('shell.offline.title')).toBe('You are offline');
    expect(port.text('shell.offline.retry')).toBe('…');
  });

  it('takes no option beyond spec, catalogs, locale and mode, in either mode', () => {
    for (const mode of ['strict', 'release'] as const) {
      for (const extra of ['regulated', 'approved', 'overrides', 'fallback', 'draft']) {
        const options = { spec: SPEC, catalogs: { en: EN }, mode, [extra]: { 'signIn.tagline': 'Draft' } };
        const error = copyErrorOf(() => createCopyPort(options));
        expect(error.code).toBe('bad-option');
        expect(error.message).toContain(extra);
      }
    }
  });

  it('a mode other than strict or release is a bad option', () => {
    for (const mode of ['debug', 'dev', '', 'Release']) {
      expect(copyErrorOf(() => createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: mode as never })).code).toBe('bad-option');
    }
  });

  it('a missing spec or catalogue is a bad option, in either mode', () => {
    for (const mode of ['strict', 'release'] as const) {
      expect(copyErrorOf(() => createCopyPort({ spec: undefined as never, catalogs: { en: EN }, mode })).code).toBe('bad-option');
      expect(copyErrorOf(() => createCopyPort({ spec: SPEC, catalogs: undefined as never, mode })).code).toBe('bad-option');
      expect(copyErrorOf(() => createCopyPort({ spec: SPEC, catalogs: { en: undefined as never }, mode })).code).toBe('bad-option');
    }
  });
});

// D4-B: native latches the locale at boot and passes it as an initial prop; JS never resolves one.
// A root with no such prop renders en. A value outside the supported set is a defect: a strict
// build throws, a release build renders en.
describe('the locale a port resolves in', () => {
  it('is en when none is given, and en when en is given', () => {
    expect(createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: 'strict' }).locale).toBe('en');
    expect(createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: 'strict', locale: 'en' }).locale).toBe('en');
  });

  it('an unsupported locale throws in a strict build and renders en in a release build', () => {
    for (const locale of ['he', 'iw', 'en-US', 'EN', '', 'fr']) {
      const error = copyErrorOf(() => createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: 'strict', locale }));
      expect(error.code).toBe('unsupported-locale');
      const port = createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: 'release', locale });
      expect(port.locale).toBe('en');
      expect(port.text('shell.offline.retry')).toBe('Try again');
    }
  });
});
