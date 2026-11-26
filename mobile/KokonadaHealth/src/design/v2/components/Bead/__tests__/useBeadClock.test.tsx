import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { entranceEnd, type BeadLooks } from '../beadDriver.ts';
import { beadMotion } from '../beadModel.ts';
import type { PresentBead } from '../beadPresence.ts';
import { exitDuration, exitOpacity, PLAY_FLOOR_MS } from '../beadTimeline.ts';
import { useBeadClock } from '../useBeadClock.ts';
import type { UiThread } from './__fixtures__/uiThread.ts';

// T4 (the architect's ruling of 2026-11-26, UI-320): the hook that runs the beads' driver. One shared value of looks by
// bead id, one frame callback that is active only while a bead enters or leaves, and one message to JS per exit, onGone,
// in the frame it ends. JS hears nothing else of a look: no React state per frame, and nothing after the unmount.

jest.mock('react-native-reanimated', () => require('./__fixtures__/uiThread').uiThreadMock());
const ui = (jest.requireMock('react-native-reanimated') as { __ui: UiThread }).__ui;

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const A = { x: 0.6, y: 0.6 };
const B = { x: -0.6, y: 0.6 };
const END = entranceEnd(beadMotion('abyss', 'full'));
const whole = (id: number, point = A): PresentBead => ({ id, point, leaving: false, placedAt: null, leftAt: null, startOpacity: 1 });
const placed = (id: number, at: number, point = A): PresentBead => ({ ...whole(id, point), placedAt: at });
const left = (bead: PresentBead, at: number): PresentBead => ({ ...bead, leaving: true, leftAt: at });

type Hook = typeof useBeadClock;
function mount(beads: readonly PresentBead[], hook: Hook = useBeadClock, timeScale?: number) {
  const onGone = jest.fn();
  const seen = { renders: 0, looks: null as null | { value: BeadLooks } };
  function Probe({ list }: { readonly list: readonly PresentBead[] }) {
    seen.renders += 1;
    seen.looks = hook(list, onGone, timeScale === undefined ? undefined : { timeScale });
    return null;
  }
  const element = (list: readonly PresentBead[]) => (
    <DirectionProvider direction="abyss" face="dark">
      <Probe list={list} />
    </DirectionProvider>
  );
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element(beads));
  });
  trees.add(tree);
  return {
    onGone,
    seen,
    looks: () => seen.looks!.value,
    update: (list: readonly PresentBead[]) => act(() => tree.update(element(list))),
    unmount: () => {
      trees.delete(tree);
      act(() => tree.unmount());
    },
  };
}
const trees = new Set<ReactTestRenderer.ReactTestRenderer>();
/** Frames every `dt` ms from `from` to `to` on the UI thread, JS hearing of each as it happens. */
const frames = (from: number, to: number, dt = 10) => {
  for (let t = from; t <= to; t += dt) {
    ui.frame(t);
    act(() => ui.flushJS());
  }
};
const active = () => ui.callbacks().filter((c) => c.active).length;

beforeEach(() => {
  ui.jsCalls.splice(0);
});
afterEach(() => {
  for (const tree of trees) act(() => tree.unmount());
  trees.clear();
  act(() => ui.flushJS());
  jest.clearAllTimers();
});

describe('useBeadClock: at rest nothing runs', () => {
  it('beads shown whole from the mount: no look, and its one frame callback is not active', () => {
    const h = mount([whole(0), whole(1, B)]);
    expect(h.looks()).toEqual({});
    expect(ui.callbacks()).toHaveLength(1);
    expect(active()).toBe(0);
    ui.frame(100);
    expect(h.looks()).toEqual({});
    expect(ui.jsCalls).toEqual([]);
  });

  it('a re-render with the very same beads starts nothing', () => {
    const beads = [whole(0)];
    const h = mount(beads);
    h.update(beads);
    expect(active()).toBe(0);
  });
});

describe('useBeadClock: an entrance', () => {
  it('runs from the first UI frame after the placement, whenever that comes, and the callback rests once it has ended, with no word to the page', () => {
    const h = mount([]);
    h.update([placed(0, performance.now())]);
    expect(active()).toBe(1);
    // No look yet: the bead is not drawn whole (the view reads it as out).
    expect(h.looks()[0]).toBeUndefined();
    const t0 = 50_000;
    ui.frame(t0);
    expect(h.looks()[0]).toEqual({ opacity: 0, colour: 0, scale: beadMotion('abyss', 'full').scaleFrom, start: null });
    frames(t0 + 10, t0 + END - 10);
    expect(h.looks()[0].scale).toBeLessThan(1);
    expect(active()).toBe(1);
    frames(t0 + END, t0 + END + 20);
    expect(h.looks()[0]).toEqual({ opacity: 1, colour: 1, scale: 1, start: null });
    expect(active()).toBe(0);
    expect(h.onGone).not.toHaveBeenCalled();
  });

  it('dispatched late by a held JS thread, it is compressed onto what is left, never under motion.respond', () => {
    const h = mount([]);
    const placedAt = performance.now() - 430;
    h.update([placed(0, placedAt)]);
    ui.frame(1000);
    expect(h.looks()[0].opacity).toBe(0);
    ui.frame(1000 + PLAY_FLOOR_MS - 1);
    expect(h.looks()[0].scale).toBeLessThan(1);
    ui.frame(1000 + PLAY_FLOOR_MS);
    expect(h.looks()[0]).toMatchObject({ opacity: 1, colour: 1, scale: 1 });
  });

  it('the lateness is measured once, when the phase is first dispatched: a later render does not move it', () => {
    const h = mount([]);
    const first = placed(0, performance.now());
    h.update([first]);
    ui.frame(1000);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    h.update([first, placed(1, performance.now(), B)]);
    ui.frame(1000 + 300);
    ui.frame(1000 + END - 1);
    // Bead 0 still plays its whole 600 ms; a lateness of 300 would have ended it at 350.
    expect(h.looks()[0].scale).toBeLessThan(1);
    expect(h.looks()[1].opacity).toBeLessThanOrEqual(1);
  });
});

describe('useBeadClock: an exit', () => {
  it('reports onGone with the bead’s id exactly once, in the frame the exit ends, then the callback rests', () => {
    const bead = whole(4);
    const h = mount([bead, whole(5, B)]);
    h.update([left(bead, performance.now()), whole(5, B)]);
    expect(active()).toBe(1);
    const t0 = 7000;
    frames(t0, t0 + exitDuration(1) - 10);
    expect(h.onGone).not.toHaveBeenCalled();
    expect(h.looks()[4].opacity).toBeGreaterThan(0);
    frames(t0 + exitDuration(1), t0 + exitDuration(1) + 300);
    expect(h.onGone.mock.calls).toEqual([[4]]);
    expect(active()).toBe(0);
  });

  it('a bead the page has not dropped yet is never reported twice, however long the frames go on for another bead', () => {
    const a = whole(1);
    const b = whole(2, B);
    const h = mount([a, b]);
    h.update([left(a, performance.now()), b]);
    frames(0, 600);
    // The page ignores onGone here (the mock keeps the bead): bead 2 leaves, and frames run on.
    h.update([left(a, 0), left(b, performance.now())]);
    frames(610, 1400);
    expect(h.onGone.mock.calls).toEqual([[1], [2]]);
  });

  it('never reports after the unmount: a message already on its way to JS is dropped', () => {
    const bead = whole(4);
    const h = mount([bead]);
    h.update([left(bead, performance.now())]);
    ui.frame(0);
    ui.frame(exitDuration(1));
    expect(ui.pending()).toBeGreaterThan(0);
    h.unmount();
    act(() => ui.flushJS());
    expect(h.onGone).not.toHaveBeenCalled();
    expect(ui.callbacks()).toEqual([]);
  });

  it('the latest onGone is the one called: the page may hand a new function each render', () => {
    const calls: string[] = [];
    const bead = whole(4);
    function Page({ list, tag }: { readonly list: readonly PresentBead[]; readonly tag: string }) {
      useBeadClock(list, (id) => calls.push(`${tag}:${id}`));
      return null;
    }
    const element = (list: readonly PresentBead[], tag: string) => <DirectionProvider direction="abyss" face="dark"><Page list={list} tag={tag} /></DirectionProvider>;
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(element([bead], 'first'));
    });
    trees.add(tree);
    const leaving = [left(bead, performance.now())];
    act(() => tree.update(element(leaving, 'second')));
    act(() => tree.update(element(leaving, 'third')));
    frames(0, 500);
    expect(calls).toEqual(['third:4']);
  });
});

describe('useBeadClock: JS hears only onGone', () => {
  it('no frame re-renders the page, and nothing that crosses to JS carries a look: one report per exit, and a bare word that the driver may rest', () => {
    const bead = whole(4);
    const h = mount([bead]);
    h.update([left(bead, performance.now()), placed(5, performance.now(), B)]);
    const renders = h.seen.renders;
    frames(0, 1000, 5);
    expect(h.seen.renders).toBe(renders);
    expect(h.onGone.mock.calls).toEqual([[4]]);
    const reports = ui.jsCalls.filter((c) => c.args.length === 1 && c.args[0] === 4);
    expect(reports).toHaveLength(1);
    for (const call of ui.jsCalls) for (const arg of call.args) expect(typeof arg).toBe('number');
    // Two motions ended (the exit, then the entrance): two messages at the most beside the report.
    expect(ui.jsCalls.length).toBeLessThanOrEqual(3);
  });

  it('the looks are one shared value for the hook’s life: its readers never re-subscribe', () => {
    const h = mount([]);
    const first = h.seen.looks;
    h.update([placed(0, performance.now())]);
    frames(0, 700);
    h.update([left(placed(0, 0), performance.now())]);
    expect(h.seen.looks).toBe(first);
  });

  it('a motion that starts as another ends keeps the callback running: a stale word to rest does not stop it', () => {
    const h = mount([]);
    h.update([placed(0, performance.now())]);
    for (let t = 0; t <= END; t += 10) ui.frame(t);
    // The driver said it may rest; before JS hears it, a second bead is placed.
    expect(ui.pending()).toBeGreaterThan(0);
    h.update([placed(0, 0), placed(1, performance.now(), B)]);
    act(() => ui.flushJS());
    expect(active()).toBe(1);
    frames(END + 10, END + 10 + END + 20);
    expect(h.looks()[1]).toMatchObject({ opacity: 1, colour: 1 });
    expect(active()).toBe(0);
  });
});

describe('useBeadClock: the time scale (the lab’s dial)', () => {
  it('stretches the motion: at 8, an exit takes eight times as long and reports then', () => {
    const bead = whole(4);
    const h = mount([bead], useBeadClock, 8);
    h.update([left(bead, performance.now())]);
    ui.frame(0);
    ui.frame(8 * 200);
    expect(h.looks()[4].opacity).toBe(exitOpacity(1, 200));
    frames(8 * exitDuration(1) - 10, 8 * exitDuration(1) + 10);
    expect(h.onGone.mock.calls).toEqual([[4]]);
  });
});
