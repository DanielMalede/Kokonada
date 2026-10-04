// The Design Lab's scenes (MB-085), by id. A launch names one (`--es scene <id>`); the parser
// refuses any other id. Each scene declares the probes READY waits for, and its period T: the
// fixed and stepped clocks run within [0, T).

import type { ComponentType } from 'react';
import type { FieldClock } from '../v2/clock/fieldClock';
import type { LabParams } from './params';
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

export const SCENES: Readonly<Record<string, Scene>> = {
  smoke: { periodMs: SMOKE_PERIOD_MS, probes: SMOKE_PROBES, Component: SmokeScene },
};
