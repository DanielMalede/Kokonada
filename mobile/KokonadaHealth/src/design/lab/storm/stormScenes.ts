// The storm scenes (B8-7; the architect's B8 plan at 199b138; QA-068's S7 and UI-190), ids `storm.abyss.dark.<case>`.
// Abyss dark only: package 3 is Abyss alone, so S7's Basin dark is not built (QA-068 names it; Basin is retired here).
//
//   storm.abyss.dark.first-full     S7 (i): the first tap, rest → one.calm, in normal motion (the full tier)
//   storm.abyss.dark.first-still    S7 (i): the same under reduced motion (the still tier)
//   storm.abyss.dark.toggle-still   S7 (ii): the toggle storm on the one.calm spot, 7 taps a second for 3 s, reduced
//   storm.abyss.dark.idle-still     UI-190 (L19): one change after each 2 s idle, reduced, for the tap-to-field latency
//
// The case is one token (the capture plans' grammar, `storm.<direction>.<face>.<case>`); the tier is part of it. Each is
// drawn by scenes/StormScene.tsx on the hero layout, with the hero scene one.calm's placement read from the extensions.

import type { FieldLayout } from '../../v2/field/fieldDriver';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { QUIET_SLOTS } from '../../v2/field/fieldLaw';
import type { Tap } from '../../v2/field/placementLedger';
import type { MotionTier } from '../../v2/motion/useMotionPolicy';
import { EXTENSIONS } from '../../v2/tokens/tokens.extensions.generated';
import type { DirectionId, Face } from '../../v2/tokens/tokens.generated';
import { FIELD_DIRECTION } from '../fieldScenes';
import { stormScript, type StormCase, type StormScript } from './stormScript';

export interface StormSceneSpec {
  readonly id: string;
  readonly direction: DirectionId;
  readonly face: Face;
  readonly tier: MotionTier;
  readonly script: StormScript;
  readonly layout: (width: number, height: number, fontScale: number) => FieldLayout;
}

const HERO = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: Readonly<Record<string, { readonly placements?: ReadonlyArray<{ x: number; y: number }> }>> } } } })
  .base.$root.hero.scenes;

function calmSpot(): Tap {
  const p = HERO['one.calm']?.placements;
  if (p === undefined || p.length !== 1) throw new Error('the hero scene one.calm must place exactly one bead: the storm scenes tap its spot');
  return { x: p[0].x, y: p[0].y };
}

const FACE: Face = 'dark';
const CASES: ReadonlyArray<readonly [StormCase, MotionTier]> = [['first', 'full'], ['first', 'still'], ['toggle', 'still'], ['idle', 'still']];

export const STORM_SCENE_SPECS: Readonly<Record<string, StormSceneSpec>> = (() => {
  const calm = calmSpot();
  return Object.fromEntries(CASES.map(([c, tier]) => {
    const id = `storm.${FIELD_DIRECTION}.${FACE}.${c}-${tier}`;
    return [id, {
      id, direction: FIELD_DIRECTION, face: FACE, tier, script: stormScript(c, calm),
      layout: (w: number, h: number, fontScale: number) => heroLayout(FIELD_DIRECTION, w, h, fontScale),
    }];
  }));
})();

/** A storm scene's layout at a measured size: more than QUIET_SLOTS quiet rects is a RangeError (the lab never clamps). */
export function stormSceneLayout(spec: StormSceneSpec, width: number, height: number, fontScale: number): FieldLayout {
  const layout = spec.layout(width, height, fontScale);
  const count = layout.quietRects?.length ?? 0;
  if (count > QUIET_SLOTS) {
    throw new RangeError(`lab scene "${spec.id}": ${count} quiet rects, at most ${QUIET_SLOTS} (QUIET_SLOTS); the lab never clamps`);
  }
  return layout;
}

/** A launch's storm scene, by id: any other id is a programming error. */
export function stormSceneSpec(id: string): StormSceneSpec {
  if (!Object.prototype.hasOwnProperty.call(STORM_SCENE_SPECS, id)) throw new Error(`"${id}" is not a lab storm scene`);
  return STORM_SCENE_SPECS[id];
}
