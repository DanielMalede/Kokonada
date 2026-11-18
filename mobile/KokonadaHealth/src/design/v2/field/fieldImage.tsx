// FieldSurface's drawing (T12; architect rerule §4 item 12; the component is FieldSurface.tsx): a frame's
// uniforms to pixels, with no Reanimated, so real Skia runs it in the skia project. FieldView (state → frame)
// gives FieldSurface the packed frame each frame; the lab's witness and grain scenes can give it known frames, so
// FieldView needs no lab-only knob.
//
// The frame is drawn once at render resolution (renderScale, field.tiers), over an offscreen target the
// size of the view in render px, then drawn onto the view upscaled with bilinear filtering and no mipmaps
// (UI-152: the ring's edges are anti-aliased over one render pixel, and a nearest upscale would put the
// steps back). The image keeps its own scale, render px / (pxPerDp × renderScale), never stretched, so the
// render px the builder was given land where it meant them.
//
// The colour path stays unmanaged sRGB (architect B4 forks, fork 2): the canvas asks for "srgb" and is not
// opaque, and the paint never dithers (the field dithers itself, in the shader).

import React from 'react';
import { FilterMode, Image, MipmapMode, type SkImage, type SkPaint, type SkRuntimeEffect, type SkShader, type SkSurface } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';

/** The upscale's sampling, pinned (fieldSurface.skia.test.tsx). */
export const FIELD_SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.None } as const;

/** The part of Skia the render needs: the real Skia, or a test's. */
export interface SurfaceSkia {
  readonly Surface: { MakeOffscreen(width: number, height: number): SkSurface | null };
  Paint(): SkPaint;
}

/** The frame drawn over a width × height render target, or null when no target can be made. */
export function renderFieldImage(skia: SurfaceSkia, effect: SkRuntimeEffect, blueNoise: SkShader, uniforms: readonly number[], width: number, height: number): SkImage | null {
  'worklet';
  const surface = skia.Surface.MakeOffscreen(width, height);
  if (surface === null) return null;
  const paint = skia.Paint();
  paint.setDither(false);
  paint.setShader(effect.makeShaderWithChildren([...uniforms], [blueNoise]));
  surface.getCanvas().drawPaint(paint);
  surface.flush();
  return surface.makeImageSnapshot();
}

/** Where the render image sits on the view, in dp: at its own scale from the top left. */
export function imageRect(size: { readonly width: number; readonly height: number }, pxPerDp: number, renderScale: number): { x: number; y: number; width: number; height: number } {
  'worklet';
  const k = pxPerDp * renderScale;
  return { x: 0, y: 0, width: size.width / k, height: size.height / k };
}

type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** The upscale itself: the one element that draws the render image onto the view. */
export function FieldImage({ image, rect }: { image: SkImage | null | SharedValue<SkImage | null>; rect: Rect }) {
  return <Image image={image} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fit="fill" sampling={FIELD_SAMPLING} />;
}
