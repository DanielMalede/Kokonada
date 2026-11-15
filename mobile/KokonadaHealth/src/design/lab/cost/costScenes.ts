// The fieldCost bench's scenes (B8-3), by id: `cost.abyss.<face>.<hero>.<tier>[.storm|.heavy|.empty]` (the architect's B8
// plan, "Contracts fixed now"). Each is a field scene of the catalogue (fieldScenes.ts) measured, never drawn: its taps and
// its layout are the field scene's, so the bench builds the frames the lab's field shots show.
//
//   · The hero scene is three, the hero scene with the most placements; the tiers are the two that run frames, full and
//     low (the still draws once and stops).
//   · idle: the scene's own taps, no change; storm: the 7 taps/s storm (costStorm.ts) in place of the scene's taps.
//   · heavy and empty: the instrument's calibration (heavyShader.ts), at the tier's render size. A face changes no render
//     size, so they are on the dark face only.

import type { FieldLayout } from '../../v2/field/fieldDriver';
import type { Tap } from '../../v2/field/placementLedger';
import type { DirectionId, Face } from '../../v2/tokens/tokens.generated';
import { FIELD_DIRECTION, FIELD_SCENES } from '../fieldScenes';

export type CostTier = 'full' | 'low';
export type CostVariant = 'idle' | 'storm' | 'heavy' | 'empty';

export interface CostSceneSpec {
  readonly id: string;
  readonly direction: DirectionId;
  readonly face: Face;
  readonly hero: string;
  readonly tier: CostTier;
  readonly variant: CostVariant;
  /** The field scene's taps (idle); the storm replaces them. */
  readonly taps: readonly Tap[];
  readonly periodMs: number;
  readonly layout: (width: number, height: number, fontScale: number) => FieldLayout;
}

export const COST_HERO = 'three';
const TIERS: readonly CostTier[] = ['full', 'low'];
const VARIANTS_BY_FACE: Readonly<Record<Face, readonly CostVariant[]>> = { dark: ['idle', 'storm', 'heavy', 'empty'], light: ['idle', 'storm'] };

function specs(): Record<string, CostSceneSpec> {
  const out: Record<string, CostSceneSpec> = {};
  for (const face of ['dark', 'light'] as const) {
    for (const tier of TIERS) {
      const field = FIELD_SCENES[`field.${FIELD_DIRECTION}.${face}.${COST_HERO}.${tier}`];
      if (field === undefined) throw new Error(`no field scene for the cost scene ${face}.${COST_HERO}.${tier}`);
      for (const variant of VARIANTS_BY_FACE[face]) {
        const id = `cost.${FIELD_DIRECTION}.${face}.${COST_HERO}.${tier}${variant === 'idle' ? '' : `.${variant}`}`;
        out[id] = { id, direction: field.direction, face, hero: COST_HERO, tier, variant, taps: field.taps, periodMs: field.periodMs, layout: field.layout };
      }
    }
  }
  return out;
}

export const COST_SCENE_SPECS: Readonly<Record<string, CostSceneSpec>> = specs();

/** A launch's cost scene, by id: any other id is a programming error. */
export function costSceneSpec(id: string): CostSceneSpec {
  const spec = Object.prototype.hasOwnProperty.call(COST_SCENE_SPECS, id) ? COST_SCENE_SPECS[id] : undefined;
  if (spec === undefined) throw new Error(`"${id}" is not a lab cost scene`);
  return spec;
}
