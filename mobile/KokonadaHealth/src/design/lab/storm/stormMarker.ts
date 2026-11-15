// The storm scenes' lab marker (B8-7): a small View in the window's top-left corner whose colour changes in the same
// render as each change of the taps (scenes/StormScene.tsx), so scripts/lab/reports/flashTrace.mts measures the latency
// in video frames from the marker's change to the first changed field cell, with no clock alignment.
//
//   · Its place, in dp from the window's top left (the stage is the app window, UI-216): flush left, below the status bar
//     (S22+: about 32 dp with the cutout), clear of the plate, so it sits over the field's ground only.
//   · Its two colours are Abyss dark's ground and hairline: the luminance step between them is about 0.02, far under
//     WCAG 2.3.1's 0.1, so the marker itself never makes a flash by the definition flashTrace counts, and at about 20
//     code values it stands well above a recording's noise.
//   · No tap coordinate and no emotion value: the colour says only the parity of the count of changes.
//
// flashTrace reads where the marker is from READY's marker probe, never from this rect (the stage is ltr, but READY is
// what the device did). No dependency but the generated tokens, imported with their extension, so the planted frames
// (makeFlashFrames.mts) import this file in plain node.

import { DIRECTIONS } from '../../v2/tokens/tokens.generated.ts';

/** The marker's square, dp from the window's top left. */
export const STORM_MARKER_DP = { left: 0, top: 72, size: 16 } as const;

export const STORM_MARKER_COLOURS = [DIRECTIONS.abyss.color.dark.ground.hex, DIRECTIONS.abyss.color.dark.line.hairline.hex] as const;

/** The marker's colour after `count` changes: it flips on every change. */
export const stormMarkerColour = (count: number): string => STORM_MARKER_COLOURS[count % 2];
