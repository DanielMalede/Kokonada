import React from 'react';
import { I18nManager, StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry } from '../geometry.ts';
import { Plate } from '../Plate.tsx';
import { rimPlan } from '../rim.ts';

// A stateful fake of the part of Skia the rim draws with. Each recording keeps every call made on its canvas (any call:
// the canvas is a Proxy, so a ring, a face or a fill drawn by mistake shows up here), the paint each draw used, and how
// many times its picture was freed. The pixels are rim.skia.test.ts's, on CanvasKit; here, the component's wiring.
jest.mock('@shopify/react-native-skia', () => {
  const fake = { recordings: [] as Array<{ calls: Array<{ name: string; args: unknown[] }>; disposed: number; bounds: unknown }>, redraws: 0 };
  // The canvas: its ref's redraw() asks the native view to draw its picture again (SkiaViewApi.requestRedraw); counted.
  const ReactInMock = jest.requireActual('react') as typeof import('react');
  const Canvas = ({ children, ref }: { children?: unknown; ref?: unknown }) => {
    ReactInMock.useImperativeHandle(ref as never, () => ({ redraw: () => { fake.redraws += 1; } }), []);
    return children ?? null;
  };
  const paint = () => {
    const state: Record<string, unknown> = {};
    const setter = (key: string) => (value: unknown) => {
      state[key] = value;
    };
    return { state, setAntiAlias: setter('antiAlias'), setDither: setter('dither'), setStyle: setter('style'), setStrokeWidth: setter('strokeWidth'), setShader: setter('shader'), setColor: setter('color'), dispose() {} };
  };
  // A paint is recorded as the state it held when it was drawn with.
  const recorded = (a: unknown) => (a !== null && typeof a === 'object' && 'state' in a ? { ...(a as { state: object }).state } : a);
  const Skia = {
    Paint: paint,
    Point: (x: number, y: number) => ({ x, y }),
    XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
    Shader: { MakeLinearGradient: (start: unknown, end: unknown, colors: unknown, positions: unknown, mode: unknown) => ({ start, end, colors, positions, mode, dispose() {} }) },
    PictureRecorder: () => {
      let current: { calls: Array<{ name: string; args: unknown[] }>; disposed: number; bounds: unknown } | null = null;
      return {
        beginRecording: (bounds: unknown) => {
          const recording = { calls: [] as Array<{ name: string; args: unknown[] }>, disposed: 0, bounds };
          current = recording;
          return new Proxy({}, { get: (_t, name) => (...args: unknown[]) => recording.calls.push({ name: String(name), args: args.map(recorded) }) });
        },
        finishRecordingAsPicture: () => {
          const recording = current!;
          fake.recordings.push(recording);
          return { dispose: () => { recording.disposed += 1; } };
        },
        dispose() {},
      };
    },
  };
  return { Canvas, Picture: () => null, PaintStyle: { Fill: 0, Stroke: 1 }, TileMode: { Clamp: 0 }, Skia, __fake: fake };
});

type Recording = { calls: Array<{ name: string; args: unknown[] }>; disposed: number; bounds: { width: number; height: number } };
const recordings = (): Recording[] => jest.requireMock('@shopify/react-native-skia').__fake.recordings;
const redraws = (): number => jest.requireMock('@shopify/react-native-skia').__fake.redraws;
const reanimated = jest.requireMock('react-native-reanimated') as Record<string, (...args: unknown[]) => unknown>;

type Node = ReactTestRenderer.ReactTestInstance;
const flat = (n: Node) => StyleSheet.flatten(n.props.style) ?? {};
const tokensOf = (face: Face) => ({ base: BASE, direction: DIRECTIONS.abyss, color: DIRECTIONS.abyss.color[face] });

function mount(props: { diameter: number; fontScale: number; face?: Face; children?: React.ReactNode }) {
  const tree = (p: typeof props) => (
    <DirectionProvider direction="abyss" face={p.face ?? 'dark'}>
      <Plate diameter={p.diameter} fontScale={p.fontScale}>{p.children}</Plate>
    </DirectionProvider>
  );
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(tree(props));
  });
  const root = () => r.root.find((n) => typeof n.type === 'string' && n.props.testID === 'hero.plate');
  const rim = () => r.root.find((n) => typeof n.type !== 'string' && n.props.testID === 'hero.plate.rim');
  return { r, root, rim, update: (next: typeof props) => act(() => r.update(tree(next))), unmount: () => act(() => r.unmount()) };
}

beforeEach(() => {
  recordings().splice(0);
  jest.requireMock('@shopify/react-native-skia').__fake.redraws = 0;
});
afterEach(() => jest.restoreAllMocks());

describe('Plate', () => {
  it.each([false, true])('is a box of its diameter, laid out left to right whatever the locale (R7, QA-088): isRTL %p', (rtl) => {
    jest.replaceProperty(I18nManager, 'isRTL', rtl);
    const view = mount({ diameter: 296, fontScale: 1 });
    expect(flat(view.root())).toMatchObject({ width: 296, height: 296, direction: 'ltr', overflow: 'visible' });
    view.unmount();
  });

  it('lays its rim canvas over its box, outset on every side so the keyline is never cut, and inert to touch', () => {
    const view = mount({ diameter: 296, fontScale: 1 });
    const plan = rimPlan(tokensOf('dark'), plateGeometry(tokensOf('dark'), 296, 1));
    const rim = view.rim();
    expect(flat(rim)).toMatchObject({ position: 'absolute', left: -plan.pad, top: -plan.pad, width: plan.size, height: plan.size });
    expect(rim.props.pointerEvents).toBe('none');
    expect(rim.props.colorSpace).toBe('srgb');
    // The canvas is the root's direct child: under RTL its `left` resolves against the root's ltr, as on the device.
    expect(view.root().children.includes(rim)).toBe(true);
    view.unmount();
  });

  it('hides the rim drawing from accessibility, and is no accessibility element itself, so its layers are reached one by one', () => {
    const view = mount({ diameter: 296, fontScale: 1, children: <Text accessibilityLabel="a layer">x</Text> });
    expect(view.rim().props.accessibilityElementsHidden).toBe(true);
    expect(view.rim().props.importantForAccessibility).toBe('no-hide-descendants');
    expect(view.root().props.accessible).not.toBe(true);
    expect(['no', 'no-hide-descendants']).not.toContain(view.root().props.importantForAccessibility);
    view.unmount();
  });

  it('draws its layers, its children, over the rim, in the order given', () => {
    const view = mount({ diameter: 296, fontScale: 1, children: [<Text key="a" testID="layer.a">a</Text>, <Text key="b" testID="layer.b">b</Text>] });
    const kids = view.root().children as Node[];
    const ids = kids.map((k) => k.props.testID);
    expect(ids).toEqual(['hero.plate.rim', 'layer.a', 'layer.b']);
    view.unmount();
  });

  it.each(['dark', 'light'] as const)('%s face: draws exactly one stroked circle, the plan’s keyline in the face’s rim colours, and nothing else', (face) => {
    const view = mount({ diameter: 296, fontScale: 1, face });
    const plan = rimPlan(tokensOf(face), plateGeometry(tokensOf(face), 296, 1));
    expect(recordings()).toHaveLength(1);
    const [recording] = recordings();
    expect(recording.bounds).toMatchObject({ width: plan.size, height: plan.size });
    expect(recording.calls.map((c) => c.name)).toEqual(['drawCircle']);
    const [cx, cy, r, paint] = recording.calls[0].args as [number, number, number, Record<string, unknown>];
    expect([cx, cy, r]).toEqual([plan.centre[0], plan.centre[1], plan.radius]);
    expect(paint).toMatchObject({ style: 1, strokeWidth: plan.width, antiAlias: true, dither: false });
    const shader = paint.shader as { start: unknown; end: unknown; colors: Float32Array[] };
    expect(shader.start).toEqual({ x: plan.gradient.from[0], y: plan.gradient.from[1] });
    expect(shader.end).toEqual({ x: plan.gradient.to[0], y: plan.gradient.to[1] });
    const asBytes = (c: Float32Array) => Array.from(c).map((v) => Math.round(v * 255));
    expect(shader.colors.map(asBytes)).toEqual([[...plan.gradient.top, 255], [...plan.gradient.bottom, 255]]);
    view.unmount();
  });

  it('records a new picture only when its geometry or face changes, and frees every picture once (RA-31)', () => {
    const view = mount({ diameter: 296, fontScale: 1 });
    view.update({ diameter: 296, fontScale: 1 });
    expect(recordings()).toHaveLength(1);
    view.update({ diameter: 320, fontScale: 1 });
    expect(recordings()).toHaveLength(2);
    expect(recordings()[0].disposed).toBe(1);
    view.update({ diameter: 320, fontScale: 1, face: 'light' });
    expect(recordings()).toHaveLength(3);
    expect(recordings()[1].disposed).toBe(1);
    view.unmount();
    expect(recordings().map((r) => r.disposed)).toEqual([1, 1, 1]);
  });

  it('at font scale 2.0 keeps its box and its keyline: only the band, which the field and the rim words lay, grows', () => {
    const one = mount({ diameter: 296, fontScale: 1 });
    one.unmount();
    const two = mount({ diameter: 296, fontScale: 2 });
    expect(flat(two.root())).toMatchObject({ width: 296, height: 296 });
    const [atOne, atTwo] = recordings();
    expect(atTwo.calls).toHaveLength(1);
    expect(atTwo.calls[0].args.slice(0, 3)).toEqual(atOne.calls[0].args.slice(0, 3));
    expect(atTwo.calls[0].args[2]).toBe(148);
    two.unmount();
  });

  it('is the designed still in every tier: no frame callback, no animated value, no timing (reduced motion has nothing to stop)', () => {
    const spies = ['useFrameCallback', 'useSharedValue', 'useAnimatedStyle', 'withTiming'].map((name) => jest.spyOn(reanimated, name));
    const view = mount({ diameter: 296, fontScale: 1 });
    view.update({ diameter: 320, fontScale: 2 });
    view.unmount();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  // The d5479dc launches: 1 in 19 lost the keyline. Skia renders a static canvas only around its surface's attach, and
  // each render first latches the TextureView's queued frame on the main thread, where that fails and releases it
  // (RNSkia's "updateAndRelease() failed"); a frame the view had not shown yet is dropped, and no later render comes.
  // So once the plate is laid out, two frames on (its surfaces attach at the first draw), the rim is drawn once more.
  describe('the keyline is drawn again once its surface is up (the d5479dc launch that lost it)', () => {
    const layout = (view: ReturnType<typeof mount>) => act(() => view.root().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 296, height: 296 } } }));
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) act(() => jest.advanceTimersToNextTimer());
    };
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('two frames after a layout, it asks the rim canvas to draw again, once', () => {
      const view = mount({ diameter: 296, fontScale: 1 });
      expect(redraws()).toBe(0);
      layout(view);
      expect(redraws()).toBe(0);
      frames(1);
      expect(redraws()).toBe(0);
      frames(1);
      expect(redraws()).toBe(1);
      view.unmount();
    });

    it('then does no frame work at rest: nothing pending, and no redraw without a new layout', () => {
      const view = mount({ diameter: 296, fontScale: 1 });
      expect(jest.getTimerCount()).toBe(0);
      layout(view);
      frames(2);
      expect(jest.getTimerCount()).toBe(0);
      act(() => jest.advanceTimersByTime(10_000));
      expect(redraws()).toBe(1);
      layout(view);
      frames(2);
      expect(redraws()).toBe(2);
      view.unmount();
    });

    it('layouts that come before the frames ask once; an unmount before them asks nothing and leaves nothing pending', () => {
      const view = mount({ diameter: 296, fontScale: 1 });
      layout(view);
      layout(view);
      frames(1);
      layout(view);
      act(() => jest.advanceTimersByTime(1000));
      expect(redraws()).toBe(1);
      const gone = mount({ diameter: 296, fontScale: 1 });
      layout(gone);
      expect(jest.getTimerCount()).toBe(1);
      gone.unmount();
      expect(jest.getTimerCount()).toBe(0);
      act(() => jest.advanceTimersByTime(1000));
      expect(redraws()).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
      view.unmount();
    });
  });

  it('has no elevation and no shadow anywhere (R9)', () => {
    const view = mount({ diameter: 296, fontScale: 1 });
    const keys = view.r.root.findAll((n) => typeof n.type === 'string').flatMap((n) => Object.keys(flat(n)));
    expect(keys.filter((k) => k === 'elevation' || k.startsWith('shadow'))).toEqual([]);
    view.unmount();
  });
});
