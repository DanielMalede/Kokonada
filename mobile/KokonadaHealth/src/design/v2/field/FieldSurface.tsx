// FieldSurface (T12; architect rerule §4 item 12): frame → pixels. It takes the packed frame as a
// SharedValue, draws it at render resolution on the UI thread and upscales it onto the view through
// FieldImage (fieldImage.tsx: bilinear, no mipmaps), in a canvas that asks for sRGB and is not opaque
// (architect B4 forks, fork 2, C1). The lab's witness and grain scenes can give it known frames.
// Under the lab's FieldSurfaceDrawReport (surfaceDrawReport.ts, RA-50) it also says when its first image was rendered;
// the app mounts no listener, so there it mounts nothing more and runs no extra worklet.
//
// Only the UI thread puts the field's frames on screen (F10 G8 round 2, still/ f002 to f005: blue, purple, blue, purple
// after one placement). Every JS commit of a Skia canvas makes RN Skia stop its mapper and draw a recording made on JS
// (sksg Container.native.ts redraw()), so a commit in the middle of a ramp showed an older frame after a newer one. The
// surface is therefore committed by JS only when what it draws is new: its effect, its frame's SharedValue, or its
// size (renderSize by value). A wake, a sleep, a start or a page that re-renders FieldView with equal props commit nothing.

import React, { useContext } from 'react';
import { Canvas, Skia, type SkImage, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { runOnJS, useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { FieldImage, imageRect, renderFieldImage } from './fieldImage.tsx';
import { FieldSurfaceDrawReport, type SurfaceDrawListener } from './surfaceDrawReport.ts';

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

/** Two surfaces draw the same: the same effect, noise and frame SharedValue, and the same sizes by value. */
export function sameSurface(a: FieldSurfaceProps, b: FieldSurfaceProps): boolean {
  return (
    a.uniforms === b.uniforms &&
    a.effect === b.effect &&
    a.blueNoise === b.blueNoise &&
    Object.is(a.width, b.width) &&
    Object.is(a.height, b.height) &&
    Object.is(a.renderSize.width, b.renderSize.width) &&
    Object.is(a.renderSize.height, b.renderSize.height) &&
    Object.is(a.pxPerDp, b.pxPerDp) &&
    Object.is(a.renderScale, b.renderScale)
  );
}

export const FieldSurface = React.memo(FieldSurfaceDraw, sameSurface);

function FieldSurfaceDraw({ uniforms, effect, blueNoise, width, height, renderSize, pxPerDp, renderScale }: FieldSurfaceProps) {
  const w = renderSize.width;
  const h = renderSize.height;
  const image = useDerivedValue(() => {
    const u = uniforms.value;
    return u === null ? null : renderFieldImage(Skia, effect, blueNoise, u, w, h);
  }, [uniforms, effect, blueNoise, w, h]);
  const drawn = useContext(FieldSurfaceDrawReport);
  return (
    <>
      <Canvas style={{ width, height }} colorSpace="srgb">
        <FieldImage image={image} rect={imageRect(renderSize, pxPerDp, renderScale)} />
      </Canvas>
      {drawn !== null && <FirstImage image={image} onFirst={drawn} />}
    </>
  );
}

/** The lab's listener hears, once per mount, that the UI thread rendered an image. Renders nothing. */
function FirstImage({ image, onFirst }: { image: Readonly<SharedValue<SkImage | null>>; onFirst: SurfaceDrawListener }) {
  const told = useSharedValue(false);
  useAnimatedReaction(
    () => image.value !== null,
    (has) => {
      if (has && !told.value) {
        told.value = true;
        runOnJS(onFirst)();
      }
    },
    [image, onFirst, told],
  );
  return null;
}
