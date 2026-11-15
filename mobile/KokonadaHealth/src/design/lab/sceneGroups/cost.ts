// The lab's cost scene group: the fieldCost bench (B8-3), ids `cost.abyss.<face>.<scene>.<tier>[.storm|.heavy|.empty]`.
// It lives in its own file so its package never edits scenes.ts, which composes it (B8-0) and refuses an id without the
// group's prefix or one already in the catalogue. The scenes themselves are cost/costScenes.ts; each is drawn by CostScene.

import { COST_SCENE_SPECS } from '../cost/costScenes';
import type { Scene } from '../scenes';
import { COST_SCENE_PROBES, CostScene } from '../scenes/CostScene';

export const COST_SCENES: Readonly<Record<string, Scene>> = Object.fromEntries(Object.values(COST_SCENE_SPECS)
  .map((s) => [s.id, { periodMs: s.periodMs, probes: COST_SCENE_PROBES, Component: CostScene }]));
