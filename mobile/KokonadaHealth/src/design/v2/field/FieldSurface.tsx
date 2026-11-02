// FieldSurface (T12; architect rerule §4 item 12): frame → pixels. It takes the packed frame as a
// SharedValue, draws it at render resolution on the UI thread and upscales it onto the view through
// FieldImage (fieldImage.tsx: bilinear, no mipmaps), in a canvas that asks for sRGB and is not opaque
// (architect B4 forks, fork 2, C1). The lab's witness and grain scenes can give it known frames.

import React from 'react';
import { Canvas, Skia, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { FieldImage, imageRect, renderFieldImage } from './fieldImage.tsx';

export interface FieldSurfaceProps {
  /** The packed frame, or null for nothing drawn yet. */
  readonly uniforms: SharedValue<readonly number[] | null>;
  readonly effect: SkRuntimeEffect;
  readonly blueNoise: SkShader;
  /** The view in dp, and the render target in render px (fieldDriver.ts renderSize). */
  readonly width: number;
  readonly height: number;
  readonly renderSize: { readonly width: number; readonly height: number };
  readonly pxPerDp: number;
  readonly renderScale: number;
}

export function FieldSurface({ uniforms, effect, blueNoise, width, height, renderSize, pxPerDp, renderScale }: FieldSurfaceProps) {
  const w = renderSize.width;
  const h = renderSize.height;
  const image = useDerivedValue(() => {
    const u = uniforms.value;
    return u === null ? null : renderFieldImage(Skia, effect, blueNoise, u, w, h);
  }, [uniforms, effect, blueNoise, w, h]);
  return (
    <Canvas style={{ width, height }} colorSpace="srgb">
      <FieldImage image={image} rect={imageRect(renderSize, pxPerDp, renderScale)} />
    </Canvas>
  );
}
