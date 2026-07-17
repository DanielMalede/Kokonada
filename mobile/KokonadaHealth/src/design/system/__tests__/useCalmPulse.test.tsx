import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Animated } from 'react-native';
import { useCalmPulse, type CalmPulseCurve } from '../useCalmPulse';

// The extracted breath ENGINE (BreathingGlow's loop, generalised). It drives an opacity
// node from a sine loop under motion, and STILLS to a fixed value under reduced motion or a
// non-positive period — with the loop disposed on unmount so nothing leaks. These are the
// invariants every skeleton / banner dot inherits, so they are pinned once here.

const CURVE: CalmPulseCurve = { rest: 0.6, peak: 1.0, still: 1.0 };

// Read the opacity node's current value: a bare number (reduced/still) is returned as-is; an
// AnimatedInterpolation exposes __getValue() which, at rest (t=0), yields the outputRange floor.
const read = (v: unknown): unknown =>
  typeof v === 'number' ? v : v && typeof (v as any).__getValue === 'function' ? (v as any).__getValue() : v;

function Probe({ reduced, periodMs, curve, sink }: {
  reduced: boolean; periodMs: number; curve: CalmPulseCurve; sink: (v: unknown) => void;
}) {
  sink(useCalmPulse(reduced, periodMs, curve));
  return null;
}

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

describe('useCalmPulse — the shared breath engine', () => {
  let fakeLoop: { start: jest.Mock; stop: jest.Mock; reset: jest.Mock };
  let loopSpy: jest.SpyInstance;

  beforeEach(() => {
    fakeLoop = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue(fakeLoop as any);
  });
  afterEach(() => { loopSpy.mockRestore(); });

  it('under reduced motion returns the fixed STILL value and starts NO loop', async () => {
    let val: unknown;
    const tree = await render(<Probe reduced periodMs={4200} curve={CURVE} sink={(v) => { val = v; }} />);
    expect(val).toBe(CURVE.still);
    expect(loopSpy).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a non-positive period returns STILL and starts NO loop (never a zero-duration spin)', async () => {
    let zero: unknown; let neg: unknown;
    const a = await render(<Probe reduced={false} periodMs={0} curve={CURVE} sink={(v) => { zero = v; }} />);
    const b = await render(<Probe reduced={false} periodMs={-10} curve={CURVE} sink={(v) => { neg = v; }} />);
    expect(zero).toBe(CURVE.still);
    expect(neg).toBe(CURVE.still);
    expect(loopSpy).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { a.unmount(); });
    await ReactTestRenderer.act(async () => { b.unmount(); });
  });

  it('under motion starts exactly ONE loop and returns an animated node resting at curve.rest', async () => {
    let val: unknown;
    const tree = await render(<Probe reduced={false} periodMs={4200} curve={CURVE} sink={(v) => { val = v; }} />);
    expect(loopSpy).toHaveBeenCalledTimes(1);
    expect(fakeLoop.start).toHaveBeenCalledTimes(1);
    expect(typeof val).toBe('object'); // an Animated node, never a bare number
    expect(read(val)).toBeCloseTo(CURVE.rest, 5); // rest frame maps to the outputRange floor
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('DISPOSES the loop on unmount (no leak) — resilience invariant', async () => {
    const tree = await render(<Probe reduced={false} periodMs={4200} curve={CURVE} sink={() => {}} />);
    expect(fakeLoop.stop).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    expect(fakeLoop.stop).toHaveBeenCalledTimes(1);
  });

  it('honours a different still value (curve is the single source of the rest/peak/still frames)', async () => {
    let val: unknown;
    const curve: CalmPulseCurve = { rest: 0.2, peak: 0.9, still: 0.55 };
    const tree = await render(<Probe reduced periodMs={4200} curve={curve} sink={(v) => { val = v; }} />);
    expect(val).toBe(0.55);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
