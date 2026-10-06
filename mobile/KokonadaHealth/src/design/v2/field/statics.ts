// The field's statics (FieldStatics, fieldFrame.ts) for a direction, read from the token extensions
// the caller holds. Only the lab and tests hold them (extensionsBoundary.test.ts), so they call this
// once per direction, on the JS thread, and pass the result down as a prop. It is deliberately not a
// worklet: a worklet that called it would copy the whole extensions object to the UI runtime.
//
// Stage 0 (architect, B4 forks, 1D and 1E) replaces this with a typed module generated from the
// tokens; fieldFrame.test.ts pins every value it returns, so the move can be checked.

import type { DirectionId } from '../tokens/tokens.generated.ts';
import type { FieldStatics } from './fieldFrame.ts';

interface ExtensionsShape {
  readonly base: {
    readonly 'field.clock': { readonly drift: { readonly harmonics: Record<string, readonly [number, number]>; readonly phases: Record<string, readonly [number, number]> } };
    readonly 'field.fallback': { readonly stops: { readonly position: readonly number[]; readonly weight: readonly number[] } };
  };
}

/** The statics for a direction, read from the extensions object the caller holds (the lab, a test). */
export function staticsFor(id: DirectionId, extensions: ExtensionsShape): FieldStatics {
  const drift = extensions.base['field.clock'].drift;
  const stops = extensions.base['field.fallback'].stops;
  const lobes = ['lobe0', 'lobe1', 'lobe2'];
  const own = (extensions as unknown as Record<string, Record<string, { lobes: ReadonlyArray<readonly [number, number]> }>>)[id]['field.rest'];
  return {
    restLobes: own.lobes,
    drift: { harmonics: lobes.map((l) => drift.harmonics[l]), phases: lobes.map((l) => drift.phases[l]) },
    fallbackStops: { position: stops.position, weight: stops.weight },
  };
}
