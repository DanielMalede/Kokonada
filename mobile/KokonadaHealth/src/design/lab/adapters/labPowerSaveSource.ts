// Battery saver in the Design Lab (MB-087, F-9 A): the lab activity reads PowerManager and passes the
// state at launch, as an initial prop, and again on every change, as a device event. This adapter is
// v2's PowerSaveSource over those two, so the motion policy (useMotionPolicy) hears the real OS state.
//
// The names are LabRoot's (LAB_PROPS, LAB_EVENTS), which nativeContract.test.ts pins to the Kotlin
// call sites; this file never spells them. A launch value that is not a boolean reads as off, exactly
// as LabRoot reports it in READY, so the shot's manifest and the policy see the same state.
//
// Create it once per mount (useLabPowerSaveSource): a source rebuilt on every render is a new,
// unanswered source each time, and the policy would re-subscribe without end (resilience MEDIUM-4).

import { useState } from 'react';
import type { PowerSaveSource } from '../../v2/motion/ports';
import { LAB_EVENTS, LAB_PROPS, type LabEventSource } from '../LabRoot';

export function createLabPowerSaveSource(launchProps: Readonly<Record<string, unknown>>, events: LabEventSource): PowerSaveSource {
  let latest = launchProps[LAB_PROPS.powerSave] === true;
  return {
    read: () => Promise.resolve(latest),
    subscribe: (onChange) => {
      const subscription = events.addListener(LAB_EVENTS.powerSave, (event) => {
        const value = (event as { powerSave?: unknown } | null | undefined)?.powerSave;
        if (typeof value !== 'boolean') return;
        latest = value;
        onChange(value);
      });
      return () => subscription.remove();
    },
  };
}

/** The lab session's one power-save source: made on mount from the launch props, kept for its life. */
export function useLabPowerSaveSource(launchProps: Readonly<Record<string, unknown>>, events: LabEventSource): PowerSaveSource {
  const [source] = useState(() => createLabPowerSaveSource(launchProps, events));
  return source;
}
