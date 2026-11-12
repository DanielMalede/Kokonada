// The Design Lab's scenes (MB-085), by id. A launch names one (`--es scene <id>`); the parser
// refuses any other id. Each scene declares the probes READY waits for, and its period T: the
// fixed and stepped clocks run within [0, T).

import type { ComponentType } from 'react';
import type { FieldClock } from '../v2/clock/fieldClock';
import { FIELD_SCENES } from './fieldScenes';
import type { LabParams } from './params';
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
  Component: ComponentType<SceneProps>;
};

// The field scenes (T14, fieldScenes.ts): FieldView for a field scene, FieldFallback for a fallback scene, each on the
// field's master period.
const fieldScenes: Record<string, Scene> = Object.fromEntries(Object.values(FIELD_SCENES).map((s) => [s.id, s.kind === 'field'
  ? { periodMs: s.periodMs, probes: FIELD_SCENE_PROBES, Component: FieldScene }
  : { periodMs: s.periodMs, probes: FALLBACK_SCENE_PROBES, Component: FallbackScene }]));

export const SCENES: Readonly<Record<string, Scene>> = {
  smoke: { periodMs: SMOKE_PERIOD_MS, probes: SMOKE_PROBES, Component: SmokeScene },
  ...fieldScenes,
};
