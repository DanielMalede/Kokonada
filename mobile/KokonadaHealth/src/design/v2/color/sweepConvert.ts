// The colour core's two conversions, for the never-red sweeps only.
//
// oklab.ts keeps Math.* inline, so its functions can become worklets (a module-scope binding of a
// Math function is a host function the UI thread cannot call). Under jest's sandbox every such
// global lookup costs about ten times a local one, and the sweeps make millions of conversions.
// So this module does the same arithmetic, in the same order, with the same matrices, and binds
// Math once. It holds no worklet and must never be imported by UI-thread code.
// sweepConvert.test.ts holds its results to the same bits as oklab.ts.

import {
  LINEAR_SRGB_TO_XYZ,
  LMS_TO_OKLAB,
  LMS_TO_XYZ,
  OKLAB_TO_LMS,
  XYZ_TO_LINEAR_SRGB,
  XYZ_TO_LMS,
  multiply,
  type Oklab,
  type Srgb,
} from './oklab.ts';

const { abs, cbrt, pow, sign } = Math;

function toLinear(value: number): number {
  const magnitude = abs(value);
  if (magnitude <= 0.04045) {
    return value / 12.92;
  }
  return sign(value) * pow((magnitude + 0.055) / 1.055, 2.4);
}

function toGamma(value: number): number {
  const magnitude = abs(value);
  if (magnitude > 0.0031308) {
    return sign(value) * (1.055 * pow(magnitude, 1 / 2.4) - 0.055);
  }
  return 12.92 * value;
}

export function sweepSrgbToOklab(rgb: Srgb): Oklab {
  const xyz = multiply(LINEAR_SRGB_TO_XYZ, [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])]);
  const lms = multiply(XYZ_TO_LMS, xyz);
  const lab = multiply(LMS_TO_OKLAB, [cbrt(lms[0]), cbrt(lms[1]), cbrt(lms[2])]);
  return { L: lab[0], a: lab[1], b: lab[2] };
}

export function sweepOklabToSrgb(lab: Oklab): Srgb {
  const lms = multiply(OKLAB_TO_LMS, [lab.L, lab.a, lab.b]);
  const xyz = multiply(LMS_TO_XYZ, [pow(lms[0], 3), pow(lms[1], 3), pow(lms[2], 3)]);
  const linear = multiply(XYZ_TO_LINEAR_SRGB, xyz);
  return [toGamma(linear[0]), toGamma(linear[1]), toGamma(linear[2])];
}
