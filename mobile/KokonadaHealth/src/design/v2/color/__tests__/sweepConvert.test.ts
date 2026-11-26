import { oklabToSrgb, srgbToOklab, type Oklab, type Srgb } from '../oklab.ts';
import { sweepOklabToSrgb, sweepSrgbToOklab } from '../sweepConvert.ts';

// oklab.ts is worklet-safe (Math.* inline), which costs about ten times more per call under
// jest's sandbox. The never-red sweeps make millions of conversions, so they use sweepConvert,
// the same arithmetic in the same order with Math bound once. These tests hold the two to the
// same bits, so the fast path can never drift from the colour core.

function srgbGrid(): Srgb[] {
  const steps = [-0.05, 0, 0.0005, 0.003, 0.04045, 0.1, 0.25, 0.5, 0.75, 0.9, 1, 1.05];
  const out: Srgb[] = [];
  for (const r of steps) for (const g of steps) for (const b of steps) out.push([r, g, b]);
  return out;
}

function oklabGrid(): Oklab[] {
  const out: Oklab[] = [];
  for (let L = -0.02; L <= 1.04; L += 0.06) {
    for (let a = -0.4; a <= 0.4; a += 0.05) {
      for (let b = -0.4; b <= 0.4; b += 0.05) out.push({ L, a, b });
    }
  }
  return out;
}

describe('sweepConvert matches the colour core bit for bit', () => {
  it('sRGB to OKLab, over 1 728 colours in and out of the gamut', () => {
    for (const rgb of srgbGrid()) expect(sweepSrgbToOklab(rgb)).toEqual(srgbToOklab(rgb));
  });

  it('OKLab to sRGB, over 5 000 colours in and out of the gamut', () => {
    for (const lab of oklabGrid()) expect(sweepOklabToSrgb(lab)).toEqual(oklabToSrgb(lab));
  });
});
