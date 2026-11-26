// Reduced motion from React Native. On Android, RN reads it from the system animator scales
// (TRANSITION_ANIMATION_SCALE). This adapter only forwards; the policy decides what it means.

import { AccessibilityInfo } from 'react-native';
import type { ReduceMotionSource } from './ports.ts';

export const reduceMotionSource: ReduceMotionSource = {
  read: () => AccessibilityInfo.isReduceMotionEnabled(),
  subscribe: (onChange) => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', onChange);
    return () => subscription.remove();
  },
};
