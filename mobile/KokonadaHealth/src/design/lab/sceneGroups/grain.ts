// The lab's grain scene group: the grain swatch (B8-4), ids `grain.abyss.<face>.<tier>`.
// It lives in its own file so its package never edits scenes.ts, which composes it (B8-0) and refuses an id without the
// group's prefix or one already in the catalogue. Each scene is GrainScene (scenes/GrainScene.tsx) on the field's master
// period, its facts in grain/grainFrames.ts.

import { GRAIN_SPECS } from '../grain/grainFrames';
import type { Scene } from '../scenes';
import { GRAIN_SCENE_PROBES, GrainScene } from '../scenes/GrainScene';

export const GRAIN_SCENES: Readonly<Record<string, Scene>> = Object.fromEntries(Object.values(GRAIN_SPECS)
  .map((s): [string, Scene] => [s.id, { periodMs: s.periodMs, probes: GRAIN_SCENE_PROBES, Component: GrainScene }]));
