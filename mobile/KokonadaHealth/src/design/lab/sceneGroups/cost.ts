// The lab's cost scene group: the fieldCost bench (B8-3), ids `cost.abyss.<face>.<scene>.<tier>[.storm|.heavy|.empty]`.
// It lives in its own file so its package never edits scenes.ts, which composes it (B8-0) and refuses an id without the
// group's prefix or one already in the catalogue.

import type { Scene } from '../scenes';

export const COST_SCENES: Readonly<Record<string, Scene>> = {};
