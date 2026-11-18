// The tokens for the current direction and face. Fails loudly outside a DirectionProvider or for a
// direction the generated tokens do not have, rather than painting with a guess.

import { useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { DirectionContext } from './DirectionProvider.tsx';
import { BASE, DIRECTIONS, type DirectionId, type DirectionTokens, type Face } from './tokens.generated.ts';

export interface Tokens {
  readonly id: DirectionId;
  readonly face: Face;
  readonly base: typeof BASE;
  readonly direction: DirectionTokens;
  /** The direction's colours for this face. */
  readonly color: DirectionTokens['color'][Face];
}

export function useTokens(): Tokens {
  const choice = useContext(DirectionContext);
  const scheme = useColorScheme();
  const id = choice?.direction;
  // An unknown phone setting (null) reads as the light face.
  const face: Face = choice?.face ?? (scheme === 'dark' ? 'dark' : 'light');
  const tokens = useMemo(() => {
    const direction = id !== undefined && Object.prototype.hasOwnProperty.call(DIRECTIONS, id) ? DIRECTIONS[id] : undefined;
    return id !== undefined && direction ? { id, face, base: BASE, direction, color: direction.color[face] } : null;
  }, [id, face]);
  if (!choice) {
    throw new Error('useTokens needs a DirectionProvider above it');
  }
  if (!tokens) {
    throw new Error(`no tokens for direction ${String(id)}`);
  }
  return tokens;
}
