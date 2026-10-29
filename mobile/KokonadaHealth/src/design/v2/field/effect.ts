// The field's runtime effect and its blue-noise child, made once per process (minimal F9).
//
// Compiling SkSL is slow and its result never changes, so the effect is compiled on first use and
// kept. Anything that keeps it from drawing gives the fallback (F-11 A: FieldFallback's gradients),
// and that answer is kept too, so a broken shader is not recompiled on every frame. The status is
// for the lab's manifest (shaderStatus); it is never reported anywhere (REG-066).
//
// The blue-noise tile (R the dither, G the grain) is made with MakeImage from its raw bytes, which on
// the device carries no colour space, so the shader reads the levels it was given. Its shader repeats
// and samples nearest with no mipmaps: the field reads one texel per pixel, never a blend of two
// (architect, B4 fork 2, 2C).

import {
  AlphaType,
  ColorType,
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type ImageInfo,
  type SkData,
  type SkImage,
  type SkRuntimeEffect,
  type SkShader,
} from '@shopify/react-native-skia';
import { BLUE_NOISE_SIZE, blueNoiseRgba } from './blueNoise.ts';
import { FIELD_SKSL } from './fieldShader.ts';
import { FIELD_UNIFORM_FLOATS } from './uniforms.ts';

/** The part of Skia the effect needs: the real Skia, or a test's counting wrapper around it. */
export interface FieldSkia {
  readonly RuntimeEffect: { Make(source: string): SkRuntimeEffect | null };
  readonly Image: { MakeImage(info: ImageInfo, data: SkData, bytesPerRow: number): SkImage | null };
  readonly Data: { fromBytes(bytes: Uint8Array): SkData };
}

export type FieldEffect =
  | {
      readonly status: 'ready';
      readonly effect: SkRuntimeEffect;
      /** The tile itself, and its shader: repeat, nearest, no mipmaps. */
      readonly blueNoise: SkImage;
      readonly blueNoiseShader: SkShader;
    }
  | { readonly status: 'fallback'; readonly reason: string };

function make(skia: FieldSkia, source: string): FieldEffect {
  let effect: SkRuntimeEffect | null;
  try {
    effect = skia.RuntimeEffect.Make(source);
  } catch (error) {
    return { status: 'fallback', reason: `the field shader did not compile: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!effect) return { status: 'fallback', reason: 'the field shader did not compile' };
  const floats = effect.getUniformFloatCount();
  if (floats !== FIELD_UNIFORM_FLOATS) {
    return { status: 'fallback', reason: `the field shader declares ${floats} uniform floats, the builder packs ${FIELD_UNIFORM_FLOATS}` };
  }
  let blueNoise: SkImage | null;
  try {
    blueNoise = skia.Image.MakeImage(
      { width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
      skia.Data.fromBytes(blueNoiseRgba()),
      BLUE_NOISE_SIZE * 4,
    );
  } catch {
    blueNoise = null;
  }
  if (!blueNoise) return { status: 'fallback', reason: 'the blue-noise image was not made' };
  const blueNoiseShader = blueNoise.makeShaderOptions(TileMode.Repeat, TileMode.Repeat, FilterMode.Nearest, MipmapMode.None);
  return { status: 'ready', effect, blueNoise, blueNoiseShader };
}

/** The effect for `source`, made on the first call and the same answer on every call after. */
export function createFieldEffect(skia: FieldSkia, source: string = FIELD_SKSL): () => FieldEffect {
  let made: FieldEffect | null = null;
  return () => {
    if (made === null) made = make(skia, source);
    return made;
  };
}

/** The app's one field effect, made from the real Skia on first use. */
export const fieldEffect = createFieldEffect(Skia);
