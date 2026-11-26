import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId } from '../../tokens/tokens.generated.ts';
import type { FieldStatics } from '../fieldFrame.ts';
import { staticsFor } from '../statics.ts';

// UI-233 (RA-44): FieldView tells the nearest FieldFirstFrameReport listener, once per mount, that it drew its first frame
// (its first non-null uniforms), so the Design Lab's READY can say `ready` only for a field that was drawn. The signal
// crosses from the UI thread to JS as onStart does (runOnJS). The app mounts no listener: then FieldView calls nothing
// and draws exactly as it did. The Reanimated fake is FieldView.test.tsx's: SharedValues persist, a frame callback runs
// only while active, each frame on a rising timestamp, and every runOnJS crossing is counted.
const ui = { runOnJS: 0, timestamp: 0 };
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  const registry = new Map<number, { fn: (info: unknown) => void; active: boolean }>();
  let nextId = 1;
  return {
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ get value() { return fn(); } }),
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
      ui.runOnJS += 1;
      fn(...args);
    },
    useFrameCallback: (fn: (info: unknown) => void, autostart = true) => {
      const ref = useRef(null as null | { isActive: boolean; callbackId: number; setActive: (a: boolean) => void });
      if (ref.current === null) {
        const handle = {
          isActive: autostart,
          callbackId: -1,
          setActive(a: boolean) {
            const entry = registry.get(handle.callbackId);
            if (entry) entry.active = a;
            handle.isActive = a;
          },
        };
        ref.current = handle;
      }
      useEffect(() => {
        const handle = ref.current!;
        const id = nextId;
        nextId += 1;
        registry.set(id, { fn, active: false });
        handle.callbackId = id;
        handle.setActive(handle.isActive);
        return () => { registry.delete(id); handle.callbackId = -1; };
      }, [fn, autostart]);
      return ref.current;
    },
    __frame: (dt: number) => {
      ui.timestamp += dt;
      for (const entry of [...registry.values()]) if (entry.active) entry.fn({ timestamp: ui.timestamp, timeSincePreviousFrame: dt, timeSinceFirstFrame: 0 });
    },
    __active: () => [...registry.values()].filter((e) => e.active).length,
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number): void; __active(): number };

jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const inert: unknown = new Proxy(function stub() {}, { get: () => inert, apply: () => inert });
  return {
    Canvas: Stub, Image: () => null, Picture: () => null,
    FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
    ClipOp: { Difference: 0, Intersect: 1 }, TileMode: { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 },
    Skia: inert,
  };
});

const effectState: { status: 'ready' | 'fallback' } = { status: 'ready' };
jest.mock('../effect.ts', () => ({
  fieldEffect: () => (effectState.status === 'ready'
    ? { status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }
    : { status: 'fallback', reason: 'the field shader did not compile' }),
}));

// The real builder; a test may plant a throw in it, as the UI thread would meet one.
const planted = { throw: false };
jest.mock('../fieldFrame.ts', () => {
  const actual = jest.requireActual('../fieldFrame.ts');
  return {
    ...actual,
    buildFieldFrame: (...args: unknown[]) => {
      if (planted.throw) throw new RangeError('planted builder throw');
      return actual.buildFieldFrame(...args);
    },
  };
});

import { FieldFallback } from '../FieldFallback.tsx';
import { FieldSurface } from '../FieldSurface.tsx';
import { FieldView, type FieldViewProps } from '../FieldView.tsx';
import { FieldFirstFrameReport } from '../firstFrameReport.ts';

const ID = Object.keys(DIRECTIONS)[0] as DirectionId;
const STATICS: FieldStatics = staticsFor(ID, EXTENSIONS as never);
const A = { x: 0.5, y: 0.5 };
const B = { x: -0.5, y: -0.4 };
const clock = { t: { value: 3000 } };
const baseProps = (over: Partial<FieldViewProps> = {}): FieldViewProps => ({
  direction: ID, face: 'dark', scene: 'rest', statics: STATICS, taps: [A],
  layout: { width: 360, height: 640, centre: [180, 300], radius: 160, fontScale: 1 },
  pxPerDp: 2.625, tier: 'full', stress: 0, confidence: 1, genesis: false, clock: clock as never,
  ...over,
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
function mount(node: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => { r = ReactTestRenderer.create(node); });
  mounted.push(r);
  return r;
}
const listened = (listener: () => void, props: FieldViewProps) => (
  <FieldFirstFrameReport.Provider value={listener}>
    <FieldView {...props} />
  </FieldFirstFrameReport.Provider>
);
const frames = (n: number) => { for (let i = 0; i < n; i++) act(() => reanimated.__frame(16)); };
const uniformsOf = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByType(FieldSurface).props.uniforms.value as number[] | null;

beforeEach(() => {
  ui.runOnJS = 0;
  ui.timestamp = 0;
  effectState.status = 'ready';
  planted.throw = false;
});
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
  expect(reanimated.__active()).toBe(0);
});

describe('FieldView signals its first drawn frame to the lab, once per mount (UI-233)', () => {
  it('not before the first frame; at the first non-null uniforms; never again on that mount, whatever changes', () => {
    const seen: Array<number[] | null> = [];
    const at: { r: ReactTestRenderer.ReactTestRenderer | null } = { r: null };
    const heard = jest.fn(() => { seen.push(uniformsOf(at.r!)); });
    const listener = () => heard();
    const r = mount(listened(listener, baseProps()));
    at.r = r;
    expect(uniformsOf(r)).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    frames(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(seen[0]).not.toBeNull(); // the uniforms were written when it was told
    frames(30);
    act(() => r.update(listened(listener, baseProps({ taps: [A, B] }))));
    frames(30);
    act(() => r.update(listened(listener, baseProps({ taps: [A, B], stress: 0.5 }))));
    frames(10);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('re-armed per key: a scene switch mounts afresh and signals the new mount\'s first frame', () => {
    const heard = jest.fn();
    const r = mount(listened(heard, baseProps({ scene: 'a' })));
    frames(3);
    expect(heard).toHaveBeenCalledTimes(1);
    act(() => r.update(listened(heard, baseProps({ scene: 'b' }))));
    expect(uniformsOf(r)).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    frames(1);
    expect(heard).toHaveBeenCalledTimes(2);
    frames(10);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('never for a field that did not draw: a builder throw on the first frame, or an effect that cannot draw', () => {
    planted.throw = true;
    const thrown = jest.fn();
    const r = mount(listened(thrown, baseProps()));
    frames(5);
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(1);
    expect(thrown).not.toHaveBeenCalled();

    planted.throw = false;
    effectState.status = 'fallback';
    const none = jest.fn();
    const f = mount(listened(none, baseProps()));
    frames(5);
    expect(f.root.findAllByType(FieldFallback)).toHaveLength(1);
    expect(none).not.toHaveBeenCalled();
  });

  it('with no listener (the app): nothing crosses to JS and nothing is called, and the render output is the same', () => {
    const surface = (r: ReactTestRenderer.ReactTestRenderer) => {
      const { uniforms, ...rest } = r.root.findByType(FieldSurface).props;
      return { ...rest, uniforms: [...(uniforms.value as number[])] };
    };
    const bare = mount(<FieldView {...baseProps()} />);
    frames(100);
    expect(ui.runOnJS).toBe(0);
    expect(uniformsOf(bare)).not.toBeNull();
    const bareJson = bare.toJSON();
    const bareSurface = surface(bare);
    act(() => bare.unmount());
    mounted.splice(mounted.indexOf(bare), 1);

    ui.timestamp = 0;
    const heard = jest.fn();
    const told = mount(listened(heard, baseProps()));
    frames(100);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(ui.runOnJS).toBe(1); // the one crossing is the signal
    expect(told.toJSON()).toEqual(bareJson);
    expect(surface(told)).toEqual(bareSurface);
  });
});
