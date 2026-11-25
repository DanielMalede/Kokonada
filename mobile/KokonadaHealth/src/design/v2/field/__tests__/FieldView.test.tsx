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
import { renderScaleFor } from '../fieldDriver.ts';
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
    expect(scan.refs).toEqual(['currentGeneration', 'fallbackLedger', 'forcedDraws', 'listener', 'mounted', 'seq', 'shownLayout', 'shownTaps']);
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

  // RA-39 (resilience B4 re-audit, UI-229; the designer's ruling): only a change of the taps or of the layout (the size,
  // pxPerDp, the plate's centre and radius, the font scale, the quiet rects; the render scale with them) is drawn at once:
  // the rim, the words and the beads move on the same layout pass, so a field that waited for the cap would tear for a
  // frame. Every other prop (stress, confidence, genesis, the quiet presence values) waits for the cap's next frame, so a
  // prop animated from JS on every frame cannot lift the low tier off its cap. A wake still wakes (RA-22), and the first
  // frame after a wake from sleep is drawn.
  const QUIET = [{ x: 20, y: 20, width: 40, height: 20 }, { x: 200, y: 500, width: 60, height: 30 }];
  const quietLayout = { ...baseProps().layout, quietRects: QUIET };
  /** A prop changed before each of 24 frames at 120 Hz; the builds counted. */
  const storm = (tier: 'full' | 'low', over: (i: number) => Partial<FieldViewProps>) => {
    const r = mount(baseProps({ tier, taps: [A], ...over(0) }));
    for (let i = 1; i <= 24; i++) {
      act(() => r.update(<FieldView {...baseProps({ tier, taps: [A], ...over(i) })} />));
      act(() => reanimated.__frame(HZ120));
    }
    const builds = counts.build;
    for (const m of mounted.splice(0)) act(() => m.unmount());
    counts.build = 0;
    return builds;
  };
  const STORMS: Record<string, (i: number) => Partial<FieldViewProps>> = {
    // every storm passes the same taps in a new array each render, as a root that rebuilds them would
    'the same taps, a new array every render': () => ({}),
    stress: (i) => ({ stress: i / 24 }),
    confidence: (i) => ({ confidence: (i % 10) / 10 }),
    genesis: (i) => ({ genesis: i % 2 === 0 }),
    'quiet presence values': (i) => ({ layout: quietLayout, quietPresence: [i / 24, 1 - i / 24] }),
    'every one of them at once': (i) => ({ stress: i / 24, confidence: (i % 10) / 10, genesis: i % 2 === 0, layout: quietLayout, quietPresence: [i / 24, 1 - i / 24] }),
    'the same layout, a new object every render': () => ({ layout: { ...quietLayout, centre: [180, 300], quietRects: QUIET.map((q) => ({ ...q })) } }),
  };

  it('RA-39: a prop that changes on every 120 Hz frame keeps the low tier on its cap: at most 13 builds of 24', () => {
    for (const [name, over] of Object.entries(STORMS)) {
      const builds = storm('low', over);
      expect([name, builds >= 12 && builds <= 13]).toEqual([name, true]);
    }
  });

  it('RA-39: at full nothing changes: the same storms build on every frame', () => {
    for (const [name, over] of Object.entries(STORMS)) expect([name, storm('full', over)]).toEqual([name, 24]);
  });

  it('RA-39: a stress change on a frame the cap skips is drawn on the next frame the cap allows', () => {
    const weight = (u: readonly number[]) => u.slice(OFFSET.uWeight, OFFSET.uWeight + 4);
    const r = mount(baseProps({ tier: 'low', taps: [A] }));
    frames(1, HZ120);
    const before = uniformsOf(r)!;
    act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A], stress: 1 })} />));
    frames(1, HZ120);
    expect(counts.build).toBe(1);
    expect(uniformsOf(r)).toBe(before);
    frames(1, HZ120);
    expect(counts.build).toBe(2);
    expect(weight(uniformsOf(r)!)).not.toEqual(weight(before));
    // and it is the stressed frame: the same as a field mounted at stress 1
    const settled = weight(uniformsOf(r)!);
    for (const m of mounted.splice(0)) act(() => m.unmount());
    const fresh = mount(baseProps({ tier: 'low', taps: [A], stress: 1 }));
    frames(1, HZ120);
    expect(weight(uniformsOf(fresh)!)).toEqual(settled);
  });

  it('RA-39: a taps change is still drawn on its first frame, in the middle of a stress storm', () => {
    const r = mount(baseProps({ tier: 'low', taps: [A] }));
    frames(1, HZ120);
    act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A], stress: 0.5 })} />));
    frames(1, HZ120);
    expect(counts.build).toBe(1);
    act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A, B], stress: 0.6 })} />));
    frames(1, HZ120);
    expect(counts.build).toBe(2);
    act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A, B], stress: 0.7 })} />));
    frames(1, HZ120);
    expect(counts.build).toBe(2);
  });

  it('RA-39: each layout change at low is drawn on its first frame, though the cadence would skip it', () => {
    const base = baseProps().layout;
    const layouts: Array<Partial<FieldViewProps>> = [
      { layout: { ...base, width: 640, height: 360 } },
      { layout: { ...base, centre: [180, 280] } },
      { layout: { ...base, radius: 150 } },
      { layout: { ...base, fontScale: 1.3 } },
      { layout: { ...base, quietRects: QUIET } },
      { layout: { ...base, quietRects: [QUIET[0], { ...QUIET[1], y: 300 }] } },
      { layout: { ...base, quietRects: [QUIET[0]] } },
      { layout: base, pxPerDp: 3 },
      { layout: base, pxPerDp: 3, renderScale: 0.4 },
    ];
    const r = mount(baseProps({ tier: 'low', taps: [A] }));
    frames(1, HZ120);
    layouts.forEach((over, i) => {
      act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A], ...over })} />));
      frames(1, HZ120);
      expect([i, counts.build]).toEqual([i, i + 2]);
    });
    // and with the layout held, the cap again
    frames(4, HZ120);
    expect(counts.build).toBe(layouts.length + 1 + 2);
    // and a stress change under the last layout, on a frame the cap skips, waits: the layout shown is that one now
    act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A], ...layouts[layouts.length - 1], stress: 0.5 })} />));
    frames(1, HZ120);
    expect(counts.build).toBe(layouts.length + 1 + 2);
  });

  it('RA-39: a still field asleep, woken by a stress change, draws on its first frame', () => {
    const r = mount(baseProps({ tier: 'still', taps: [A] }));
    frames(3);
    expect(reanimated.__active()).toBe(0);
    const asleep = counts.build;
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A], stress: 0.8 })} />));
    expect(reanimated.__active()).toBe(1);
    frames(1);
    expect(counts.build).toBe(asleep + 1);
  });

  // Only the still tier sleeps, so a capped tier is woken from sleep only by the tier change itself. The still's frames
  // leave the cap no schedule, so the first frame of the capped tier is drawn however soon it comes after the last
  // capped draw: here 4 ms after it, inside the period the old low schedule would still skip. (Low's render scale is
  // not the still's, so here the layout pass forces the frame too; the full case below has only the schedule.)
  it('RA-39: low, then asleep at still, then woken to low 4 ms after the last low draw: that first frame is drawn', () => {
    const r = mount(baseProps({ tier: 'low', taps: [A] }));
    frames(1, HZ120);
    expect(counts.build).toBe(1);
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A] })} />));
    frames(1, 2);
    expect([counts.build, reanimated.__active()]).toEqual([2, 0]);
    act(() => r.update(<FieldView {...baseProps({ tier: 'low', taps: [A] })} />));
    expect(reanimated.__active()).toBe(1);
    frames(1, 2);
    expect(counts.build).toBe(3);
    // and low's cadence from that frame
    frames(1, HZ120);
    expect(counts.build).toBe(3);
    frames(1, HZ120);
    expect(counts.build).toBe(4);
  });

  // The same at full, where the still's render scale is full's own, so no layout pass forces the frame: only the empty
  // schedule the still left does. 4 ms after the last full draw, the old full schedule would still skip.
  it('RA-39: full, then asleep at still, then woken to full 4 ms after the last full draw: that first frame is drawn', () => {
    expect(renderScaleFor('still')).toBe(renderScaleFor('full'));
    const r = mount(baseProps({ tier: 'full', taps: [A] }));
    frames(1, HZ120);
    expect(counts.build).toBe(1);
    act(() => r.update(<FieldView {...baseProps({ tier: 'still', taps: [A] })} />));
    frames(1, 2);
    expect([counts.build, reanimated.__active()]).toEqual([2, 0]);
    act(() => r.update(<FieldView {...baseProps({ tier: 'full', taps: [A] })} />));
    expect(reanimated.__active()).toBe(1);
    frames(1, 2);
    expect(counts.build).toBe(3);
  });
});

// DEC-174's CTA hears the field's starts (the architect's F10 G8 rulings, Q1: option A, filtered by option 1b). The
// frame worklet reads the start's target from the ledger (admittedLive) and sends it with the admitted count in one hop,
// runOnJS(deliverStart)(admitted, live). deliverStart reads the listener through a ref, so a new onStart never re-makes
// the worklet (F7); it drops a start that lands after the unmount; and it keeps only what the taps FieldView last wrote
// still hold (stillLive). The signature is additive: a listener that takes the count alone still hears it (the legacy
// tests above, unedited).
describe('the start carries its live placements to the CTA (T1–T6, the architect’s Q1)', () => {
  type LivePlacement = import('../placementLedger.ts').LivePlacement;
  const { mountedLive } = require('../placementLedger.ts') as typeof import('../placementLedger.ts');
  const C = { x: -0.5, y: 0.45 };
  const at = (id: number, t: { x: number; y: number }): LivePlacement => ({ id, x: t.x, y: t.y });
  const listen = () => {
    const calls: Array<[number, readonly LivePlacement[]]> = [];
    return { calls, onStart: (admitted: number, live: readonly LivePlacement[]) => { calls.push([admitted, live]); } };
  };
  /** Steps frames with every crossing to JS held back until one is queued, and returns its landing. */
  const holdOneCrossing = () => {
    ui.deferred = [];
    for (let i = 0; i < 10 && ui.deferred.length === 0; i++) act(() => reanimated.__frame(16));
    const queued = ui.deferred;
    ui.deferred = null;
    expect(queued).toHaveLength(1);
    return () => act(() => { for (const land of queued) land(); });
  };

  it('T1: a start hands onStart its admitted count and the target’s store-live placements, in one crossing: [A] → [A, B] is (1, [A0, B1]); a pop is (1, [A0])', () => {
    const { calls, onStart } = listen();
    const r = mount(baseProps({ taps: [A], onStart }));
    frames(5);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart })} />));
    frames(60);
    expect(calls).toEqual([[1, [at(0, A), at(1, B)]]]);
    act(() => r.update(<FieldView {...baseProps({ taps: [A], onStart })} />));
    frames(60);
    expect(calls).toEqual([[1, [at(0, A), at(1, B)]], [1, [at(0, A)]]]);
    expect(ui.runOnJS).toBe(2);
  });

  it('T2: onStart is read through a ref: a new listener on every render keeps one frame worklet, and the newest one hears the start', () => {
    const module = require('react-native-reanimated') as { useFrameCallback: (...args: unknown[]) => unknown };
    const spy = jest.spyOn(module, 'useFrameCallback');
    try {
      const heard: string[] = [];
      const r = mount(baseProps({ taps: [A], onStart: () => { heard.push('first'); } }));
      frames(3);
      for (let i = 0; i < 3; i++) act(() => r.update(<FieldView {...baseProps({ taps: [A], onStart: () => { heard.push(`render ${i}`); } })} />));
      act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart: () => { heard.push('newest'); } })} />));
      frames(60);
      expect(heard).toEqual(['newest']);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(5);
      expect(new Set(spy.mock.calls.map((c) => c[0])).size).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('T3: a start whose hop lands after the unmount reaches nobody; React’s simulated unmount and remount (StrictMode) keeps the listener', () => {
    const gone = listen();
    const r = mount(baseProps({ taps: [A], onStart: gone.onStart }));
    frames(3);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart: gone.onStart })} />));
    const land = holdOneCrossing();
    act(() => r.unmount());
    mounted.splice(mounted.indexOf(r), 1);
    land();
    expect(gone.calls).toEqual([]);

    const strict = listen();
    let s!: ReactTestRenderer.ReactTestRenderer;
    act(() => { s = ReactTestRenderer.create(<React.StrictMode><FieldView {...baseProps({ taps: [A], onStart: strict.onStart })} /></React.StrictMode>); });
    mounted.push(s);
    frames(3);
    act(() => s.update(<React.StrictMode><FieldView {...baseProps({ taps: [A, B], onStart: strict.onStart })} /></React.StrictMode>));
    frames(60);
    expect(strict.calls).toEqual([[1, [at(0, A), at(1, B)]]]);
  });

  it('T4: a start whose hop lands after an undo carries only what the taps FieldView last wrote still hold', () => {
    const { calls, onStart } = listen();
    const r = mount(baseProps({ taps: [A], onStart }));
    frames(3);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart })} />));
    const land = holdOneCrossing();
    act(() => r.update(<FieldView {...baseProps({ taps: [A], onStart })} />));
    land();
    expect(calls).toEqual([[1, [at(0, A)]]]);
    // and the start the undo makes next carries the store as it is
    frames(60);
    expect(calls).toEqual([[1, [at(0, A)]], [1, [at(0, A)]]]);
  });

  it('T5: a face switch mounts a fresh ledger: the old one’s start in flight is dropped, and the new one numbers its placements as mountedLive does', () => {
    const { calls, onStart } = listen();
    const r = mount(baseProps({ taps: [A], onStart }));
    frames(3);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart })} />));
    const land = holdOneCrossing();
    act(() => r.update(<FieldView {...baseProps({ face: 'light', taps: [A, B], onStart })} />));
    land();
    expect(calls).toEqual([]);
    frames(3);
    expect(calls).toEqual([]);
    act(() => r.update(<FieldView {...baseProps({ face: 'light', taps: [A, B, C], onStart })} />));
    frames(60);
    expect(calls).toEqual([[1, [...mountedLive([A, B]), at(2, C)]]]);
  });

  // F7, read from the source: the frame worklet's dependency list names no onStart (only deliverStart, which reads it
  // through the ref), so a page that passes an inline listener never re-makes the worklet.
  it('T6: the frame worklet’s dependencies name deliverStart and never onStart (static, with a planted control)', () => {
    const isWorklet = (fn: ts.Node) => {
      const body = (fn as ts.FunctionLikeDeclarationBase).body;
      return body !== undefined && ts.isBlock(body) && body.statements.length > 0 && ts.isExpressionStatement(body.statements[0])
        && ts.isStringLiteral(body.statements[0].expression) && body.statements[0].expression.text === 'worklet';
    };
    /** The dependency lists of the useCallback worklets in a source, each with where its closing bracket sits. */
    const workletDeps = (source: string) => {
      const file = ts.createSourceFile('FieldView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const out: Array<{ names: string[]; close: number }> = [];
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useCallback' && n.arguments.length === 2) {
          const [fn, deps] = n.arguments;
          if (isWorklet(fn) && ts.isArrayLiteralExpression(deps)) out.push({ names: deps.elements.map((e) => e.getText(file)), close: deps.getEnd() - 1 });
        }
        ts.forEachChild(n, visit);
      };
      visit(file);
      return out;
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../FieldView.tsx'), 'utf8');
    const deps = workletDeps(source);
    expect(deps).toHaveLength(1);
    expect(deps[0].names).toContain('deliverStart');
    expect(deps[0].names).not.toContain('onStart');
    // Planted: onStart written back into the worklet's dependencies is seen.
    const planted = source.slice(0, deps[0].close) + ', onStart' + source.slice(deps[0].close);
    expect(workletDeps(planted)[0].names).toEqual([...deps[0].names, 'onStart']);
  });
});

// F1 (S1, the architect's F10 G8 findings): while FieldFallback draws, the frame worklet does not run, so no start would
// reach the CTA and it would never show. FieldView runs the same ledger on JS instead: one reconcile at each change and
// then per animation frame, only while the ledger needs frames (needsFrames), its starts delivered the same way
// (deliverStart). It builds nothing: FieldFallback draws from the props. A builder throw hands the UI thread's ledger to
// JS, so its ids and its spacing carry on, and the start of the frame that threw is still heard. F5: `active` (default
// true) gates every frame, the UI thread's and the fallback's, so a blurred page (P10) draws nothing; the ledger reads
// the taps written meanwhile on its first frame once active again. The animation frames run on jest's fake timers.
describe('fallback starts (F1) and the active gate (F5)', () => {
  type LivePlacement = import('../placementLedger.ts').LivePlacement;
  const SETTLE = BASE.motion.settle.duration;
  const C = { x: -0.5, y: 0.45 };
  const at = (id: number, t: { x: number; y: number }): LivePlacement => ({ id, x: t.x, y: t.y });
  const listen = () => {
    const calls: Array<[number, readonly LivePlacement[]]> = [];
    const times: number[] = [];
    const onStart = (admitted: number, live: readonly LivePlacement[]) => {
      calls.push([admitted, live]);
      times.push(performance.now());
    };
    return { calls, times, onStart };
  };
  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    for (const r of mounted.splice(0)) act(() => r.unmount());
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('F1: in fallback a start still reaches onStart, [A] → [A, B] is (1, [A0, B1]); frames are asked for only while the ledger needs them, and nothing is built', () => {
    effectState.status = 'fallback';
    const { calls, onStart } = listen();
    const r = mount(baseProps({ taps: [A], onStart }));
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
    advance(1000);
    expect(calls).toEqual([]);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart })} />));
    expect(calls).toEqual([[1, [at(0, A), at(1, B)]]]);
    expect(jest.getTimerCount()).toBe(1);
    advance(SETTLE + 100);
    expect(jest.getTimerCount()).toBe(0);
    expect(calls).toHaveLength(1);
    expect(counts.build).toBe(0);
    expect(reanimated.__active()).toBe(0);
  });

  it('F1: a toggle storm in fallback: several starts, each at least motion.settle after the last, nothing built, and no frame asked for at rest', () => {
    effectState.status = 'fallback';
    const { times, onStart } = listen();
    const r = mount(baseProps({ taps: [], onStart }));
    for (let t = 0, k = 0; t < 3000; t += 17, k++) {
      act(() => r.update(<FieldView {...baseProps({ taps: k % 2 === 0 ? [A] : [], onStart })} />));
      advance(17);
    }
    advance(3 * SETTLE);
    expect(times.length).toBeGreaterThan(3);
    for (let i = 1; i < times.length; i++) expect([i, times[i] - times[i - 1] >= SETTLE]).toEqual([i, true]);
    expect(jest.getTimerCount()).toBe(0);
    expect(counts.build).toBe(0);
  });

  it('F1: a builder throw hands the UI thread’s ledger to JS: the throwing frame’s start is heard, and the next keeps the ids and waits out the spacing', () => {
    const { calls, times, onStart } = listen();
    const layout = { ...baseProps().layout, quietRects: [{ x: 10, y: 10, width: 20, height: 20 }] };
    const r = mount(baseProps({ taps: [A], layout, quietPresence: [1], onStart }));
    frames(3);
    // A presence outside [0, 1] makes the builder throw (checkQuietPresence) on the frame that starts B.
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], layout, quietPresence: [2], onStart })} />));
    frames(1);
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(1);
    expect(calls).toEqual([[1, [at(0, A), at(1, B)]]]);
    const built = counts.build;
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B, C], layout, quietPresence: [2], onStart })} />));
    advance(2 * SETTLE);
    expect(calls).toEqual([[1, [at(0, A), at(1, B)]], [1, [at(0, A), at(1, B), at(2, C)]]]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(SETTLE);
    expect(counts.build).toBe(built);
    expect(reanimated.__active()).toBe(0);
  });

  it('F5: inactive, no frame runs and nothing is built at any tier; once active, the first frame reads what changed meanwhile', () => {
    for (const tier of ['full', 'low', 'still'] as const) {
      const { calls, onStart } = listen();
      const r = mount(baseProps({ tier, taps: [A], onStart }));
      frames(3);
      const drawn = counts.build;
      act(() => r.update(<FieldView {...baseProps({ tier, taps: [A], onStart, active: false })} />));
      expect([tier, reanimated.__active()]).toEqual([tier, 0]);
      act(() => r.update(<FieldView {...baseProps({ tier, taps: [A, B], stress: 0.5, onStart, active: false })} />));
      frames(625);
      expect([tier, counts.build - drawn, reanimated.__active(), calls]).toEqual([tier, 0, 0, []]);
      act(() => r.update(<FieldView {...baseProps({ tier, taps: [A, B], stress: 0.5, onStart })} />));
      expect([tier, reanimated.__active()]).toEqual([tier, 1]);
      frames(1);
      expect([tier, counts.build - drawn, calls]).toEqual([tier, 1, [[1, [at(0, A), at(1, B)]]]]);
      for (const m of mounted.splice(0)) act(() => m.unmount());
    }
  });

  it('F5 in fallback: going inactive cancels the frame asked for and none is asked for meanwhile; active again, a crossfade carries on where it stopped, and a change made meanwhile starts at once', () => {
    effectState.status = 'fallback';
    const { calls, onStart } = listen();
    const r = mount(baseProps({ taps: [A], onStart }));
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart })} />));
    expect([calls.length, jest.getTimerCount()]).toEqual([1, 1]);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart, active: false })} />));
    expect(jest.getTimerCount()).toBe(0);
    advance(2000);
    expect(jest.getTimerCount()).toBe(0);
    // Active again: the ledger's clock stood still meanwhile (L19), so the crossfade carries on, then the frames stop.
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart })} />));
    expect(jest.getTimerCount()).toBe(1);
    advance(SETTLE + 100);
    expect(jest.getTimerCount()).toBe(0);
    // A change made while inactive is read on the first step once active, and starts at once.
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], onStart, active: false })} />));
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B, C], onStart, active: false })} />));
    advance(2000);
    expect([calls.length, jest.getTimerCount()]).toEqual([1, 0]);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B, C], onStart })} />));
    expect(calls).toEqual([[1, [at(0, A), at(1, B)]], [1, [at(0, A), at(1, B), at(2, C)]]]);
    expect(counts.build).toBe(0);
  });

  it('F1: a throw ends the UI thread’s work at once, before JS hears of it: no further build and no second handoff while the switch is in flight', () => {
    const { calls, onStart } = listen();
    const layout = { ...baseProps().layout, quietRects: [{ x: 10, y: 10, width: 20, height: 20 }] };
    const r = mount(baseProps({ taps: [A], layout, quietPresence: [1], onStart }));
    frames(3);
    act(() => r.update(<FieldView {...baseProps({ taps: [A, B], layout, quietPresence: [2], onStart })} />));
    ui.deferred = [];
    frames(1);
    const built = counts.build;
    const queued = ui.deferred.length;
    expect(queued).toBe(2); // the start, then the failure
    frames(10);
    expect([counts.build - built, ui.deferred.length]).toEqual([0, queued]);
    const landing = ui.deferred;
    ui.deferred = null;
    act(() => { for (const land of landing) land(); });
    expect(r.root.findAllByType(FieldFallback)).toHaveLength(1);
    expect(calls).toEqual([[1, [at(0, A), at(1, B)]]]);
  });
});
