import React from 'react';
import { PixelRatio } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AlphaType, ColorType, Picture, Skia, ClipOp, TileMode, type SkPicture } from '@shopify/react-native-skia';
import { recordFieldFallback } from '../../v2/field/fallbackDraw';
import { fallbackPlan } from '../../v2/field/fallbackModel';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { FieldFallback, type FieldFallbackProps } from '../../v2/field/FieldFallback';
import { FIELD_SCENES, FIELD_STATICS } from '../fieldScenes';
import { ProbeRegistry } from '../probe/Probe';
import type { LabParams } from '../params';
import { FallbackScene } from '../scenes/FallbackScene';

// T14, S3: a lab fallback scene draws FieldFallback directly, never FieldView (a forced shader failure is not needed to see
// the fallback), on T13's hero layout (UI-207), once its view is measured; the stage is its one probe. In real Skia
// (CanvasKit): the picture it shows is its scene's plan, byte for byte, and not a flat ground. That its import closure never
// reaches FieldView is checked in the unit project (fieldSceneRegistry.test.ts), where a FieldView import cannot stop the
// suite from loading.

// As in FieldFallback.skia.test.tsx: CanvasKit's gradient factory reads the colours with instanceof checks that arrays
// made in the test's realm fail; at CanvasKit's own door only, the colours are re-homed into CanvasKit's realm unchanged.
beforeAll(() => {
  const ck = (globalThis as unknown as { CanvasKit: { HEAPF32: Float32Array; Shader: { MakeRadialGradient: (...args: unknown[]) => unknown } } }).CanvasKit;
  const Home = ck.HEAPF32.constructor as Float32ArrayConstructor;
  const make = ck.Shader.MakeRadialGradient.bind(ck.Shader);
  ck.Shader.MakeRadialGradient = (centre: unknown, radius: unknown, colours: unknown, ...rest: unknown[]) =>
    make(centre, radius, Array.isArray(colours) ? Home.from((colours as Float32Array[]).flatMap((c) => Array.from(c))) : colours, ...rest);
});

const W = 411;
const H = 914;
const FALLBACK_IDS = Object.values(FIELD_SCENES).filter((s) => s.kind === 'fallback').map((s) => s.id);
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 0, stepMs: 0, frames: 10 });

function mount(scene: string) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ProbeRegistry onMeasure={() => {}}>
        <FallbackScene params={paramsOf(scene)} />
      </ProbeRegistry>,
    );
  });
  return r;
}
const probes = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-')).map((n) => n.props.nativeID);
const layoutAs = (r: ReactTestRenderer.ReactTestRenderer, width = W, height = H) =>
  act(() => r.root.find((n) => n.props.testID === 'fallback-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));

/** The picture as RN Skia's Canvas plays it: the view's device px, under the density's scale; the surface freed. */
function play(picture: SkPicture, w: number, h: number, k: number): Uint8Array {
  const surface = Skia.Surface.Make(w, h)!;
  surface.getCanvas().scale(k, k);
  surface.getCanvas().drawPicture(picture);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const px = image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
  image.dispose();
  surface.dispose();
  return px;
}

describe('a lab fallback scene: FieldFallback, mounted directly', () => {
  it('before layout: the stage probe and nothing drawn (UI-175 at this root)', () => {
    const r = mount(FALLBACK_IDS[0]);
    expect(probes(r)).toEqual(['probe-stage']);
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(0);
    layoutAs(r, 0, H);
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(0);
    act(() => r.unmount());
  });

  it.each(FALLBACK_IDS)('%s: FieldFallback on its face and taps, on the hero layout, the stage its one probe', (id) => {
    const spec = FIELD_SCENES[id];
    const r = mount(id);
    layoutAs(r);
    expect(probes(r)).toEqual(['probe-stage']);
    const found = r.root.findAllByType(FieldFallback);
    expect(found).toHaveLength(1);
    const p = found[0].props;
    expect([p.direction, p.face, p.statics, p.taps, p.pxPerDp, p.quietPresence]).toEqual(['abyss', spec.face, FIELD_STATICS, spec.taps, PixelRatio.get(), undefined]);
    expect(p.statics).toBe(FIELD_STATICS);
    expect(p.layout).toEqual(heroLayout('abyss', W, H, PixelRatio.getFontScale()));
    expect(typeof p.reason).toBe('string');
    act(() => r.unmount());
  });

  it('what it shows is its scene\'s plan, byte for byte, and not a flat ground; the faces differ', () => {
    const k = PixelRatio.get();
    const [w, h] = [Math.round(W * k), Math.round(H * k)];
    const shown = (id: string) => {
      const r = mount(id);
      layoutAs(r);
      const props = r.root.findByType(FieldFallback).props as FieldFallbackProps;
      const px = play(r.root.findByType(Picture).props.picture, w, h, k);
      const planned = play(recordFieldFallback({ Skia, ClipOp, TileMode }, fallbackPlan(props), W, H), w, h, k);
      act(() => r.unmount());
      return { px, planned, props };
    };
    const dark = shown('fallback.abyss.dark.three');
    const light = shown('fallback.abyss.light.three');
    for (const s of [dark, light]) {
      expect(Buffer.from(s.px).equals(Buffer.from(s.planned))).toBe(true);
      const at = (x: number, y: number) => Array.from(s.px.slice(4 * (Math.round(y * k) * w + Math.round(x * k)), 4 * (Math.round(y * k) * w + Math.round(x * k)) + 3));
      const [cx, cy] = s.props.layout.centre;
      expect(at(cx + 0.6 * s.props.layout.radius, cy - 0.6 * s.props.layout.radius)).not.toEqual(at(2, H / 2)); // the field over the face, not the ground
    }
    expect(Buffer.from(dark.px).equals(Buffer.from(light.px))).toBe(false);
  });
});
