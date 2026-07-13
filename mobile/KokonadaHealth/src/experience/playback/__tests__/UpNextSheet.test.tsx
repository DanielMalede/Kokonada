import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

// SpotifyAttribution pulls the native playback graph for its default wiring — stub it to a marker so
// this suite stays focused on the sheet (the real mark is covered in SpotifyAttribution.test.tsx).
jest.mock('../../player/SpotifyAttribution', () => {
  const React2 = require('react');
  const { View } = require('react-native');
  return { SpotifyAttribution: () => React2.createElement(View, { testID: 'spotify-attribution' }) };
});
// The commit haptic — spy it so "haptics.selection on jump commit" is observable without native.
jest.mock('../../../design/haptics', () => ({ fireHaptic: jest.fn() }));

import { UpNextSheet } from '../UpNextSheet';
import { fireHaptic } from '../../../design/haptics';
import { PlaybackOrchestrator } from '../playbackOrchestrator';
import { PlaybackQueue, type QueueTrack } from '../playbackQueue';

const fireHapticMock = fireHaptic as jest.Mock;

// ── track + text helpers ─────────────────────────────────────────────────────
const TR = (id: string, recordingKey: string | null = null, uri: string | null = `spotify:track:${id}`): QueueTrack =>
  ({ id, uri, title: `Title ${id}`, artist: `Artist ${id}`, receipt: null, recordingKey });

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const byId = (root: any, id: string) => root.findAll((n: any) => n.props.testID === id)[0];
const allById = (root: any, id: string) => root.findAll((n: any) => n.props.testID === id);

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  // Flush the reduce-motion probe + let the FlatList cell-render timer settle inside act.
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return tree;
}
// findAll matches both composite AND host instances carrying a testID, so exact counts inflate;
// presence (>0) / absence (===0) are the robust checks. Whitespace between nested Text nodes varies,
// so header/label strings are normalized before substring checks.
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const flushMicrotasks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function makeScheduler() {
  let pending: (() => void) | null = null;
  return {
    scheduler: { schedule: (fn: () => void) => { pending = fn; return 1; }, cancel: () => { pending = null; } },
    flush: () => { const f = pending; pending = null; f?.(); },
  };
}
// Real orchestrator + stateful fake player (mirrors the playback suite): a "dead" uri fails with
// command_failed (a track Spotify refused), a "disconnected" uri fails with reason 'disconnected'.
function buildOrch(opts: { dead?: string[]; disconnected?: string[]; maxConsecutiveFailures?: number } = {}) {
  const dead = new Set((opts.dead ?? []).map((id) => `spotify:track:${id}`));
  const severed = new Set((opts.disconnected ?? []).map((id) => `spotify:track:${id}`));
  const player: any = {
    played: [] as string[],
    play: jest.fn(async (uri: string) => {
      player.played.push(uri);
      if (severed.has(uri)) return { ok: false, reason: 'disconnected' };
      if (dead.has(uri)) return { ok: false, reason: 'command_failed' };
      return { ok: true };
    }),
    pause: jest.fn(async () => ({ ok: true })),
    resume: jest.fn(async () => ({ ok: true })),
  };
  const socket: any = { requestPlaylist: jest.fn(() => 1), requestHeartPlaylist: jest.fn(() => 1), ensureConnected: jest.fn() };
  const sched = makeScheduler();
  const onPlaybackFailed = jest.fn();
  const orch = new PlaybackOrchestrator({
    player, socket, queue: new PlaybackQueue(), scheduler: sched.scheduler, onPlaybackFailed,
    maxConsecutiveFailures: opts.maxConsecutiveFailures,
  });
  return { orch, player, sched, onPlaybackFailed };
}

const FIVE = [TR('a'), TR('b', 'k:b'), TR('c', 'k:c'), TR('d'), TR('e')]; // n=5, m=2 discovery (b, c)

const base = {
  visible: true as boolean,
  onClose: () => {},
  tracks: FIVE,
  currentTrackId: 'a' as string | null,
  isPlaying: true,
  quadrant: 'calm' as const,
  connection: 'connected' as 'connected' | 'connecting' | 'disconnected',
  onJump: () => {},
};

beforeEach(() => {
  jest.clearAllMocks();
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

describe('UpNextSheet — visibility gate', () => {
  it('renders nothing when not visible', async () => {
    const tree = await render(<UpNextSheet {...base} visible={false} />);
    expect(tree.toJSON()).toBeNull();
  });
});

describe('UpNextSheet — honest header summary (discovery = recordingKey != null)', () => {
  it('shows "{n} tracks · {m} new for you", counting m by recordingKey', async () => {
    const tree = await render(<UpNextSheet {...base} />);
    const header = norm(texts(byId(tree.root, 'upnext-header')).join(' '));
    expect(header).toContain('5 tracks');
    expect(header).toContain('2 new');
    expect(header).toContain('for you');
  });

  it('tints the "{m} new" span in emotionAccent[q].ink', async () => {
    const tree = await render(<UpNextSheet {...base} quadrant="joyful" />);
    const span = byId(tree.root, 'upnext-newcount');
    const style = StyleSheet.flatten(span.props.style) as any;
    // joyful ink on the (jest default) light face
    expect(style.color).toBeTruthy();
    expect(norm(texts(span).join(' '))).toContain('2 new');
  });

  it('places the Spotify attribution mark on the sheet surface (C1/C2)', async () => {
    const tree = await render(<UpNextSheet {...base} />);
    expect(byId(tree.root, 'spotify-attribution')).toBeTruthy();
  });
});

describe('UpNextSheet — rows: badge only on discovery rows, metadata verbatim', () => {
  it('renders a DiscoveryBadge on rows with a recordingKey and none on familiar rows', async () => {
    const tree = await render(<UpNextSheet {...base} />);
    expect(allById(byId(tree.root, 'upnext-row-b'), 'discovery-badge').length).toBeGreaterThan(0); // discovery
    expect(allById(byId(tree.root, 'upnext-row-c'), 'discovery-badge').length).toBeGreaterThan(0); // discovery
    expect(allById(byId(tree.root, 'upnext-row-a'), 'discovery-badge').length).toBe(0); // familiar
    expect(allById(byId(tree.root, 'upnext-row-d'), 'discovery-badge').length).toBe(0); // familiar
  });

  it('shows the Spotify-resolved title + artist verbatim (C3)', async () => {
    const tree = await render(<UpNextSheet {...base} />);
    const row = texts(byId(tree.root, 'upnext-row-c')).join(' ');
    expect(row).toContain('Title c');
    expect(row).toContain('Artist c');
  });
});

describe('UpNextSheet — cursor row: four non-color signals (rail + wash + weight + glyph)', () => {
  it('draws the leading rail + a ▶ glyph on the playing cursor row', async () => {
    const tree = await render(<UpNextSheet {...base} currentTrackId="c" isPlaying />);
    const rail = byId(byId(tree.root, 'upnext-row-c'), 'upnext-cursor-rail');
    expect(rail).toBeTruthy();
    expect(texts(byId(tree.root, 'upnext-cursor-glyph')).join('')).toBe('▶');
    // non-cursor rows carry no rail
    expect(allById(byId(tree.root, 'upnext-row-a'), 'upnext-cursor-rail').length).toBe(0);
  });

  it('shows the ❙❙ paused glyph when the cursor row is paused', async () => {
    const tree = await render(<UpNextSheet {...base} currentTrackId="c" isPlaying={false} />);
    expect(texts(byId(tree.root, 'upnext-cursor-glyph')).join('')).toBe('❙❙');
  });
});

describe('UpNextSheet — soft states (never red, never a dead end)', () => {
  it('disconnected → a soft "Reconnecting…" note (not state.danger); rows dim but stay tappable', async () => {
    const onJump = jest.fn();
    const tree = await render(<UpNextSheet {...base} connection="disconnected" onJump={onJump} />);
    expect(texts(byId(tree.root, 'upnext-note')).join(' ')).toContain('Reconnecting');
    await ReactTestRenderer.act(async () => { byId(tree.root, 'upnext-row-b').props.onPress(); });
    expect(onJump).toHaveBeenCalledTimes(1); // still tappable
  });

  it('foreign track (cursor not in our set) → no rail + soft "Playing from Spotify"', async () => {
    const tree = await render(<UpNextSheet {...base} currentTrackId="zzz-foreign" connection="connected" />);
    expect(texts(byId(tree.root, 'upnext-note')).join(' ')).toContain('Playing from Spotify');
    expect(allById(tree.root, 'upnext-cursor-rail').length).toBe(0); // no row is the cursor
  });

  it('end-of-queue (cursor on the last playable track) → soft "End of set · finding more…" footer', async () => {
    const tree = await render(<UpNextSheet {...base} currentTrackId="e" />);
    expect(texts(byId(tree.root, 'upnext-footer')).join(' ')).toContain('End of set');
  });
});

describe('UpNextSheet — accessibility', () => {
  it('is a focus-trapped modal', async () => {
    const tree = await render(<UpNextSheet {...base} />);
    expect(byId(tree.root, 'upnext-sheet').props.accessibilityViewIsModal).toBe(true);
  });

  it('labels each row "Play {title} by {artist}[, new discovery][, now playing/paused], track {i+1} of {n}"', async () => {
    const tree = await render(<UpNextSheet {...base} currentTrackId="c" isPlaying />);
    expect(byId(tree.root, 'upnext-row-c').props.accessibilityLabel)
      .toBe('Play Title c by Artist c, new discovery, now playing, track 3 of 5');
    expect(byId(tree.root, 'upnext-row-a').props.accessibilityLabel)
      .toBe('Play Title a by Artist a, track 1 of 5');
    expect(byId(tree.root, 'upnext-row-b').props.accessibilityLabel)
      .toBe('Play Title b by Artist b, new discovery, track 2 of 5');
  });
});

describe('UpNextSheet — tap-to-jump wiring + optimistic reconcile', () => {
  it('tapping a row invokes onJump with that track and fires the selection haptic on commit', async () => {
    const onJump = jest.fn();
    const tree = await render(<UpNextSheet {...base} onJump={onJump} />);
    await ReactTestRenderer.act(async () => { byId(tree.root, 'upnext-row-d').props.onPress(); });
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'd' }));
    expect(fireHapticMock).toHaveBeenCalledWith('selection');
  });

  it('optimistic: the rail moves to the tapped row immediately, then reconciles to the real cursor', async () => {
    const tree = await render(<UpNextSheet {...base} currentTrackId="a" />);
    // rail starts on a
    expect(byId(byId(tree.root, 'upnext-row-a'), 'upnext-cursor-rail')).toBeTruthy();
    await ReactTestRenderer.act(async () => { byId(tree.root, 'upnext-row-c').props.onPress(); });
    // optimistic → rail jumps to c even though the currentTrackId prop is still 'a'
    expect(byId(byId(tree.root, 'upnext-row-c'), 'upnext-cursor-rail')).toBeTruthy();
    expect(allById(byId(tree.root, 'upnext-row-a'), 'upnext-cursor-rail').length).toBe(0);
    // the orchestrator's real state lands on 'd' (e.g. a dead-track skip) → the rail follows reality
    await ReactTestRenderer.act(async () => { tree.update(<UpNextSheet {...base} currentTrackId="d" />); });
    expect(byId(byId(tree.root, 'upnext-row-d'), 'upnext-cursor-rail')).toBeTruthy();
    expect(allById(byId(tree.root, 'upnext-row-c'), 'upnext-cursor-rail').length).toBe(0);
  });
});

// The critical guarantee: tap-to-jump routes through the SAME orchestrator path, so the #130
// self-heal invariants still hold. These wire onJump to a REAL orchestrator with a stateful fake.
describe('UpNextSheet — tap-to-jump preserves the #130 self-heal (real orchestrator, stateful fake)', () => {
  it('tapping a DEAD discovery row reports it once + auto-skips, without burning past the cap', async () => {
    const { orch, player, sched, onPlaybackFailed } = buildOrch({ dead: ['c'] });
    await ReactTestRenderer.act(async () => {
      await orch.handlePlaylist({ tracks: [TR('a'), TR('b'), TR('c', 'k:c'), TR('d')] });
    });
    player.played.length = 0;
    const tree = await render(
      <UpNextSheet {...base} tracks={orch.getQueueTracks()} currentTrackId="a" onJump={(t) => orch.jumpToId(t.id)} />,
    );
    await ReactTestRenderer.act(async () => { byId(tree.root, 'upnext-row-c').props.onPress(); });
    sched.flush();
    await ReactTestRenderer.act(async () => { await flushMicrotasks(); await new Promise((r) => setTimeout(r, 0)); });
    expect(player.played).toEqual(['spotify:track:c', 'spotify:track:d']); // tried c (dead), skipped to d
    expect(orch.getNowPlaying().track?.id).toBe('d');
    expect(onPlaybackFailed).toHaveBeenCalledTimes(1);
    expect(onPlaybackFailed).toHaveBeenCalledWith('k:c');
  });

  it('tapping a track while the remote is SEVERED degrades in place — no walk, no report', async () => {
    const { orch, player, sched, onPlaybackFailed } = buildOrch({ disconnected: ['c', 'd'] });
    await ReactTestRenderer.act(async () => {
      await orch.handlePlaylist({ tracks: [TR('a'), TR('b'), TR('c', 'k:c'), TR('d', 'k:d')] });
    });
    player.played.length = 0;
    const tree = await render(
      <UpNextSheet {...base} tracks={orch.getQueueTracks()} currentTrackId="a" connection="disconnected" onJump={(t) => orch.jumpToId(t.id)} />,
    );
    await ReactTestRenderer.act(async () => { byId(tree.root, 'upnext-row-c').props.onPress(); });
    sched.flush();
    await ReactTestRenderer.act(async () => { await flushMicrotasks(); await new Promise((r) => setTimeout(r, 0)); });
    expect(player.played).toEqual(['spotify:track:c']); // did NOT walk to d
    expect(orch.getNowPlaying().track?.id).toBe('c');
    expect(onPlaybackFailed).not.toHaveBeenCalled();
  });
});

describe('UpNextSheet — motion', () => {
  it('normal motion presents with the gentle spring', async () => {
    const handle = { start: jest.fn(), stop: jest.fn() };
    const spy = jest.spyOn(Animated, 'spring').mockReturnValue(handle as any);
    await render(<UpNextSheet {...base} />);
    expect(handle.start).toHaveBeenCalled();
    expect(handle.stop).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reduced motion presents instantly — the slide spring is torn down, never left running', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
    const handle = { start: jest.fn(), stop: jest.fn() };
    const spy = jest.spyOn(Animated, 'spring').mockReturnValue(handle as any);
    await render(<UpNextSheet {...base} />);
    expect(handle.stop).toHaveBeenCalled(); // reduce-motion resolved → slide stilled
    spy.mockRestore();
  });
});
