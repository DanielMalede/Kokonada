// The lab's grain scene group: the grain swatch (B8-4), ids `grain.abyss.<face>.<tier>`.
// It lives in its own file so its package never edits scenes.ts, which composes it (B8-0) and refuses an id without the
// group's prefix or one already in the catalogue.

import type { Scene } from '../scenes';

export const GRAIN_SCENES: Readonly<Record<string, Scene>> = {};
