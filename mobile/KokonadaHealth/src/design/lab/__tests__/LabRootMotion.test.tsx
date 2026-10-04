import React from 'react';
import { EventEmitter } from 'events';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { LabRoot } from '../LabRoot';

// OPS-100 (round-1 review: "the 0-frames check needs a positive control"). On the real-time clock the
// field moves only when reduced motion is OFF. So a still shot (reduced motion on) must draw 0 frames,
// and the same scene with reduced motion off must draw some: that positive control is what makes the
// 0 meaningful. Until the lab knows the reduced-motion setting, the clock stays still.
//
// The field clock itself is replaced here by a recorder: what LabRoot asks of it (period, active) is
// the subject. Its own laws are tested in src/design/v2/clock/__tests__/fieldClock.test.tsx.
const mockClockCalls: Array<{ periodMs: number; active: boolean }> = [];
jest.mock('../../v2/clock/fieldClock', () => ({
  useRealtimeFieldClock: (periodMs: number, active: boolean) => {
    mockClockCalls.push({ periodMs, active });
    return { t: { value: 0 } };
  },
}));

function reduceMotionSource() {
  const emitter = new EventEmitter();
  let resolve!: (on: boolean) => void;
  const initial = new Promise<boolean>((r) => { resolve = r; });
  return {
    source: {
      current: () => initial,
      subscribe: (fn: (on: boolean) => void) => { emitter.on('change', fn); return () => { emitter.off('change', fn); }; },
    },
    settle: (on: boolean) => act(async () => { resolve(on); await initial; }),
    change: (on: boolean) => act(() => { emitter.emit('change', on); }),
    listeners: () => emitter.listenerCount('change'),
  };
}

const LAUNCH = (clock: string) => ({ run: 'r', scene: 'smoke', clock, ...(clock === 'fixed' ? { t: '0' } : {}) });
const lastActive = () => mockClockCalls[mockClockCalls.length - 1].active;

function mount(clock: string, source: ReturnType<typeof reduceMotionSource>['source']) {
  const events = { addListener: () => ({ remove: () => {} }) };
  const frames = { next: () => () => {} };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <LabRoot labArgs={LAUNCH(clock)} nonStringKeys={[]} deps={{ emit: () => {}, events, frames, reduceMotion: source }} />,
    );
  });
  return tree;
}

beforeEach(() => { mockClockCalls.length = 0; });

describe('the real-time field clock and reduced motion', () => {
  it('stays still until the reduced-motion setting is known', () => {
    const rm = reduceMotionSource();
    mount('realtime', rm.source);
    expect(lastActive()).toBe(false);
  });

  it('runs when reduced motion is off, and stops when it turns on', async () => {
    const rm = reduceMotionSource();
    mount('realtime', rm.source);
    await rm.settle(false);
    expect(lastActive()).toBe(true);
    rm.change(true);
    expect(lastActive()).toBe(false);
  });

  it('stays still when reduced motion is on', async () => {
    const rm = reduceMotionSource();
    mount('realtime', rm.source);
    await rm.settle(true);
    expect(lastActive()).toBe(false);
  });

  it('never runs on a fixed clock, whatever the setting', async () => {
    const rm = reduceMotionSource();
    mount('fixed', rm.source);
    await rm.settle(false);
    expect(lastActive()).toBe(false);
  });

  it('stops listening for the setting when the lab unmounts', async () => {
    const rm = reduceMotionSource();
    const tree = mount('realtime', rm.source);
    await rm.settle(false);
    expect(rm.listeners()).toBe(1);
    act(() => tree.unmount());
    expect(rm.listeners()).toBe(0);
  });
});
