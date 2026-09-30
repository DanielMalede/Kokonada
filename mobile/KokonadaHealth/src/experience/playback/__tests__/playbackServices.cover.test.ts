// HX-4 M3, the glue: the REAL playbackServices graph (SpotifyPlayerController → CoverArtResolver →
// nowPlayingStore) driven by a native PlayerState emission. App Remote reports the track URI and its
// image in ONE PlayerState; this pins that the glue hands BOTH to the resolver, so the cover lands in
// the store paired with the track it belongs to. Only the native module is replaced — the global
// stub from jest.setup, plus a stateful image bridge that resolves each image to its own cached file.

import { SpotifyRemote } from '@kokonada/spotify-remote';

const flush = () => new Promise((r) => setImmediate(r));

type Emit = (state: { trackUri: string | null; isPaused: boolean; imageUri?: string | null }) => void;
let emit: Emit;
let nowPlayingStore: typeof import('../nowPlayingStore').nowPlayingStore;

beforeAll(() => {
  (SpotifyRemote as any).getTrackImage = jest.fn(async (imageUri: string) => `file:///cache/${imageUri}.jpg`);
  // Loading the module builds the graph; the controller subscribes to the native PlayerState stream.
  require('../playbackServices');
  nowPlayingStore = require('../nowPlayingStore').nowPlayingStore;
  const calls = (SpotifyRemote.onPlayerStateChanged as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0); // the real controller subscribed — not a vacuous harness
  emit = calls[calls.length - 1][0];
});

describe('playbackServices — the live cover is stored paired with its PlayerState track', () => {
  it('a PlayerState (track + image) stores the resolved cover with THAT track URI', async () => {
    emit({ trackUri: 'spotify:track:aaa', isPaused: false, imageUri: 'spotify:image:aaa' });
    await flush();
    const s = nowPlayingStore.getState();
    expect(s.coverUri).toBe('file:///cache/spotify:image:aaa.jpg');
    expect(s.coverTrackUri).toBe('spotify:track:aaa');
  });

  it('the next track (same album image) re-pairs the cover with the new track', async () => {
    emit({ trackUri: 'spotify:track:bbb', isPaused: false, imageUri: 'spotify:image:aaa' });
    await flush();
    expect(nowPlayingStore.getState().coverTrackUri).toBe('spotify:track:bbb');
  });
});
