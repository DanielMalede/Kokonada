import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';

// MB-086. The `skia` jest project: Skia's own jest environment, which loads CanvasKit (WASM) and
// backs the Skia API with it, so a shader really compiles and a surface really draws. The global
// setup (jest.setup.js) stubs Skia for headless screen renders; this project never loads that stub.
// Shader tests (the field, its uniform layout, never-red) are only as true as this smoke test.

describe('real Skia in jest (CanvasKit)', () => {
  it('is CanvasKit-backed Skia, not the global stub', () => {
    expect(typeof (globalThis as { CanvasKit?: unknown }).CanvasKit).toBe('object');
    expect(typeof Skia.RuntimeEffect?.Make).toBe('function');
    expect(typeof Skia.Path.Make().toSVGString).toBe('function'); // the stub's path has no such method
  });

  it('compiles a trivial SkSL shader', () => {
    expect(Skia.RuntimeEffect.Make('half4 main(float2 p) { return half4(1.0, 0.0, 0.0, 1.0); }')).not.toBeNull();
  });

  it('returns null for SkSL that does not compile: the trigger for the still fallback', () => {
    expect(Skia.RuntimeEffect.Make('half4 main(float2 p) { return undefinedThing; }')).toBeNull();
  });

  it('draws a 4x4 CPU surface with a shader and reads back the exact colour, every pixel', () => {
    const effect = Skia.RuntimeEffect.Make('uniform float4 c; half4 main(float2 p) { return half4(c); }');
    expect(effect).not.toBeNull();
    const surface = Skia.Surface.Make(4, 4);
    expect(surface).not.toBeNull();
    const paint = Skia.Paint();
    paint.setShader(effect!.makeShader([0.2, 0.4, 0.6, 1]));
    surface!.getCanvas().drawPaint(paint);
    surface!.flush();
    const pixels = surface!.makeImageSnapshot().readPixels(0, 0, {
      width: 4, height: 4, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul,
    });
    expect(pixels).not.toBeNull();
    const bytes = Array.from(pixels as Uint8Array);
    expect(bytes).toHaveLength(4 * 4 * 4);
    const expected = [51, 102, 153, 255]; // round(0.2, 0.4, 0.6, 1.0 x 255)
    for (let i = 0; i < 16; i += 1) expect(bytes.slice(i * 4, i * 4 + 4)).toEqual(expected);
  });
});
