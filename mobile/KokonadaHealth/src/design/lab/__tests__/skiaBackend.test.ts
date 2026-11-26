import { readSkiaBackend, SKIA_BACKEND_MAX_REASON, SKIA_BACKENDS } from '../skiaBackend';
import { fakeSkia, type FakeBuild } from './__fixtures__/fakeSkiaBackend';

// UI-276. READY says which Skia backend drew the lab, read on the device from react-native-skia itself: its build flag
// (Skia.hasDevice(), true only with Graphite), then, for Ganesh, the GPU API it drives, from the native texture of a 1x1
// offscreen surface it makes (a GL texture on Android). A read that does not answer is null with the reason, never a
// guess, and the read never throws: a READY must always be sent. On a stateful fake that answers as 2.6.9's native code
// does, by build (__fixtures__/fakeSkiaBackend.ts); skiaBackend.skia.test.ts runs it on the real CanvasKit-backed Skia.

const fact = (build: FakeBuild, options = {}) => {
  const f = fakeSkia(build, options);
  return { ...f, read: readSkiaBackend(f.skia) };
};

describe('the backend react-native-skia answers', () => {
  it('Ganesh on GL (the S22+\'s lab): ganesh-gl, read from the GL texture of the one 1x1 surface it made, then disposed', () => {
    const { read, made } = fact('ganesh-gl');
    expect(read).toEqual({
      backend: 'ganesh-gl',
      readBy: 'Skia.hasDevice() is false (Ganesh), and a 1x1 Skia.Surface.MakeOffscreen surface\'s native texture is a GL texture on target 0xde1',
      reason: null,
    });
    expect(made.map((s) => [s.width, s.height, s.reads, s.disposed])).toEqual([[1, 1, 1, 1]]);
  });

  it('Graphite: graphite from the build flag alone, with no surface made', () => {
    const { read, made } = fact('graphite');
    expect(read).toEqual({ backend: 'graphite', readBy: 'Skia.hasDevice() is true: react-native-skia was built with the Graphite backend (SK_GRAPHITE)', reason: null });
    expect(made).toEqual([]);
  });

  it('Graphite even when its offscreen surfaces cannot be made: the build flag is read first', () => {
    expect(fact('graphite', { offscreen: 'throws' }).read.backend).toBe('graphite');
  });

  it.each([
    ['Ganesh on Metal (an iOS build): its texture names no GL texture', 'ganesh-metal' as FakeBuild, {}, /^Skia\.hasDevice\(\) is false \(Ganesh\), and the offscreen surface's native texture names no GL texture \(glTarget 0, glID 0\)$/],
    ['CanvasKit\'s CPU surface: no native texture at all', 'raster' as FakeBuild, {}, /names no GL texture \(glTarget undefined, glID undefined\)$/],
    ['a GL target without a texture name', 'ganesh-gl' as FakeBuild, { texture: () => ({ glTarget: 0x0de1, glID: 0 }) }, /names no GL texture \(glTarget 3553, glID 0\)$/],
    ['a texture whose GL target is not a whole number', 'ganesh-gl' as FakeBuild, { texture: () => ({ glTarget: '3553', glID: 2 }) }, /names no GL texture \(glTarget "3553", glID 2\)$/],
    ['a native texture that throws', 'ganesh-gl' as FakeBuild, { texture: () => { throw new Error('couldn\'t get OpenGL texture'); } }, /^Skia\.hasDevice\(\) is false \(Ganesh\), and the offscreen surface's getNativeTextureUnstable\(\) threw: couldn't get OpenGL texture$/],
    ['a context that makes no offscreen surface (OpenGLContext::MakeOffscreen\'s null)', 'ganesh-gl' as FakeBuild, { offscreen: 'null' }, /^Skia\.hasDevice\(\) is false \(Ganesh\), and Skia\.Surface\.MakeOffscreen\(1, 1\) made no GPU surface$/],
    ['an offscreen surface that throws', 'ganesh-gl' as FakeBuild, { offscreen: 'throws' }, /^Skia\.hasDevice\(\) is false \(Ganesh\), and Skia\.Surface\.MakeOffscreen\(1, 1\) threw: Could not make a graphics context$/],
  ])('%s: null, and why', (_label, build, options, why) => {
    const { read, made } = fact(build, options);
    expect(read).toEqual({ backend: null, readBy: null, reason: expect.stringMatching(why) });
    // Every surface the read made is disposed once, whatever it answered.
    for (const s of made) expect(s.disposed).toBe(1);
  });

  it.each([
    ['no Skia at all', undefined],
    ['null', null],
    ['the unit tests\' stub, which has no hasDevice', { Path: {} }],
  ])('a Skia with no build flag (%s): null, naming it', (_label, skia) => {
    expect(readSkiaBackend(skia as never)).toEqual({ backend: null, readBy: null, reason: 'react-native-skia has no Skia.hasDevice(), so it cannot say whether it is the Graphite build' });
  });

  it.each([
    ['a string', 'false', '"false"'],
    ['a number', 0, '0'],
    ['undefined', undefined, 'undefined'],
    ['an object', {}, 'an object'],
  ])('a build flag that is %s, not a boolean: null, naming what it returned', (_label, flag, shown) => {
    const { skia, made } = fakeSkia('ganesh-gl');
    expect(readSkiaBackend({ ...skia, hasDevice: () => flag } as never)).toEqual({ backend: null, readBy: null, reason: `Skia.hasDevice() returned ${shown}, not true or false` });
    expect(made).toEqual([]);
  });

  it('a build flag that throws: null, with its message', () => {
    const { skia } = fakeSkia('ganesh-gl');
    expect(readSkiaBackend({ ...skia, hasDevice: () => { throw new Error('no JSI'); } } as never).reason).toBe('Skia.hasDevice() threw: no JSI');
  });

  it.each([
    ['no Surface', (s: ReturnType<typeof fakeSkia>['skia']) => ({ hasDevice: s.hasDevice })],
    ['a Surface without MakeOffscreen', (s: ReturnType<typeof fakeSkia>['skia']) => ({ hasDevice: s.hasDevice, Surface: {} })],
  ])('Ganesh with %s: null, since nothing shows the GPU API it drives', (_label, cut) => {
    expect(readSkiaBackend(cut(fakeSkia('ganesh-gl').skia) as never)).toEqual({
      backend: null, readBy: null, reason: 'Skia.hasDevice() is false (Ganesh), and this Skia has no Surface.MakeOffscreen to show the GPU API Ganesh drives',
    });
  });

  it('a surface with no native texture call: null, and the surface is still disposed', () => {
    const disposed: string[] = [];
    const skia = { hasDevice: () => false, Surface: { MakeOffscreen: () => ({ dispose: () => disposed.push('d') }) } };
    expect(readSkiaBackend(skia as never).reason).toBe('Skia.hasDevice() is false (Ganesh), and the offscreen surface has no getNativeTextureUnstable()');
    expect(disposed).toEqual(['d']);
  });

  it('a surface whose dispose throws: null, so a misbehaving surface is never taken for an answer', () => {
    const { read, made } = fact('ganesh-gl', { disposeThrows: true });
    expect(read).toEqual({ backend: null, readBy: null, reason: 'the backend read threw: dispose failed' });
    expect(made[0].disposed).toBe(1);
  });

  it('never throws, even on a Skia whose every property is a callable proxy that answers itself', () => {
    const inert: unknown = new Proxy(function stub() {}, { get: () => inert, apply: () => inert });
    expect(readSkiaBackend(inert as never)).toEqual({ backend: null, readBy: null, reason: 'Skia.hasDevice() returned a function, not true or false' });
  });

  it(`clips a reason to ${SKIA_BACKEND_MAX_REASON} characters, the last an ellipsis, so READY stays one logcat line`, () => {
    const { skia } = fakeSkia('ganesh-gl');
    const { reason } = readSkiaBackend({ ...skia, hasDevice: () => { throw new Error('x'.repeat(5000)); } } as never);
    expect(reason).toHaveLength(SKIA_BACKEND_MAX_REASON);
    expect(reason!.startsWith('Skia.hasDevice() threw: xxx')).toBe(true);
    expect(reason!.endsWith('…')).toBe(true);
  });

  it('a fact is a backend and how it was read, or no backend and why: never both, never neither', () => {
    const reads = [
      ...(['ganesh-gl', 'graphite', 'ganesh-metal', 'raster'] as FakeBuild[]).map((b) => fact(b).read),
      fact('ganesh-gl', { offscreen: 'null' }).read,
      readSkiaBackend(undefined),
    ];
    for (const r of reads) {
      expect(r.backend === null).toBe(r.readBy === null);
      expect(r.backend === null).toBe(typeof r.reason === 'string' && r.reason.length > 0);
      if (r.backend !== null) expect(SKIA_BACKENDS).toContain(r.backend);
    }
  });
});
