// The fieldCost bench's calibration shaders (B8-3; the architect's B8 plan, F3 at A: "GPU time is wall time with a GPU sync
// (readPixels) around K offscreen renders, calibrated by a heavy and an empty shader"). Both are FIELD_SKSL itself with its
// main renamed fieldMain and a main of their own, so they declare the field's uniforms and its blue-noise child and draw
// through the same renderFieldImage, with the same packed frame, on the same offscreen path:
//   · empty returns a constant: what is left is the bench's own floor (the surface, the flush, the snapshot and the sync);
//   · heavy runs the field's main HEAVY_REPEATS times at shifted points and averages them: the same mix of work as the
//     field, several times over (at least 3× FIELD_SKSL in CanvasKit, costHeavyShader.skia.test.ts).
// A GPU proxy that reads heavy no higher than the field, or empty as high as it, is an instrument that does not see the GPU.
// Informational only: DEC-082 is open, and no field number is held to a threshold.

import type { SkRuntimeEffect } from '@shopify/react-native-skia';
import { FIELD_SKSL } from '../../v2/field/fieldShader';
import { FIELD_UNIFORM_FLOATS } from '../../v2/field/uniforms';

export type CalibrationKind = 'heavy' | 'empty';
export const HEAVY_REPEATS = 6;
const FIELD_MAIN = 'half4 main(float2 p) {';

const MAINS: Readonly<Record<CalibrationKind, string>> = {
  heavy: [
    'half4 main(float2 p) {',
    '  half4 sum = half4(0);',
    `  for (int i = 0; i < ${HEAVY_REPEATS}; i++) {`,
    '    sum += fieldMain(p + float2(float(i) * 0.37, float(i) * 0.11));',
    '  }',
    `  return sum / ${HEAVY_REPEATS}.0;`,
    '}',
  ].join('\n'),
  empty: 'half4 main(float2 p) {\n  return half4(0, 0, 0, 1);\n}',
};

/** The calibration source made from a field source whose main appears exactly once. */
export function calibrationSksl(kind: CalibrationKind, field: string = FIELD_SKSL): string {
  const at = field.indexOf(FIELD_MAIN);
  if (at < 0 || field.indexOf(FIELD_MAIN, at + 1) >= 0) {
    throw new Error(`the ${kind} calibration needs the field source's main ("${FIELD_MAIN}") exactly once`);
  }
  return `${field.slice(0, at)}half4 fieldMain(float2 p) {${field.slice(at + FIELD_MAIN.length)}\n${MAINS[kind]}\n`;
}

export const HEAVY_SKSL = calibrationSksl('heavy');
export const EMPTY_SKSL = calibrationSksl('empty');

export type CalibrationEffect =
  | { readonly status: 'ready'; readonly effect: SkRuntimeEffect }
  | { readonly status: 'fallback'; readonly reason: string };

/** The calibration effect, compiled; a source that does not compile, or declares other uniforms than the field's, is a fallback. */
export function makeCalibrationEffect(skia: { readonly RuntimeEffect: { Make(source: string): SkRuntimeEffect | null } }, kind: CalibrationKind): CalibrationEffect {
  let effect: SkRuntimeEffect | null;
  try {
    effect = skia.RuntimeEffect.Make(kind === 'heavy' ? HEAVY_SKSL : EMPTY_SKSL);
  } catch (error) {
    return { status: 'fallback', reason: `the ${kind} calibration shader did not compile: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!effect) return { status: 'fallback', reason: `the ${kind} calibration shader did not compile` };
  const floats = effect.getUniformFloatCount();
  if (floats !== FIELD_UNIFORM_FLOATS) {
    return { status: 'fallback', reason: `the ${kind} calibration shader declares ${floats} uniform floats, the field packs ${FIELD_UNIFORM_FLOATS}` };
  }
  return { status: 'ready', effect };
}
