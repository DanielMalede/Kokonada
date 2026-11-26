// A stateful fake of the part of Skia the rim words draw with (RimLabels.test.tsx holds the same fake inline). Its font
// measures as Heebo does by the designer's budget basis (LEDGER rev §11: 0.50 em a Latin letter, 0.56 em a Hebrew one),
// with a fixed ascent and descent; its recorder keeps every text blob drawn and every dispose. Group renders its children
// and keeps its props (a returning layer's opacity, a value the UI thread sets). Canvas counts its renders by testID: each
// one is a JS commit of that canvas, which on the device makes Skia draw a recording made on JS (the replay hazard).
//
// Use it from a jest.mock factory: jest.mock('@shopify/react-native-skia', () => require('<path>/skiaWords').skiaWordsMock()).

export interface SkiaWordsFake {
  fonts: Array<{ style: Record<string, unknown>; mgr: unknown; disposed: number }>;
  recordings: Array<{ blobs: Array<{ ids: number[]; xforms: number[][]; colour: unknown; antiAlias: unknown }>; bounds: { width: number; height: number }; disposed: number }>;
  /** How many times each canvas rendered, by its testID. */
  canvasRenders: Record<string, number>;
}

export function skiaWordsMock() {
  const fake: SkiaWordsFake = { fonts: [], recordings: [], canvasRenders: {} };
  const Canvas = ({ children, testID }: { children?: unknown; testID?: string }) => {
    const id = String(testID);
    fake.canvasRenders[id] = (fake.canvasRenders[id] ?? 0) + 1;
    return children ?? null;
  };
  const Group = ({ children }: { children?: unknown }) => children ?? null;
  const matchFont = (style: Record<string, unknown>, mgr?: unknown) => {
    const size = style.fontSize as number;
    const record = { style, mgr, disposed: 0 };
    fake.fonts.push(record);
    return {
      getSize: () => size,
      getMetrics: () => ({ ascent: -0.93 * size, descent: 0.24 * size, leading: 0 }),
      getGlyphIDs: (s: string) => Array.from(s).map((c) => c.codePointAt(0)!),
      getGlyphWidths: (ids: number[]) => ids.map((id) => (id >= 0x0590 && id <= 0x05ff ? 0.56 : 0.5) * size),
      dispose: () => { record.disposed += 1; },
    };
  };
  const Skia = {
    Paint: () => {
      const state: Record<string, unknown> = {};
      return { state, setAntiAlias: (v: unknown) => { state.antiAlias = v; }, setColor: (v: unknown) => { state.colour = v; }, dispose() {} };
    },
    Color: (hex: string) => `colour:${hex}`,
    XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
    RSXform: (scos: number, ssin: number, tx: number, ty: number) => ({ xform: [scos, ssin, tx, ty], dispose() {} }),
    TextBlob: { MakeFromRSXformGlyphs: (ids: number[], xforms: Array<{ xform: number[] }>) => ({ ids, xforms: xforms.map((x) => x.xform), dispose() {} }) },
    PictureRecorder: () => {
      let current: SkiaWordsFake['recordings'][number] | null = null;
      return {
        beginRecording: (bounds: { width: number; height: number }) => {
          const recording = { blobs: [] as SkiaWordsFake['recordings'][number]['blobs'], bounds, disposed: 0 };
          current = recording;
          return {
            drawTextBlob: (blob: { ids: number[]; xforms: number[][] }, _x: number, _y: number, paint: { state: Record<string, unknown> }) =>
              recording.blobs.push({ ids: blob.ids, xforms: blob.xforms, colour: paint.state.colour, antiAlias: paint.state.antiAlias }),
          };
        },
        finishRecordingAsPicture: () => {
          const recording = current!;
          fake.recordings.push(recording);
          return { recording, dispose: () => { recording.disposed += 1; } };
        },
        dispose() {},
      };
    },
  };
  return { Canvas, Group, Picture: () => null, Skia, matchFont, __fake: fake };
}
