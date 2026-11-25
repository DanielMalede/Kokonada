// One rim word's picture (DEC-036; DSN-027, DSN-028): the glyphs a bead leaves, each at its RSXform from the arc law
// (arc.ts), in one anti-aliased run of the word's ink. The picture is recorded in the word's own box (its RSXforms moved
// by the box's corner), the box its canvas fills. The Skia it draws with is passed in, as the rim's is (rim.ts). Each
// RSXform, the run and the paint are freed once drawn: the canvas keeps its own reference to the run (RA-31).

import type { SkFont, SkPicture, Skia as SkiaApi } from '@shopify/react-native-skia';
import type { RimWordLayout } from './arc.ts';

/** The part of Skia a rim word draws with. */
export interface RimWordSkia {
  readonly Skia: typeof SkiaApi;
}

/** The word's picture: `glyphIds` in visual order (arc.ts's PlacedGlyph.index indexes them), drawn in `inkHex`. */
export function recordRimWord(s: RimWordSkia, layout: RimWordLayout, glyphIds: readonly number[], font: SkFont, inkHex: string): SkPicture {
  const { bounds } = layout;
  const recorder = s.Skia.PictureRecorder();
  const canvas = recorder.beginRecording(s.Skia.XYWHRect(0, 0, bounds.width, bounds.height));
  const kept = layout.glyphs.filter((g) => !g.knockedOut);
  if (kept.length > 0) {
    const xforms = kept.map((g) => s.Skia.RSXform(g.scos, g.ssin, g.tx - bounds.x, g.ty - bounds.y));
    const blob = s.Skia.TextBlob.MakeFromRSXformGlyphs(kept.map((g) => glyphIds[g.index]), xforms, font);
    const paint = s.Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(s.Skia.Color(inkHex));
    canvas.drawTextBlob(blob, 0, 0, paint);
    paint.dispose();
    blob.dispose();
    for (const x of xforms) x.dispose();
  }
  const picture = recorder.finishRecordingAsPicture();
  recorder.dispose();
  return picture;
}
