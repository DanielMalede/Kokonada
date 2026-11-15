import { NODE_TIER, QUADRANT } from '../../field/fieldFrame.ts';
import { BASE, DIRECTIONS, type Face } from '../../tokens/tokens.generated.ts';
import {
  MODEL_SEPARATION_LSB,
  WITNESS_MODELS,
  displayP3ToSrgb,
  doubleEncode,
  hexBytes,
  lsbDelta,
  misreadAsP3,
  skipEncode,
  srgbToDisplayP3,
  type Bytes,
  type WitnessModel,
} from '../displayP3.ts';
import type { Srgb } from '../oklab.ts';

// B8-1 (the architect's B8 plan; B4 fork 2E/D5). Display-P3 per CSS Color 4 §10.4 and its sample code (the rational
// lin_P3 <-> XYZ D65 matrices, the sRGB transfer function), and the three wrong colour paths the device witness plants:
// the token's sRGB bytes read as Display-P3, encoded twice, and not encoded at all.
//
// Reference vectors are published values, never this module's own output: the CSS Color 4 primaries
// (`color(srgb 1 0 0)` is `color(display-p3 0.9175 0.2003 0.1386)`; `color(display-p3 1 0 0)` is
// `color(srgb 1.0931 -0.2267 -0.1501)`) and the sRGB transfer's familiar points (8-bit 188 is half linear light; 128 is
// about 21.6 % linear). Grey is grey in both spaces: they share D65 and the transfer function.
const SRGB_TO_P3: ReadonlyArray<readonly [string, Srgb, Srgb]> = [
  ['red', [1, 0, 0], [0.9175, 0.2003, 0.1386]],
  ['green', [0, 1, 0], [0.4584, 0.9853, 0.2983]],
  ['blue', [0, 0, 1], [0, 0, 0.9596]],
  ['white', [1, 1, 1], [1, 1, 1]],
  ['black', [0, 0, 0], [0, 0, 0]],
  ['mid grey', [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]],
  ['dark grey', [0.2, 0.2, 0.2], [0.2, 0.2, 0.2]],
];
const P3_TO_SRGB: ReadonlyArray<readonly [string, Srgb, Srgb]> = [
  ['red', [1, 0, 0], [1.0931, -0.2267, -0.1501]],
  ['green', [0, 1, 0], [-0.5116, 1.0183, -0.3107]],
  ['mid grey', [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]],
];

const close = (actual: readonly number[], expected: readonly number[], tol: number) => {
  expect(actual).toHaveLength(3);
  actual.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(tol));
};

describe('Display-P3 (CSS Color 4)', () => {
  it.each(SRGB_TO_P3)('sRGB %s to Display-P3 is the published vector within 1e-4', (_n, srgb, p3) => {
    close(srgbToDisplayP3(srgb), p3, 1e-4);
  });

  it.each(P3_TO_SRGB)('Display-P3 %s to sRGB is the published vector within 1e-4, unclamped', (_n, p3, srgb) => {
    close(displayP3ToSrgb(p3), srgb, 1e-4);
  });

  it('round-trips both ways within 1e-9 over a grid, out-of-gamut values included', () => {
    let cases = 0;
    for (let r = -0.2; r <= 1.2; r += 0.1) for (let g = 0; g <= 1; g += 0.25) for (let b = 0; b <= 1; b += 0.2) {
      const v: Srgb = [r, g, b];
      close(displayP3ToSrgb(srgbToDisplayP3(v)), v, 1e-9);
      close(srgbToDisplayP3(displayP3ToSrgb(v)), v, 1e-9);
      cases += 1;
    }
    expect(cases).toBeGreaterThan(300);
  });
});

describe('the wrong-path models, on 8-bit bytes', () => {
  it('hexBytes reads #RRGGBB, and refuses anything else', () => {
    // The tokens' hexes (colour literals stay out of tests too): joy's core is E3 B6 67, the dark ground 03 0C 15.
    const joy = BASE.emotion.joy.core.hex;
    expect(hexBytes(joy)).toEqual([227, 182, 103]);
    expect(hexBytes(DIRECTIONS.abyss.color.dark.ground.hex.toLowerCase())).toEqual([3, 12, 21]);
    for (const bad of [joy.slice(1), joy.slice(0, 6), `${joy}7`, '#GGGGGG', `${joy}FF`]) expect(() => hexBytes(bad)).toThrow(RangeError);
  });

  it('misreadAsP3 is the sRGB bytes a surface shows when it takes sRGB bytes for Display-P3: clamped, rounded', () => {
    expect(misreadAsP3([255, 0, 0])).toEqual([255, 0, 0]); // 1.0931, -0.2267, -0.1501 clamps back to red
    expect(misreadAsP3([0, 255, 0])).toEqual([0, 255, 0]);
    expect(misreadAsP3([128, 128, 128])).toEqual([128, 128, 128]); // grey is identity
    expect(misreadAsP3([255, 255, 255])).toEqual([255, 255, 255]);
    // A mid red, by hand from the published lin_P3 -> lin_sRGB matrix (first column 1.2249, -0.0420, -0.0197): 128 is
    // linear 0.2159, so sRGB linear (0.2644, -0.0091, -0.0043), encoded 0.5511 -> 141, then 0 and 0 once clamped.
    expect(misreadAsP3([128, 0, 0])).toEqual([141, 0, 0]);
  });

  it('doubleEncode encodes encoded bytes again; skipEncode writes linear light as bytes', () => {
    expect(doubleEncode([128, 0, 255])).toEqual([188, 0, 255]);
    expect(skipEncode([188, 0, 255])).toEqual([128, 0, 255]);
    expect(skipEncode([128, 128, 128])).toEqual([55, 55, 55]);
    // 3/255 = 0.0118 is above the encode's 0.0031308 knee (1.055 × 0.0118^(1/2.4) − 0.055 = 0.1107 -> 28) and below the
    // decode's 0.04045 one (0.0118 / 12.92 -> 0).
    expect(doubleEncode([3, 3, 3])).toEqual([28, 28, 28]);
    expect(skipEncode([3, 3, 3])).toEqual([0, 0, 0]);
  });

  it('every model returns integer bytes in [0, 255] and the three are named', () => {
    expect(Object.keys(WITNESS_MODELS).sort()).toEqual(['doubleEncode', 'misreadAsP3', 'skipEncode']);
    for (const model of Object.values(WITNESS_MODELS)) for (let v = 0; v <= 255; v += 17) for (const b of [model([v, 255 - v, v])]) {
      for (const c of b) expect(Number.isInteger(c) && c >= 0 && c <= 255).toBe(true);
    }
  });

  it('lsbDelta is the largest channel difference', () => {
    expect(lsbDelta([10, 20, 30], [12, 17, 30])).toBe(3);
    expect(lsbDelta([0, 0, 0], [0, 0, 0])).toBe(0);
  });
});

// D5. A witness colour only proves the colour path if each wrong path would move it by more than the witness tolerance
// (MODEL_SEPARATION_LSB). Abyss's witness colours are, per face, the four anchors at the face's tier (NODE_TIER) and the
// face's ground. A colour a model cannot move is listed here as identity-only for that model, with the colour on its face
// that separates instead; any other colour that fails, or a listed one that no longer fails, fails this test.
type WitnessColour = { readonly face: Face; readonly name: string; readonly hex: string };
const WITNESS_COLOURS: readonly WitnessColour[] = (['dark', 'light'] as const).flatMap((face) => [
  ...Object.values(QUADRANT).map((emotion) => ({ face, name: emotion, hex: BASE.emotion[emotion][NODE_TIER[face]].hex })),
  { face, name: 'ground', hex: DIRECTIONS.abyss.color[face].ground.hex },
]);
// Near-neutral grounds: Display-P3 and sRGB share D65 and the transfer, so a misread barely moves a near-grey.
const IDENTITY_ONLY: Readonly<Record<string, { readonly model: WitnessModel; readonly separator: string }>> = {
  'dark.ground': { model: 'misreadAsP3', separator: 'calm' },
  'light.ground': { model: 'misreadAsP3', separator: 'reflective' },
};

describe('D5: the Abyss witness colours tell the paths apart', () => {
  it('has its cases: four anchors and the ground on each face, joy and intense among them', () => {
    expect(WITNESS_COLOURS).toHaveLength(10);
    for (const face of ['dark', 'light'] as const) {
      const names = WITNESS_COLOURS.filter((c) => c.face === face).map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(['joy', 'intense', 'calm', 'reflective', 'ground']));
    }
    expect(MODEL_SEPARATION_LSB).toBe(2);
  });

  it('every colour moves by more than 2 LSB under every model, except the listed identity-only pairs', () => {
    const failing: string[] = [];
    for (const c of WITNESS_COLOURS) for (const [model, f] of Object.entries(WITNESS_MODELS) as Array<[WitnessModel, (b: Bytes) => Bytes]>) {
      const bytes = hexBytes(c.hex);
      if (lsbDelta(f(bytes), bytes) <= MODEL_SEPARATION_LSB) failing.push(`${c.face}.${c.name}:${model}`);
    }
    expect(failing.sort()).toEqual(Object.entries(IDENTITY_ONLY).map(([k, v]) => `${k}:${v.model}`).sort());
  });

  it('the mandatory anchors, joy and intense, are never identity-only', () => {
    for (const key of Object.keys(IDENTITY_ONLY)) expect(key).not.toMatch(/\.(joy|intense)$/);
  });

  it.each(Object.entries(IDENTITY_ONLY))('%s names a separating colour on its face that the model does move', (key, { model, separator }) => {
    const face = key.split('.')[0];
    const sep = WITNESS_COLOURS.find((c) => c.face === face && c.name === separator)!;
    expect(sep).toBeDefined();
    expect(lsbDelta(WITNESS_MODELS[model](hexBytes(sep.hex)), hexBytes(sep.hex))).toBeGreaterThan(MODEL_SEPARATION_LSB);
  });
});
