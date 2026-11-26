// The dev-only field preview's pure parts (FieldPreview.tsx; never in a release bundle, pinned by
// scripts/jest/__tests__/devPreviewExcluded.test.ts): what it cycles through, the layout it hands
// FieldView, and a tap on the view as a placement on the unit disc, y up, as the cold lane sends them.

import type { Tap } from '../field/placementLedger.ts';
import { ADMISSION } from '../field/placementLedger.ts';
import type { FieldLayout } from '../field/fieldDriver.ts';
import type { MotionTier } from '../motion/useMotionPolicy.ts';
import { BASE } from '../tokens/tokens.generated.ts';

export const PREVIEW_SCENES = ['rest', 'one.joy', 'three'] as const;
export type PreviewScene = (typeof PREVIEW_SCENES)[number];
export const PREVIEW_TIERS: readonly MotionTier[] = ['full', 'low', 'still'];

/** The hero scenes as the token extensions hold them (base.$root.hero.scenes). */
export type HeroScenes = Readonly<Record<string, { readonly placements?: ReadonlyArray<{ readonly x: number; readonly y: number }> }>>;

/** The value after `current` in `list`, wrapping; the first when `current` is not in it. */
export function cycle<T>(list: readonly T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length];
}

/** A hero scene's placements as taps, in order; none for a scene without placements. */
export function sceneTaps(scenes: HeroScenes, scene: string): Tap[] {
  return (scenes[scene]?.placements ?? []).map((p) => ({ x: p.x, y: p.y }));
}

/** The view's layout in dp: the plate centred, at the token diameter, shrunk to fit the shorter side. */
export function previewLayout(width: number, height: number, fontScale: number): FieldLayout {
  return {
    width,
    height,
    centre: [width / 2, height / 2],
    radius: Math.min(BASE.plate.maxDiameter / 2, Math.min(width, height) / 2),
    fontScale,
  };
}

/** A point on the view (dp) as a tap on the unit disc, y up; outside the plate, on its rim. */
export function tapOnDisc(point: { readonly x: number; readonly y: number }, layout: FieldLayout): Tap {
  const x = (point.x - layout.centre[0]) / layout.radius;
  const y = (layout.centre[1] - point.y) / layout.radius;
  const r = Math.hypot(x, y);
  return r > 1 ? { x: x / r, y: y / r } : { x: x + 0, y: y + 0 };
}

/** `taps` with `tap` appended, keeping the last ADMISSION.live, as the cold lane keeps them. */
export function withTap(taps: readonly Tap[], tap: Tap): Tap[] {
  return [...taps, tap].slice(-ADMISSION.live);
}
