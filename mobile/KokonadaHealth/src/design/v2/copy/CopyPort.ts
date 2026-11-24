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

export type CopyMode = 'strict' | 'release';

export type CopyResult =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reserved'; readonly reason: 'regulated'; readonly budget: CopyBudget };

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
  /** An N key's text. An R key is never text: resolve() it and render a ReservedSlot. */
  text(key: NeutralKeyOf<S>): string;
}

export type CopyErrorCode = 'missing-key' | 'regulated-key';

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
  readonly mode?: CopyMode;
}

const own = <T>(record: { readonly [key: string]: T }, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

export function createCopyPort<S extends CopySpec>(options: CopyPortOptions<S>): CopyPort<S> {
  const { spec, catalogs } = options;

  const resolve = (key: string): CopyResult => {
    const entry = own(spec, key);
    if (entry === undefined) {
      throw new CopyError('missing-key', `no copy key ${key}`, key);
    }
    if (entry.class === 'R') {
      return { kind: 'reserved', reason: 'regulated', budget: entry.budget };
    }
    const message = own(catalogs.en, key);
    if (message === undefined) {
      throw new CopyError('missing-key', `no en text for ${key}`, key);
    }
    return { kind: 'text', text: message };
  };

  const text = (key: string): string => {
    const result = resolve(key);
    if (result.kind !== 'text') {
      throw new CopyError('regulated-key', `${key} is an R key: resolve() it and render a ReservedSlot`, key);
    }
    return result.text;
  };

  return { locale: 'en', resolve, text };
}
