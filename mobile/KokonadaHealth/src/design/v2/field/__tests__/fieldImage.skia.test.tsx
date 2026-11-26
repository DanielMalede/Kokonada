import React from 'react';
import { AlphaType, ColorType, FilterMode, Image, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId } from '../../tokens/tokens.generated.ts';
import { fieldEffect } from '../effect.ts';
import { fieldStep, renderGeometry, renderSize, type FieldLayout } from '../fieldDriver.ts';
import { FIELD_SAMPLING, FieldImage, imageRect, renderFieldImage } from '../fieldImage.tsx';
import { emptyLedger } from '../placementLedger.ts';
import { ledgerConfigFor, staticsFor } from '../statics.ts';

// T12, FieldSurface (frame → pixels; architect rerule §4 item 12): the frame is drawn once at render
// resolution, then upscaled onto the view with bilinear filtering and no mipmaps (UI-152: the ring
// edges' anti-aliasing is one render pixel wide, and nearest would turn it back into steps). Real Skia
// (CanvasKit): the real effect, the real element through Skia's own reconciler.

const ID = Object.keys(DIRECTIONS)[0] as DirectionId;
const statics = staticsFor(ID, EXTENSIONS as never);
const PX_PER_DP = 2;
const SCALE = 0.5;
const LAYOUT: FieldLayout = { width: 60, height: 60, centre: [30, 30], radius: 26, fontScale: 1 };

// Skia's jest mock stubs drawAsImage out, and its reconciler needs the native module. FieldImage's
// element is drawn by the library's own command for <Image> (sksg/Recorder/commands/Drawing.drawImage),
// the one the reconciler calls with the element's props, onto a CanvasKit raster surface.
const { drawImage } = jest.requireActual('@shopify/react-native-skia/lib/commonjs/sksg/Recorder/commands/Drawing');
async function drawAsImage(element: React.ReactElement, size: { width: number; height: number }): Promise<SkImage> {
  const surface = Skia.Surface.Make(size.width, size.height)!;
  const rendered = (element.type as (props: unknown) => React.ReactElement)(element.props);
  drawImage({ Skia, canvas: surface.getCanvas(), paint: Skia.Paint() }, rendered.props);
  surface.flush();
  return surface.makeImageSnapshot();
}

const read = (image: SkImage) =>
  image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;

function frameUniforms(face: 'dark' | 'light'): number[] {
  const g = renderGeometry(LAYOUT, PX_PER_DP, SCALE);
  const ledger = emptyLedger(ledgerConfigFor(ID, face, statics, g));
  const step = fieldStep(ledger, { seq: 0, taps: [{ x: 0.5, y: 0.4 }] }, 0, { direction: ID, face, stress: 0, confidence: 1, genesis: false, tier: 'full' }, g, statics, 3000, 0.4);
  if (step.uniforms === null) throw new Error(step.error ?? 'no uniforms');
  return step.uniforms;
}

function ready() {
  const effect = fieldEffect();
  if (effect.status !== 'ready') throw new Error(effect.reason);
  return effect;
}

describe('renderFieldImage: the frame at render resolution', () => {
  it('is the effect drawn over the render target, byte for byte, at the render size', () => {
    const effect = ready();
    const size = renderSize(LAYOUT, PX_PER_DP, SCALE);
    const uniforms = frameUniforms('dark');
    const image = renderFieldImage(Skia, effect.effect, effect.blueNoiseShader, uniforms, size.width, size.height);
    expect(image).not.toBeNull();
    expect([image!.width(), image!.height()]).toEqual([size.width, size.height]);

    const surface = Skia.Surface.Make(size.width, size.height)!;
    const paint = Skia.Paint();
    paint.setDither(false);
    paint.setShader(effect.effect.makeShaderWithChildren(uniforms, [effect.blueNoiseShader]));
    surface.getCanvas().drawPaint(paint);
    surface.flush();
    expect(Buffer.from(read(image!)).equals(Buffer.from(read(surface.makeImageSnapshot())))).toBe(true);
  });
});

describe('the upscale is bilinear with no mipmaps (UI-152)', () => {
  it('the sampling is pinned: linear, no mipmaps', () => {
    expect(FIELD_SAMPLING).toEqual({ filter: FilterMode.Linear, mipmap: MipmapMode.None });
  });

  it('FieldImage is one <Image> that carries the pinned sampling and fills its rect (Skia’s own default is not relied on)', () => {
    const rect = { x: 0, y: 0, width: 10, height: 20 };
    const rendered = FieldImage({ image: null, rect });
    expect(rendered.type).toBe(Image);
    expect(rendered.props).toEqual(expect.objectContaining({ ...rect, fit: 'fill', sampling: FIELD_SAMPLING }));
  });

  it('the image fills the view at its own scale: render px / (pxPerDp × renderScale), never stretched', () => {
    expect(imageRect({ width: 61, height: 60 }, PX_PER_DP, SCALE)).toEqual({ x: 0, y: 0, width: 61, height: 60 });
    expect(imageRect({ width: 100, height: 50 }, 3, 0.33)).toEqual({ x: 0, y: 0, width: 100 / (3 * 0.33), height: 50 / (3 * 0.33) });
  });

  it('two texels, black and white, upscaled ×4 through FieldImage: the pixels between them are blends, as bilinear draws them', async () => {
    const two = Skia.Image.MakeImage(
      { width: 2, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
      Skia.Data.fromBytes(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255])),
      8,
    )!;
    const drawn = await drawAsImage(<FieldImage image={two} rect={{ x: 0, y: 0, width: 8, height: 4 }} />, { width: 8, height: 4 });
    const px = read(drawn!);
    const row = Array.from({ length: 8 }, (_, x) => px[4 * (1 * 8 + x)]);
    // Bilinear: 0 at the black texel's centre side, 255 at the white's, and strict blends between.
    expect(row[0]).toBe(0);
    expect(row[7]).toBe(255);
    const between = row.filter((v) => v > 0 && v < 255);
    expect(between.length).toBeGreaterThanOrEqual(3);
    for (let x = 1; x < 8; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
  });

  it('the planted control: the same image drawn nearest has no blend at all', () => {
    const two = Skia.Image.MakeImage(
      { width: 2, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
      Skia.Data.fromBytes(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255])),
      8,
    )!;
    const surface = Skia.Surface.Make(8, 4)!;
    surface.getCanvas().drawImageRectOptions(two, Skia.XYWHRect(0, 0, 2, 1), Skia.XYWHRect(0, 0, 8, 4), FilterMode.Nearest, MipmapMode.None, Skia.Paint());
    surface.flush();
    const px = read(surface.makeImageSnapshot());
    const row = Array.from({ length: 8 }, (_, x) => px[4 * (1 * 8 + x)]);
    expect(row.filter((v) => v > 0 && v < 255)).toHaveLength(0);
  });

  it('the field itself, both faces: FieldImage draws exactly the bilinear upscale of the render image', async () => {
    const effect = ready();
    const size = renderSize(LAYOUT, PX_PER_DP, SCALE);
    for (const face of ['dark', 'light'] as const) {
      const image = renderFieldImage(Skia, effect.effect, effect.blueNoiseShader, frameUniforms(face), size.width, size.height)!;
      const rect = imageRect(size, PX_PER_DP, SCALE);
      const device = { width: LAYOUT.width * PX_PER_DP, height: LAYOUT.height * PX_PER_DP };
      // drawAsImage draws in device px; the view is LAYOUT dp at PX_PER_DP, so scale the dp rect by it.
      const viaElement = await drawAsImage(
        <FieldImage image={image} rect={{ x: 0, y: 0, width: rect.width * PX_PER_DP, height: rect.height * PX_PER_DP }} />,
        device,
      );
      const expected = Skia.Surface.Make(device.width, device.height)!;
      expected.getCanvas().drawImageRectOptions(image, Skia.XYWHRect(0, 0, size.width, size.height), Skia.XYWHRect(0, 0, rect.width * PX_PER_DP, rect.height * PX_PER_DP), FilterMode.Linear, MipmapMode.None, Skia.Paint());
      expected.flush();
      const nearest = Skia.Surface.Make(device.width, device.height)!;
      nearest.getCanvas().drawImageRectOptions(image, Skia.XYWHRect(0, 0, size.width, size.height), Skia.XYWHRect(0, 0, rect.width * PX_PER_DP, rect.height * PX_PER_DP), FilterMode.Nearest, MipmapMode.None, Skia.Paint());
      nearest.flush();
      const got = Buffer.from(read(viaElement!));
      expect(got.equals(Buffer.from(read(expected.makeImageSnapshot())))).toBe(true);
      expect(got.equals(Buffer.from(read(nearest.makeImageSnapshot())))).toBe(false);
    }
  });
});
