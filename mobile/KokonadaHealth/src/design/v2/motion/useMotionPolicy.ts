// Which motion tier the field may use, from two OS settings.
//
//   reduced motion          → still  (the designed still, no frames: QA-034)
//   battery saver           → low    (the reduced-quality tier: QA-035)
//   both                    → still
//   neither                 → full
//
// A setting the platform has not answered yet counts as on. The first read is asynchronous, and
// a person who asked for reduced motion must not be shown motion while it resolves. A change
// event is newer than a read still in flight, so once an event has arrived a late read is ignored.

import { useEffect, useState } from 'react';
import type { MotionPorts, SignalSource } from './ports.ts';

export type MotionTier = 'full' | 'low' | 'still';

export interface MotionSignals {
  /** null until the platform answers. */
  readonly reduceMotion: boolean | null;
  readonly powerSave: boolean | null;
}

export function resolveMotionTier(signals: MotionSignals): MotionTier {
  if (signals.reduceMotion !== false) {
    return 'still';
  }
  if (signals.powerSave !== false) {
    return 'low';
  }
  return 'full';
}

/** The source's latest value, or null while it has not answered. A new source starts unanswered. */
function useSignal(source: SignalSource): boolean | null {
  const [heard, setHeard] = useState<{ readonly source: SignalSource; readonly value: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    let changed = false;
    const unsubscribe = source.subscribe((value) => {
      changed = true;
      if (live) {
        setHeard({ source, value });
      }
    });
    source.read().then(
      (value) => {
        if (live && !changed) {
          setHeard({ source, value });
        }
      },
      () => {
        // A refused read leaves the setting unanswered, which keeps the cautious tier.
      },
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, [source]);
  return heard !== null && heard.source === source ? heard.value : null;
}

export function useMotionPolicy(ports: MotionPorts): MotionTier {
  const reduceMotion = useSignal(ports.reduceMotion);
  const powerSave = useSignal(ports.powerSave);
  return resolveMotionTier({ reduceMotion, powerSave });
}
