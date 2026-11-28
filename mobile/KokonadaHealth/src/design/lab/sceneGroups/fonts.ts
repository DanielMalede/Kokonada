// The lab's fonts scene group (UI-072, UI-069; F10 G8): every v2 face drawn in itself, ids `fonts.abyss.<face>`.
// It lives in its own file, as the B8 groups do, so scenes.ts composes it and refuses an id without the group's prefix or
// one already in the catalogue. One scene per face, on the field's master period (it draws no field and never moves), with
// the stage as its one probe and every lab face as its fonts, so READY waits until each one drew in its own face.

import { BASE } from '../../v2/tokens/tokens.generated';
import { FIELD_FACES } from '../fieldScenes';
import type { Scene } from '../scenes';
import { FONTS_SCENE_FACES, FONTS_SCENE_PROBES, FontsScene, fontsSceneId } from '../scenes/FontsScene';

export const FONTS_SCENES: Readonly<Record<string, Scene>> = Object.fromEntries(FIELD_FACES.map((face) => [
  fontsSceneId(face), { periodMs: BASE.field.clock.T, probes: FONTS_SCENE_PROBES, fonts: FONTS_SCENE_FACES, Component: FontsScene },
]));
