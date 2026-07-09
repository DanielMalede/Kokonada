// Active-theme access for screens. Components NEVER hardcode a hex — they read the
// semantic palette for the current color scheme through useTheme(), so light/dark (and
// any future emotion-tinted variant) flow from one place. Motion likewise honours the
// OS reduced-motion setting via useMotion(), so every animated surface degrades once,
// centrally, instead of each screen re-checking the flag.

import { useColorScheme } from 'react-native';
import { AccessibilityInfo } from 'react-native';
import { useEffect, useState } from 'react';
import { colors, motion, type ColorScheme, type ThemeName } from './tokens';

export function resolveScheme(name: ThemeName | null | undefined): ColorScheme {
  return name === 'light' ? colors.light : colors.dark; // default to Bioluminescence
}

/** The semantic palette for the active OS color scheme. Dark is the default face. */
export function useTheme(): { name: ThemeName; c: ColorScheme } {
  const scheme = useColorScheme();
  const name: ThemeName = scheme === 'light' ? 'light' : 'dark';
  return { name, c: resolveScheme(name) };
}

/** Motion durations for the active reduced-motion preference. When the OS asks for
 *  reduced motion, transitions collapse and the ambient "breath" stills. */
export function useMotion(): { reduced: boolean; duration: typeof motion.duration } {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduced(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return { reduced, duration: reduced ? motion.durationReduced : motion.duration };
}
