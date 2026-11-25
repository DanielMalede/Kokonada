// The lab's hero scene group (F10 G8-2a and G8-2b): the v2 hero's instrument over the field, from synthetic data, ids
// `hero.abyss.<face>.<taps>.<script>` (scenes/HeroScene.tsx). It lives in its own file, as the B8 groups do, so scenes.ts
// composes it and refuses an id without the group's prefix or one already in the catalogue. One scene per face, starting
// taps (`three`, the hero scene's placements, or `empty`) and script (`latin` or `hebrew`), on the field's master period,
// with the stage and the plate as its probes, the files its components set their text in as its fonts, and the typeface
// provider for its rim words (F6).

import { BASE } from '../../v2/tokens/tokens.generated';
import { FIELD_FACES } from '../fieldScenes';
import type { Scene } from '../scenes';
import { HERO_FONTS, HERO_SCENE_PROBES, HERO_SCRIPTS, HERO_TAPS, HeroScene, heroSceneId } from '../scenes/HeroScene';

export const HERO_LAB_SCENES: Readonly<Record<string, Scene>> = Object.fromEntries(FIELD_FACES.flatMap((face) => HERO_TAPS.flatMap((taps) => HERO_SCRIPTS.map((script) => [
  heroSceneId(face, taps, script), { periodMs: BASE.field.clock.T, probes: HERO_SCENE_PROBES, fonts: HERO_FONTS, typefaces: true, Component: HeroScene },
]))));
