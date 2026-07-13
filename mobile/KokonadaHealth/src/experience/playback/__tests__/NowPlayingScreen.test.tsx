import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Animated, AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';

jest.setTimeout(20000); // cold-require headroom for CI (same rationale as ProfileScreen, #84)

// The orchestrator is the native-heavy playback graph — mock it to pure spies so the
// reskin's transport wiring can be asserted without touching socket/spotify-remote.
jest.mock('../playbackServices', () => ({
  orchestrator: {
    skipPrev: jest.fn(), skipNext: jest.fn(), togglePlayPause: jest.fn(),
    getQueueTracks: jest.fn(() => []), jumpToId: jest.fn(),
  },
  player: { connect: jest.fn() },
}));

// SpotifyAttribution pulls the native link-back graph — stub it to a marker (with a link-back node)
// so the NP-ATTR placement can be asserted here; the real mark is covered in SpotifyAttribution.test.
jest.mock('../../player/SpotifyAttribution', () => {
  const React2 = require('react');
  const { View, Text } = require('react-native');
  return {
    SpotifyAttribution: () =>
      React2.createElement(View, { testID: 'spotify-attribution' },
        React2.createElement(Text, {
          testID: 'spotify-attribution-linkback', accessibilityRole: 'button', accessibilityLabel: 'GET SPOTIFY FREE',
        }, 'GET SPOTIFY FREE')),
  };
});

import { NowPlayingScreen } from '../NowPlayingScreen';
import { orchestrator } from '../playbackServices';
import { nowPlayingStore } from '../nowPlayingStore';
import { playerStatusStore } from '../../player/playerStatusStore';

const skipPrev = orchestrator.skipPrev as jest.Mock;
const skipNext = orchestrator.skipNext as jest.Mock;
const togglePlayPause = orchestrator.togglePlayPause as jest.Mock;

const TRACK = { id: 't1', uri: 'spotify:track:1', title: 'Deep Current', artist: 'Bioluma', receipt: null, recordingKey: null };

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
  nowPlayingStore.getState().setCover(null); // cover is decoupled from the track — reset it too
});
afterEach(() => {
  nowPlayingStore.getState().set({ track: null, isPlaying: false });
  nowPlayingStore.getState().setCover(null);
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

  it('renders the REAL album cover Image from the resolved coverUri (App Remote SDK, not the queue)', async () => {
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    nowPlayingStore.getState().setCover('file:///cover/live.jpg');
    const tree = await render();
    const img = tree.root.findAll((n) => n.props.testID === 'now-playing-cover')[0];
    expect(img).toBeTruthy();
    expect(img.props.source).toEqual({ uri: 'file:///cover/live.jpg' });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('L2: falls back to the ♪ placeholder when the cover Image fails to load, then re-attempts on a new coverUri', async () => {
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    nowPlayingStore.getState().setCover('file:///cover/broken.jpg');
    const tree = await render();
    let img = tree.root.findAll((n) => n.props.testID === 'now-playing-cover')[0];
    expect(img).toBeTruthy();

    // Simulate a decode failure on the resolved cover file.
    await ReactTestRenderer.act(async () => { img.props.onError(); });
    expect(tree.root.findAll((n) => n.props.testID === 'now-playing-cover')).toHaveLength(0);
    expect(texts(tree.toJSON()).join(' ')).toContain('♪'); // degraded to the token placeholder

    // A NEW track resolves a fresh cover → the failed flag resets and the Image re-attempts.
    await ReactTestRenderer.act(async () => {
      nowPlayingStore.getState().set({ track: { ...TRACK, id: 't2' }, isPlaying: true });
      nowPlayingStore.getState().setCover('file:///cover/fresh.jpg');
    });
    img = tree.root.findAll((n) => n.props.testID === 'now-playing-cover')[0];
    expect(img).toBeTruthy();
    expect(img.props.source).toEqual({ uri: 'file:///cover/fresh.jpg' });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('B1: a coverUri with NO track (foreign playback at boot, empty queue) shows the placeholder and does NOT crash', async () => {
    // The cover is set on its own channel (resolver) decoupled from the track, so
    // coverUri!=null && track==null is reachable — Spotify already playing a foreign song
    // at boot with an empty queue. The cover's a11y label reads track.title, so rendering
    // the <Image> here would null-deref. Gate the cover on track metadata.
    nowPlayingStore.getState().set({ track: null, isPlaying: false });
    nowPlayingStore.getState().setCover('file:///cover/foreign.jpg');
    const tree = await render();
    expect(tree.root.findAll((n) => n.props.testID === 'now-playing-cover')).toHaveLength(0);
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('♪');                    // placeholder shown, no crash
    expect(all).toContain('Nothing playing yet');  // empty state intact
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('falls back to the token placeholder (no Image) when coverUri is null', async () => {
    nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
    nowPlayingStore.getState().setCover(null);
    const tree = await render();
    expect(tree.root.findAll((n) => n.props.testID === 'now-playing-cover')).toHaveLength(0);
    expect(texts(tree.toJSON()).join(' ')).toContain('♪'); // placeholder glyph still shown
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders the mix-receipt (label + detail) when the track carries one', async () => {
    nowPlayingStore.getState().set({
      track: { ...TRACK, receipt: { label: 'New discovery', detail: 'Matched to your mood · 128 BPM' } },
      isPlaying: true,
    });
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('New discovery');
    expect(all).toContain('Matched to your mood');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('shows no receipt row when the track has no receipt', async () => {
    nowPlayingStore.getState().set({ track: { ...TRACK, receipt: null }, isPlaying: true });
    const tree = await render();
    expect(tree.root.findAll((n) => n.props.testID === 'now-playing-receipt')).toHaveLength(0);
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

  // ── §2.a tail: the low-emphasis "Up next" trigger opening the Up-Next sheet ──
  describe('Up next sheet trigger (§2.a tail — shipped hierarchy preserved)', () => {
    it('renders a low-emphasis "Up next" button beneath the transport with a ≥44pt tap target', async () => {
      nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
      const tree = await render();
      const trigger = byLabel(tree, 'Up next');
      expect(trigger).toBeTruthy();
      expect(trigger.props.accessibilityRole).toBe('button');
      expect(StyleSheet.flatten(trigger.props.style).minHeight).toBeGreaterThanOrEqual(44);
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('does not disturb the shipped now-playing-receipt node (Task 3 owns it)', async () => {
      nowPlayingStore.getState().set({ track: { ...TRACK, receipt: { label: 'Familiar favorite' } }, isPlaying: true });
      const tree = await render();
      expect(tree.root.findAll((n) => n.props.testID === 'now-playing-receipt').length).toBeGreaterThan(0);
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('keeps the Up-Next sheet closed by default', async () => {
      nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
      const tree = await render();
      expect(tree.root.findAll((n) => n.props.testID === 'upnext-sheet')).toHaveLength(0);
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('tapping "Up next" opens the sheet (reads the live queue through the orchestrator)', async () => {
      nowPlayingStore.getState().set({ track: TRACK, isPlaying: true });
      const tree = await render();
      await ReactTestRenderer.act(async () => { byLabel(tree, 'Up next').props.onPress(); });
      await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
      expect(tree.root.findAll((n) => n.props.testID === 'upnext-sheet').length).toBeGreaterThan(0);
      expect(orchestrator.getQueueTracks as jest.Mock).toHaveBeenCalled();
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });
  });

  // ── NP-ATTR (compliance C1/C2): Spotify attribution + link-back on the Now Playing surface ──
  describe('Spotify attribution on Now Playing (NP-ATTR)', () => {
    it('renders the Spotify attribution mark + link-back on the surface, as its own element distinct from the receipt', async () => {
      nowPlayingStore.getState().set({
        track: { ...TRACK, receipt: { label: 'New discovery', detail: 'Matched to your mood · 128 BPM' } },
        isPlaying: true,
      });
      const tree = await render();
      // the attribution mark is present on the surface…
      expect(tree.root.findAll((n) => n.props.testID === 'spotify-attribution').length).toBeGreaterThan(0);
      // …with the link-back affordance…
      expect(tree.root.findAll((n) => n.props.testID === 'spotify-attribution-linkback').length).toBeGreaterThan(0);
      // …and it is NOT merged into / a descendant of the receipt node (nothing implies Spotify authored the pick).
      const receipt = tree.root.findAll((n) => n.props.testID === 'now-playing-receipt')[0];
      expect(receipt).toBeTruthy();
      expect(receipt.findAll((n) => n.props.testID === 'spotify-attribution')).toHaveLength(0);
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });
  });

  // ── L2: the connection subscribe effect must re-read live status on mount ──
  describe('L2: live connection status is re-synced on mount', () => {
    it('re-reads playerStatusStore on effect-commit so a transition after the initial render is not dropped', async () => {
      // getState() is disconnected for the useState initializer, then connected by effect-commit time —
      // the mount re-read must catch up. Old code (subscribe-only) would strand on disconnected.
      let calls = 0;
      const real = playerStatusStore.getState.bind(playerStatusStore);
      const spy = jest.spyOn(playerStatusStore, 'getState').mockImplementation(() => {
        calls += 1;
        return { ...real(), status: calls <= 1 ? 'disconnected' : 'connected' } as any;
      });
      const tree = await render(); // no track → no soft note unless we are stranded on 'disconnected'
      await ReactTestRenderer.act(async () => { byLabel(tree, 'Up next').props.onPress(); });
      await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
      expect(texts(tree.toJSON()).join(' ')).not.toContain('Reconnecting'); // caught the → connected transition
      spy.mockRestore();
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });
  });
});
