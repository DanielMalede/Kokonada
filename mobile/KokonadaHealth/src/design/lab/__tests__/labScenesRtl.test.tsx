/// <reference types="node" />
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { I18nManager, PixelRatio, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// UI-242: every lab scene that places a View by `left`, `right` or row order must land it where it would land on a
// left-to-right phone, since the harness reads probes in physical px and the owner's phone is he-IL (isRTL true). Each
// scene component of the catalogue is mounted through the real LabRoot, laid out by the lab's one Yoga model
// (__fixtures__/yogaRtl.ts) under RTL and under LTR, and every probe and every View placed by its sides or its row order
// must have the same frame in both. The scenes that place Views that way are listed, and each has its own RTL test on the
// shared model. FieldView, FieldFallback and FieldSurface are the app's, not the lab's layout: they are stubbed here (they
// draw through Skia, which does not mirror), so only the lab's own Views are laid out.
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  const RNView = require('react-native').View;
  return {
    __esModule: true,
    default: { View: RNView },
    View: RNView,
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ get value() { return fn(); } }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedReaction: () => {},
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(...args),
    useFrameCallback: () => {
      const ref = useRef({ isActive: false, callbackId: -1, setActive(a: boolean) { ref.current.isActive = a; } });
      return ref.current;
    },
  };
});
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());
jest.mock('../../v2/field/effect.ts', () => ({ fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }) }));
jest.mock('../../v2/field/FieldView', () => ({ FieldView: () => null }));
jest.mock('../../v2/field/FieldFallback', () => ({ FieldFallback: () => null }));
jest.mock('../../v2/field/FieldSurface', () => ({ FieldSurface: () => null }));

import { LabRoot } from '../LabRoot';
import { SCENES } from '../scenes';
import { flat, frameOf, hostChildren, layoutRules, type Box, type Node } from './__fixtures__/yogaRtl';

const K = 2.625;
const W = 1080 / K;
const H = 2340 / K;
const STAGE: Box = { x: 0, y: 0, width: W, height: H };

/** One scene id per scene component, in catalogue order. */
const BY_COMPONENT = new Map<string, string>();
for (const [id, scene] of Object.entries(SCENES)) {
  const name = scene.Component.name;
  if (!BY_COMPONENT.has(name)) BY_COMPONENT.set(name, id);
}

const isHost = (n: Node) => typeof n.type === 'string';
const parentHost = (n: Node): Node | null => {
  for (let p = n.parent; p !== null; p = p.parent) if (isHost(p)) return p;
  return null;
};
const inFlow = (n: Node) => flat(n.props.style).position !== 'absolute';

/** Placed by its sides: absolute, and not the same inset on both sides (absolute fill is symmetric). */
function placedBySide(n: Node): boolean {
  const s = flat(n.props.style);
  if (s.position !== 'absolute') return false;
  const L = s.left ?? s.start;
  const R = s.right ?? s.end;
  return !(L !== undefined && R !== undefined && L === R);
}
/** Placed by row order: an in-flow child of a row with more than one in-flow child. */
function placedByRow(n: Node): boolean {
  const p = parentHost(n);
  return p !== null && flat(p.props.style).flexDirection === 'row' && inFlow(n) && hostChildren(p).filter(inFlow).length > 1;
}

function mountScene(scene: string, rtl: boolean) {
  jest.replaceProperty(I18nManager, 'isRTL', rtl);
  const rules = layoutRules(I18nManager);
  let r!: ReactTestRenderer.ReactTestRenderer;
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow').mockImplementation(function (this: { props: { nativeID?: string } }, cb: unknown) {
    const host = r.root.find((n) => isHost(n) && n.props.nativeID === this.props.nativeID);
    const f = frameOf(host, STAGE, rules);
    (cb as (...v: number[]) => void)(f.x, f.y, f.width, f.height);
  });
  const events = { addListener: () => ({ remove: () => {} }) };
  const lines: string[] = [];
  act(() => {
    r = ReactTestRenderer.create(
      <LabRoot
        labArgs={{ run: 'r', scene, clock: 'fixed', t: '0', frames: '3' }}
        nonStringKeys={[]}
        deps={{ emit: (l) => lines.push(l), frames: { next: () => () => {} }, events, reduceMotion: { current: () => new Promise(() => {}), subscribe: () => () => {} } }}
      />,
    );
  });
  // The scene's measured view gets the stage's size, so everything it places only once it has a size is placed.
  for (const v of r.root.findAll((n) => !isHost(n) && typeof n.props.testID === 'string' && n.props.testID.endsWith('scene.view') && typeof n.props.onLayout === 'function')) {
    act(() => v.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: H } } }));
  }
  act(() => { for (const p of r.root.findAll((n) => isHost(n) && String(n.props.nativeID ?? '').startsWith('probe-'))) p.props.onLayout({ nativeEvent: { layout: {} } }); });
  const hosts = r.root.findAll(isHost);
  const key = (n: Node) => String(n.props.nativeID ?? n.props.testID ?? `host-${hosts.indexOf(n)}`);
  const placed = hosts.filter((n) => String(n.props.nativeID ?? '').startsWith('probe-') || placedBySide(n) || placedByRow(n));
  const frames = Object.fromEntries(placed.map((n) => [key(n), frameOf(n, STAGE, rules)]));
  const bySideOrRow = hosts.some((n) => placedBySide(n) || placedByRow(n));
  const errors = lines.filter((l) => l.startsWith('KOKONADA_LAB ERROR '));
  act(() => r.unmount());
  return { frames, bySideOrRow, errors };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(PixelRatio, 'get').mockReturnValue(K);
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('has cases: every scene component of the catalogue', () => {
  expect([...BY_COMPONENT.keys()].sort()).toEqual(['CostScene', 'FallbackScene', 'FieldScene', 'GrainScene', 'SmokeScene', 'StormScene', 'WitnessScene']);
});

describe.each([...BY_COMPONENT.entries()])('%s (%s)', (_name, scene) => {
  it('every probe and every View placed by its sides or its row order lands at the same frame under RTL as under LTR', () => {
    const rtl = mountScene(scene, true);
    const ltr = mountScene(scene, false);
    expect([rtl.errors, ltr.errors]).toEqual([[], []]);
    expect(Object.keys(rtl.frames).length).toBeGreaterThan(0);
    expect(rtl.frames).toEqual(ltr.frames);
  });
});

// The list UI-242 asks for, kept true by the catalogue: the scenes that place a View by its sides or its row order, each
// pinned by its own RTL test on the shared model (what lands where, and why the pin is the scene's own).
const RTL_TESTS: Readonly<Record<string, string>> = {
  GrainScene: 'GrainSceneRtl.test.tsx',
  StormScene: 'stormSceneRtl.test.tsx',
  WitnessScene: 'WitnessSceneRtl.test.tsx',
};

it('the scenes that place a View by its sides or its row order are exactly the grain, storm and witness scenes', () => {
  const placing = [...BY_COMPONENT.entries()].filter(([, id]) => mountScene(id, true).bySideOrRow).map(([name]) => name).sort();
  expect(placing).toEqual(Object.keys(RTL_TESTS).sort());
});

it.each(Object.entries(RTL_TESTS))('%s has its own RTL test (%s), on the shared model, under isRTL', (name, file) => {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  expect(src).toContain("from './__fixtures__/yogaRtl'");
  expect(src).toContain(`import { ${name}`);
  expect(src).toMatch(/replaceProperty\(I18nManager, 'isRTL'/);
});

it('no lab test carries its own copy of the layout model', () => {
  const copies = fs.readdirSync(__dirname).filter((f) => /\.test\.tsx?$/.test(f))
    .filter((f) => /function (frameOf|stripFrame|directionOf)\(/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  expect(copies).toEqual([]);
});
