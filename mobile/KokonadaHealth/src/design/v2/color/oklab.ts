// OKLab and OKLCh conversions for the v2 design system.
//
// The maths is CSS Color 4's (§9 and its sample code): sRGB with the extended transfer function,
// the rational sRGB <-> XYZ D65 matrices, and the XYZ <-> LMS matrices "recalculated for 64bit
// precision". Using the browser's own definition means a token, a board and the device all agree
// on what a given oklch() value is.
//
// Colours outside sRGB are not clamped here: a mix or a token can leave the gamut, and gamut.ts
// has to be able to see that rather than receive a value that was quietly pulled back inside.

/** Gamma-encoded sRGB, 0..1 inside the gamut. */
export type Srgb = readonly [r: number, g: number, b: number];
/** Linear-light sRGB. */
export type LinearSrgb = readonly [r: number, g: number, b: number];
/** CIE XYZ relative to D65, with white at Y = 1. */
export type Xyz = readonly [x: number, y: number, z: number];

export interface Oklab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/** h is in degrees, in [0, 360). It is NaN when the colour is achromatic (CSS: "powerless"). */
export interface Oklch {
  readonly L: number;
  readonly C: number;
  readonly h: number;
}

type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const LINEAR_SRGB_TO_XYZ: Matrix = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];

const XYZ_TO_LINEAR_SRGB: Matrix = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];

const XYZ_TO_LMS: Matrix = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];

const LMS_TO_OKLAB: Matrix = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.4285922420485799, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];

const LMS_TO_XYZ: Matrix = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];

const OKLAB_TO_LMS: Matrix = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];

/** CSS Color 4 §9.3: below this chroma the hue is powerless. */
const ACHROMATIC_CHROMA = 0.000004;

const DEG = 180 / Math.PI;

function multiply(m: Matrix, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** One sRGB channel to linear light. Negative values mirror, as CSS Color 4 extends it. */
export function srgbToLinear(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= 0.04045) {
    return value / 12.92;
  }
  return Math.sign(value) * Math.pow((magnitude + 0.055) / 1.055, 2.4);
}

/** One linear-light channel to gamma-encoded sRGB. Negative values mirror. */
export function linearToSrgb(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude > 0.0031308) {
    return Math.sign(value) * (1.055 * Math.pow(magnitude, 1 / 2.4) - 0.055);
  }
  return 12.92 * value;
}

export function linearSrgbToXyz(rgb: LinearSrgb): Xyz {
  return multiply(LINEAR_SRGB_TO_XYZ, rgb);
}

export function xyzToLinearSrgb(xyz: Xyz): LinearSrgb {
  return multiply(XYZ_TO_LINEAR_SRGB, xyz);
}

export function xyzToOklab(xyz: Xyz): Oklab {
  // Math.cbrt keeps the sign; a general power function would return NaN for negative LMS.
  const lms = multiply(XYZ_TO_LMS, xyz);
  const [L, a, b] = multiply(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
  return { L, a, b };
}

export function oklabToXyz(lab: Oklab): Xyz {
  const lms = multiply(OKLAB_TO_LMS, [lab.L, lab.a, lab.b]);
  return multiply(LMS_TO_XYZ, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]);
}

export function srgbToOklab(rgb: Srgb): Oklab {
  return xyzToOklab(linearSrgbToXyz([srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]));
}

/** Gamma-encoded sRGB, NOT clamped: values outside 0..1 mean the colour is outside the gamut. */
export function oklabToSrgb(lab: Oklab): Srgb {
  const linear = xyzToLinearSrgb(oklabToXyz(lab));
  return [linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])];
}

export function oklabToOklch(lab: Oklab): Oklch {
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  if (C <= ACHROMATIC_CHROMA) {
    return { L: lab.L, C, h: NaN };
  }
  const h = Math.atan2(lab.b, lab.a) * DEG;
  return { L: lab.L, C, h: h < 0 ? h + 360 : h };
}

export function oklchToOklab(lch: Oklch): Oklab {
  // A powerless hue converts as 0, the way CSS Color 4 treats a missing component.
  const h = Number.isNaN(lch.h) ? 0 : lch.h / DEG;
  return { L: lch.L, a: lch.C * Math.cos(h), b: lch.C * Math.sin(h) };
}

/**
 * The straight OKLab line from `from` (t = 0) to `to` (t = 1). Written as (1 - t)·from + t·to so
 * both ends come out exactly: a sampler that starts and stops on an anchor must test the anchor.
 */
export function mixOklab(from: Oklab, to: Oklab, t: number): Oklab {
  if (!(t >= 0 && t <= 1)) {
    throw new RangeError(`mix parameter must be in [0, 1], got ${t}`);
  }
  const s = 1 - t;
  return { L: from.L * s + to.L * t, a: from.a * s + to.a * t, b: from.b * s + to.b * t };
}
