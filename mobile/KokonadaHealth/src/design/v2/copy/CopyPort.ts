// The copy port (F7; Stage 0 D2-A, "copy is a port"). Pages and components never hold a string:
// they ask the port for a key (F10 R2). Each key is classed:
//
//   N  neutral: it ships in the batch, and its text lives in the locale catalogues.
//   R  regulated (T11; a CMP-086, REG-070 or REG-075 claim; legal): its text waits on the held
//      regulated-copy branch (F3-B). In this tree an R key has no text anywhere. It resolves to a
//      reserved result, which the UI renders as a ReservedSlot at the key's budget.
//
// Pure TypeScript, with no imports: any root, test or script can build a port. useCopy.ts is the
// React side.

/** An R key's room: characters of English, and lines at font 1.0 on a 336 dp column (LEDGER §11). */
export interface CopyBudget {
  readonly chars: number;
  readonly lines: number;
}

export interface NeutralKeySpec {
  readonly class: 'N';
}

export interface RegulatedKeySpec {
  readonly class: 'R';
  readonly budget: CopyBudget;
}

export type KeySpec = NeutralKeySpec | RegulatedKeySpec;

/** Every key the app may ask for, with its class. The text lives in the catalogues, never here. */
export type CopySpec = { readonly [key: string]: KeySpec };

/** One locale's text, by key. */
export type Catalog = { readonly [key: string]: string };

/**
 * The locales a build resolves in (D4-B): the set starts at en. Hebrew joins at the cutover through
 * the held branch, once its catalogue passes parity (D2 counts an he alias of legal text as missing).
 */
export const SUPPORTED_LOCALES = ['en'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * The pseudo-locale (QA-082), for lab and RTL evidence: the en text with every Latin letter
 * accented, at least 40% longer, in brackets. It is never a catalogue and never a user's locale:
 * the lab root passes it in, in a debug or a release build alike.
 */
export const PSEUDO_LOCALE = 'en-XA';

export type CopyLocale = SupportedLocale | typeof PSEUDO_LOCALE;

/** One catalogue per supported locale. */
export type Catalogs = { readonly en: Catalog };

/**
 * strict: a copy failure throws a CopyError (dev builds and jest).
 * release: it never throws at a screen and never paints '' or the raw key (D2-A, fail closed).
 */
export type CopyMode = 'strict' | 'release';

/**
 * text: show it. reserved: render a ReservedSlot. 'regulated' is an R key, at its budget;
 * 'unavailable' is a key a release build has no text for, which a strict build throws on instead.
 */
export type CopyResult =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reserved'; readonly reason: 'regulated'; readonly budget: CopyBudget }
  | { readonly kind: 'reserved'; readonly reason: 'unavailable'; readonly budget: null };

export type KeyOf<S extends CopySpec> = Extract<keyof S, string>;

/** The N keys of a spec: the only keys text() takes. A spec typed only as CopySpec takes any string. */
export type NeutralKeyOf<S extends CopySpec> = string extends keyof S
  ? string
  : { [K in KeyOf<S>]: S[K] extends NeutralKeySpec ? K : never }[KeyOf<S>];

/** The values an ICU message takes, by argument name: a count is a number, a select a string. */
export type CopyArgs = { readonly [name: string]: string | number };

export interface CopyPort<S extends CopySpec = CopySpec> {
  /** The locale this port resolves in. */
  readonly locale: CopyLocale;
  /** Any key: its text, or a reserved slot for an R key. */
  resolve(key: KeyOf<S>, args?: CopyArgs): CopyResult;
  /**
   * An N key's text. An R key is never text: resolve() it and render a ReservedSlot. Where a
   * release build has no text, this gives one ellipsis (U+2026), never '' and never the key.
   */
  text(key: NeutralKeyOf<S>, args?: CopyArgs): string;
}

export type CopyErrorCode =
  /** A key the spec does not declare: asked for, or given text in a catalogue. */
  | 'missing-key'
  /** An N key with no text in a catalogue. */
  | 'missing-text'
  /** An R key asked for as text. */
  | 'regulated-key'
  /** Text given for an R key: in a batch tree an R key has none (F3-B). */
  | 'regulated-text'
  /** Text that is not a non-blank string, or an ICU message outside the subset. */
  | 'bad-message'
  /** A value missing, or of the wrong kind, for one of the message's arguments. */
  | 'bad-args'
  /** A message that, with these values, leaves nothing visible. */
  | 'empty-text'
  /** A malformed key name or spec entry. */
  | 'bad-spec'
  | 'unsupported-locale'
  | 'bad-option'
  /** A strict build's check of the spec and catalogues failed: see problems. */
  | 'invalid-copy';

/** One thing checkCopy found wrong. */
export interface CopyProblem {
  readonly code: CopyErrorCode;
  readonly key: string | null;
  readonly locale: string | null;
  readonly detail: string;
}

/** A copy failure, typed, so a test or a dev build names exactly what went wrong. */
export class CopyError extends Error {
  readonly code: CopyErrorCode;
  readonly key: string | null;
  readonly locale: string | null;
  readonly problems: readonly CopyProblem[];

  constructor(
    code: CopyErrorCode,
    message: string,
    key: string | null = null,
    locale: string | null = null,
    problems: readonly CopyProblem[] = [],
  ) {
    super(message);
    this.name = 'CopyError';
    this.code = code;
    this.key = key;
    this.locale = locale;
    this.problems = problems;
  }
}

export interface CopyPortOptions<S extends CopySpec> {
  readonly spec: S;
  readonly catalogs: Catalogs;
  /** The locale native latched at boot and passed in as an initial prop (D4-B). None renders en. */
  readonly locale?: string;
  /** Defaults to strict, unless __DEV__ is false (a release bundle). */
  readonly mode?: CopyMode;
}

/** Every option createCopyPort takes. There is no channel for regulated text in a batch tree. */
const OPTIONS: readonly string[] = ['spec', 'catalogs', 'locale', 'mode'];

/** Dotted camelCase segments, the first starting lower-case: shell.offline.title, onboarding.step.1.line. */
const KEY_NAME = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/;

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** True when the record's own keys are exactly these. */
const holdsExactly = (record: object, keys: readonly string[]): boolean => {
  const held = Object.keys(record);
  return held.length === keys.length && keys.every((key) => held.includes(key));
};

const isCount = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Why a spec entry is malformed, or null when it is well formed. */
function entryProblem(key: string, entry: unknown): string | null {
  if (!KEY_NAME.test(key)) {
    return 'a key is dotted camelCase segments, the first starting lower-case';
  }
  if (!isRecord(entry)) {
    return 'an entry is { class: N } or { class: R, budget }';
  }
  if (entry.class === 'N') {
    return holdsExactly(entry, ['class']) ? null : 'an N entry holds its class only; its text lives in the catalogues';
  }
  if (entry.class === 'R') {
    if (!holdsExactly(entry, ['class', 'budget'])) {
      return 'an R entry holds its class and budget only; it carries no text in this tree';
    }
    const budget = entry.budget;
    const wellFormed = isRecord(budget) && holdsExactly(budget, ['chars', 'lines']) && isCount(budget.chars) && isCount(budget.lines);
    return wellFormed ? null : 'an R budget is whole positive chars and lines';
  }
  return 'a class is N or R';
}

const problem = (code: CopyErrorCode, key: string | null, locale: string | null, detail: string): CopyProblem => ({
  code,
  key,
  locale,
  detail,
});

/**
 * Every problem in a spec and its catalogues, one per cause, in a fixed order: the spec, the
 * locales, the N keys without text, then each catalogue entry. A strict port runs this when it is
 * built; the catalogues' own test can call it for a readable list.
 */
export function checkCopy(spec: CopySpec, catalogs: Catalogs): CopyProblem[] {
  const problems: CopyProblem[] = [];
  const wellFormed = new Map<string, KeySpec>();
  for (const key of Object.keys(spec)) {
    const why = entryProblem(key, spec[key]);
    if (why === null) {
      wellFormed.set(key, spec[key]);
    } else {
      problems.push(problem('bad-spec', key, null, why));
    }
  }
  const supported: readonly string[] = SUPPORTED_LOCALES;
  for (const locale of isRecord(catalogs) ? Object.keys(catalogs) : []) {
    if (!supported.includes(locale)) {
      problems.push(problem('unsupported-locale', null, locale, `the supported locales are ${supported.join(', ')}`));
    }
  }
  const en: { readonly [key: string]: unknown } = isRecord(catalogs) && isRecord(catalogs.en) ? catalogs.en : {};
  for (const [key, entry] of wellFormed) {
    if (entry.class === 'N' && !has(en, key)) {
      problems.push(problem('missing-text', key, 'en', 'an N key needs en text'));
    }
  }
  for (const key of Object.keys(en)) {
    const entry = wellFormed.get(key);
    if (!has(spec, key)) {
      problems.push(problem('missing-key', key, 'en', 'text for a key the spec does not declare'));
    } else if (entry === undefined) {
      continue; // its spec entry is reported already
    } else if (entry.class === 'R') {
      problems.push(problem('regulated-text', key, 'en', 'an R key carries no text in this tree (F3-B)'));
    } else {
      const message = en[key];
      let why: string | null;
      if (typeof message !== 'string' || message.trim() === '') {
        why = 'text is a non-blank string';
      } else {
        const nodes = tryParse(message);
        why = typeof nodes === 'string' ? nodes : styleProblem(message);
      }
      if (why !== null) {
        problems.push(problem('bad-message', key, 'en', why));
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The ICU subset. No message-format engine is installed (Stage 0 D3 names FormatJS behind this port,
// and package.json is held), so the port formats the forms copy needs: an argument {name}, plural
// (with # and =N) and select, nested. It refuses everything else, including every form where ICU
// quoting or FormatJS tags would read the same text differently, so each accepted message selects
// the same branch and the same words under FormatJS. Plural selection and the grouping of # are plain
// code, never Intl, so jest and a Hermes release build select alike.
// ---------------------------------------------------------------------------------------------

/** First-strong isolate and pop: each value put into a message sits in its own bidi run (LEDGER section 9). */
const FSI = '\u2068';
const PDI = '\u2069';

/** Message text outside a plural branch, where # has no number to stand for. */
type TextNode =
  | { readonly type: 'literal'; readonly value: string }
  | { readonly type: 'argument'; readonly name: string }
  | { readonly type: 'plural'; readonly name: string; readonly branches: ReadonlyMap<string, readonly PluralNode[]> }
  | { readonly type: 'select'; readonly name: string; readonly branches: ReadonlyMap<string, readonly TextNode[]> };

/** Inside a plural branch, # stands for the plural's number. */
type PluralNode = TextNode | { readonly type: 'pound' };

/** A message outside the subset. Its message says what and where. */
class MessageSyntaxError extends Error {}

/** A value the message cannot take: missing, or of the wrong kind. */
class MessageArgsError extends Error {}

const ARGUMENT_NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const PLURAL_SELECTOR = /[=]\d+|[a-z]+/y;
const SELECT_SELECTOR = /[A-Za-z][A-Za-z0-9_]*/y;
const PLURAL_CATEGORIES: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** After an ASCII apostrophe, these start ICU quoting (FormatJS adds < and >), so the subset refuses them. */
const QUOTE_STARTERS = "'{}#<>|";

function parseMessage(source: string): readonly TextNode[] {
  let at = 0;
  const fail = (why: string): never => {
    throw new MessageSyntaxError(`${why}, at character ${at + 1}`);
  };
  const skipSpace = () => {
    while (at < source.length && /\s/.test(source[at])) {
      at += 1;
    }
  };
  const read = (pattern: RegExp, what: string): string => {
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (match === null) {
      return fail(`expected ${what}`);
    }
    at += match[0].length;
    return match[0];
  };

  /** Text and arguments up to the end, or, inside a branch, up to its closing brace. */
  function sequence(inPlural: true, inBranch: boolean): PluralNode[];
  function sequence(inPlural: false, inBranch: boolean): TextNode[];
  function sequence(inPlural: boolean, inBranch: boolean): PluralNode[] {
    const nodes: PluralNode[] = [];
    let text = '';
    const flush = () => {
      if (text !== '') {
        nodes.push({ type: 'literal', value: text });
        text = '';
      }
    };
    while (at < source.length) {
      const char = source[at];
      if (char === '}') {
        if (inBranch) {
          break;
        }
        fail('a } with no {');
      } else if (char === '{') {
        flush();
        nodes.push(argument());
        continue;
      } else if (char === '#') {
        if (!inPlural) {
          fail('a # outside a plural branch');
        }
        flush();
        nodes.push({ type: 'pound' });
        at += 1;
        continue;
      } else if (char === '<') {
        fail('a < (FormatJS reads it as a tag)');
      } else if (char === "'" && at + 1 < source.length && QUOTE_STARTERS.includes(source[at + 1])) {
        fail(`an apostrophe before ${source[at + 1]} (ICU reads it as quoting)`);
      }
      text += char;
      at += 1;
    }
    flush();
    return nodes;
  }

  function argument(): TextNode {
    at += 1;
    skipSpace();
    const name = read(ARGUMENT_NAME, 'an argument name');
    skipSpace();
    if (source[at] === '}') {
      at += 1;
      return { type: 'argument', name };
    }
    if (source[at] !== ',') {
      return fail('expected , or } after the argument name');
    }
    at += 1;
    skipSpace();
    const type = read(ARGUMENT_NAME, 'plural or select');
    if (type !== 'plural' && type !== 'select') {
      return fail(`${type} is outside the copy subset, which has plural and select only`);
    }
    skipSpace();
    if (source[at] !== ',') {
      return fail(`expected , after ${type}`);
    }
    at += 1;
    const pluralBranches = new Map<string, readonly PluralNode[]>();
    const selectBranches = new Map<string, readonly TextNode[]>();
    for (;;) {
      skipSpace();
      if (at >= source.length) {
        return fail('a { with no }');
      }
      if (source[at] === '}') {
        at += 1;
        break;
      }
      let selector = read(type === 'plural' ? PLURAL_SELECTOR : SELECT_SELECTOR, `a ${type} selector`);
      if (type === 'plural') {
        if (selector.startsWith('=')) {
          selector = `=${Number(selector.slice(1))}`;
        } else if (!PLURAL_CATEGORIES.includes(selector)) {
          return fail(`${selector} is not a plural category`);
        }
      }
      if (pluralBranches.has(selector) || selectBranches.has(selector)) {
        return fail(`the selector ${selector} appears twice`);
      }
      skipSpace();
      if (source[at] !== '{') {
        return fail(`expected { after ${selector}`);
      }
      at += 1;
      if (type === 'plural') {
        pluralBranches.set(selector, sequence(true, true));
      } else {
        selectBranches.set(selector, sequence(false, true));
      }
      if (source[at] !== '}') {
        return fail('a { with no }');
      }
      at += 1;
    }
    if (!pluralBranches.has('other') && !selectBranches.has('other')) {
      return fail(`a ${type} needs an other branch`);
    }
    return type === 'plural' ? { type, name, branches: pluralBranches } : { type, name, branches: selectBranches };
  }

  return sequence(false, false);
}

/** A message's nodes, or why it is outside the subset. */
function tryParse(message: string): readonly TextNode[] | string {
  try {
    return parseMessage(message);
  } catch (error) {
    if (error instanceof MessageSyntaxError) {
      return error.message;
    }
    throw error;
  }
}

/**
 * Emoji, by code point, never by a Unicode property regex: the pictograph and emoticon planes
 * (U+1F000 to U+1FAFF, flags included), the miscellaneous symbols and dingbats, the emoji
 * presentation selector, the keycap, and the stars and squares of U+2B00. Not ™ or ©.
 */
const isEmoji = (point: number): boolean =>
  (point >= 0x1f000 && point <= 0x1faff) ||
  (point >= 0x2600 && point <= 0x27bf) ||
  [0xfe0f, 0x20e3, 0x2b1b, 0x2b1c, 0x2b50, 0x2b55].includes(point);

/** The LEDGER section 11 rules a machine can hold, or null when the text keeps them. */
function styleProblem(message: string): string | null {
  if (message.includes('...')) {
    return 'an ellipsis is one character, U+2026, never three dots';
  }
  if (message.includes('!')) {
    return 'copy carries no exclamation mark';
  }
  for (const char of message) {
    if (isEmoji(char.codePointAt(0) ?? 0)) {
      return 'copy carries no emoji';
    }
  }
  return null;
}

/** CLDR's en rule for whole numbers: one for 1 and -1, other for every other number. */
const enPluralCategory = (n: number): string => (Math.abs(n) === 1 ? 'one' : 'other');

/** A whole number as FormatJS writes # in en: digits grouped in threes with commas. */
function groupDigits(n: number): string {
  const grouped = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${grouped}` : grouped;
}

function argumentValue(args: CopyArgs | undefined, name: string): unknown {
  if (!isRecord(args) || !has(args, name)) {
    throw new MessageArgsError(`no value for ${name}`);
  }
  return args[name];
}

/**
 * One node's text, with `literal` applied to the catalogue's own words (the pseudo-locale accents
 * them), never to a value. A # is written by its own plural, the one place its number is known.
 */
function renderNode(node: TextNode, args: CopyArgs | undefined, literal: (text: string) => string): string {
  if (node.type === 'literal') {
    return literal(node.value);
  }
  if (node.type === 'argument') {
    const value = argumentValue(args, node.name);
    if (typeof value === 'string') {
      return FSI + value + PDI;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return FSI + String(value) + PDI;
    }
    throw new MessageArgsError(`${node.name} is a string or a finite number`);
  }
  if (node.type === 'plural') {
    const count = argumentValue(args, node.name);
    if (typeof count !== 'number' || !Number.isSafeInteger(count)) {
      throw new MessageArgsError(`${node.name} is a whole number, for its plural`);
    }
    const branch = node.branches.get(`=${count}`) ?? node.branches.get(enPluralCategory(count)) ?? node.branches.get('other') ?? [];
    return branch.map((part) => (part.type === 'pound' ? FSI + groupDigits(count) + PDI : renderNode(part, args, literal))).join('');
  }
  const value = argumentValue(args, node.name);
  if (typeof value !== 'string') {
    throw new MessageArgsError(`${node.name} is a string, for its select`);
  }
  const branch = node.branches.get(value) ?? node.branches.get('other') ?? [];
  return branch.map((part) => renderNode(part, args, literal)).join('');
}

const unchanged = (text: string): string => text;

/** The bidi marks and isolates: they take no room and show nothing. */
const BIDI_CONTROLS = /[\u200E\u200F\u061C\u2066-\u2069]/g;

const showsNothing = (text: string): boolean => text.replace(BIDI_CONTROLS, '').trim() === '';

const visibleLength = (text: string): number => [...text.replace(BIDI_CONTROLS, '')].length;

// The pseudo-locale's letters: each Latin letter has its own accented look-alike, one to one, so a
// capture's text can be read back to the en catalogue (QA-039). All are single BMP code points.
const PLAIN_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACCENTED_LETTERS = '\u00E1\u0180\u00E7\u010F\u00E9\u0192\u011D\u0125\u00ED\u0135\u0137\u013A\u1E3F\u00F1\u00F3\u1E55\u024B\u0155\u0161\u0165\u00FA\u1E7D\u0175\u1E8B\u00FD\u017E\u00C1\u0181\u00C7\u010E\u00C9\u0191\u011C\u0124\u00CD\u0134\u0136\u0139\u1E3E\u00D1\u00D3\u1E54\u024A\u0154\u0160\u0164\u00DA\u1E7C\u0174\u1E8A\u00DD\u017D';
const ACCENT = new Map([...PLAIN_LETTERS].map((letter, i) => [letter, ACCENTED_LETTERS[i]]));

const accent = (text: string): string => text.replace(/[A-Za-z]/g, (letter) => ACCENT.get(letter) ?? letter);

/** Words to lengthen pseudo text with, accented like the rest, so they wrap as words do. */
const FILLER = accent(' one two three four five six seven eight nine ten');

/** The pseudo-locale's shape: at least 40% longer, then bracketed, so a cut-off end shows. */
function lengthen(text: string): string {
  const extra = Math.ceil(visibleLength(text) * 0.4);
  let filler = '';
  while (filler.length < extra) {
    filler += FILLER;
  }
  return `[${text}${filler.slice(0, extra)}]`;
}

/** What a release build shows where it has no text: one ellipsis, never '' and never the key. */
const NO_TEXT = '\u2026';

const UNAVAILABLE: CopyResult = { kind: 'reserved', reason: 'unavailable', budget: null };

const own = <T>(record: { readonly [key: string]: T }, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

/** A release bundle's prelude declares __DEV__ false; jest's preset sets it true; a bare script has none. */
function defaultMode(): CopyMode {
  return (globalThis as { readonly __DEV__?: unknown }).__DEV__ === false ? 'release' : 'strict';
}

/** The locale a port resolves in: the one native latched (D4-B), en when none was passed. */
function chooseLocale(asked: unknown, mode: CopyMode): CopyLocale {
  if (asked === undefined) {
    return 'en';
  }
  if (asked === PSEUDO_LOCALE) {
    return PSEUDO_LOCALE;
  }
  const supported: readonly unknown[] = SUPPORTED_LOCALES;
  if (supported.includes(asked)) {
    return asked as CopyLocale;
  }
  if (mode === 'strict') {
    throw new CopyError('unsupported-locale', `no copy locale ${String(asked)}`, null, String(asked));
  }
  return 'en';
}

/**
 * The one way to build a port: at the composition root, from the app's spec and catalogues. A
 * malformed option throws in every build; a strict build also checks the spec and catalogues and
 * throws invalid-copy with every problem it found.
 */
export function createCopyPort<S extends CopySpec>(options: CopyPortOptions<S>): CopyPort<S> {
  for (const name of Object.keys(options)) {
    if (!OPTIONS.includes(name)) {
      throw new CopyError('bad-option', `createCopyPort takes no option ${name}`);
    }
  }
  const { spec, catalogs } = options;
  if (!isRecord(spec)) {
    throw new CopyError('bad-option', 'createCopyPort needs a spec');
  }
  if (!isRecord(catalogs) || !isRecord(catalogs.en)) {
    throw new CopyError('bad-option', 'createCopyPort needs catalogs with an en catalogue');
  }
  if (options.mode !== undefined && options.mode !== 'strict' && options.mode !== 'release') {
    throw new CopyError('bad-option', `no copy mode ${String(options.mode)}`);
  }
  const mode = options.mode ?? defaultMode();
  const locale = chooseLocale(options.locale, mode);
  if (mode === 'strict') {
    const problems = checkCopy(spec, catalogs);
    if (problems.length > 0) {
      const listed = problems.map((p) => `${p.code} ${p.key ?? ''}${p.locale ? ` (${p.locale})` : ''}: ${p.detail}`);
      throw new CopyError('invalid-copy', `the copy spec or catalogues are invalid: ${listed.join('; ')}`, null, null, problems);
    }
  }

  /** A strict build throws the failure; a release build resolves it to an unavailable slot. */
  const fail = (code: CopyErrorCode, message: string, key: string): CopyResult => {
    if (mode === 'strict') {
      throw new CopyError(code, message, key);
    }
    return UNAVAILABLE;
  };

  /** The pseudo-locale reads the en catalogue and changes only how its words look. */
  const pseudo = locale === PSEUDO_LOCALE;

  /** Each message is parsed once; a message outside the subset is remembered as its reason. */
  const parsed = new Map<string, readonly TextNode[] | string>();
  const parse = (message: string): readonly TextNode[] | string => {
    let nodes = parsed.get(message);
    if (nodes === undefined) {
      nodes = tryParse(message);
      parsed.set(message, nodes);
    }
    return nodes;
  };

  const resolve = (key: string, args?: CopyArgs): CopyResult => {
    const entry = own(spec, key);
    if (entry === undefined) {
      return fail('missing-key', `no copy key ${key}`, key);
    }
    if (entry.class === 'R') {
      return { kind: 'reserved', reason: 'regulated', budget: entry.budget };
    }
    const message: unknown = own(catalogs.en, key);
    if (message === undefined) {
      return fail('missing-text', `no en text for ${key}`, key);
    }
    if (typeof message !== 'string') {
      return fail('bad-message', `${key}: text is a non-blank string`, key);
    }
    const nodes = parse(message);
    if (typeof nodes === 'string') {
      return fail('bad-message', `${key}: ${nodes}`, key);
    }
    let shown: string;
    try {
      shown = nodes.map((node) => renderNode(node, args, pseudo ? accent : unchanged)).join('');
    } catch (error) {
      if (error instanceof MessageArgsError) {
        return fail('bad-args', `${key}: ${error.message}`, key);
      }
      throw error;
    }
    if (showsNothing(shown)) {
      return fail('empty-text', `${key} leaves nothing visible with these values`, key);
    }
    return { kind: 'text', text: pseudo ? lengthen(shown) : shown };
  };

  const text = (key: string, args?: CopyArgs): string => {
    const result = resolve(key, args);
    if (result.kind === 'text') {
      return result.text;
    }
    if (result.reason === 'regulated' && mode === 'strict') {
      throw new CopyError('regulated-key', `${key} is an R key: resolve() it and render a ReservedSlot`, key);
    }
    return NO_TEXT;
  };

  return { locale, resolve, text };
}
