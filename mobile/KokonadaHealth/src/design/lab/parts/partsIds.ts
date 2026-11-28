// The parts scenes' ids (LF3: the F10 parts B1's pages need before their G8): `parts.abyss.<face>.<item>.<script>`. Shared by
// the scene group (sceneGroups/parts.ts) and the scenes, which read their face and script from the launch's id.

import type { Face } from '../../v2/tokens/tokens.generated';
import { FIELD_DIRECTION, FIELD_FACES } from '../fieldScenes';

/** The parts drawn: the InlineNotice, the LegalReader, the Well's hint with its accessibility label. */
export const PARTS_ITEMS = ['notice', 'reader', 'well'] as const;
export type PartsItem = (typeof PARTS_ITEMS)[number];
/** The scripts each is drawn in: the keys of ui.body. */
export const PARTS_SCRIPTS = ['latin', 'hebrew'] as const;
export type PartsScript = (typeof PARTS_SCRIPTS)[number];

export const partsSceneId = (face: Face, item: PartsItem, script: PartsScript) => `parts.${FIELD_DIRECTION}.${face}.${item}.${script}`;

/** The face and script a parts scene's id names, for the item the scene draws: any other id is a programming error. */
export function partsScene(id: string, item: PartsItem): { face: Face; script: PartsScript } {
  for (const face of FIELD_FACES) for (const script of PARTS_SCRIPTS) if (partsSceneId(face, item, script) === id) return { face, script };
  throw new Error(`"${id}" is not a lab parts scene of ${item}`);
}
