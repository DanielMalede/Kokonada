// Presentational accent layer at the composition boundary (Fork 2A). Maps the committed
// emotionSlice taps to the ACTIVE theme's emotionAccent ink, reusing emotionAccentFor for the
// valence×arousal quadrant. This is the reactive workhorse the Generate hero paints with — the
// tap dots, the CTA label/border, tinted text — all AA-proven (emotionAccent.contrast.test.ts).
//
// It is purely presentational: it never feeds deriveAuraUniforms (the aura keeps its HR-driven
// hue/intensity/breath untouched). Pure + defensive: malformed / absent input degrades to the
// brand calm ink, exactly as emotionAccentFor degrades to 'calm'.

import type { Tap } from '../state/cold/emotionSlice';
import { emotionAccentFor } from './emotionAccent';
import type { ColorScheme } from './tokens';
import type { Hex } from './contrast';

export function accentInkFor(taps: readonly Tap[] | null | undefined, scheme: ColorScheme): Hex {
  return scheme.emotionAccent[emotionAccentFor(taps)].ink;
}
