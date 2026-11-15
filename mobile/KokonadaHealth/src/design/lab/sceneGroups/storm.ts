// The lab's storm scene group: the S7 storm recordings (B8-7), ids `storm.abyss.dark.<case>`.
// It lives in its own file so its package never edits scenes.ts, which composes it (B8-0) and refuses an id without the
// group's prefix or one already in the catalogue. The scenes are storm/stormScenes.ts; each is drawn by StormScene on the
// field's master period (a recording runs on the real-time clock), with the stage and the marker as its probes.

import { BASE } from '../../v2/tokens/tokens.generated';
import type { Scene } from '../scenes';
import { STORM_SCENE_PROBES, StormScene } from '../scenes/StormScene';
import { STORM_SCENE_SPECS } from '../storm/stormScenes';

export const STORM_SCENES: Readonly<Record<string, Scene>> = Object.fromEntries(Object.keys(STORM_SCENE_SPECS).map((id) => [
  id, { periodMs: BASE.field.clock.T, probes: STORM_SCENE_PROBES, Component: StormScene },
]));
