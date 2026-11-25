// The Design Lab's scenes (MB-085), by id. A launch names one (`--es scene <id>`); the parser
// refuses any other id. Each scene declares the probes READY waits for, the faces it draws text in
// (UI-072), and its period T: the fixed and stepped clocks run within [0, T).

import type { ComponentType } from 'react';
import type { FieldClock } from '../v2/clock/fieldClock';
import type { Face } from '../v2/tokens/tokens.generated';
import { FIELD_SCENES } from './fieldScenes';
import type { SceneFaceId } from './fonts';
import type { LabParams } from './params';
import { COST_SCENES } from './sceneGroups/cost';
import { FONTS_SCENES } from './sceneGroups/fonts';
import { GRAIN_SCENES } from './sceneGroups/grain';
import { STORM_SCENES } from './sceneGroups/storm';
import { WITNESS_SCENES } from './sceneGroups/witness';
import { FALLBACK_SCENE_PROBES, FallbackScene } from './scenes/FallbackScene';
import { FIELD_SCENE_PROBES, FieldScene } from './scenes/FieldScene';
import { SMOKE_PERIOD_MS, SMOKE_PROBES, SmokeScene } from './scenes/SmokeScene';

export type SceneProps = {
  /** The field clock: a SharedValue for UI-thread drawing. */
  clock: FieldClock;
  /** The controlled time in ms (fixed and stepped clocks), or null on the real-time clock. */
  t: number | null;
  params: LabParams;
};

export type Scene = {
  periodMs: number;
  probes: readonly string[];
  /**
   * The faces the scene draws text in (UI-072, fonts.ts): a face cut by its file, or the type tokens' family at a weight
   * (a token face, as the v2 components style their text). READY waits until React Native drew each one, measured against
   * its fallback face; a scene that names none waits for no font. Every face the scene draws must be named here
   * (scenes.test.tsx renders each scene and checks).
   */
  fonts?: readonly SceneFaceId[];
  Component: ComponentType<SceneProps>;
};

// The field scenes (T14, fieldScenes.ts): FieldView for a field scene, FieldFallback for a fallback scene, each on the
// field's master period.
const fieldScenes: Record<string, Scene> = Object.fromEntries(Object.values(FIELD_SCENES).map((s) => [s.id, s.kind === 'field'
  ? { periodMs: s.periodMs, probes: FIELD_SCENE_PROBES, Component: FieldScene }
  : { periodMs: s.periodMs, probes: FALLBACK_SCENE_PROBES, Component: FallbackScene }]));

// The scene groups, each in its own file under sceneGroups/, by group: the faces its ids may name. A group's id is
// `<group>.abyss.<face>`, alone or followed by `.<more>` (the B8 plan's "Contracts fixed now"). The B8 benches (B8-0),
// then F10's fonts scenes (G8).
export const SCENE_GROUP_FACES = {
  witness: ['dark', 'light'],
  grain: ['dark', 'light'],
  cost: ['dark', 'light'],
  storm: ['dark'],
  fonts: ['dark', 'light'],
} as const satisfies Readonly<Record<string, readonly Face[]>>;
export type SceneGroupName = keyof typeof SCENE_GROUP_FACES;

export const SCENE_GROUPS: Readonly<Record<SceneGroupName, Readonly<Record<string, Scene>>>> = {
  witness: WITNESS_SCENES,
  grain: GRAIN_SCENES,
  cost: COST_SCENES,
  storm: STORM_SCENES,
  fonts: FONTS_SCENES,
};

const hasPrefix = (group: SceneGroupName, id: string): boolean => (SCENE_GROUP_FACES[group] as readonly string[])
  .some((face) => id === `${group}.abyss.${face}` || id.startsWith(`${group}.abyss.${face}.`));

/** The catalogue: the base, then each group in order. An id seen twice anywhere, or a group's id without its prefix,
 *  is an Error naming the id (and the group). */
export function composeScenes(
  base: Readonly<Record<string, Scene>>,
  groups: Readonly<Record<SceneGroupName, Readonly<Record<string, Scene>>>>,
): Record<string, Scene> {
  const out: Record<string, Scene> = { ...base };
  for (const group of Object.keys(SCENE_GROUP_FACES) as SceneGroupName[]) {
    for (const [id, scene] of Object.entries(groups[group])) {
      if (Object.prototype.hasOwnProperty.call(out, id)) throw new Error(`lab scene "${id}" is defined twice (group ${group})`);
      if (!hasPrefix(group, id)) {
        throw new Error(`lab scene "${id}" is not ${group}.abyss.<${SCENE_GROUP_FACES[group].join('|')}>[.…] (group ${group})`);
      }
      out[id] = scene;
    }
  }
  return out;
}

export const SCENES: Readonly<Record<string, Scene>> = composeScenes({
  smoke: { periodMs: SMOKE_PERIOD_MS, probes: SMOKE_PROBES, Component: SmokeScene },
  ...fieldScenes,
}, SCENE_GROUPS);
