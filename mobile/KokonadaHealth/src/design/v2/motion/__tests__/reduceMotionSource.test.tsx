import React from 'react';
import { AccessibilityInfo } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type { SignalSource } from '../ports.ts';
import { reduceMotionSource } from '../reduceMotionSource.ts';
import { useMotionPolicy, type MotionTier } from '../useMotionPolicy.ts';

const { act } = ReactTestRenderer;

// The adapter is the thin edge between the policy and React Native; its device proof is QA-034 in
// the lab. Here it runs against a stand-in for AccessibilityInfo's event channel with real
// subscribe and remove semantics.
//
// The jest preset already installs these two methods as jest.fn, and jest.spyOn on an existing
// mock registers no restore, so the preset's own implementations are captured and put back by hand.
const addEventListener = AccessibilityInfo.addEventListener as unknown as jest.Mock;
const isReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled as unknown as jest.Mock;
const PRESET_ADD = addEventListener.getMockImplementation();
const PRESET_READ = isReduceMotionEnabled.getMockImplementation();

const channel = new Map<string, Set<(value: boolean) => void>>();
let platformSays = true;

const listening = (event: string) => channel.get(event)?.size ?? 0;
const osChanges = (event: string, value: boolean) =>
  act(async () => {
    for (const handler of channel.get(event) ?? []) handler(value);
  });

beforeEach(() => {
  channel.clear();
  platformSays = true;
  addEventListener.mockImplementation((event: string, handler: (value: boolean) => void) => {
    const handlers = channel.get(event) ?? new Set();
    handlers.add(handler);
    channel.set(event, handlers);
    return { remove: () => handlers.delete(handler) };
  });
  isReduceMotionEnabled.mockImplementation(() => Promise.resolve(platformSays));
});

afterEach(() => {
  addEventListener.mockImplementation(PRESET_ADD);
  isReduceMotionEnabled.mockImplementation(PRESET_READ);
});

describe('reduceMotionSource', () => {
  it('reads the platform’s reduced-motion setting', async () => {
    await expect(reduceMotionSource.read()).resolves.toBe(true);
    platformSays = false;
    await expect(reduceMotionSource.read()).resolves.toBe(false);
  });

  it('listens on reduceMotionChanged only, and stops when asked', async () => {
    const seen: boolean[] = [];
    const stop = reduceMotionSource.subscribe((value) => seen.push(value));
    expect(listening('reduceMotionChanged')).toBe(1);
    await osChanges('reduceMotionChanged', false);
    await osChanges('screenReaderChanged', true);
    expect(seen).toEqual([false]);
    stop();
    expect(listening('reduceMotionChanged')).toBe(0);
    await osChanges('reduceMotionChanged', true);
    expect(seen).toEqual([false]);
  });

  it('drives the policy end to end, and leaves no listener behind', async () => {
    const powerSaveOff: SignalSource = { read: () => Promise.resolve(false), subscribe: () => () => {} };
    const seen: MotionTier[] = [];
    function Probe() {
      seen.push(useMotionPolicy({ reduceMotion: reduceMotionSource, powerSave: powerSaveOff }));
      return null;
    }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<Probe />);
    });
    expect(seen[seen.length - 1]).toBe('still');
    await osChanges('reduceMotionChanged', false);
    expect(seen[seen.length - 1]).toBe('full');
    act(() => tree.unmount());
    expect(listening('reduceMotionChanged')).toBe(0);
  });
});
