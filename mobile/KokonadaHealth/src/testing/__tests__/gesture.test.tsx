/// <reference types="node" />
import React from 'react';
import * as path from 'path';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Gesture } from 'react-native-gesture-handler';
import { RadialWheel } from '../../experience/wheel/RadialWheel';
import { screenToCircumplex } from '../../experience/wheel/wheelGeometry';
import { installGestureFakes, realBuilderMethods, FAKE_BUILDER_METHODS, type FakeGesture, type GestureFakes } from '../gesture';
import { loadMutant } from '../mutant';
import { APP_ROOT } from '../guards/productionImports';

// Planting a mutant loads @babel/core inside the test VM on first use (src/testing/mutant.ts); under
// full-suite worker contention that cold load overran the 5 s default (q3-final-jest run file).
const MUTANT_TIMEOUT_MS = 30000; // given per test, only to the tests that compile a mutant (RA-235-9)

// QA-110: gesture tests fire real handler callbacks. The global mock (jest.setup.js:61-68) is a Proxy
// that accepts ANY method name and swallows every callback, so the wheel's gesture-to-commit path
// (RadialWheel.tsx:65-71) never runs in jest. The fake builders record each callback and fire them in
// RNGH's order (onBegin, onStart, onEnd(success), onFinalize(success)), respect the tap limits they
// were configured with, and accept only the builder methods the real RNGH classes have (3.4.0).
// Pass rule: QA-089's planted mutation fails: one fired gesture commits exactly one tap, and the
// wheel with runOnJS(commitTap) removed (in memory) commits none.

let gestures: GestureFakes;
beforeEach(() => { gestures = installGestureFakes(); });
afterEach(() => { gestures.restore(); });

const SIZE = 300;
function renderWheel(Wheel: typeof RadialWheel, onCommit: jest.Mock) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => { tree = ReactTestRenderer.create(<Wheel size={SIZE} committedTaps={[]} onCommit={onCommit} />); });
  return tree;
}

describe('QA-110 · the real wheel through the gesture fake', () => {
  it('one fired tap commits exactly one point, at the real geometry', () => {
    const onCommit = jest.fn();
    const tree = renderWheel(RadialWheel, onCommit);
    expect(gestures.detectors()).toBe(1);
    act(() => { gestures.tap(0, { x: SIZE * 0.75, y: SIZE * 0.25 }); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(screenToCircumplex({ x: SIZE * 0.75, y: SIZE * 0.25 }, { cx: SIZE / 2, cy: SIZE / 2, radius: SIZE / 2 }));
    act(() => { tree.unmount(); });
    expect(gestures.detectors()).toBe(0);
  });

  it('planted (QA-089): the wheel with runOnJS(commitTap) removed (in memory) commits nothing, and the check fails', () => {
    const { RadialWheel: Mutant } = loadMutant<typeof import('../../experience/wheel/RadialWheel')>(
      path.join(APP_ROOT, 'src/experience/wheel/RadialWheel.tsx'),
      [{ find: 'runOnJS(commitTap)(e.x, e.y);', replace: '' }],
      require,
    );
    const onCommit = jest.fn();
    renderWheel(Mutant, onCommit);
    act(() => { gestures.tap(0, { x: SIZE * 0.75, y: SIZE * 0.25 }); });
    expect(onCommit).not.toHaveBeenCalled();
  }, MUTANT_TIMEOUT_MS);

  it('a tap held past the wheel\'s maxDuration fails: onEnd never runs, onFinalize(false) does', () => {
    const onCommit = jest.fn();
    renderWheel(RadialWheel, onCommit);
    act(() => { gestures.tap(0, { x: SIZE * 0.75, y: SIZE * 0.25, durationMs: 10_001 }); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(gestures.lastFinalize()).toEqual({ success: false });
  });
});

describe('QA-110 · the builders are the real ones, not a Proxy', () => {
  it('fires a pan in RNGH order with translation and change', () => {
    const seen: string[] = [];
    const pan = Gesture.Pan()
      .onBegin(() => seen.push('begin'))
      .onStart(() => seen.push('start'))
      .onUpdate((e: any) => seen.push(`update ${e.translationX},${e.translationY}`))
      .onChange((e: any) => seen.push(`change ${e.changeX},${e.changeY}`))
      .onEnd((_e: any, success: boolean) => seen.push(`end ${success}`))
      .onFinalize((_e: any, success: boolean) => seen.push(`finalize ${success}`));
    gestures.pan(pan as unknown as FakeGesture, [{ x: 10, y: 10 }, { x: 20, y: 15 }, { x: 25, y: 30 }]);
    expect(seen).toEqual(['begin', 'start', 'update 10,5', 'change 10,5', 'update 15,20', 'change 5,15', 'end true', 'finalize true']);
  });

  it('an unknown builder method throws, as the real class would (the Proxy accepted anything)', () => {
    expect(() => (Gesture.Tap() as any).onDoubleTapEnd(() => {})).toThrow(/is not a function/);
  });

  it('the fake builder methods are exactly the public methods of the installed RNGH classes', () => {
    const real = realBuilderMethods();
    expect(real.Tap.length).toBeGreaterThan(20);
    expect([...FAKE_BUILDER_METHODS.Tap].sort()).toEqual(real.Tap);
    expect([...FAKE_BUILDER_METHODS.Pan].sort()).toEqual(real.Pan);
  });

  it('restore() puts the global Proxy mock back', () => {
    const fakeTap = Gesture.Tap;
    gestures.restore();
    expect(Gesture.Tap).not.toBe(fakeTap);
    expect(() => (Gesture.Tap() as any).anythingAtAll()).not.toThrow(); // the Proxy is back
    gestures = installGestureFakes();
  });
});
