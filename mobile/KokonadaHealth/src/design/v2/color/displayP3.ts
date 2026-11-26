// Display-P3 and the three wrong colour paths the device witness plants (B8-1; B4 fork 2E, D5).
//
// The maths is CSS Color 4's (§10.4 and its sample code): Display-P3 shares sRGB's D65 white and its transfer function,
// and differs by its primaries, the rational lin_P3 <-> XYZ matrices below. Values outside the gamut are not clamped,
// as in oklab.ts.
//
// The models work on 8-bit bytes, since that is what a device grab holds. Each gives the bytes an sRGB-referred grab
// would show if the path from a token's hex to the screen went wrong in one way:
//   · misreadAsP3: the token's sRGB bytes are taken for Display-P3 (an untagged buffer on a P3 surface);
//   · doubleEncode: bytes already sRGB-encoded are encoded once more (a managed surface over the manual encode);
//   · skipEncode: linear light is written as bytes without the encode.
// The field's output contract is sRGB-encoded, unmanaged and 8-bit (ADR-0017, pending), so on the device each wrong
// path must move a witness colour by more than MODEL_SEPARATION_LSB, or the witness cannot see it.

import { LINEAR_SRGB_TO_XYZ, XYZ_TO_LINEAR_SRGB, linearToSrgb, multiply, srgbToLinear, type Matrix, type Srgb } from './oklab.ts';

/** Gamma-encoded Display-P3, 0..1 inside its gamut. */
export type DisplayP3 = readonly [r: number, g: number, b: number];
/** 8-bit sRGB bytes, as a grab holds them. */
export type Bytes = readonly [r: number, g: number, b: number];

export const LINEAR_P3_TO_XYZ: Matrix = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0 / 1, 32229 / 714400, 5220557 / 5000800],
];

export const XYZ_TO_LINEAR_P3: Matrix = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];

/** The witness tolerance in LSB: a wrong path must move a witness colour by more than this to be seen (D2, D5). */
export const MODEL_SEPARATION_LSB = 2;

const channels = (v: readonly number[], f: (x: number) => number): [number, number, number] => [f(v[0]), f(v[1]), f(v[2])];

export function srgbToDisplayP3(rgb: Srgb): DisplayP3 {
  return channels(multiply(XYZ_TO_LINEAR_P3, multiply(LINEAR_SRGB_TO_XYZ, channels(rgb, srgbToLinear))), linearToSrgb);
}

export function displayP3ToSrgb(p3: DisplayP3): Srgb {
  return channels(multiply(XYZ_TO_LINEAR_SRGB, multiply(LINEAR_P3_TO_XYZ, channels(p3, srgbToLinear))), linearToSrgb);
}

const toByte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
const unit = (b: Bytes): [number, number, number] => channels(b, (x) => x / 255);

/** A token's `#RRGGBB` as bytes; anything else is a RangeError. */
export function hexBytes(hex: string): Bytes {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new RangeError(`"${hex}" is not #RRGGBB`);
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** The sRGB bytes shown when the bytes are taken for Display-P3. */
export function misreadAsP3(bytes: Bytes): Bytes {
  return channels(displayP3ToSrgb(unit(bytes)), toByte);
}

/** The bytes after one more sRGB encode. */
export function doubleEncode(bytes: Bytes): Bytes {
  return channels(unit(bytes), (x) => toByte(linearToSrgb(x)));
}

/** The bytes when the encode is skipped: the linear light, written as bytes. */
export function skipEncode(bytes: Bytes): Bytes {
  return channels(unit(bytes), (x) => toByte(srgbToLinear(x)));
}

export const WITNESS_MODELS = { misreadAsP3, doubleEncode, skipEncode } as const;
export type WitnessModel = keyof typeof WITNESS_MODELS;

/** The largest channel difference between two byte triples. */
export function lsbDelta(a: Bytes, b: Bytes): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}
