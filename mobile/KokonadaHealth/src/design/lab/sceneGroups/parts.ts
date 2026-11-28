// The lab's parts scene group (LF3: the F10 parts B1's pages need before any B1 G8), ids `parts.abyss.<face>.<item>.<script>`
// (parts/partsIds.ts): the InlineNotice with zero, one and two actions (scenes/NoticeScene.tsx), the LegalReader on the
// lab's sample document (scenes/ReaderScene.tsx), and the Well's hint with its accessibility label (scenes/WellHintScene.tsx).
// It lives in its own file, as the B8 groups do, so scenes.ts composes it and refuses an id without the group's prefix or one
// already in the catalogue. They draw no field: each is on the ground, on the field's master period (it never moves by the
// clock), with the stage as its one probe and the files its text is set in as its fonts.

import { BASE } from '../../v2/tokens/tokens.generated';
import { FIELD_FACES } from '../fieldScenes';
import { PARTS_SCRIPTS, partsSceneId, type PartsItem } from '../parts/partsIds';
import type { Scene } from '../scenes';
import { NOTICE_SCENE_FONTS, NoticeScene } from '../scenes/NoticeScene';
import { READER_SCENE_FONTS, ReaderScene } from '../scenes/ReaderScene';
import { WELL_SCENE_FONTS, WellHintScene } from '../scenes/WellHintScene';

export { PARTS_ITEMS, PARTS_SCRIPTS, partsSceneId } from '../parts/partsIds';

export const PARTS_SCENE_PROBES: readonly string[] = ['stage'];

const BY_ITEM: Readonly<Record<PartsItem, Pick<Scene, 'Component' | 'fonts'>>> = {
  notice: { Component: NoticeScene, fonts: NOTICE_SCENE_FONTS },
  reader: { Component: ReaderScene, fonts: READER_SCENE_FONTS },
  well: { Component: WellHintScene, fonts: WELL_SCENE_FONTS },
};

export const PARTS_SCENES: Readonly<Record<string, Scene>> = Object.fromEntries(
  FIELD_FACES.flatMap((face) => (Object.keys(BY_ITEM) as PartsItem[]).flatMap((item) => PARTS_SCRIPTS.map((script) => [
    partsSceneId(face, item, script),
    { periodMs: BASE.field.clock.T, probes: PARTS_SCENE_PROBES, ...BY_ITEM[item] },
  ]))),
);
