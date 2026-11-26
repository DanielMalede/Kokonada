// The lab's witness scene group: the colour-path witness (B8-2), ids `witness.abyss.<face>`.
// It lives in its own file so its package never edits scenes.ts, which composes it (B8-0) and refuses an id without the
// group's prefix or one already in the catalogue. One scene per face, on the field's master period (the fixed and stepped
// clocks run within it; the witness itself is still), with the stage as its one probe.

import { BASE } from '../../v2/tokens/tokens.generated';
import { FIELD_FACES } from '../fieldScenes';
import type { Scene } from '../scenes';
import { WITNESS_SCENE_PROBES, WitnessScene } from '../scenes/WitnessScene';
import { witnessSceneId } from '../witness/witnessFrames';

export const WITNESS_SCENES: Readonly<Record<string, Scene>> = Object.fromEntries(FIELD_FACES.map((face) => [
  witnessSceneId(face), { periodMs: BASE.field.clock.T, probes: WITNESS_SCENE_PROBES, Component: WitnessScene },
]));
