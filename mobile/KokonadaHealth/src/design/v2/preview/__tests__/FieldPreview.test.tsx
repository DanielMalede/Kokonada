import React from 'react';
import { PixelRatio } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS } from '../../tokens/tokens.generated.ts';
import { NODE_SLOTS } from '../../field/fieldLaw.ts';
import { staticsFor } from '../../field/statics.ts';
import { FIELD_UNIFORMS } from '../../field/uniforms.ts';
import { previewLayout, sceneTaps, tapOnDisc, type HeroScenes } from '../previewModel.ts';

// The dev-only field preview (option A of the T12 report): the real FieldView, Abyss, on a real-time clock,
// mounted only once the root has measured its view (UI-175), with the face, the scene, the tier and taps
// switched from on-screen controls. FieldView is the real one, its builder the real builder; only the UI
// thread and the canvas are faked, as in FieldView.test.tsx: SharedValues persist, a frame callback is
// registered per identity, only active callbacks run, and each frame carries a rising timestamp.
const ui = { timestamp: 0 };
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
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(...args),
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
  return { Canvas: Stub, Image: () => null, FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 }, Skia: {} };
});
jest.mock('../../field/effect.ts', () => ({
  fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }),
}));

import { FieldSurface } from '../../field/FieldSurface.tsx';
import { FieldView } from '../../field/FieldView.tsx';
import { FieldPreview } from '../FieldPreview.tsx';

const SCENES = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: HeroScenes } } } }).base.$root.hero.scenes;
const W = 411;
const H = 800;

const OFFSET: Record<string, number> = {};
FIELD_UNIFORMS.reduce((at, u) => { OFFSET[u.name] = at; return at + u.floats; }, 0);
const placementFades = (u: readonly number[]) =>
  Array.from({ length: NODE_SLOTS }, (_, k) => ({ fade: u[OFFSET[`uNode${k}`] + 3], bead: u[OFFSET[`uNode${k}Bead`] + 2] === 1 })).filter((n) => n.bead).map((n) => n.fade);

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
function mount(onClose?: () => void) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => { r = ReactTestRenderer.create(<FieldPreview onClose={onClose} />); });
  mounted.push(r);
  return r;
}
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
  expect(reanimated.__active()).toBe(0);
});

const byId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.find((n) => n.props.testID === id && typeof n.type !== 'string');
const layoutAs = (r: ReactTestRenderer.ReactTestRenderer, width = W, height = H) =>
  act(() => byId(r, 'preview.root').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
const press = (r: ReactTestRenderer.ReactTestRenderer, id: string, nativeEvent: object = {}) => act(() => byId(r, id).props.onPress({ nativeEvent }));
const field = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByType(FieldView).props;
const frames = (n: number, dt = 16) => { for (let i = 0; i < n; i++) act(() => reanimated.__frame(dt)); };
const uniformsOf = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByType(FieldSurface).props.uniforms.value as number[] | null;
const label = (r: ReactTestRenderer.ReactTestRenderer, id: string) => byId(r, id).findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children).join(' ');

beforeEach(() => { ui.timestamp = 0; });

describe('FieldView mounts only once the view is measured (UI-175)', () => {
  it('no FieldView before layout; after it, Abyss at rest, dark, full, on the measured layout and the device pxPerDp', () => {
    const r = mount();
    expect(r.root.findAllByType(FieldView)).toHaveLength(0);
    layoutAs(r);
    const p = field(r);
    expect(p.direction).toBe('abyss');
    expect(p.face).toBe('dark');
    expect(p.scene).toBe('rest');
    expect(p.taps).toEqual([]);
    expect(p.tier).toBe('full');
    expect(p.layout).toEqual(previewLayout(W, H, PixelRatio.getFontScale()));
    expect(p.pxPerDp).toBe(PixelRatio.get());
    expect(p.statics).toEqual(staticsFor('abyss', EXTENSIONS as never));
    expect(p.breathPhase).toBeUndefined();
  });

  it('a zero-size layout mounts nothing', () => {
    const r = mount();
    layoutAs(r, 0, 0);
    expect(r.root.findAllByType(FieldView)).toHaveLength(0);
  });

  it('the real builder draws a frame on the first frame after mount', () => {
    const r = mount();
    layoutAs(r);
    expect(uniformsOf(r)).toBeNull();
    frames(1);
    expect(uniformsOf(r)).not.toBeNull();
  });
});

describe('real time', () => {
  it('the field clock advances with each frame, wrapping at the master period', () => {
    const r = mount();
    layoutAs(r);
    const t0 = field(r).clock.t.value;
    frames(10, 16);
    expect(field(r).clock.t.value - t0).toBeCloseTo(160, 9);
    expect(BASE.field.clock.T).toBe(60000);
  });
});

describe('the controls', () => {
  it('face: dark, light, dark, and the ground follows', () => {
    const r = mount();
    layoutAs(r);
    const ground = () => [byId(r, 'preview.root').props.style].flat().find((s: { backgroundColor?: string } | undefined) => s?.backgroundColor)?.backgroundColor;
    expect(ground()).toBe(DIRECTIONS.abyss.color.dark.ground.hex);
    press(r, 'preview.face');
    expect(field(r).face).toBe('light');
    expect(label(r, 'preview.face')).toContain('light');
    expect(ground()).toBe(DIRECTIONS.abyss.color.light.ground.hex);
    press(r, 'preview.face');
    expect(field(r).face).toBe('dark');
  });

  it('scene: rest, one.joy, three, rest, each with its hero placements as taps', () => {
    const r = mount();
    layoutAs(r);
    for (const s of ['one.joy', 'three', 'rest']) {
      press(r, 'preview.scene');
      expect(field(r).scene).toBe(s);
      expect(field(r).taps).toEqual(sceneTaps(SCENES, s));
      expect(label(r, 'preview.scene')).toContain(s);
    }
  });

  it('tier: full, low, still, full', () => {
    const r = mount();
    layoutAs(r);
    for (const t of ['low', 'still', 'full']) {
      press(r, 'preview.tier');
      expect(field(r).tier).toBe(t);
      expect(label(r, 'preview.tier')).toContain(t);
    }
  });

  it('close calls onClose', () => {
    const onClose = jest.fn();
    const r = mount(onClose);
    layoutAs(r);
    press(r, 'preview.close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a tap adds a placement', () => {
  it('a tap on the field becomes a tap on the disc, and the drawn frame fades its bead in to 1', () => {
    const r = mount();
    layoutAs(r);
    frames(2);
    expect(placementFades(uniformsOf(r)!)).toEqual([]);
    const at = { x: W / 2 + 60, y: H / 2 - 60 };
    press(r, 'preview.field', { locationX: at.x, locationY: at.y });
    expect(field(r).taps).toEqual([tapOnDisc(at, previewLayout(W, H, PixelRatio.getFontScale()))]);
    expect(field(r).scene).toBe('rest');
    frames(Math.ceil(BASE.motion.settle.duration / 16) + 3);
    expect(placementFades(uniformsOf(r)!)).toEqual([1]);
  });

  it('a tap adds to the scene\'s placements, the last three kept; a scene switch starts from its own', () => {
    const r = mount();
    layoutAs(r);
    press(r, 'preview.scene');
    press(r, 'preview.scene');
    expect(field(r).taps).toHaveLength(3);
    press(r, 'preview.field', { locationX: W / 2, locationY: H / 2 });
    expect(field(r).taps).toEqual([...sceneTaps(SCENES, 'three').slice(1), { x: 0, y: 0 }]);
    press(r, 'preview.scene');
    expect(field(r).taps).toEqual([]);
  });

  it('clear takes the taps back to the scene\'s own', () => {
    const r = mount();
    layoutAs(r);
    press(r, 'preview.scene');
    press(r, 'preview.field', { locationX: W / 2, locationY: H / 2 });
    expect(field(r).taps).toHaveLength(2);
    press(r, 'preview.clear');
    expect(field(r).taps).toEqual(sceneTaps(SCENES, 'one.joy'));
  });
});
