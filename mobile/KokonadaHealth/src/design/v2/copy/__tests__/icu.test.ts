import { checkCopy, CopyError, createCopyPort, type CopyArgs, type CopyMode } from '../CopyPort.ts';

// The port formats ICU messages itself: no message-format engine is installed, and none is added
// while #308 holds package.json (Stage 0 D3 names FormatJS behind this port). The subset is the
// argument, plural (with # and =N) and select, nested. Anything outside it is refused when the
// catalogue is checked, including every form where ICU quoting or FormatJS tags would read the text
// differently, so each accepted message selects the same branch and the same words under FormatJS.
//
// Every value put into a message is bidi-isolated, FSI before and PDI after (LEDGER §9: ICU
// placeholders are isolated; QA-082's pseudo-locale is bidi-marked). Plural selection and the
// grouping of # are plain code, never Intl, so jest and a Hermes release build select alike; the
// conformance tests below hold them to Node's full-ICU Intl over a fixture table.

const FSI = '\u2068';
const PDI = '\u2069';
const iso = (value: string) => FSI + value + PDI;

const KEY = 'a.message';
const portFor = (message: unknown, mode: CopyMode = 'strict') =>
  createCopyPort({ spec: { [KEY]: { class: 'N' } }, catalogs: { en: { [KEY]: message as string } }, mode });
const fmt = (message: string, args?: CopyArgs) => portFor(message).text(KEY, args);

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

describe('arguments', () => {
  it('puts each value in its place, isolated', () => {
    expect(fmt('Step {n} of {m}', { n: 1, m: 4 })).toBe(`Step ${iso('1')} of ${iso('4')}`);
    expect(portFor('Step {n} of {m}').resolve(KEY, { n: 2, m: 4 })).toEqual({ kind: 'text', text: `Step ${iso('2')} of ${iso('4')}` });
  });

  it('keeps a string value exactly, so a right-to-left name cannot reorder the sentence around it', () => {
    expect(fmt('From {app} via Health Connect', { app: 'Garmin Connect' })).toBe(`From ${iso('Garmin Connect')} via Health Connect`);
    expect(fmt('From {app} today', { app: 'אפליקציה' })).toBe(`From ${iso('אפליקציה')} today`);
  });

  it('writes a number argument as plain digits, as FormatJS does for a simple argument', () => {
    expect(fmt('{n} bpm', { n: 1000 })).toBe(`${iso('1000')} bpm`);
    expect(fmt('{n} min', { n: 2.5 })).toBe(`${iso('2.5')} min`);
  });

  it('allows white space inside the braces, and ignores values the message does not use', () => {
    expect(fmt('Hello { name }', { name: 'Ana', unused: 3 })).toBe(`Hello ${iso('Ana')}`);
  });

  it('reads only the values passed, never Object.prototype', () => {
    expect(copyErrorOf(() => fmt('{constructor}', {})).code).toBe('bad-args');
    expect(copyErrorOf(() => fmt('{toString}', {})).code).toBe('bad-args');
  });
});

describe('plural', () => {
  const SESSIONS = '{count, plural, one {# session} other {# sessions}}';

  it('selects one or other by the en rule', () => {
    expect(fmt(SESSIONS, { count: 1 })).toBe(`${iso('1')} session`);
    expect(fmt(SESSIONS, { count: 0 })).toBe(`${iso('0')} sessions`);
    expect(fmt(SESSIONS, { count: 2 })).toBe(`${iso('2')} sessions`);
    expect(fmt(SESSIONS, { count: -1 })).toBe(`${iso('-1')} session`);
  });

  it('writes # grouped, as FormatJS formats it', () => {
    expect(fmt(SESSIONS, { count: 1000 })).toBe(`${iso('1,000')} sessions`);
    expect(fmt(SESSIONS, { count: -1234567 })).toBe(`${iso('-1,234,567')} sessions`);
  });

  it('an exact =N branch wins over the category', () => {
    const message = '{count, plural, =0 {No sessions yet} =1 {Just one} one {# session} other {# sessions}}';
    expect(fmt(message, { count: 0 })).toBe('No sessions yet');
    expect(fmt(message, { count: 1 })).toBe('Just one');
    expect(fmt(message, { count: 5 })).toBe(`${iso('5')} sessions`);
  });

  it('# is the innermost plural’s number, through a select between them', () => {
    const message = '{a, plural, other {# rows, {kind, select, live {{b, plural, one {# live} other {# live}}} other {none}}}}';
    expect(fmt(message, { a: 3, kind: 'live', b: 1 })).toBe(`${iso('3')} rows, ${iso('1')} live`);
    expect(fmt(message, { a: 3, kind: 'manual', b: 1 })).toBe(`${iso('3')} rows, none`);
  });

  it('selects exactly as Intl.PluralRules en does, over integers from -1000 to 1000 and some large ones', () => {
    const rules = new Intl.PluralRules('en');
    const port = portFor('{n, plural, one {one} other {other}}');
    const fixtures = [...Array.from({ length: 2001 }, (_, i) => i - 1000), 1e6, 2 ** 31, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER];
    const mismatches = fixtures.filter((n) => port.text(KEY, { n }) !== rules.select(n));
    expect(fixtures.length).toBe(2005);
    expect(mismatches).toEqual([]);
  });

  it('groups # exactly as Intl.NumberFormat en does (negative zero aside, which it writes -0)', () => {
    const format = new Intl.NumberFormat('en');
    const port = portFor('{n, plural, other {#}}');
    const fixtures = [0, 1, 7, 12, 999, 1000, 1001, 9999, 10000, 12345, 123456, 999999, 1000000, 1234567, 2 ** 31, Number.MAX_SAFE_INTEGER, -1, -999, -1000, -1234567, -Number.MAX_SAFE_INTEGER];
    const mismatches = fixtures.filter((n) => port.text(KEY, { n }) !== iso(format.format(n)));
    expect(mismatches).toEqual([]);
    expect(port.text(KEY, { n: -0 })).toBe(iso('0'));
  });
});

describe('select', () => {
  const SOURCE = '{source, select, live {Live} manual {Added by hand} other {Imported}}';

  it('picks the matching branch, else other', () => {
    expect(fmt(SOURCE, { source: 'live' })).toBe('Live');
    expect(fmt(SOURCE, { source: 'manual' })).toBe('Added by hand');
    expect(fmt(SOURCE, { source: 'garmin' })).toBe('Imported');
  });

  it('a value named like an Object.prototype member takes other', () => {
    for (const source of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(fmt(SOURCE, { source })).toBe('Imported');
    }
  });

  it('branches hold arguments and plurals', () => {
    const message = '{source, select, live {Live from {app}} other {{n, plural, one {# import} other {# imports}}}}';
    expect(fmt(message, { source: 'live', app: 'Polar', n: 1 })).toBe(`Live from ${iso('Polar')}`);
    expect(fmt(message, { source: 'file', app: 'Polar', n: 1 })).toBe(`${iso('1')} import`);
  });
});

describe('a message outside the subset is a bad message', () => {
  const BAD: readonly string[] = [
    'Hello {name',
    'Hello name}',
    'Hello {}',
    'Hello {1x}',
    'Hello {na me}',
    '{n, number}',
    '{n, date, short}',
    '{n, selectordinal, one {#st} other {#th}}',
    '{n, plural}',
    '{n, plural, }',
    '{n, plural, one {# item}}',
    '{s, select, a {A}}',
    '{n, plural, one {a} one {b} other {c}}',
    '{n, plural, =1 {a} =01 {b} other {c}}',
    '{n, plural, several {a} other {b}}',
    '{n, plural, offset:1 other {#}}',
    '{n, plural, other #}',
    '{n, plural, other {#}',
    '{s, select, other {x}',
    '{s, select, a-b {x} other {y}}',
    'Total #3',
    '{n, plural, other {{s, select, other {# items}}}}',
    "It'{s} here",
    "Don''t",
    "Say '# now",
    "Done'}",
    'Hold <b>here</b>',
    '{n, plural, one {x} other {y}} trailing }',
  ];

  it('checkCopy names each one, with the reason', () => {
    for (const message of BAD) {
      const problems = checkCopy({ [KEY]: { class: 'N' } }, { en: { [KEY]: message } });
      expect([message, problems.map((p) => p.code)]).toEqual([message, ['bad-message']]);
      expect(problems[0].detail.length).toBeGreaterThan(0);
    }
  });

  it('a strict build refuses it; a release build shows the ellipsis', () => {
    for (const message of BAD) {
      expect(copyErrorOf(() => portFor(message)).code).toBe('invalid-copy');
      const release = portFor(message, 'release');
      expect(release.resolve(KEY, { n: 1, s: 'a', name: 'x' })).toEqual({ kind: 'reserved', reason: 'unavailable', budget: null });
      expect(release.text(KEY, { n: 1, s: 'a', name: 'x' })).toBe('…');
    }
  });

  it('an apostrophe anywhere else is a plain apostrophe', () => {
    expect(fmt("You're offline")).toBe("You're offline");
    expect(fmt("The plate's rim, the user's {thing}", { thing: 'line' })).toBe(`The plate's rim, the user's ${iso('line')}`);
    expect(fmt("'quoted'")).toBe("'quoted'");
    expect(fmt('Use > and |')).toBe('Use > and |');
  });
});

describe('a value a page passes wrongly is bad args', () => {
  const cases: ReadonlyArray<readonly [string, CopyArgs | undefined]> = [
    ['Hello {name}', undefined],
    ['Hello {name}', {}],
    ['Hello {name}', { name: Number.NaN }],
    ['Hello {name}', { name: Number.POSITIVE_INFINITY }],
    ['Hello {name}', { name: true as never }],
    ['Hello {name}', { name: null as never }],
    ['Hello {name}', { name: undefined as never }],
    ['Hello {name}', { name: {} as never }],
    ['{n, plural, other {# x}}', { n: '3' }],
    ['{n, plural, other {# x}}', { n: 1.5 }],
    ['{n, plural, other {# x}}', { n: Number.NaN }],
    ['{n, plural, other {# x}}', { n: Number.NEGATIVE_INFINITY }],
    ['{n, plural, other {# x}}', { n: 2 ** 53 }],
    ['{s, select, other {x}}', { s: 3 }],
    ['{s, select, other {x}}', {}],
  ];

  it('a strict build throws bad-args naming the key and the value’s name', () => {
    for (const [message, args] of cases) {
      const error = copyErrorOf(() => fmt(message, args));
      expect([message, error.code]).toEqual([message, 'bad-args']);
      expect(error.key).toBe(KEY);
    }
    expect(copyErrorOf(() => fmt('Hello {name}', {})).message).toContain('name');
  });

  it('a release build shows the ellipsis, never a half-filled sentence', () => {
    for (const [message, args] of cases) {
      const release = portFor(message, 'release');
      expect(release.text(KEY, args)).toBe('…');
      expect(release.resolve(KEY, args)).toEqual({ kind: 'reserved', reason: 'unavailable', budget: null });
    }
  });
});

describe('a key never renders nothing', () => {
  it('a branch or value that leaves nothing visible is empty-text: strict throws, release shows the ellipsis', () => {
    const cases: ReadonlyArray<readonly [string, CopyArgs]> = [
      ['{n, plural, =0 {} other {# items}}', { n: 0 }],
      ['{name}', { name: '' }],
      ['{name}', { name: ' \n' }],
      ['{s, select, a { } other {x}}', { s: 'a' }],
    ];
    for (const [message, args] of cases) {
      expect([message, copyErrorOf(() => fmt(message, args)).code]).toEqual([message, 'empty-text']);
      expect(portFor(message, 'release').text(KEY, args)).toBe('…');
    }
    expect(fmt('{n, plural, =0 {} other {# items}}', { n: 2 })).toBe(`${iso('2')} items`);
  });
});
