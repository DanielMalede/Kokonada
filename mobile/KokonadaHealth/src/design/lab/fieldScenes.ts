// The Design Lab's field scenes (T14: handoff items 7 and 9; the architect's T14 plan at c8ff246, forks F1–F6 at A).
//
// A catalogue, by scene id: Abyss on both faces, the hero scenes rest, one.joy, three and one.intense at the tiers full,
// low and still, and the near.* scenes at the full tier (UI-210), each drawn by the real FieldView (scenes/FieldScene.tsx),
// and the fallback's scenes (T13's list, on both faces), each drawn by FieldFallback mounted directly
// (scenes/FallbackScene.tsx). Everything a scene draws comes from its
// id: `field.abyss.dark.three.full` is Abyss, the dark face, the hero scene three, the full tier; `fallback.abyss.light.
// one.C.right` is the fallback on the light face in T13's scene one.C.right. A launch names the id; FieldView takes no
// lab-only knob.
//
//   · The taps are the hero scene's placements, in order (the token extensions, which the lab may hold:
//     extensionsBoundary.test.ts); a fallback scene's are T13's (fallbackScenes.ts).
//   · The period is the field's master period, BASE.field.clock.T, for every scene (handoff item 7): the fixed and
//     stepped clocks run within [0, T), so a capture's t means what it means on the hero.
//   · The layout is T13's hero layout (heroLayout, fallbackScenes.ts): the V1 boards' construction, an assumption until
//     B6 measures the real hero (UI-207), laid over the lab's measured view at the device's font scale.
//   · A scene whose layout has more than QUIET_SLOTS quiet rects is a RangeError naming it, when the catalogue is built
//     and whenever it is laid out. The shipped FieldView clamps to QUIET_SLOTS (fieldDriver.ts) and keeps that clamp; a
//     lab scene must not lean on it, or a capture would show fewer zones than its scene declares.

import { PHONE, fallbackScenes, heroLayout } from '../v2/field/fallbackScenes';
import type { FieldLayout } from '../v2/field/fieldDriver';
import type { FieldStatics } from '../v2/field/fieldFrame';
import { QUIET_SLOTS } from '../v2/field/fieldLaw';
import type { Tap } from '../v2/field/placementLedger';
import { staticsFor } from '../v2/field/statics';
import type { MotionTier } from '../v2/motion/useMotionPolicy';
import { EXTENSIONS } from '../v2/tokens/tokens.extensions.generated';
import { BASE, type DirectionId, type Face } from '../v2/tokens/tokens.generated';

export const FIELD_DIRECTION: DirectionId = 'abyss';
export const FIELD_FACES: readonly Face[] = ['dark', 'light'];
export const HERO_SCENES = ['rest', 'one.joy', 'three', 'one.intense'] as const;
export const FIELD_TIERS: readonly MotionTier[] = ['full', 'low', 'still'];
/** The near.* scenes (UI-210): one bead at (±0.141, ±0.141), r 0.2 and p 0.11, the hero's S1 beside one.neutral. */
export const NEAR_SCENES = ['near.joy', 'near.calm', 'near.reflective', 'near.intense'] as const;
/** S1's tier: the near.* scenes are stills on the fixed clock at t*, so they are drawn at the full tier only. */
export const NEAR_TIER: MotionTier = 'full';

export interface FieldSceneSpec {
  readonly id: string;
  /** field: FieldView draws it; fallback: FieldFallback, mounted directly. */
  readonly kind: 'field' | 'fallback';
  readonly direction: DirectionId;
  readonly face: Face;
  /** The hero scene a field scene draws; null for a fallback scene. */
  readonly hero: string | null;
  /** The motion tier; null for a fallback scene, which has no motion. */
  readonly tier: MotionTier | null;
  /** The cold lane's taps on the unit disc, y up, oldest first. */
  readonly taps: readonly Tap[];
  readonly periodMs: number;
  /** The view's layout in dp at its measured size and the device's font scale. */
  readonly layout: (width: number, height: number, fontScale: number) => FieldLayout;
}

type Placements = ReadonlyArray<{ readonly x: number; readonly y: number }>;
const EXT = EXTENSIONS as unknown as {
  base: { $root: { hero: { scenes: Readonly<Record<string, { readonly placements?: Placements }>> } } };
  abyss: { $root: { hardest: Parameters<typeof fallbackScenes>[1] } };
};

/** The direction's statics, read once from the extensions on the JS thread (statics.ts). */
export const FIELD_STATICS: FieldStatics = staticsFor(FIELD_DIRECTION, EXTENSIONS as never);

const hero = (width: number, height: number, fontScale: number) => heroLayout(FIELD_DIRECTION, width, height, fontScale);
const tapsOf = (placements: Placements | undefined): Tap[] => (placements ?? []).map((p) => ({ x: p.x, y: p.y }));

/** A scene's layout at a measured size: a RangeError naming the scene when it has more than QUIET_SLOTS quiet rects. */
export function fieldSceneLayout(spec: FieldSceneSpec, width: number, height: number, fontScale: number): FieldLayout {
  const layout = spec.layout(width, height, fontScale);
  const count = layout.quietRects?.length ?? 0;
  if (count > QUIET_SLOTS) {
    throw new RangeError(`lab scene "${spec.id}": ${count} quiet rects, at most ${QUIET_SLOTS} (QUIET_SLOTS); the lab never clamps`);
  }
  return layout;
}

/** The catalogue by id: a repeated id, or a scene with more than QUIET_SLOTS quiet rects on the board's phone, is refused. */
export function fieldSceneCatalogue(specs: readonly FieldSceneSpec[]): Readonly<Record<string, FieldSceneSpec>> {
  const out: Record<string, FieldSceneSpec> = {};
  for (const spec of specs) {
    if (Object.prototype.hasOwnProperty.call(out, spec.id)) throw new Error(`lab scene "${spec.id}" is defined twice`);
    fieldSceneLayout(spec, PHONE.width, PHONE.height, 1);
    out[spec.id] = spec;
  }
  return out;
}

/** A launch's scene, by id and kind: an id that is not a lab scene of that kind is a programming error. */
export function sceneSpec(id: string, kind: FieldSceneSpec['kind']): FieldSceneSpec {
  const spec = Object.prototype.hasOwnProperty.call(FIELD_SCENES, id) ? FIELD_SCENES[id] : undefined;
  if (spec === undefined || spec.kind !== kind) throw new Error(`"${id}" is not a lab ${kind} scene`);
  return spec;
}

function abyssSpecs(): FieldSceneSpec[] {
  const periodMs = BASE.field.clock.T;
  const field = FIELD_FACES.flatMap((face) => HERO_SCENES.flatMap((scene) => FIELD_TIERS.map((tier): FieldSceneSpec => ({
    id: `field.${FIELD_DIRECTION}.${face}.${scene}.${tier}`,
    kind: 'field', direction: FIELD_DIRECTION, face, hero: scene, tier,
    taps: tapsOf(EXT.base.$root.hero.scenes[scene]?.placements),
    periodMs, layout: hero,
  }))));
  const near = FIELD_FACES.flatMap((face) => NEAR_SCENES.map((scene): FieldSceneSpec => ({
    id: `field.${FIELD_DIRECTION}.${face}.${scene}.${NEAR_TIER}`,
    kind: 'field', direction: FIELD_DIRECTION, face, hero: scene, tier: NEAR_TIER,
    taps: tapsOf(EXT.base.$root.hero.scenes[scene]?.placements),
    periodMs, layout: hero,
  })));
  const fallback = fallbackScenes(EXT.base.$root.hero.scenes, EXT.abyss.$root.hardest);
  const fallbacks = FIELD_FACES.flatMap((face) => fallback.map((f): FieldSceneSpec => ({
    id: `fallback.${FIELD_DIRECTION}.${face}.${f.id}`,
    kind: 'fallback', direction: FIELD_DIRECTION, face, hero: null, tier: null,
    taps: f.taps,
    periodMs, layout: hero,
  })));
  return [...field, ...near, ...fallbacks];
}

export const FIELD_SCENES: Readonly<Record<string, FieldSceneSpec>> = fieldSceneCatalogue(abyssSpecs());
