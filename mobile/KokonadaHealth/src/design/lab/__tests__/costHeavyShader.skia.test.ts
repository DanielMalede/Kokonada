import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { fieldEffect } from '../../v2/field/effect';
import { FIELD_SKSL } from '../../v2/field/fieldShader';
import { FIELD_UNIFORM_FLOATS } from '../../v2/field/uniforms';
import { benchBody, benchFrame, benchStart, costBenchConfig } from '../cost/costBench';
import { formatCostResult } from '../cost/costResult';
import { COST_SCENE_SPECS } from '../cost/costScenes';
import { EMPTY_SKSL, HEAVY_REPEATS, HEAVY_SKSL, calibrationSksl, makeCalibrationEffect } from '../cost/heavyShader';
import { MAX_LINE_BYTES } from '../protocol';

// B8-3, the instrument's calibration in real Skia (CanvasKit; the architect's B8 plan, F3 at A: "calibrated by a heavy and
// an empty shader"; B8-3: "the heavy shader compiles in CanvasKit and is at least 3× FIELD_SKSL there"). Both are made from
// FIELD_SKSL itself, so they take the field's packed frame and its blue noise through the same renderFieldImage: the empty
// one returns a constant (the bench's own floor: the surface, the flush, the snapshot and the sync), the heavy one runs the
// field's main HEAVY_REPEATS times at shifted points. The 3× is the instrument's own calibration, never a budget: DEC-082 is
// open, and no field cost is held to a threshold here.

function ready() {
  const e = fieldEffect();
  if (e.status !== 'ready') throw new Error(e.reason);
  return e;
}
const read = (img: { readPixels: (x: number, y: number, info: object) => unknown; width(): number; height(): number }) =>
  img.readPixels(0, 0, { width: img.width(), height: img.height(), colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;

describe('the calibration shaders', () => {
  it.each([['heavy'], ['empty']] as const)('%s compiles in CanvasKit and declares the field\'s uniforms', (kind) => {
    const made = makeCalibrationEffect(Skia, kind);
    expect(made.status).toBe('ready');
    if (made.status === 'ready') expect(made.effect.getUniformFloatCount()).toBe(FIELD_UNIFORM_FLOATS);
  });

  it('both are FIELD_SKSL with its main renamed, and a main of their own', () => {
    for (const sksl of [HEAVY_SKSL, EMPTY_SKSL]) {
      expect(sksl.startsWith(FIELD_SKSL.slice(0, FIELD_SKSL.indexOf('half4 main(float2 p) {')))).toBe(true);
      expect(sksl.match(/half4 main\(float2 p\) \{/g)).toHaveLength(1);
      expect(sksl).toContain('half4 fieldMain(float2 p) {');
    }
    expect(HEAVY_REPEATS).toBeGreaterThanOrEqual(4);
    expect(HEAVY_SKSL).toContain(`i < ${HEAVY_REPEATS}`);
  });

  it('a field source without its main is refused, never a calibration that measures something else', () => {
    expect(() => calibrationSksl('heavy', 'half4 other(float2 p) { return half4(1); }')).toThrow(/main/);
    expect(() => calibrationSksl('empty', `${FIELD_SKSL}\n${FIELD_SKSL}`)).toThrow(/main/);
  });

  it('a shader that does not compile, or declares other uniforms, is a fallback with a reason', () => {
    const none = makeCalibrationEffect({ RuntimeEffect: { Make: () => null } }, 'heavy');
    expect(none).toEqual({ status: 'fallback', reason: expect.stringMatching(/heavy.*did not compile/) });
    const thrown = makeCalibrationEffect({ RuntimeEffect: { Make: () => { throw new Error('boom'); } } }, 'empty');
    expect(thrown).toEqual({ status: 'fallback', reason: expect.stringMatching(/empty.*boom/) });
    const other = makeCalibrationEffect({ RuntimeEffect: { Make: (s: string) => Skia.RuntimeEffect.Make(s.replace(/half4 main[\s\S]*$/, 'uniform float x; half4 main(float2 p) { return half4(x); }')) } }, 'empty');
    expect(other.status).toBe('fallback');
  });
});

describe('the bench in CanvasKit, end to end', () => {
  const COUNTS = { warmup: 1, frames: 2, gpuSamples: 3, gpuRenders: 2 };
  const runBench = (id: string, effect: unknown) => {
    const e = ready();
    const c = costBenchConfig({
      spec: COST_SCENE_SPECS[id], width: 411, height: 914, pxPerDp: 0.05, fontScale: 1,
      skia: Skia, effect: effect as never, blueNoise: e.blueNoiseShader, counts: COUNTS,
    });
    const s = benchStart(c);
    for (let i = 0; i < 100 && s.phase !== 'done' && s.phase !== 'error'; i++) benchFrame(s, c, 1000 + i * (1000 / 60));
    expect(s.error).toBeNull();
    return { body: benchBody(s), c };
  };
  const calibration = (kind: 'heavy' | 'empty') => {
    const made = makeCalibrationEffect(Skia, kind);
    if (made.status !== 'ready') throw new Error(made.reason);
    return made.effect;
  };

  it('the heavy shader costs at least 3× the field shader on the bench\'s own GPU proxy (the calibration, not a budget)', () => {
    const field = runBench('cost.abyss.dark.three.full', ready().effect).body;
    const heavy = runBench('cost.abyss.dark.three.full.heavy', calibration('heavy')).body;
    expect(heavy.gpuProxyUs.p50).toBeGreaterThanOrEqual(3 * field.gpuProxyUs.p50);
  });

  it('the empty shader draws its constant through renderFieldImage, with the field\'s frame', () => {
    const { c } = runBench('cost.abyss.dark.three.full.empty', calibration('empty'));
    const { renderFieldImage } = jest.requireActual('../../v2/field/fieldImage');
    const e = ready();
    const img = renderFieldImage(Skia, calibration('empty'), e.blueNoiseShader, new Array(FIELD_UNIFORM_FLOATS).fill(0), c.size.width, c.size.height);
    const px = read(img);
    expect(Array.from(px.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });

  it('a real run\'s RESULT is finite and at most 4000 bytes', () => {
    const { body } = runBench('cost.abyss.dark.three.full.storm', ready().effect);
    const line = formatCostResult({ run: 'r'.repeat(64), seq: 0, ...body });
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(MAX_LINE_BYTES);
    expect(body.frames).toBe(COUNTS.frames);
    expect(body.displayHz).toBe(60);
  });
});
