import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Animated, AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';

jest.setTimeout(20000); // cold-require headroom for CI (same rationale as ProfileScreen, #84)

// The orchestrator is the native-heavy playback graph — mock it to pure spies so the
// reskin's transport wiring can be asserted without touching socket/spotify-remote.
jest.mock('../playbackServices', () => ({
  orchestrator: { skipPrev: jest.fn(), skipNext: jest.fn(), togglePlayPause: jest.fn() },
}));

import { NowPlayingScreen } from '../NowPlayingScreen';
import { orchestrator } from '../playbackServices';
import { nowPlayingStore } from '../nowPlayingStore';

const skipPrev = orchestrator.skipPrev as jest.Mock;
const skipNext = orchestrator.skipNext as jest.Mock;
const togglePlayPause = orchestrator.togglePlayPause as jest.Mock;

const TRACK = { id: 't1', uri: 'spotify:track:1', title: 'Deep Current', artist: 'Bioluma' };

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label)[0];

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<NowPlayingScreen />); });
  // Flush useMotion's async reduce-motion probe + any resulting re-render deterministically.
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
  nowPlayingStore.getState().set({ track: null, isPlaying: false });
});
afterEach(() => {
  nowPlayingStore.getState().set({ track: null, isPlaying: false });
});

describe('NowPlayingScreen (Wave 2.8 reskin — playback contract preserved)', () => {
  it('renders the current track title + artist when a track is present', async () => {
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Deep Current');
    expect(all).toContain('Bioluma');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders an empty state when there is no track (contract 4)', async () => {
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Nothing playing yet');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('transport wiring: prev/next/play-pause call the exact orchestrator methods (contract 2)', async () => {
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    const tree = await render();
    await ReactTestRenderer.act(async () => { byLabel(tree, 'Previous').props.onPress(); });
    await ReactTestRenderer.act(async () => { byLabel(tree, 'Pause').props.onPress(); });
    await ReactTestRenderer.act(async () => { byLabel(tree, 'Next').props.onPress(); });
    expect(skipPrev).toHaveBeenCalledTimes(1);
    expect(togglePlayPause).toHaveBeenCalledTimes(1);
    expect(skipNext).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('play/pause is disabled when there is no track (contract 3)', async () => {
    const tree = await render(); // no track
    const btn = byLabel(tree, 'Play');
    expect(btn.props.disabled).toBe(true);
    expect(btn.props.accessibilityState).toMatchObject({ disabled: true });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('play/pause is enabled when a track is present', async () => {
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: false });
    const tree = await render();
    const btn = byLabel(tree, 'Play');
    expect(btn.props.disabled).toBeFalsy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('subscribes to nowPlayingStore and unsubscribes on unmount (contract 1 — S10-1 no-leak)', async () => {
    let subs = 0; let unsubs = 0;
    const real = nowPlayingStore.subscribe.bind(nowPlayingStore);
    const spy = jest.spyOn(nowPlayingStore, 'subscribe').mockImplementation((cb: any) => {
      subs++; const u = real(cb); return () => { unsubs++; u(); };
    });
    const tree = await render();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    spy.mockRestore();
    expect(subs).toBeGreaterThan(0);
    expect(unsubs).toBe(subs);
  });

  it('a live store update re-renders the now-playing track', async () => {
    const tree = await render(); // starts empty
    await ReactTestRenderer.act(async () => { nowPlayingStore.getState().set({ track: TRACK, isPlaying: true }); });
    expect(texts(tree.toJSON()).join(' ')).toContain('Deep Current');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('transport controls expose button roles + labels, and play/pause reflects playing state', async () => {
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    const tree = await render();
    expect(byLabel(tree, 'Previous')).toBeTruthy();
    expect(byLabel(tree, 'Next')).toBeTruthy();
    // playing → the control offers Pause
    const pause = byLabel(tree, 'Pause');
    expect(pause).toBeTruthy();
    expect(pause.props.accessibilityRole).toBe('button');
    expect(byLabel(tree, 'Play')).toBeFalsy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reduced-motion stills the ambient breath (loop is torn down, never left running)', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
    const loopHandle = { start: jest.fn(), stop: jest.fn() };
    const loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue(loopHandle as any);
    const tree = await render();
    expect(loopHandle.stop).toHaveBeenCalled(); // reduce-motion resolved → breath stilled
    loopSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('runs the ambient breath when reduced-motion is OFF (the still is not vacuous)', async () => {
    const loopHandle = { start: jest.fn(), stop: jest.fn() };
    const loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue(loopHandle as any);
    const tree = await render();
    expect(loopHandle.start).toHaveBeenCalled();
    expect(loopHandle.stop).not.toHaveBeenCalled();
    loopSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  // H1 (CONFIRMED HIGH): a fixed 300dp cover with no height bound overflows the non-scrolling
  // flex container on short/landscape/split-screen viewports and occludes the transport row.
  const artStyle = (tree: ReactTestRenderer.ReactTestRenderer) =>
    StyleSheet.flatten(tree.root.findAll((n) => n.props.testID === 'now-playing-art')[0].props.style) as any;

  it('bounds the hero art on a short portrait viewport so the transport row is never occluded (H1)', async () => {
    const dimSpy = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 360, height: 640, scale: 2, fontScale: 2 } as any);
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    const tree = await render();
    const s = artStyle(tree);
    expect(s.height).toBeLessThan(300);              // shrunk below the fixed maximum
    expect(s.height).toBeLessThanOrEqual(640 * 0.42); // held within the vertical budget
    expect(s.flexShrink).toBe(1);                     // and can give way further if space is tight
    expect(typeof s.maxHeight).toBe('number');
    expect(s.maxHeight).toBeLessThan(300);
    dimSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('bounds the hero art in landscape / split-screen (height-bound, transport stays reachable) (H1)', async () => {
    const dimSpy = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 640, height: 360, scale: 2, fontScale: 2 } as any);
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    const tree = await render();
    const s = artStyle(tree);
    expect(s.height).toBeLessThan(200);   // bound by viewport HEIGHT (not the 592 width, not the 300 cap)
    dimSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('caps the hero art at the design maximum on a large viewport (no regression)', async () => {
    const dimSpy = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 1200, height: 2000, scale: 3, fontScale: 1 } as any);
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    const tree = await render();
    expect(artStyle(tree).height).toBe(300); // capped at ART_SIZE
    dimSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
