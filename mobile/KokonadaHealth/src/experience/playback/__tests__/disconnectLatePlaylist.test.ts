// HX-2 B1 (resilience) — a playlist that arrives AFTER Disconnect Spotify must not reconnect Spotify.
//
// A generation requested before the tap still answers with playlist_ready. Before this fix the
// orchestrator accepted it — clear() latched nothing — and play() → ensureConnected() spent the
// untouched reconnect budget, App Remote reconnected, and the Profile row read Connected again.
// Pause/resume could do the same through togglePlayPause.
//
// Real PlaybackOrchestrator + real SpotifyPlayerController; only the native App Remote is faked, and
// it COUNTS what reaches it — so "nothing reconnects" is observed at the native boundary.

import { PlaybackOrchestrator, type PlaybackSocket } from '../playbackOrchestrator';
import { PlaybackQueue, type QueueTrack } from '../playbackQueue';
import { SpotifyPlayerController, type SpotifyRemoteLike } from '../../player/spotifyController';

const T = (id: string): QueueTrack => ({ id, uri: `spotify:track:${id}`, title: id, artist: 'x', receipt: null, recordingKey: null });

function fakeRemote() {
  const calls = { connect: 0, playUri: 0, resume: 0, pause: 0, disconnect: 0 };
  const remote: SpotifyRemoteLike = {
    connect: async () => { calls.connect += 1; },
    disconnect: async () => { calls.disconnect += 1; },
    isConnectedAsync: async () => true,
    playUri: async () => { calls.playUri += 1; },
    pause: async () => { calls.pause += 1; },
    resume: async () => { calls.resume += 1; },
    addListener: () => {},
    removeAllListeners: () => {},
  };
  return { remote, calls };
}

function build() {
  const { remote, calls } = fakeRemote();
  const player = new SpotifyPlayerController({ remote, getToken: async () => 'ready' });
  const socket: PlaybackSocket = { requestPlaylist: () => 1, requestHeartPlaylist: () => 1, ensureConnected: () => {} };
  const nowPlaying: Array<{ track: QueueTrack | null; isPlaying: boolean }> = [];
  const orchestrator = new PlaybackOrchestrator({
    player, socket, queue: new PlaybackQueue(),
    scheduler: { schedule: () => 1, cancel: () => {} },
    onNowPlaying: (s) => nowPlaying.push(s),
  });
  // The device half of Disconnect Spotify, in the order profileServices runs it.
  const disconnect = async () => { await player.dispose(); orchestrator.clear(); };
  const reset = () => { for (const k of Object.keys(calls) as Array<keyof typeof calls>) calls[k] = 0; };
  return { orchestrator, player, calls, nowPlaying, disconnect, reset };
}

describe('after Disconnect Spotify, nothing reaches Spotify again (B1)', () => {
  it('a late spotify: playlist is dropped: 0 connect, 0 playUri, 0 resume, and Now Playing stays empty', async () => {
    const w = build();
    await w.orchestrator.handlePlaylist({ tracks: [T('a'), T('b')] });
    expect(w.calls.playUri).toBe(1); // control: before the disconnect it really plays
    await w.disconnect();
    w.reset();

    await w.orchestrator.handlePlaylist({ tracks: [T('late1'), T('late2')], contextUri: 'spotify:playlist:hidden' });

    expect(w.calls).toMatchObject({ connect: 0, playUri: 0, resume: 0 });
    expect(w.nowPlaying[w.nowPlaying.length - 1].track).toBeNull();
    expect(w.orchestrator.getNowPlaying()).toEqual({ track: null, isPlaying: false });
    expect(w.player.getState()).toBe('disconnected');
  });

  it('play/pause after the disconnect cannot resume Spotify either', async () => {
    const w = build();
    await w.orchestrator.handlePlaylist({ tracks: [T('a')] });
    await w.disconnect();
    w.reset();

    await w.orchestrator.togglePlayPause();

    expect(w.calls).toMatchObject({ connect: 0, resume: 0, pause: 0 });
  });

  it('the dropped playlist still releases the generation guard (no wedged "generating")', async () => {
    const w = build();
    await w.disconnect();
    const generations: number[] = [];
    (w.orchestrator as any).socket.requestPlaylist = () => { generations.push(1); return generations.length; };

    await w.orchestrator.handlePlaylist({ tracks: [T('late')] });

    expect((w.orchestrator as any).generationPending).toBe(false);
  });

  it('resume() — a fresh Spotify link — lets the next playlist play again', async () => {
    const w = build();
    await w.disconnect();
    w.reset();

    w.orchestrator.resume();
    await w.orchestrator.handlePlaylist({ tracks: [T('back')] });

    expect(w.calls.connect).toBe(1);
    expect(w.calls.playUri).toBe(1);
    expect(w.orchestrator.getNowPlaying().track?.id).toBe('back');
  });
});
