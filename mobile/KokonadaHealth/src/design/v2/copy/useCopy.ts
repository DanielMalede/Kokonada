// The React side of the copy port. The composition root builds one port (createCopyPort, from the
// app's spec and catalogues, in the locale native latched at boot) and provides it above every page;
// a page or component reads it with useCopy and asks it for keys, never holding a string itself.
//
// With no CopyProvider above, the context's default is an adapter that throws on every read, in
// every build (D2-A, fail closed): a page wired without copy cannot render a guess.

import { createContext, createElement, useContext, type ReactNode } from 'react';
import { CopyError, type CopyArgs, type CopyLocale, type CopyPort, type CopyResult, type CopySpec } from './CopyPort.ts';

/**
 * A port with its spec erased, as the context holds it. Every CopyPort<S> fits it, because it takes
 * no key at all; useCopy gives the typed port back.
 */
export interface AnyCopyPort {
  readonly locale: CopyLocale;
  resolve(key: never, args?: CopyArgs): CopyResult;
  text(key: never, args?: CopyArgs): string;
}

const noProvider = (): CopyError => new CopyError('no-provider', 'copy was read with no CopyProvider above');

const THROWING_PORT: AnyCopyPort = {
  get locale(): never {
    throw noProvider();
  },
  resolve(): never {
    throw noProvider();
  },
  text(): never {
    throw noProvider();
  },
};

const CopyContext = createContext<AnyCopyPort>(THROWING_PORT);

export interface CopyProviderProps {
  /** Build it once, at the root (module scope or a stable memo); a new port re-renders every reader. */
  readonly port: AnyCopyPort;
  readonly children?: ReactNode;
}

export function CopyProvider({ port, children }: CopyProviderProps) {
  return createElement(CopyContext.Provider, { value: port }, children);
}

/**
 * The port the nearest CopyProvider holds, typed to the app's spec so text() takes its N keys only.
 * The context cannot carry the spec's type, so this asserts it; the port still checks every key it
 * is given at run time.
 */
export function useCopy<S extends CopySpec = CopySpec>(): CopyPort<S> {
  return useContext(CopyContext) as CopyPort<S>;
}
