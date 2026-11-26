// The window's insets the witness lays out inside (the designer's witness BLOCK, 2026-11-15, item iii). Lab only.
//
// The lab window is edge to edge (the dry run's stage was the whole 1080 × 2340 px screen), so the system bars sit over
// the stage, and the capture harness crops every grab to the screen minus them (dumpsys window: the status bar 0–74 px,
// the navigation bar 2301–2340 px on the S22+). The lab may import react-native only (scripts/lab/importGraph.mjs
// LAB_PACKAGES), and of what it offers:
//   · the top is measured: StatusBar.currentHeight is the top of the root window's insets (status bars, navigation bars
//     and the display cutout; DisplayMetricsHolder.getStatusBarHeightPx), in dp;
//   · the bottom is not: nothing in react-native measures it, and Dimensions cannot (with targetSdk 36 the window is the
//     whole screen: mAppBounds 0,0–1080,2340 on the S22+), so it is a bound no Android navigation bar exceeds, the
//     three-button bar's 48 dp (the gesture bar is 39 px, 14.9 dp, there).
// A bound that is too large only moves patches up; one too small is caught on the device, where every patch probe and the
// region probe are compared with the app region (witnessProbes.ts), so a wrong inset is a refused row, never a pass.

import { StatusBar } from 'react-native';
import type { Insets } from './witnessLayout';

/** The bottom inset the witness keeps clear, in dp: Android's three-button navigation bar, the tallest phone bar. */
export const NAV_BAR_BOUND_DP = 48;

/** The insets the witness lays out inside: the measured top, the bound at the bottom, none at the sides (portrait). */
export function witnessInsets(): Insets {
  return { top: StatusBar.currentHeight ?? 0, right: 0, bottom: NAV_BAR_BOUND_DP, left: 0 };
}
