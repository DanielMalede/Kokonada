// A stateful stand-in for the parts of @shopify/react-native-skia 2.6.9 that say which backend it draws with, for the
// lab's backend read (skiaBackend.ts, UI-276). It answers as the package's native code does, by build:
//   · ganesh-gl, Android without SK_GRAPHITE (the S22+'s lab): hasDevice() is false (cpp/api/JsiSkApi.h); MakeOffscreen
//     makes a GL texture through OpenGLContext, on GL_TEXTURE_2D with a fresh texture name, or null when the context
//     cannot (android/cpp/rnskia-android/OpenGLContext.h); getNativeTextureUnstable returns JsiTextureInfo::toValue's
//     object (cpp/api/JsiTextureInfo.h: mtlTexture a BigInt, glTarget, glID, glFormat, glProtected);
//   · graphite (SK_GRAPHITE): hasDevice() is true, and a surface's native texture throws (cpp/rnskia/RNSkPlatformContext.h);
//   · ganesh-metal, iOS: the texture names a Metal texture and no GL one;
//   · raster, CanvasKit in node: MakeOffscreen falls back to a CPU surface, whose native texture is null
//     (src/skia/web/JsiSkSurfaceFactory.ts, JsiSkSurface.ts).
// A surface it made is kept with whether it was disposed, and a disposed one refuses to be read, so a test sees what a
// read did on the GPU. Test-only.

export type FakeBuild = 'ganesh-gl' | 'graphite' | 'ganesh-metal' | 'raster';

const GL_TEXTURE_2D = 0x0de1;
const GL_RGBA8 = 0x8058;

export class FakeSkiaSurface {
  disposed = 0;
  reads = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly texture: () => unknown,
    private readonly disposeThrows: boolean,
  ) {}

  getNativeTextureUnstable(): unknown {
    if (this.disposed > 0) throw new Error('the surface was disposed');
    this.reads += 1;
    return this.texture();
  }

  dispose(): void {
    this.disposed += 1;
    if (this.disposeThrows) throw new Error('dispose failed');
  }
}

export type FakeSkiaOptions = {
  /** What MakeOffscreen does: make a surface, return null (a context that cannot), or throw. */
  readonly offscreen?: 'surface' | 'null' | 'throws';
  readonly disposeThrows?: boolean;
  /** The native texture's object, in place of the build's. */
  readonly texture?: () => unknown;
};

export function fakeSkia(build: FakeBuild, options: FakeSkiaOptions = {}) {
  const made: FakeSkiaSurface[] = [];
  let names = 0;
  const textureOf = (): (() => unknown) => {
    if (options.texture) return options.texture;
    if (build === 'ganesh-gl') {
      names += 1;
      const glID = names;
      return () => ({ mtlTexture: BigInt(0), glTarget: GL_TEXTURE_2D, glID, glFormat: GL_RGBA8, glProtected: 0 });
    }
    if (build === 'graphite') return () => { throw new Error('getTexture(surface) not implemented yet on Graphite'); };
    if (build === 'ganesh-metal') return () => ({ mtlTexture: BigInt(0x7f00a0), glTarget: 0, glID: 0, glFormat: 0, glProtected: 0 });
    return () => null;
  };
  const skia = {
    hasDevice: () => build === 'graphite',
    Surface: {
      MakeOffscreen(width: number, height: number): FakeSkiaSurface | null {
        if (options.offscreen === 'throws') throw new Error('Could not make a graphics context');
        if (options.offscreen === 'null') return null;
        const surface = new FakeSkiaSurface(width, height, textureOf(), options.disposeThrows === true);
        made.push(surface);
        return surface;
      },
    },
  };
  return { skia, made };
}
