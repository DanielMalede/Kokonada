// Lets a report running under node import the lab's TypeScript as the app's bundler does (B8-8d). The lab and v2 sources
// write their relative imports without an extension (`from '../fieldScenes'`); node resolves only full file names, so a
// report could not import witnessLayout.ts and would have to restate it. This module hook tries `.ts`, then
// `/index.ts`, for a relative specifier with no extension, and leaves every other specifier to node. Type stripping does
// the rest; a .tsx file (JSX) is never reached from the witness modules.
//
//   import { registerTsResolve } from './lib/tsResolve.mjs';
//   registerTsResolve();
//   const { witnessLayout } = await import('../../../src/design/lab/witness/witnessLayout.ts');   // dynamic: after the hook

import { register } from 'node:module';

const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

/** The module hook (node:module register): a relative specifier with no extension, tried as .ts, then /index.ts. */
export async function resolve(specifier, context, next) {
  if (RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier) && context.parentURL?.startsWith('file:')) {
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await next(`${specifier}${suffix}`, context);
      } catch {
        // not that file: try the next suffix, then node's own answer (and its error)
      }
    }
  }
  return next(specifier, context);
}

let registered = false;
/** Registers the hook once per process; modules imported after it resolve extensionless relative imports. */
export function registerTsResolve() {
  if (registered) return;
  register(new URL(import.meta.url));
  registered = true;
}
