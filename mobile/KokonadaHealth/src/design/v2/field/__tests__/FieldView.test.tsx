/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId } from '../../tokens/tokens.generated.ts';
import type { FieldStatics } from '../fieldFrame.ts';
import { NODE_SLOTS } from '../fieldLaw.ts';
import { staticsFor } from '../statics.ts';
import { FIELD_UNIFORMS } from '../uniforms.ts';

// T12, FieldView (state → frame; architect rerule §4 item 12, T5 r1 §5, reconciliation T5 r1):
//   · it owns seq (fork B): it takes `taps` and bumps seq when the reference changes, and the ledger
//     reads by value, so a new array of the same taps changes nothing;
//   · it is keyed by direction, face and scene: a switch mounts a fresh ledger, never bumps seq;
//   · one step per frame on the UI thread, the builder run exactly once per frame, and the JS thread never
//     reads the ledger per frame (resilience T5 r1 Q5): JS hears of a start, a stop or a failure only;
//   · a builder throw switches to FieldFallback (planted over-demand), as does an effect that cannot draw;
//   · the still tier runs one fadeReduced ramp, then stops its frames until an input changes;
//   · it draws through FieldSurface, an sRGB canvas that is not opaque (fork 2, C1).
//
// The Reanimated fake is stateful, as in fieldClock.test.tsx: SharedValues persist, a frame callback is
// registered per identity, only active callbacks run, and each frame carries a rising timestamp. runOnJS
// is counted, so every crossing from the UI thread to JS is seen.
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
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => { ui.runOnJS += 1; fn(...args); },
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

// The effect: ready, or (per test) the fallback effect.ts gives when the shader cannot draw.
const effectState: { status: 'ready' | 'fallback' } = { status: 'ready' };
jest.mock('../effect.ts', () => ({
  fieldEffect: () => (effectState.status === 'ready'
    ? { status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }
    : { status: 'fallback', reason: 'the field shader did not compile' }),
}));

// The real builder, every call counted.
const counts = { build: 0 };
jest.mock('../fieldFrame.ts', () => {
  const actual = jest.requireActual('../fieldFrame.ts');
  return { ...actual, buildFieldFrame: (...args: unknown[]) => { counts.build += 1; return actual.buildFieldFrame(...args); } };
});

import { FieldFallback } from '../FieldFallback.tsx';
import { FieldSurface } from '../FieldSurface.tsx';
import { FieldView, type FieldViewProps } from '../FieldView.tsx';
import { FIELD_SAMPLING, FieldImage } from '../fieldImage.tsx';

const ID = Object.keys(DIRECTIONS)[0] as DirectionId;
const STATICS: FieldStatics = staticsFor(ID, EXTENSIONS as never);
const A = { x: 0.5, y: 0.5 };
const B = { x: -0.5, y: -0.4 };
const clock = { t: { value: 3000 } };

const baseProps = (over: Partial<FieldViewProps> = {}): FieldViewProps => ({
  direction: ID,
  face: 'dark',
  scene: 'rest',
  statics: STATICS,
  taps: [],
  layout: { width: 360, height: 640, centre: [180, 300], radius: 160, fontScale: 1 },
  pxPerDp: 2.625,
  tier: 'full',
  stress: 0,
  confidence: 1,
  genesis: false,
  clock: clock as never,
  ...over,
});

// The packed frame's node slots, read back from the uniform layout: each slot's fade, and whether it is a placement (it has a bead).
const OFFSET: Record<string, number> = {};
FIELD_UNIFORMS.reduce((at, u) => { OFFSET[u.name] = at; return at + u.floats; }, 0);
const nodes = (u: readonly number[]) => Array.from({ length: NODE_SLOTS }, (_, k) => ({ fade: u[OFFSET[`uNode${k}`] + 3], bead: u[OFFSET[`uNode${k}Bead`] + 2] === 1 }));
const placementFades = (u: readonly number[]) => nodes(u).filter((n) => n.bead).map((n) => n.fade);

// Every mount is unmounted after its test, failed or not, so no frame callback outlives its test.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
function mount(props: FieldViewProps) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => { r = ReactTestRenderer.create(<FieldView {...props} />); });
  mounted.push(r);
  return r;
}
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
  expect(reanimated.__active()).toBe(0);
});
const frames = (n: number, dt = 16) => { for (let i = 0; i < n; i++) act(() => reanimated.__frame(dt)); };
const uniformsOf = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByType(FieldSurface).props.uniforms.value as number[] | null;

beforeEach(() => {
  counts.build = 0;
  ui.runOnJS = 0;
  effectState.status = 'ready';
});

describe('FieldView draws through FieldSurface (fork 2, C1; UI-152)', () => {
  it('one sRGB canvas, not opaque, with the bilinear FieldImage at the render size', () => {
    const r = mount(baseProps());
    const surface = r.root.findByType(FieldSurface);
    expect(surface.props.renderScale).toBe(0.5);
    expect(surface.props.renderSize).toEqual({ width: Math.ceil(360 * 2.625 * 0.5), height: Math.ceil(640 * 2.625 * 0.5) });
    const canvas = surface.findAll((n) => n.props.colorSpace !== undefined);
    expect(canvas).toHaveLength(1);
    expect(canvas[0].props.colorSpace).toBe('srgb');
    expect(canvas[0].props.opaque).toBeFalsy();
    const image = r.root.findByType(FieldImage);
    expect(image.props.rect).toEqual({ x: 0, y: 0, width: Math.ceil(360 * 2.625 * 0.5) / (2.625 * 0.5), height: Math.ceil(640 * 2.625 * 0.5) / (2.625 * 0.5) });
    expect(FIELD_SAMPLING).toEqual({ filter: 1, mipmap: 0 });
  });

  it('tier low draws at field.tiers.low.renderScale', () => {
    const r = mount(baseProps({ tier: 'low' }));
    expect(r.root.findByType(FieldSurface).props.renderScale).toBe(0.33);
  });
});

describe('one step per frame (resilience T5 r1 Q5)', () => {
  it('the builder runs exactly once per frame', () => {
    mount(baseProps({ taps: [A] }));
    expect(counts.build).toBe(0);
    frames(25);
    expect(counts.build).toBe(25);
  });

  it('the JS thread hears nothing per frame: no crossing in 100 steady frames', () => {
    const r = mount(baseProps({ taps: [A] }));
    frames(100);
    expect(ui.runOnJS).toBe(0);
    expect(uniformsOf(r)).not.toBeNull();
  });

  it('a start crosses to JS once, with the admitted count, and only at the start', () => {
    const starts: number[] = [];
    const r = mount(baseProps({ taps: [A], onStart: (admitted) => starts.push(admitted) }));
    frames(5);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart: (admitted) => starts.push(admitted) })} />));
    frames(60);
    expect(starts).toEqual([1]);
    expect(ui.runOnJS).toBe(1);
  });

  it('static pin: every read of the ledger SharedValue in FieldView.tsx is inside a worklet', () => {
    const file = path.resolve(__dirname, '../FieldView.tsx');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const reads: Array<{ line: number; inWorklet: boolean }> = [];
    const isWorklet = (fn: ts.Node) => {
      const body = (fn as ts.FunctionLikeDeclarationBase).body;
      return body !== undefined && ts.isBlock(body) && body.statements.length > 0 && ts.isExpressionStatement(body.statements[0])
        && ts.isStringLiteral(body.statements[0].expression) && body.statements[0].expression.text === 'worklet';
    };
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'value' && ts.isIdentifier(node.expression) && node.expression.text === 'ledger') {
        let up: ts.Node | undefined = node.parent;
        while (up && !ts.isFunctionLike(up)) up = up.parent;
        reads.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, inWorklet: up !== undefined && isWorklet(up) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((r) => !r.inWorklet)).toEqual([]);
  });
});

describe('FieldView owns seq (architect T5 r1, fork B)', () => {
  it('a mount shows its taps at once, at fade 1', () => {
    const r = mount(baseProps({ taps: [A, B] }));
    frames(1);
    expect(placementFades(uniformsOf(r)!)).toEqual([1, 1]);
  });

  it('a new array of the same taps changes nothing: no start, the same frame', () => {
    const starts: number[] = [];
    const r = mount(baseProps({ taps: [A], onStart: (n) => starts.push(n) }));
    frames(3);
    const before = uniformsOf(r);
    act(() => r.update(<FieldView {...baseProps({ taps: [{ ...A }], onStart: (n) => starts.push(n) })} />));
    frames(30);
    expect(starts).toEqual([]);
    expect(uniformsOf(r)).toEqual(before);
  });

  it('a changed taps prop crossfades: the new placement rises from 0, never pops in', () => {
    const r = mount(baseProps({ taps: [A] }));
    frames(3);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B] })} />));
    frames(2);
    const mid = placementFades(uniformsOf(r)!);
    expect(mid).toHaveLength(2);
    expect(mid.some((f) => f > 0 && f < 1)).toBe(true);
    frames(60);
    expect(placementFades(uniformsOf(r)!)).toEqual([1, 1]);
  });
});

describe('keyed by direction, face and scene: a switch mounts a fresh ledger', () => {
  it('a scene switch shows the new taps at once; the same scene crossfades them', () => {
    const r = mount(baseProps({ taps: [A] }));
    frames(3);
    act(() => r.update(<FieldView {...baseProps({ scene: 'three', taps: [A, B] })} />));
    frames(1);
    expect(placementFades(uniformsOf(r)!)).toEqual([1, 1]);
  });

  it('a face switch mounts afresh (the ledger’s rest table is the face’s: dark and light differ)', () => {
    expect(STATICS.restLobes.dark.length).not.toBe(STATICS.restLobes.light.length);
    const r = mount(baseProps({ taps: [A] }));
    frames(3);
    const first = r.root.findByType(FieldSurface).props.uniforms;
    act(() => r.update(<FieldView {...baseProps({ face: 'light', taps: [A, B] })} />));
    expect(r.root.findByType(FieldSurface).props.uniforms).not.toBe(first);
    frames(1);
    expect(placementFades(uniformsOf(r)!)).toEqual([1, 1]);
  });
});

describe('FieldFallback when the field cannot draw (architect T5 r1 §5)', () => {
  it('planted over-demand (statics with seven rest lobes): the first frame’s builder throw switches to FieldFallback, and the frames stop', () => {
    const planted: FieldStatics = { ...STATICS, restLobes: { dark: Array.from({ length: 7 }, (_, i) => [0.1 * i - 0.3, 0.2] as const), light: STATICS.restLobes.light } };
    const r = mount(baseProps({ statics: planted }));
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(0);
    frames(1);
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(1);
    expect(r.root.findAllByType(FieldSurface)).toHaveLength(0);
    expect(reanimated.__active()).toBe(0);
    const built = counts.build;
    frames(10);
    expect(counts.build).toBe(built);
  });

  it('the control: the shipped statics keep the field', () => {
    const r = mount(baseProps());
    frames(10);
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(0);
  });

  it('an effect that cannot draw gives FieldFallback from the start, and no frames run', () => {
    effectState.status = 'fallback';
    const r = mount(baseProps());
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(1);
    frames(5);
    expect(counts.build).toBe(0);
  });
});

describe('the still tier (reduced motion): one fadeReduced ramp, then stop', () => {
  it('draws the still once and stops its frames; a taps change wakes it for one ramp, then it stops again', () => {
    const r = mount(baseProps({ tier: 'still', taps: [A] }));
    frames(3);
    expect(reanimated.__active()).toBe(0);
    const still = counts.build;
    expect(still).toBeGreaterThanOrEqual(1);
    frames(20);
    expect(counts.build).toBe(still);
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A, B] })} />));
    expect(reanimated.__active()).toBe(1);
    frames(30);
    expect(reanimated.__active()).toBe(0);
    expect(placementFades(uniformsOf(r)!)).toEqual([1, 1]);
    // One ramp of fadeReduced (150 ms) at 16 ms frames, a frame or two either side, then no more.
    expect(counts.build - still).toBeGreaterThanOrEqual(10);
    expect(counts.build - still).toBeLessThanOrEqual(13);
  });

  it('the moving tiers never stop', () => {
    mount(baseProps({ tier: 'full', taps: [A] }));
    frames(50);
    expect(reanimated.__active()).toBe(1);
  });
});

describe('the quiet zones at the boundary', () => {
  it('eight measured rects and a NaN presence draw (clamped to six, NaN as 1), never the fallback', () => {
    const quietRects = Array.from({ length: 8 }, (_, i) => ({ x: 10 + 20 * i, y: 10, width: 12, height: 12 }));
    const r = mount(baseProps({ layout: { ...baseProps().layout, quietRects }, quietPresence: [Number.NaN, 1, 1, 1, 1, 1, 1, 1] }));
    frames(3);
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(0);
    const u = uniformsOf(r)!;
    expect(u[OFFSET.uQuietParams + 2]).toBe(6);
    expect(u[OFFSET.uQuietOn0]).toBe(1);
  });
});
