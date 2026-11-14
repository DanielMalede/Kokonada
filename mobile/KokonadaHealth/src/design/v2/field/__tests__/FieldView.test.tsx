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
//   · the still tier runs one fadeReduced ramp and its frames until the spacing since that start has passed
//     (L19), then stops them until an input changes;
//   · it draws through FieldSurface, an sRGB canvas that is not opaque (fork 2, C1).
//
// The Reanimated fake is stateful, as in fieldClock.test.tsx: SharedValues persist, a frame callback is
// registered per identity, only active callbacks run, and each frame carries a rising timestamp. runOnJS
// is counted, so every crossing from the UI thread to JS is seen. A test may defer those crossings (ui.deferred), as
// the real hop to JS can land after a JS effect has run (resilience T10 RA-22).
const ui = { runOnJS: 0, timestamp: 0, deferred: null as null | Array<() => void> };
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
      if (ui.deferred !== null) ui.deferred.push(() => fn(...args));
      else fn(...args);
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

// FieldFallback records its picture through Skia on the JS thread: here every Skia call is taken and draws nothing, so
// its real model runs on FieldView's real props. Its pixels are held in real Skia (FieldFallback.skia.test.tsx).
jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const inert: unknown = new Proxy(function stub() {}, { get: () => inert, apply: () => inert });
  return {
    Canvas: Stub,
    Image: () => null,
    Picture: () => null,
    FilterMode: { Nearest: 0, Linear: 1 },
    MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
    ClipOp: { Difference: 0, Intersect: 1 },
    TileMode: { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 },
    Skia: inert,
  };
});

// The effect: ready, or (per test) the fallback effect.ts gives when the shader cannot draw.
const effectState: { status: 'ready' | 'fallback' } = { status: 'ready' };
jest.mock('../effect.ts', () => ({
  fieldEffect: () => (effectState.status === 'ready'
    ? { status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }
    : { status: 'fallback', reason: 'the field shader did not compile' }),
}));

// The real builder, every call counted.
const counts = { build: 0, tMs: [] as number[] };
jest.mock('../fieldFrame.ts', () => {
  const actual = jest.requireActual('../fieldFrame.ts');
  return { ...actual, buildFieldFrame: (...args: unknown[]) => { counts.build += 1; counts.tMs.push((args[0] as { tMs: number }).tMs); return actual.buildFieldFrame(...args); } };
});

import { useRealtimeFieldClock } from '../../clock/fieldClock.ts';
import { BASE } from '../../tokens/tokens.generated.ts';
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
  counts.tMs = [];
  ui.runOnJS = 0;
  ui.deferred = null;
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

  // T13 (the designer's Q2, Q5; UI-204): the fallback draws from the props themselves: the newest tap that carries a lobe,
  // the layout as the root measured it (every quiet rect, no clamp to six) and each presence as given (never sanitised).
  // The effect's failure gives the fallback from the mount, whatever the taps (with taps, a planted over-demand of rest
  // lobes would not throw: the rest lobes are faded out of the frame).
  it('the fallback is given what it draws from: the direction, face, statics, taps, the measured layout, pxPerDp and the presence as given', () => {
    effectState.status = 'fallback';
    const statics: FieldStatics = { ...STATICS };
    const quietRects = Array.from({ length: 8 }, (_, i) => ({ x: 10 + 20 * i, y: 10, width: 12, height: 12 }));
    const layout = { ...baseProps().layout, quietRects };
    const quietPresence = [Number.NaN, 1, 0, 1, 1, 1, 1, 1];
    const taps = [A, B];
    const r = mount(baseProps({ face: 'light', statics, taps, layout, quietPresence }));
    const fallback = r.root.findByType(FieldFallback);
    expect(fallback.props.direction).toBe(ID);
    expect(fallback.props.face).toBe('light');
    expect(fallback.props.statics).toBe(statics);
    expect(fallback.props.taps).toBe(taps);
    expect(fallback.props.layout).toBe(layout);
    expect(fallback.props.layout.quietRects).toHaveLength(8);
    expect(fallback.props.pxPerDp).toBe(2.625);
    expect(fallback.props.quietPresence).toBe(quietPresence);
  });
});

describe('the still tier (reduced motion): one fadeReduced ramp, frames until the spacing has passed, then stop', () => {
  it('draws the still once and stops its frames; a taps change wakes it for one ramp and the spacing after its start, then it stops again', () => {
    const r = mount(baseProps({ tier: 'still', taps: [A] }));
    frames(3);
    expect(reanimated.__active()).toBe(0);
    const still = counts.build;
    expect(still).toBeGreaterThanOrEqual(1);
    frames(20);
    expect(counts.build).toBe(still);
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A, B] })} />));
    expect(reanimated.__active()).toBe(1);
    frames(60);
    expect(reanimated.__active()).toBe(0);
    expect(placementFades(uniformsOf(r)!)).toEqual([1, 1]);
    // L19 (architect T5 r1 §5): one ramp of fadeReduced (150 ms), then frames until the spacing since its start
    // (motion.settle, 600 ms) has passed, at 16 ms frames: 38 or so, a frame either side, then no more.
    expect(counts.build - still).toBeGreaterThanOrEqual(Math.floor(600 / 16));
    expect(counts.build - still).toBeLessThanOrEqual(Math.ceil(600 / 16) + 2);
  });

  // L19: the frames that stop while the still is idle are skipped, so the first frame after a pause moves the
  // ledger's clock by one clamped step; with the spacing passed before the stop, it starts the crossfade.
  it('a taps change after a long pause starts its crossfade on the first frame', () => {
    const C = { x: -0.5, y: 0.45 };
    const starts: number[] = [];
    const onStart = (n: number) => starts.push(n);
    const r = mount(baseProps({ tier: 'still', taps: [A], onStart }));
    frames(3);
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A, B], onStart })} />));
    frames(60);
    expect(reanimated.__active()).toBe(0);
    expect(starts).toEqual([1]);
    frames(300);
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A, B, C], onStart })} />));
    frames(1);
    expect(starts).toEqual([1, 1]);
  });

  // RA-22 (resilience T10, UI-195): the lost wake-up. The UI thread decides idle on the input it has and queues the sleep
  // to JS; a taps change lands first and wakes the field, though awake is still true, so setAwake(true) changes nothing;
  // then the stale sleep lands. It must not stop the frames with the new taps unread.
  it('a sleep queued before a wake does not stop the frames: the new taps start their crossfade, then the field sleeps again', () => {
    const C = { x: -0.5, y: 0.45 };
    const starts: number[] = [];
    const onStart = (n: number) => starts.push(n);
    const r = mount(baseProps({ tier: 'still', taps: [A], onStart }));
    frames(3);
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A, B], onStart })} />));
    frames(30);
    expect([starts, reanimated.__active()]).toEqual([[1], 1]);
    // Every crossing to JS deferred: step until the UI thread decides idle and queues its sleep.
    ui.deferred = [];
    for (let i = 0; i < 20 && ui.deferred.length === 0; i++) act(() => reanimated.__frame(16));
    expect(ui.deferred).toHaveLength(1);
    // The taps change before the sleep lands, and wakes the field; then the stale sleep lands.
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A, B, C], onStart })} />));
    const stale = ui.deferred;
    ui.deferred = null;
    act(() => { for (const land of stale) land(); });
    frames(60);
    expect(starts).toEqual([1, 1]);
    expect(placementFades(uniformsOf(r)!)).toEqual([1, 1, 1]);
    expect(reanimated.__active()).toBe(0);
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

// RA-28 (resilience T10 re-audit, UI-202): jest runs FieldView's frame worklet as plain JS, where a React ref is live,
// so a worklet reading one passes every test here; on the device the worklet holds a frozen copy of it (the
// generation's stop would always carry 0). So no function whose body opens with 'worklet' may name an identifier
// that a useRef(…) binds; a property name (x.seq) is not a name. Read with the TypeScript compiler.
describe('no worklet in FieldView.tsx names a React ref (RA-28)', () => {
  const isWorkletFn = (fn: ts.Node) => {
    const body = (fn as ts.FunctionLikeDeclarationBase).body;
    return body !== undefined && ts.isBlock(body) && body.statements.length > 0 && ts.isExpressionStatement(body.statements[0])
      && ts.isStringLiteral(body.statements[0].expression) && body.statements[0].expression.text === 'worklet';
  };
  /** The names useRef(…) binds, the worklets, and each ref a worklet names, as `name at line n`. */
  const refsInWorklets = (source: string) => {
    const file = ts.createSourceFile('FieldView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const refs = new Set<string>();
    const worklets: ts.Node[] = [];
    const collect = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && ts.isCallExpression(node.initializer)
        && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'useRef') refs.add(node.name.text);
      if (ts.isFunctionLike(node) && isWorkletFn(node)) worklets.push(node);
      ts.forEachChild(node, collect);
    };
    collect(file);
    const isPropertyName = (id: ts.Identifier) => {
      const up = id.parent;
      return (ts.isPropertyAccessExpression(up) && up.name === id) || (ts.isPropertyAssignment(up) && up.name === id);
    };
    const offenders: string[] = [];
    for (const w of worklets) {
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && refs.has(node.text) && !isPropertyName(node)) {
          offenders.push(`${node.text} at line ${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit((w as ts.FunctionLikeDeclarationBase).body!);
    }
    return { refs: [...refs].sort(), worklets: worklets.length, offenders };
  };
  const SOURCE = fs.readFileSync(path.resolve(__dirname, '../FieldView.tsx'), 'utf8');

  it('the scan sees FieldView’s refs and its frame worklet, and no worklet names a ref', () => {
    const scan = refsInWorklets(SOURCE);
    expect(scan.refs).toEqual(['currentGeneration', 'mounted', 'seq', 'shownTaps']);
    expect(scan.worklets).toBeGreaterThan(0);
    expect(scan.offenders).toEqual([]);
  });

  it('planted: the stop sent with the ref’s generation instead of the SharedValue’s is flagged, and only it', () => {
    const from = 'runOnJS(sleep)(generation.value);';
    expect(SOURCE.split(from)).toHaveLength(2);
    const line = SOURCE.slice(0, SOURCE.indexOf(from)).split('\n').length;
    expect(refsInWorklets(SOURCE.replace(from, () => 'runOnJS(sleep)(currentGeneration.current);')).offenders).toEqual([`currentGeneration at line ${line}`]);
  });

  it('planted: a worklet reading a ref is flagged; a property of the same name is not', () => {
    const tiny = "const seq = useRef(0);\nconst f = () => { 'worklet'; return seq.current + x.seq; };\n";
    expect(refsInWorklets(tiny)).toEqual({ refs: ['seq'], worklets: 1, offenders: ['seq at line 2'] });
  });
});

// UI-171, the owner's ruling of 2026-11-14: the frame callback skips frames to the tier's cap (field.tiers.<tier>.fpsCap:
// full 120, low 60), and a skipped frame does no builder work. The field clock runs on its own frame callback, so the
// motion's speed does not depend on the cap; the ledger takes each drawn frame's own timestamp, so a skipped frame's
// time is never lost. The first frame after a mount, a tier change or a wake is always drawn.
describe('the frame cap (UI-171)', () => {
  const HZ120 = 1000 / 120;

  it('120 Hz: full builds on every frame, low on every second one', () => {
    mount(baseProps({ taps: [A] }));
    frames(24, HZ120);
    expect(counts.build).toBe(24);
    for (const r of mounted.splice(0)) act(() => r.unmount());
    counts.build = 0;
    mount(baseProps({ tier: 'low', taps: [A] }));
    frames(24, HZ120);
    expect(counts.build).toBe(12);
  });

  it('60 Hz: low builds on every frame', () => {
    mount(baseProps({ tier: 'low', taps: [A] }));
    frames(30, 1000 / 60);
    expect(counts.build).toBe(30);
  });

  it('the first frame after a tier change is drawn, though the old cadence would skip it', () => {
    const r = mount(baseProps({ tier: 'low', taps: [A] }));
    frames(1, HZ120);
    expect(counts.build).toBe(1);
    frames(1, HZ120);
    expect(counts.build).toBe(1);
    frames(1, HZ120);
    expect(counts.build).toBe(2);
    act(() => r.update(<FieldView {...baseProps({ tier: 'full', taps: [A] })} />));
    frames(1, HZ120);
    expect(counts.build).toBe(3);
    frames(4, HZ120);
    expect(counts.build).toBe(7);
    act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A] })} />));
    frames(1, HZ120);
    expect(counts.build).toBe(8);
    frames(1, HZ120);
    expect(counts.build).toBe(8);
  });

  it('the first frame after a wake (a taps change) is drawn, though the cadence would skip it', () => {
    const r = mount(baseProps({ tier: 'low', taps: [A] }));
    frames(1, HZ120);
    expect(counts.build).toBe(1);
    act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A, B] })} />));
    frames(1, HZ120);
    expect(counts.build).toBe(2);
  });

  // The real-time clock and FieldView on one display: after N seconds at 120 Hz, full and low draw the same field time
  // and the same crossfade at a frame both draw.
  function Live(props: FieldViewProps) {
    const live = useRealtimeFieldClock(BASE.field.clock.T, true);
    return <FieldView {...props} clock={live} />;
  }
  const liveRun = (tier: 'full' | 'low') => {
    counts.tMs = [];
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = ReactTestRenderer.create(<Live {...baseProps({ tier, taps: [A] })} />); });
    mounted.push(r);
    frames(120, HZ120);
    act(() => r.update(<Live {...baseProps({ tier, taps: [A, B] })} />));
    // 37 frames: the last is one low draws too (the change's frame is drawn, then every second one)
    frames(37, HZ120);
    const out = { t: counts.tMs[counts.tMs.length - 1], fades: placementFades(uniformsOf(r)!), builds: counts.tMs.length };
    for (const m of mounted.splice(0)) act(() => m.unmount());
    return out;
  };

  it('after 1.3 s at 120 Hz, full and low stand at the same field time and the same crossfade', () => {
    const full = liveRun('full');
    const low = liveRun('low');
    expect(full.builds).toBe(157);
    expect(low.builds).toBeLessThan(full.builds);
    expect(full.t).toBeGreaterThan(1000);
    expect(low.t).toBeCloseTo(full.t, 6);
    expect(full.fades.some((f) => f > 0 && f < 1)).toBe(true);
    expect(low.fades).toHaveLength(full.fades.length);
    low.fades.forEach((f, i) => expect(f).toBeCloseTo(full.fades[i], 6));
  });
});
