// The unit project's headless Skia stub (jest.setup.js), with the two enums it lacks: FilterMode and MipmapMode, which
// fieldImage.tsx reads when it loads (FIELD_SAMPLING). Since T14 the lab's SCENES reach FieldView, so every unit test whose
// imports reach SCENES or LabRoot loads fieldImage.tsx, and the setup stub alone fails it at import. Each such test mocks
// Skia with this, as the v2 tests that reach FieldView mock it themselves (FieldView.test.tsx, FieldPreview.test.tsx).
// Nothing here draws: these tests render no field. The values are Skia's own. Until the setup stub carries the enums.
//
// F10 G8: the hero scene's Plate records its rim keyline and RimLabels lays its words out with a font, so the stub also
// records pictures that hold nothing, and matches a font whose metrics are plain numbers: each glyph is 0.6 em wide, the
// ascent 0.93 em above the baseline and the descent 0.24 em below, so a word has a size to lay out at. What the pictures
// draw is the components' own tests' (Plate.test.tsx, RimLabels.test.tsx, and their CanvasKit tests).

import type { ReactNode } from 'react';

const StubView = ({ children }: { children?: ReactNode }) => children ?? null;
const disposable = () => ({ dispose() {} });

/** A paint, a canvas or a recorder's method: accepts anything, records nothing. */
const inert = () => new Proxy({ dispose() {} }, { get: (target, key) => (key in target ? target[key as 'dispose'] : () => {}) });

/** A font at `size` whose glyphs are 0.6 em wide, one glyph per code point. */
function headlessFont(size: number) {
  return {
    getMetrics: () => ({ ascent: -0.93 * size, descent: 0.24 * size }),
    getGlyphIDs: (text: string) => Array.from(text, (c) => c.codePointAt(0) as number),
    getGlyphWidths: (ids: readonly number[]) => ids.map(() => 0.6 * size),
    dispose() {},
  };
}

export function skiaHeadless() {
  return {
    Canvas: StubView, Group: StubView, Circle: StubView, Blur: StubView, Path: StubView,
    RadialGradient: StubView, LinearGradient: StubView, Fill: StubView, Rect: StubView, RoundedRect: StubView,
    Image: () => null, Picture: () => null,
    vec: (x: number, y: number) => ({ x, y }),
    useClock: () => ({ value: 0 }),
    Skia: {
      Path: { Make: () => ({ moveTo() {}, lineTo() {}, addCircle() {}, close() {} }) },
      PictureRecorder: () => ({ beginRecording: inert, finishRecordingAsPicture: disposable, dispose() {} }),
      XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
      Point: (x: number, y: number) => ({ x, y }),
      Paint: inert,
      Color: (c: string) => c,
      RSXform: disposable,
      Shader: { MakeLinearGradient: disposable },
      TextBlob: { MakeFromRSXformGlyphs: disposable },
      // F6: the typeface provider reads each face (Data.fromURI), makes its typeface and registers it by family in one
      // font manager. Headless, the bytes are a stand-in, every one makes a typeface, and the manager keeps what it was
      // given; the real faces are typefaces.skia.test.ts's, in CanvasKit.
      Data: { fromURI: (uri: string) => Promise.resolve({ uri, dispose() {} }) },
      Typeface: { MakeFreeTypeFaceFromData: (data: unknown) => ({ data, dispose() {} }) },
      TypefaceFontProvider: {
        Make: () => {
          const fonts: Array<{ family: string }> = [];
          return { fonts, registerFont: (_typeface: unknown, family: string) => { fonts.push({ family }); }, dispose() {} };
        },
      },
    },
    matchFont: (style: { fontSize?: number } = {}) => headlessFont(style.fontSize ?? 14),
    PaintStyle: { Fill: 0, Stroke: 1 },
    TileMode: { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 },
    FilterMode: { Nearest: 0, Linear: 1 },
    MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
  };
}
