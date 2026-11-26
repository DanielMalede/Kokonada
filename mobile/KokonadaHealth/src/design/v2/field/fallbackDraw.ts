// FieldFallback's drawing (T13; the designer's Q3 of 2026-11-11): a FallbackPlan (fallbackModel.ts) onto a Skia canvas,
// in device px, in Q3's order:
//   1. color.<face>.ground over the whole canvas;
//   2. the face material: plate.face, a disc of radius ringInner·R + 1 dp;
//   3. the field: one radial gradient, clipped by the DEC (fallback field clip) without anti-aliasing (doAntiAlias
//      false), the clip whole device pixels;
//   4. the ring: plate.ring, the annulus from ringInner·R to the rim, opaque, anti-aliased on both edges, so its inner
//      fringe mixes plate.ring with the gradient only (the 1 dp under it).
// Every surface is its flat token colour: no vignette, no centre lift, no plate shadow (Q4), no halo, no grain, and no
// dither (each paint's dither off). The moat is not drawn: the ground shows there. No layer paints the ground's colour
// over the field. E6 (B6) draws the rim, the words and the beads over all this; never the ring.
//
// FieldFallback records it as a picture in dp, its layers at device px under scale(1/pxPerDp), so the picture played on RN
// Skia's canvas (scaled by the density) puts every clip edge on a whole device pixel. The Skia it draws with is passed in
// (FallbackSkia: the API and the two enums it needs), so the tests draw the very same calls on CanvasKit.

import type { ClipOp, SkCanvas, SkPaint, SkPicture, Skia as SkiaApi, TileMode } from '@shopify/react-native-skia';
import type { FallbackPlan } from './fallbackModel.ts';

/** The part of Skia the fallback draws with: the real Skia and its enums, or a test's. */
export interface FallbackSkia {
  readonly Skia: typeof SkiaApi;
  readonly ClipOp: { readonly Intersect: ClipOp };
  readonly TileMode: { readonly Clamp: TileMode };
}

/**
 * What a layer makes that the canvas copies when it draws (its paints, its shader, its clip path and builder): held here
 * and freed once the layer is drawn (RA-31), so a recording leaves nothing behind but its picture. Skia's canvas keeps
 * its own copy of each paint and path, and its own reference to a shader, on the device and in CanvasKit alike.
 */
const made: Array<{ dispose(): void }> = [];
function own<T extends { dispose(): void }>(o: T): T {
  made.push(o);
  return o;
}
function freeMade(): void {
  for (const o of made.splice(0)) o.dispose();
}

/** A flat token colour, never dithered. */
function flat(s: FallbackSkia, hex: string, antiAlias: boolean): SkPaint {
  const paint = own(s.Skia.Paint());
  paint.setColor(s.Skia.Color(hex));
  paint.setAntiAlias(antiAlias);
  paint.setDither(false);
  return paint;
}

/** 1. The ground, over the whole canvas. */
export function drawFallbackGround(s: FallbackSkia, canvas: SkCanvas, plan: FallbackPlan): void {
  canvas.drawPaint(flat(s, plan.ground, false));
  freeMade();
}

/** 2. The face material: plate.face to ringInner·R + 1 dp, under the gradient and the ring. */
export function drawFallbackFace(s: FallbackSkia, canvas: SkCanvas, plan: FallbackPlan): void {
  canvas.drawCircle(plan.face.centre[0], plan.face.centre[1], plan.face.radius, flat(s, plan.face.colour, false));
  freeMade();
}

/** 3. The field: one radial gradient through the stops, clamped, inside the clip of whole device pixels (doAntiAlias false). */
export function drawFallbackField(s: FallbackSkia, canvas: SkCanvas, plan: FallbackPlan): void {
  const field = plan.field;
  if (field === null) return;
  const builder = own(s.Skia.PathBuilder.Make());
  for (const [x, y, w, h] of field.clip) builder.addRect(s.Skia.XYWHRect(x, y, w, h));
  const clip = own(builder.detach());
  const paint = own(s.Skia.Paint());
  paint.setAntiAlias(false);
  paint.setDither(false);
  paint.setShader(
    own(
      s.Skia.Shader.MakeRadialGradient(
        s.Skia.Point(field.centre[0], field.centre[1]),
        field.radius,
        field.colours.map(([r, g, b]) => Float32Array.of(r, g, b, 1)),
        [...field.positions],
        s.TileMode.Clamp,
      ),
    ),
  );
  canvas.save();
  canvas.clipPath(clip, s.ClipOp.Intersect, false);
  canvas.drawPaint(paint);
  canvas.restore();
  freeMade();
}

/** 4. The ring: plate.ring from ringInner·R to the rim, opaque, anti-aliased on both edges. */
export function drawFallbackRing(s: FallbackSkia, canvas: SkCanvas, plan: FallbackPlan): void {
  const { centre, inner, outer, colour } = plan.ring;
  const circle = (r: number) => s.Skia.RRectXY(s.Skia.XYWHRect(centre[0] - r, centre[1] - r, 2 * r, 2 * r), r, r);
  canvas.drawDRRect(circle(outer), circle(inner), flat(s, colour, true));
  freeMade();
}

/** The four layers in Q3's order, in device px. */
export function drawFieldFallback(s: FallbackSkia, canvas: SkCanvas, plan: FallbackPlan): void {
  drawFallbackGround(s, canvas, plan);
  drawFallbackFace(s, canvas, plan);
  drawFallbackField(s, canvas, plan);
  drawFallbackRing(s, canvas, plan);
}

/** The picture FieldFallback shows: recorded in dp, its layers drawn at device px under scale(1/pxPerDp). The recorder is freed; the picture is the caller's to dispose. */
export function recordFieldFallback(s: FallbackSkia, plan: FallbackPlan, widthDp: number, heightDp: number): SkPicture {
  const recorder = s.Skia.PictureRecorder();
  const canvas = recorder.beginRecording(s.Skia.XYWHRect(0, 0, widthDp, heightDp));
  canvas.scale(1 / plan.pxPerDp, 1 / plan.pxPerDp);
  drawFieldFallback(s, canvas, plan);
  const picture = recorder.finishRecordingAsPicture();
  recorder.dispose();
  return picture;
}
