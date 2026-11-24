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

export type CopyLocale = 'en';

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

export type CopyErrorCode = 'missing-key' | 'missing-text' | 'regulated-key';

/** A copy failure, typed, so a test or a dev build names exactly what went wrong. */
export class CopyError extends Error {
  readonly code: CopyErrorCode;
  readonly key: string | null;

  constructor(code: CopyErrorCode, message: string, key: string | null = null) {
    super(message);
    this.name = 'CopyError';
    this.code = code;
    this.key = key;
  }
}

export interface CopyPortOptions<S extends CopySpec> {
  readonly spec: S;
  readonly catalogs: { readonly en: Catalog };
  /** Defaults to strict, unless __DEV__ is false (a release bundle). */
  readonly mode?: CopyMode;
}

/** What a release build shows where it has no text: one ellipsis, never '' and never the key. */
const NO_TEXT = '…';

const UNAVAILABLE: CopyResult = { kind: 'reserved', reason: 'unavailable', budget: null };

const own = <T>(record: { readonly [key: string]: T }, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

/** A release bundle's prelude declares __DEV__ false; jest's preset sets it true; a bare script has none. */
function defaultMode(): CopyMode {
  return (globalThis as { readonly __DEV__?: unknown }).__DEV__ === false ? 'release' : 'strict';
}

export function createCopyPort<S extends CopySpec>(options: CopyPortOptions<S>): CopyPort<S> {
  const { spec, catalogs } = options;
  const mode = options.mode ?? defaultMode();

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

  return { locale: 'en', resolve, text };
}
