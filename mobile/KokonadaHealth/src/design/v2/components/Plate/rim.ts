// The rim keyline (V1 directions §1.5 and A2; the designer's D6-1 and T13 Q3): the plate's one frame. It is 1.5 dp wide,
// centred on R (the field's d = 1), drawn at device resolution above the field, and lit by a vertical gradient across
// the plate: plate.rim.lit at the top (drawn toward plate.rim.base as plate.rim.light falls), plate.rim.base at the
// bottom. The field paints the ring, the face and the moat, and anti-aliases both of the ring's edges itself (D6-1), so
// the plate draws none of them, and nothing depends on the keyline to hide a field edge.
//
// rimPlan says what, from the tokens and the plate's geometry; drawPlateRim and recordPlateRim say how, with the Skia they
// are given (RimSkia), so the tests draw the very same calls on CanvasKit (rim.skia.test.ts). The picture is recorded in
// dp, in a canvas that is the plate's box outset by `pad` on every side, and the canvas scales it to device px.

import type { PaintStyle, SkCanvas, SkPicture, Skia as SkiaApi, TileMode } from '@shopify/react-native-skia';
import { mixSafe } from '../../color/mixSafe.ts';
import { oklabToSrgb, type Oklab } from '../../color/oklab.ts';
import type { ColorValue } from '../../tokens/tokens.generated.ts';
import type { Tokens } from '../../tokens/useTokens.ts';
import type { PlateGeometry } from './geometry.ts';

/** The tokens the rim reads: useTokens()'s base, direction and the face's colours. */
export type RimTokens = Pick<Tokens, 'base' | 'direction' | 'color'>;

/** An 8-bit sRGB colour. */
export type RimBytes = readonly [r: number, g: number, b: number];

export interface RimPlan {
  /** How far the canvas reaches beyond the plate's box on every side, in dp. */
  readonly pad: number;
  /** The canvas's side, in dp: the diameter and a pad on each side. */
  readonly size: number;
  /** The keyline's circle in the canvas, in dp: the plate's centre, at R. */
  readonly centre: readonly [number, number];
  readonly radius: number;
  /** The keyline's width, in dp: plate.rim.width. */
  readonly width: number;
  /** The lit gradient, from the plate's top edge to its bottom edge, in the canvas's dp. */
  readonly gradient: {
    readonly from: readonly [number, number];
    readonly to: readonly [number, number];
    readonly top: RimBytes;
    readonly bottom: RimBytes;
  };
}

/** The part of Skia the rim draws with: the real Skia and its two enums, or a test's. */
export interface RimSkia {
  readonly Skia: typeof SkiaApi;
  readonly PaintStyle: { readonly Stroke: PaintStyle };
  readonly TileMode: { readonly Clamp: TileMode };
}

const bytesOf = (c: ColorValue): RimBytes => [parseInt(c.hex.slice(1, 3), 16), parseInt(c.hex.slice(3, 5), 16), parseInt(c.hex.slice(5, 7), 16)];
const labOf = (c: ColorValue): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const encode = (lab: Oklab): RimBytes => {
  const rgb = oklabToSrgb(lab);
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return [byte(rgb[0]), byte(rgb[1]), byte(rgb[2])];
};

/**
 * The keyline for a plate. At plate.rim.light 1 the top is plate.rim.lit and at 0 it is plate.rim.base, each byte for
 * byte; between, the never-red mix of the two (mixSafe, DSN-015). A light outside 0..1 is a broken token: a RangeError.
 * The pad is the keyline's width again on each side of it: its outer half and its anti-aliased fringe.
 */
export function rimPlan(t: RimTokens, g: PlateGeometry): RimPlan {
  const light = t.direction.plate.rim.light;
  if (!(light >= 0 && light <= 1)) {
    throw new RangeError(`plate.rim.light must be in [0, 1], got ${light}`);
  }
  const { base, lit } = t.color.plate.rim;
  const band = { hueFrom: t.base.neverRed.design.hueStart, hueTo: t.base.neverRed.design.hueEnd, chromaFloor: t.base.neverRed.design.chromaFloor };
  const top = light === 1 ? bytesOf(lit) : light === 0 ? bytesOf(base) : encode(mixSafe(labOf(base), labOf(lit), light, band));
  const width = g.rimWidth;
  const pad = 2 * width;
  const c = g.radius + pad;
  return {
    pad,
    size: g.diameter + 2 * pad,
    centre: [c, c],
    radius: g.radius,
    width,
    gradient: { from: [c, pad], to: [c, pad + g.diameter], top, bottom: bytesOf(base) },
  };
}

const unit = (b: RimBytes) => Float32Array.of(b[0] / 255, b[1] / 255, b[2] / 255, 1);

/** The keyline: one anti-aliased stroked circle, its shader the lit gradient, never dithered. */
export function drawPlateRim(s: RimSkia, canvas: SkCanvas, plan: RimPlan): void {
  const shader = s.Skia.Shader.MakeLinearGradient(
    s.Skia.Point(plan.gradient.from[0], plan.gradient.from[1]),
    s.Skia.Point(plan.gradient.to[0], plan.gradient.to[1]),
    [unit(plan.gradient.top), unit(plan.gradient.bottom)],
    null,
    s.TileMode.Clamp,
  );
  const paint = s.Skia.Paint();
  paint.setAntiAlias(true);
  paint.setDither(false);
  paint.setStyle(s.PaintStyle.Stroke);
  paint.setStrokeWidth(plan.width);
  paint.setShader(shader);
  canvas.drawCircle(plan.centre[0], plan.centre[1], plan.radius, paint);
  // The canvas keeps its own copy of the paint and its own reference to the shader (RA-31).
  paint.dispose();
  shader.dispose();
}

/** The picture the plate shows, recorded in dp. The recorder is freed; the picture is the caller's to dispose. */
export function recordPlateRim(s: RimSkia, plan: RimPlan): SkPicture {
  const recorder = s.Skia.PictureRecorder();
  const canvas = recorder.beginRecording(s.Skia.XYWHRect(0, 0, plan.size, plan.size));
  drawPlateRim(s, canvas, plan);
  const picture = recorder.finishRecordingAsPicture();
  recorder.dispose();
  return picture;
}
