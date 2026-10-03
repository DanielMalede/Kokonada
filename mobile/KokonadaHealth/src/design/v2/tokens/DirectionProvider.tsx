// Which direction's tokens the tree below uses, and optionally which face. One build serves all
// three directions: swapping is this prop, never a code path (F-7, DSN-047). Without a forced
// face, useTokens follows the phone, because both faces are equal and the phone decides.

import React, { createContext, useMemo, type ReactNode } from 'react';
import type { DirectionId, Face } from './tokens.generated.ts';

export interface DirectionChoice {
  readonly direction: DirectionId;
  /** Forces a face; the lab captures each face this way. Omit it to follow the phone. */
  readonly face?: Face;
}

export const DirectionContext = createContext<DirectionChoice | null>(null);

export function DirectionProvider({ direction, face, children }: DirectionChoice & { readonly children?: ReactNode }) {
  const choice = useMemo(() => ({ direction, face }), [direction, face]);
  return <DirectionContext.Provider value={choice}>{children}</DirectionContext.Provider>;
}
