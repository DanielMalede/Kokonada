/// <reference types="node" />
import * as path from 'path';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { loadMutant } from '../../../testing/mutant';
import type { UiThread } from '../../v2/components/Bead/__tests__/__fixtures__/uiThread';
import { driverStep, type BeadLooks, type BeadPlay, type BeadRuns } from '../../v2/components/Bead/beadDriver';
import { beadMotion } from '../../v2/components/Bead/beadModel';
import type { PresentBead } from '../../v2/components/Bead/beadPresence';
import { exitDuration } from '../../v2/components/Bead/beadTimeline';
import { useBeadClock } from '../../v2/components/Bead/useBeadClock';
import { lettersOpacity } from '../../v2/components/RimLabels/arc';
import type { RimLabels, RimWords } from '../../v2/components/RimLabels/RimLabels';
import type { SkiaWordsFake } from '../../v2/components/RimLabels/__tests__/__fixtures__/skiaWords';
import { DirectionProvider } from '../../v2/tokens/DirectionProvider';

// UI-320 and UI-321: mutants planted in the real sources of the beads' driver, its hook and the rim words, each killed by
// the same check its own suite makes (Bead/__tests__/beadDriver.test.ts T1, useBeadClock.test.tsx T4, presenceSync.test.tsx
// T5). They live here because a v2 test imports nothing from outside v2 (isolation.test.ts), and the planting tool is the
// app's (src/testing/mutant.ts). Every mutant is in memory only.

jest.mock('react-native-reanimated', () => require('../../v2/components/Bead/__tests__/__fixtures__/uiThread').uiThreadMock());
jest.mock('@shopify/react-native-skia', () => require('../../v2/components/RimLabels/__tests__/__fixtures__/skiaWords').skiaWordsMock());
const ui = (jest.requireMock('react-native-reanimated') as { __ui: UiThread }).__ui;
const skia = jest.requireMock('@shopify/react-native-skia') as { __fake: SkiaWordsFake };

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const BEAD = path.resolve(__dirname, '../../v2/components/Bead');
const RIM = path.resolve(__dirname, '../../v2/components/RimLabels');
const A = { x: 0, y: 1 };
const whole = (id: number): PresentBead => ({ id, point: A, leaving: false, placedAt: null, leftAt: null, startOpacity: 1 });
const left = (bead: PresentBead): PresentBead => ({ ...bead, leaving: true, leftAt: performance.now() });

const trees = new Set<ReactTestRenderer.ReactTestRenderer>();
afterEach(() => {
  for (const tree of trees) act(() => tree.unmount());
  trees.clear();
  act(() => ui.flushJS());
  jest.clearAllTimers();
});

describe('beadDriver.ts', () => {
  type Step = typeof driverStep;
  /** An opaque bead's exit whose first UI frame comes `d` ms after leftAt: is its first frame the bead as it was? */
  const firstFrame = (step: Step, d: number) => {
    const play: BeadPlay = { id: 1, leaving: true, entered: false, late: d };
    const runs: BeadRuns = {};
    const looks: BeadLooks = {};
    const out = step([play], runs, looks, 5000 + d, { motion: beadMotion('abyss', 'full'), timeScale: 1 });
    return { opacity: out.looks[1].opacity, colour: out.looks[1].colour, letters: lettersOpacity([1], out.looks) };
  };

  it('the real driver: however late the first frame, it shows the bead as it was, its letters out', () => {
    for (const d of [0, 300, 1000]) expect(firstFrame(driverStep, d)).toEqual({ opacity: 1, colour: 1, letters: 0 });
  });

  it('planted: an exit clock that starts at the JS stamp shows a late bead part-way gone, or gone, in its first frame', () => {
    const mutant = loadMutant<{ driverStep: Step }>(path.join(BEAD, 'beadDriver.ts'), [
      { find: 'run = { leaving: true, t0: timestamp, end,', replace: 'run = { leaving: true, t0: timestamp - p.late, end,' },
    ], require);
    expect(firstFrame(mutant.driverStep, 0)).toEqual({ opacity: 1, colour: 1, letters: 0 });
    expect(firstFrame(mutant.driverStep, 300).opacity).toBeLessThan(0.2);
    expect(firstFrame(mutant.driverStep, 1000)).toMatchObject({ opacity: 0, colour: 0 });
  });

  it('planted: an entrance played 1:1 from its stamp is whole in its first frame when 600 ms late', () => {
    const mutant = loadMutant<{ driverStep: Step }>(path.join(BEAD, 'beadDriver.ts'), [
      { find: 'run = { leaving: false, t0: timestamp, end, play: playMs(end, p.late) * stretch,', replace: 'run = { leaving: false, t0: timestamp - p.late, end, play: end * stretch,' },
    ], require);
    const first = (step: Step) => step([{ id: 1, leaving: false, entered: true, late: 600 }], {}, {}, 9000, { motion: beadMotion('abyss', 'full'), timeScale: 1 }).looks[1];
    expect(first(driverStep)).toMatchObject({ opacity: 0, colour: 0 });
    expect(first(mutant.driverStep)).toMatchObject({ opacity: 1, colour: 1 });
  });
});

describe('RimLabels/arc.ts', () => {
  it('planted: letters that read the current frame’s look (e803fe9) are back beside a bead that was whole the frame before', () => {
    const looks = { 1: { opacity: 0.4, colour: 0, scale: 1, start: 1, before: 1 } };
    expect(lettersOpacity([1], looks)).toBe(0);
    const mutant = loadMutant<{ lettersOpacity: typeof lettersOpacity }>(path.join(RIM, 'arc.ts'), [
      { find: 'const before = look === undefined ? null : look.before;', replace: 'const before = look === undefined ? null : (look as unknown as { opacity: number }).opacity;' },
    ], require);
    expect(mutant.lettersOpacity([1], looks)).toBe(0.6);
  });
});

describe('useBeadClock.ts', () => {
  type Hook = typeof useBeadClock;
  const SOURCE = path.join(BEAD, 'useBeadClock.ts');
  function mount(hook: Hook) {
    const onGone = jest.fn();
    function Probe({ list }: { readonly list: readonly PresentBead[] }) {
      hook(list, onGone);
      return null;
    }
    const element = (list: readonly PresentBead[]) => <DirectionProvider direction="abyss" face="dark"><Probe list={list} /></DirectionProvider>;
    const bead = whole(4);
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(element([bead]));
    });
    trees.add(tree);
    act(() => tree.update(element([left(bead)])));
    return { onGone, tree };
  }
  const active = () => ui.callbacks().filter((c) => c.active).length;
  const exit = () => {
    for (let t = 0; t <= exitDuration(1) + 200; t += 10) {
      ui.frame(t);
      act(() => ui.flushJS());
    }
  };

  it('the real hook: after an exit the frame callback rests, and a report on its way at the unmount is dropped', () => {
    const run = mount(useBeadClock);
    exit();
    expect(run.onGone).toHaveBeenCalledTimes(1);
    expect(active()).toBe(0);
    const cut = mount(useBeadClock);
    ui.frame(0);
    ui.frame(exitDuration(1));
    trees.delete(cut.tree);
    act(() => cut.tree.unmount());
    act(() => ui.flushJS());
    expect(cut.onGone).not.toHaveBeenCalled();
  });

  it('planted: a hook that never rests leaves its frame callback running', () => {
    const mutant = loadMutant<{ useBeadClock: Hook }>(SOURCE, [{ find: 'if (seen === generation.current) frame.setActive(false);', replace: '' }], require);
    mount(mutant.useBeadClock);
    exit();
    expect(active()).toBe(1);
  });

  it('planted: a hook that reports after the unmount calls the page’s onGone on a tree that is gone', () => {
    const mutant = loadMutant<{ useBeadClock: Hook }>(SOURCE, [{ find: 'if (mounted.current) gone.current(id);', replace: 'gone.current(id);' }], require);
    const cut = mount(mutant.useBeadClock);
    ui.frame(0);
    ui.frame(exitDuration(1));
    trees.delete(cut.tree);
    act(() => cut.tree.unmount());
    act(() => ui.flushJS());
    expect(cut.onGone).toHaveBeenCalledTimes(1);
  });
});

describe('RimLabels.tsx', () => {
  const WORDS: RimWords = { top: 'More energy', right: 'Pleasant', bottom: 'Less energy', left: 'Unpleasant' };
  /** A parent's re-render with equal props while a bead leaves: how many more times the top word's canvas rendered. */
  const recommits = (Rim: typeof RimLabels) => {
    const beads = [{ id: 1, point: A, leaving: true }];
    const looks = { value: {} };
    const element = () => (
      <DirectionProvider direction="abyss" face="dark">
        <Rim diameter={296} fontScale={1} words={WORDS} a11y={WORDS} script="latin" beads={beads} looks={looks} />
      </DirectionProvider>
    );
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(element());
    });
    trees.add(tree);
    const before = skia.__fake.canvasRenders['hero.plate.word.top'];
    act(() => tree.update(element()));
    act(() => tree.update(element()));
    return skia.__fake.canvasRenders['hero.plate.word.top'] - before;
  };

  it('the real RimLabels commits no word canvas on a re-render with equal props; planted without its memo, it commits one each time', () => {
    const real = jest.requireActual('../../v2/components/RimLabels/RimLabels') as { RimLabels: typeof RimLabels };
    expect(recommits(real.RimLabels)).toBe(0);
    const mutant = loadMutant<{ RimLabels: typeof RimLabels }>(path.join(RIM, 'RimLabels.tsx'), [
      { find: 'const WordCanvas = memo(function WordCanvasView(', replace: 'const WordCanvas = ((view: (props: WordCanvasProps) => React.JSX.Element) => view)(function WordCanvasView(' },
    ], require);
    expect(recommits(mutant.RimLabels)).toBe(2);
  });
});
