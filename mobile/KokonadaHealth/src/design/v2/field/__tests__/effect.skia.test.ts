import { AlphaType, ColorType, Skia, type ImageInfo, type SkData, type SkImage, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { BLUE_NOISE_SIZE, blueNoiseRgba } from '../blueNoise.ts';
import { createFieldEffect, fieldEffect, type FieldSkia } from '../effect.ts';
import { FIELD_SKSL } from '../fieldShader.ts';
import { FIELD_UNIFORM_FLOATS } from '../uniforms.ts';

// effect.ts in real Skia (CanvasKit): the field's runtime effect is compiled once per process and its
// blue-noise child made once, raw and untagged (MakeImage), sampled nearest with no mipmaps. Anything
// that keeps the effect from being drawn (a null compile, a throw, a layout that is not the
// builder's) gives the fallback (F-11 A), recorded and never reported anywhere (REG-066).
//
// The factory is real Skia behind a counter: every call reaches CanvasKit, and the test sees how many
// times it was asked.

interface Counted {
  readonly skia: FieldSkia;
  readonly made: string[];
  readonly images: ImageInfo[];
}

function counting(make: (source: string) => SkRuntimeEffect | null = (s) => Skia.RuntimeEffect.Make(s)): Counted {
  const made: string[] = [];
  const images: ImageInfo[] = [];
  return {
    made,
    images,
    skia: {
      RuntimeEffect: {
        Make: (source: string) => {
          made.push(source);
          return make(source);
        },
      },
      Image: {
        MakeImage: (info: ImageInfo, data: SkData, bytesPerRow: number): SkImage | null => {
          images.push(info);
          return Skia.Image.MakeImage(info, data, bytesPerRow);
        },
      },
      Data: { fromBytes: (bytes: Uint8Array) => Skia.Data.fromBytes(bytes) },
    },
  };
}

const readShader = (shader: SkShader, size: number, draw: (canvas: ReturnType<NonNullable<ReturnType<typeof Skia.Surface.Make>>['getCanvas']>) => void = () => {}) => {
  const surface = Skia.Surface.Make(size, size);
  if (!surface) throw new Error('no surface');
  const paint = Skia.Paint();
  paint.setDither(false);
  paint.setShader(shader);
  const canvas = surface.getCanvas();
  draw(canvas);
  canvas.drawPaint(paint);
  surface.flush();
  return surface.makeImageSnapshot().readPixels(0, 0, { width: size, height: size, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
};

const TILE = blueNoiseRgba();
const texel = (x: number, y: number) => Array.from(TILE.slice(4 * (y * BLUE_NOISE_SIZE + x), 4 * (y * BLUE_NOISE_SIZE + x) + 4));
const pixel = (pixels: Uint8Array, size: number, x: number, y: number) => Array.from(pixels.slice(4 * (y * size + x), 4 * (y * size + x) + 4));

describe('the field effect is compiled once', () => {
  it('Make is called exactly once, with the field shader, however often the effect is asked for', () => {
    const { skia, made } = counting();
    const get = createFieldEffect(skia);
    const first = get();
    for (let i = 0; i < 5; i++) expect(get()).toBe(first);
    expect(made).toEqual([FIELD_SKSL]);
    expect(first.status).toBe('ready');
  });

  it('is ready with the builder’s uniform layout', () => {
    const effect = createFieldEffect(counting().skia)();
    if (effect.status !== 'ready') throw new Error(`expected ready, got ${effect.reason}`);
    expect(effect.effect.getUniformFloatCount()).toBe(FIELD_UNIFORM_FLOATS);
  });

  it('the app’s own effect is one memoised instance', () => {
    expect(fieldEffect()).toBe(fieldEffect());
    expect(fieldEffect().status).toBe('ready');
  });
});

describe('anything that keeps the effect from drawing gives the fallback, once', () => {
  it('a source that does not compile', () => {
    const { skia, made } = counting();
    const get = createFieldEffect(skia, 'half4 main(float2 p) { return notAThing; }');
    expect(get()).toEqual({ status: 'fallback', reason: 'the field shader did not compile' });
    get();
    expect(made).toHaveLength(1);
  });

  it('a Make that throws', () => {
    const { skia, made } = counting(() => {
      throw new Error('driver refused the program');
    });
    const get = createFieldEffect(skia);
    expect(get()).toEqual({ status: 'fallback', reason: 'the field shader did not compile: driver refused the program' });
    get();
    expect(made).toHaveLength(1);
  });

  it('an effect whose uniforms are not the builder’s', () => {
    const { skia } = counting((source) => Skia.RuntimeEffect.Make(source.replace('uniform float uOctaves;', 'uniform float uOctaves; uniform float uStray;')));
    expect(createFieldEffect(skia)()).toEqual({
      status: 'fallback',
      reason: `the field shader declares ${FIELD_UNIFORM_FLOATS + 1} uniform floats, the builder packs ${FIELD_UNIFORM_FLOATS}`,
    });
  });

  it('a blue-noise image that cannot be made', () => {
    const { skia } = counting();
    const get = createFieldEffect({ ...skia, Image: { MakeImage: () => null } });
    expect(get()).toEqual({ status: 'fallback', reason: 'the blue-noise image was not made' });
  });
});

describe('the blue-noise child: made once, raw and untagged, nearest, no mipmaps (architect, fork 2, 2C)', () => {
  it('MakeImage is called once, with the tile’s size and raw 8-bit RGBA, and no colour space', () => {
    const { skia, images } = counting();
    const get = createFieldEffect(skia);
    get();
    get();
    expect(images).toEqual([{ width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }]);
  });

  it('its bytes are the tile’s, every texel', () => {
    const effect = createFieldEffect(counting().skia)();
    if (effect.status !== 'ready') throw new Error('not ready');
    const bytes = effect.blueNoise.readPixels(0, 0, { width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    expect(Array.from(bytes as Uint8Array)).toEqual(Array.from(TILE));
  });

  it('its shader repeats every 64 pixels, texel for texel', () => {
    const effect = createFieldEffect(counting().skia)();
    if (effect.status !== 'ready') throw new Error('not ready');
    const size = 2 * BLUE_NOISE_SIZE;
    const pixels = readShader(effect.blueNoiseShader, size);
    for (let y = 0; y < size; y += 3) {
      for (let x = 0; x < size; x += 5) expect(pixel(pixels, size, x, y)).toEqual(texel(x % BLUE_NOISE_SIZE, y % BLUE_NOISE_SIZE));
    }
  });

  it('samples nearest: magnified ×2, every pixel is one texel, never a blend of two', () => {
    const effect = createFieldEffect(counting().skia)();
    if (effect.status !== 'ready') throw new Error('not ready');
    const size = BLUE_NOISE_SIZE;
    const pixels = readShader(effect.blueNoiseShader, size, (canvas) => canvas.scale(2, 2));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) expect(pixel(pixels, size, x, y)).toEqual(texel(Math.floor(x / 2), Math.floor(y / 2)));
    }
  });

  // Each pixel centre lands on a texel centre (half a texel in), where nearest and linear agree with
  // the texel itself, so only a mipmap level (an average of four) could change it.
  it('has no mipmaps: minified ×½, every pixel is the texel at its centre, never an average', () => {
    const effect = createFieldEffect(counting().skia)();
    if (effect.status !== 'ready') throw new Error('not ready');
    const size = BLUE_NOISE_SIZE / 2;
    const pixels = readShader(effect.blueNoiseShader, size, (canvas) => {
      canvas.scale(0.5, 0.5);
      canvas.translate(0.5, 0.5);
    });
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) expect(pixel(pixels, size, x, y)).toEqual(texel(2 * x, 2 * y));
    }
  });
});
