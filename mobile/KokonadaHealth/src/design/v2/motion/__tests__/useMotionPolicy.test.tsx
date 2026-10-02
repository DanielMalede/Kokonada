import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { MotionPorts, SignalSource } from '../ports.ts';
import { resolveMotionTier, useMotionPolicy, type MotionTier } from '../useMotionPolicy.ts';

const { act } = ReactTestRenderer;

/**
 * A stateful fake with the port's real semantics: one pending read the test settles, a live
 * registry of listeners (so parity is counted, not assumed), and emit for an OS change.
 */
function fakeSignal() {
  const listeners: Array<{ fn: (value: boolean) => void; live: boolean }> = [];
  let settle!: (value: boolean) => void;
  let fail!: (error: Error) => void;
  const pending = new Promise<boolean>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const source: SignalSource = {
    read: () => pending,
    subscribe: (fn) => {
      const entry = { fn, live: true };
      listeners.push(entry);
      return () => {
        entry.live = false;
      };
    },
  };
  return {
    source,
    answer: (value: boolean) => act(async () => settle(value)),
    refuse: () => act(async () => fail(new Error('platform refused'))),
    emit: (value: boolean) =>
      act(async () => {
        for (const l of listeners) if (l.live) l.fn(value);
      }),
    listening: () => listeners.filter((l) => l.live).length,
  };
}

function render(ports: MotionPorts) {
  const seen: MotionTier[] = [];
  function Probe({ p }: { p: MotionPorts }) {
    seen.push(useMotionPolicy(p));
    return null;
  }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<Probe p={ports} />);
  });
  return {
    tier: () => seen[seen.length - 1],
    rerender: (next: MotionPorts) => act(() => tree.update(<Probe p={next} />)),
    unmount: () => act(() => tree.unmount()),
  };
}

describe('resolveMotionTier: the precedence', () => {
  it.each([
    [false, false, 'full'],
    [true, false, 'still'],
    [false, true, 'low'],
    [true, true, 'still'],
  ] as const)('reduced motion %p and battery saver %p give %p', (reduceMotion, powerSave, tier) => {
    expect(resolveMotionTier({ reduceMotion, powerSave })).toBe(tier);
  });

  // Until the platform answers, the policy assumes the setting that moves least: reduced motion
  // must never be shown motion it asked not to see (QA-034).
  it.each([
    [null, null, 'still'],
    [null, false, 'still'],
    [null, true, 'still'],
    [false, null, 'low'],
    [true, null, 'still'],
  ] as const)('an unanswered setting is the cautious one: %p and %p give %p', (reduceMotion, powerSave, tier) => {
    expect(resolveMotionTier({ reduceMotion, powerSave })).toBe(tier);
  });
});

describe('useMotionPolicy', () => {
  it('is still before the platform answers, then follows both settings', async () => {
    const reduce = fakeSignal();
    const power = fakeSignal();
    const view = render({ reduceMotion: reduce.source, powerSave: power.source });
    expect(view.tier()).toBe('still');
    await reduce.answer(false);
    expect(view.tier()).toBe('low');
    await power.answer(false);
    expect(view.tier()).toBe('full');
    view.unmount();
  });

  it('follows live changes of either setting, reduced motion first', async () => {
    const reduce = fakeSignal();
    const power = fakeSignal();
    const view = render({ reduceMotion: reduce.source, powerSave: power.source });
    await reduce.answer(false);
    await power.answer(false);
    await power.emit(true);
    expect(view.tier()).toBe('low');
    await reduce.emit(true);
    expect(view.tier()).toBe('still');
    await power.emit(false);
    expect(view.tier()).toBe('still');
    await reduce.emit(false);
    expect(view.tier()).toBe('full');
    view.unmount();
  });

  // The first read is async. A change event that arrives before it is newer, and must win.
  it('a change event beats a read that answers later', async () => {
    const reduce = fakeSignal();
    const power = fakeSignal();
    const view = render({ reduceMotion: reduce.source, powerSave: power.source });
    await power.answer(false);
    await reduce.emit(true);
    await reduce.answer(false);
    expect(view.tier()).toBe('still');
    view.unmount();
  });

  it('a read the platform refuses leaves the cautious tier, and a later change still lands', async () => {
    const reduce = fakeSignal();
    const power = fakeSignal();
    const view = render({ reduceMotion: reduce.source, powerSave: power.source });
    await power.answer(false);
    await reduce.refuse();
    expect(view.tier()).toBe('still');
    await reduce.emit(false);
    expect(view.tier()).toBe('full');
    view.unmount();
  });

  describe('listener parity across mount and unmount', () => {
    it('subscribes once per setting on mount and releases both on unmount, every time', () => {
      const reduce = fakeSignal();
      const power = fakeSignal();
      const ports = { reduceMotion: reduce.source, powerSave: power.source };
      for (let round = 0; round < 3; round++) {
        const view = render(ports);
        expect([reduce.listening(), power.listening()]).toEqual([1, 1]);
        view.unmount();
        expect([reduce.listening(), power.listening()]).toEqual([0, 0]);
      }
    });

    it('a re-render with the same sources does not subscribe again', () => {
      const reduce = fakeSignal();
      const power = fakeSignal();
      const view = render({ reduceMotion: reduce.source, powerSave: power.source });
      view.rerender({ reduceMotion: reduce.source, powerSave: power.source });
      view.rerender({ reduceMotion: reduce.source, powerSave: power.source });
      expect([reduce.listening(), power.listening()]).toEqual([1, 1]);
      view.unmount();
      expect([reduce.listening(), power.listening()]).toEqual([0, 0]);
    });

    it('a new source replaces the old one, which is released, and starts unanswered', async () => {
      const first = fakeSignal();
      const second = fakeSignal();
      const power = fakeSignal();
      const view = render({ reduceMotion: first.source, powerSave: power.source });
      await first.answer(false);
      await power.answer(false);
      expect(view.tier()).toBe('full');
      view.rerender({ reduceMotion: second.source, powerSave: power.source });
      expect([first.listening(), second.listening(), power.listening()]).toEqual([0, 1, 1]);
      expect(view.tier()).toBe('still');
      await second.answer(false);
      expect(view.tier()).toBe('full');
      view.unmount();
    });

    it('a read that answers after unmount changes nothing and warns nothing', async () => {
      const reduce = fakeSignal();
      const power = fakeSignal();
      const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const view = render({ reduceMotion: reduce.source, powerSave: power.source });
        view.unmount();
        await reduce.answer(true);
        await power.answer(true);
        expect(errors).not.toHaveBeenCalled();
        expect([reduce.listening(), power.listening()]).toEqual([0, 0]);
      } finally {
        errors.mockRestore();
      }
    });
  });
});
