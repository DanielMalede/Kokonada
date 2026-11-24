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

export type CopyLocale = (typeof SUPPORTED_LOCALES)[number];

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

export interface CopyPort<S extends CopySpec = CopySpec> {
  /** The locale this port resolves in. */
  readonly locale: CopyLocale;
  /** Any key: its text, or a reserved slot for an R key. */
  resolve(key: KeyOf<S>): CopyResult;
  /**
   * An N key's text. An R key is never text: resolve() it and render a ReservedSlot. Where a
   * release build has no text, this gives one ellipsis (U+2026), never '' and never the key.
   */
  text(key: NeutralKeyOf<S>): string;
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
  /** Text that is not a non-blank string. */
  | 'bad-message'
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
      if (typeof message !== 'string' || message.trim() === '') {
        problems.push(problem('bad-message', key, 'en', 'text is a non-blank string'));
      }
    }
  }
  return problems;
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

  const resolve = (key: string): CopyResult => {
    const entry = own(spec, key);
    if (entry === undefined) {
      return fail('missing-key', `no copy key ${key}`, key);
    }
    if (entry.class === 'R') {
      return { kind: 'reserved', reason: 'regulated', budget: entry.budget };
    }
    const message = own(catalogs.en, key);
    if (message === undefined) {
      return fail('missing-text', `no en text for ${key}`, key);
    }
    return { kind: 'text', text: message };
  };

  const text = (key: string): string => {
    const result = resolve(key);
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
