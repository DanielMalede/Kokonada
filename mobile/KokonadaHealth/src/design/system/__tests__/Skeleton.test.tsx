import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Animated } from 'react-native';

// Isolate the Skeleton by driving its theme + motion deterministically. useTheme/useMotion are
// verified in tokens.test.ts; here we pin Skeleton's OWN contract (ghost fill, geometry, one shared
// pulse, reduced-motion still frame) given a known theme/motion — no async reduced-motion flicker.
jest.mock('../../theme', () => ({ useTheme: jest.fn(), useMotion: jest.fn() }));

import { Skeleton, SKELETON_PULSE } from '../Skeleton';
import { useTheme, useMotion } from '../../theme';
import { colors, space, radius, elevation, motion } from '../../tokens';

const DARK = colors.dark;

beforeEach(() => {
  (useTheme as jest.Mock).mockReturnValue({ name: 'dark', c: DARK });
  (useMotion as jest.Mock).mockReturnValue({ reduced: false, duration: motion.duration });
});

function flatStyle(node: any): Record<string, unknown> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
const ghostBlocks = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.accessibilityRole === 'none' && typeof n.type === 'string');
const liveRegions = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.accessibilityLiveRegion === 'polite' && typeof n.type === 'string');

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

describe('Skeleton — breathing placeholders, never spinners', () => {
  it('exposes the SKELETON_PULSE frames (rest 0.6, peak 1.0, still 1.0)', () => {
    expect(SKELETON_PULSE).toEqual({ rest: 0.6, peak: 1.0, still: 1.0 });
  });

  it('line variant: body height, small radius, raised ghost on base, e0, decorative role', async () => {
    const tree = await render(<Skeleton variant="line" />);
    const b = flatStyle(ghostBlocks(tree)[0]);
    expect(b.height).toBe(space.md);
    expect(b.borderRadius).toBe(radius.sm);
    expect(b.backgroundColor).toBe(DARK.surface.raised); // on-base ghost
    expect(b.shadowRadius).toBe(elevation.e0.shadowRadius); // text lines carry no elevation
    expect(ghostBlocks(tree)[0].props.accessibilityRole).toBe('none');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('title variant: title height and defaults to 55% width', async () => {
    const tree = await render(<Skeleton variant="title" />);
    const b = flatStyle(ghostBlocks(tree)[0]);
    expect(b.height).toBe(space.lg);
    expect(b.width).toBe('55%');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('onSurface="raised" lifts the ghost fill to surface.overlay (text lines inside a card)', async () => {
    const tree = await render(<Skeleton variant="line" onSurface="raised" />);
    expect(flatStyle(ghostBlocks(tree)[0]).backgroundColor).toBe(DARK.surface.overlay);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('card/row silhouettes carry the large radius and e1 elevation', async () => {
    const card = await render(<Skeleton variant="card" />);
    const row = await render(<Skeleton variant="row" />);
    for (const t of [card, row]) {
      const b = flatStyle(ghostBlocks(t)[0]);
      expect(b.borderRadius).toBe(radius.lg);
      expect(b.shadowRadius).toBe(elevation.e1.shadowRadius);
      expect(b.elevation).toBe(elevation.e1.elevation);
    }
    await ReactTestRenderer.act(async () => { card.unmount(); });
    await ReactTestRenderer.act(async () => { row.unmount(); });
  });

  it('count renders that many ghost blocks under a single busy live-region container', async () => {
    const tree = await render(<Skeleton variant="line" count={3} />);
    expect(ghostBlocks(tree)).toHaveLength(3);
    expect(liveRegions(tree)).toHaveLength(1);
    const container = liveRegions(tree)[0];
    expect(typeof container.props.accessibilityLabel).toBe('string');
    expect(container.props.accessibilityLabel.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('NEVER a spinner: no ActivityIndicator and no translational transform (pulse is opacity-only)', async () => {
    const tree = await render(<Skeleton variant="card" count={2} />);
    expect(tree.root.findAll((n) => n.type === 'ActivityIndicator')).toHaveLength(0);
    for (const blk of ghostBlocks(tree)) {
      expect(flatStyle(blk).transform).toBeUndefined(); // no translateX shimmer
      expect('opacity' in flatStyle(blk)).toBe(true);    // it breathes on opacity
    }
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reduced motion: blocks sit at the STILL frame (1.0) with byte-identical layout, no loop', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop');
    const motionTree = await render(<Skeleton variant="card" />);
    const motionHeight = flatStyle(ghostBlocks(motionTree)[0]).height;
    await ReactTestRenderer.act(async () => { motionTree.unmount(); });
    loopSpy.mockClear();

    (useMotion as jest.Mock).mockReturnValue({ reduced: true, duration: motion.durationReduced });
    const reduced = await render(<Skeleton variant="card" />);
    const b = flatStyle(ghostBlocks(reduced)[0]);
    expect(b.opacity).toBe(SKELETON_PULSE.still); // full strength, static
    expect(b.height).toBe(motionHeight);          // layout byte-identical
    expect(loopSpy).not.toHaveBeenCalled();       // no breath loop under reduced motion
    await ReactTestRenderer.act(async () => { reduced.unmount(); });
    loopSpy.mockRestore();
  });
});

describe('Skeleton.Group — one shared in-phase driver', () => {
  it('drives every child from a SINGLE breath loop and a single live region', async () => {
    const fake = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    const loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue(fake as any);
    const tree = await render(
      <Skeleton.Group>
        <Skeleton variant="title" onSurface="raised" />
        <Skeleton variant="line" onSurface="raised" />
        <Skeleton variant="line" onSurface="raised" width="80%" />
      </Skeleton.Group>,
    );
    expect(loopSpy).toHaveBeenCalledTimes(1); // ONE driver for the whole group
    expect(liveRegions(tree)).toHaveLength(1);
    const blocks = ghostBlocks(tree);
    expect(blocks).toHaveLength(3);
    // in-phase: every block reads the very same opacity node (object identity)
    const op0 = flatStyle(blocks[0]).opacity;
    expect(flatStyle(blocks[1]).opacity).toBe(op0);
    expect(flatStyle(blocks[2]).opacity).toBe(op0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    expect(fake.stop).toHaveBeenCalledTimes(1); // disposed on unmount
    loopSpy.mockRestore();
  });
});

describe('Skeleton.Row — a list-row placeholder (card + title + 2 body lines)', () => {
  it('renders an e1 card holding a 55% title and two body lines from one driver', async () => {
    const fake = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    const loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue(fake as any);
    const tree = await render(<Skeleton.Row />);
    const blocks = ghostBlocks(tree);
    expect(blocks.length).toBe(3);                  // title + 2 body
    expect(flatStyle(blocks[0]).width).toBe('55%'); // title
    expect(loopSpy).toHaveBeenCalledTimes(1);       // one shared driver
    expect(liveRegions(tree)).toHaveLength(1);      // one busy container
    // the card silhouette wears the large radius + e1
    const card = tree.root.findAll((n) => typeof n.type === 'string' && flatStyle(n).borderRadius === radius.lg && flatStyle(n).shadowRadius === elevation.e1.shadowRadius);
    expect(card.length).toBeGreaterThanOrEqual(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    loopSpy.mockRestore();
  });
});
