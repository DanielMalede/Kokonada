// The lab's storm scene group: the S7 storm recordings (B8-7), ids `storm.abyss.dark.<case>`.
// It lives in its own file so its package never edits scenes.ts, which composes it (B8-0) and refuses an id without the
// group's prefix or one already in the catalogue.

import type { Scene } from '../scenes';

export const STORM_SCENES: Readonly<Record<string, Scene>> = {};
