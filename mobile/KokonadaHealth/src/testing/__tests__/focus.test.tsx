import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { act } from 'react-test-renderer';
import { useIsFocused } from '@react-navigation/native';
import { useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useRealtimeFieldClock } from '../../design/v2/clock/fieldClock';
import { useCalmPulse } from '../../design/system/useCalmPulse';
import { renderInTabs } from '../focus';
import { installMotionFakes, type MotionFakes } from '../motion';
import { installTeardownProbes } from '../teardown';

// QA-018: when a page loses focus its frame callbacks, loops, timers and visual subscriptions pause,
// and resume on focus. The app's tabs never unmount (RootNavigator.tsx, MB-032), so every unmount-only
// parity pin (NowPlayingScreen.test.tsx:260-271, GenerateScreen.test.tsx:660-692) is blind to a blurred
// page that keeps drawing. renderInTabs mounts the subject as one tab of a REAL bottom-tab navigator;
// blur() navigates to a sibling tab (the subject stays mounted, as in the app) and the real
// useIsFocused sees it. Pass rule: after blur, frame callbacks = 0 and visual loops = 0.

let motion: MotionFakes;
beforeEach(() => { motion = installMotionFakes(); });
afterEach(() => { motion.restore(); });

// Compliant: every piece of visual work is keyed on focus.
function FocusedField() {
  const focused = useIsFocused();
  const { t } = useRealtimeFieldClock(6000, focused);                                  // the real v2 field clock
  useCalmPulse(!focused, 2000, { rest: 0.3, peak: 1, still: 0.6 });                      // the real breath loop
  return <Text>{focused ? `live ${Math.round(t.value)}` : 'paused'}</Text>;
}
// Planted: the clock is subscribed regardless of focus (and a loop keeps breathing).
function UnfocusedField() {
  const clock = useClock();
  const pose = useDerivedValue(() => clock.value);
  useCalmPulse(false, 2000, { rest: 0.3, peak: 1, still: 0.6 });
  return <Text>{String(pose.value)}</Text>;
}

describe('QA-018 · blur pauses all visual work', () => {
  it('the subject stays mounted across blur and focus (tabs never unmount)', async () => {
    let mounts = 0;
    let unmounts = 0;
    function Counted() { useEffect(() => { mounts += 1; return () => { unmounts += 1; }; }, []); return <Text>x</Text>; }
    const h = await renderInTabs(<Counted />);
    await h.blur();
    await h.focus();
    expect([mounts, unmounts]).toEqual([1, 0]);
    expect(h.isFocused()).toBe(true);
    await h.unmount();
    expect(unmounts).toBe(1);
  });

  it('a page that keys its work on focus: after blur, frame callbacks = 0 and loops = 0; on focus they resume', async () => {
    const h = await renderInTabs(<FocusedField />);
    act(() => { motion.frame(16); motion.frame(16); });
    expect(motion.activeFrameCallbacks()).toBe(1);
    expect(motion.activeLoops()).toBe(1);
    await h.blur();
    expect(h.isFocused()).toBe(false);
    expect(() => motion.assertStill()).not.toThrow();
    await h.focus();
    expect(motion.activeFrameCallbacks()).toBe(1);
    expect(motion.activeLoops()).toBe(1);
    await h.unmount();
  });

  it('planted: a page that ignores focus keeps its clock and loop running after blur, and the check fails', async () => {
    const h = await renderInTabs(<UnfocusedField />);
    await h.blur();
    expect(() => motion.assertStill()).toThrow(/Skia clock subscriptions: 1[\s\S]*RN Animated loops: 1/);
    await h.unmount();
  });

  it('the planted page passes unmount-only parity: only the blur check catches it (why QA-018 exists)', async () => {
    motion.restore();
    const probes = installTeardownProbes();
    try {
      const before = probes.snapshot();
      const h = await renderInTabs(<UnfocusedField />);
      await h.blur();
      expect(() => probes.motion.assertStill()).toThrow();
      await h.unmount();
      expect(() => probes.assertParity(before)).not.toThrow();
    } finally {
      probes.restore();
      motion = installMotionFakes();
    }
  });

  it('a timer keyed on focus is cleared on blur', async () => {
    function Poller() {
      const focused = useIsFocused();
      const [n, setN] = useState(0);
      useEffect(() => {
        if (!focused) return;
        const id = setInterval(() => setN((x) => x + 1), 1000);
        return () => clearInterval(id);
      }, [focused]);
      return <Text>{n}</Text>;
    }
    const probes = (motion.restore(), installTeardownProbes());
    try {
      const h = await renderInTabs(<Poller />);
      const focusedTimers = probes.snapshot().timers;
      await h.blur();
      expect(probes.snapshot().timers).toBe(focusedTimers - 1);
      await h.unmount();
    } finally {
      probes.restore();
      motion = installMotionFakes();
    }
  });
});
