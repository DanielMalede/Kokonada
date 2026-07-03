// The playback queue holds a generated playlist and a cursor. It knows how to
// advance/retreat, how to skip tracks that have no Spotify URI (YouTube-only tracks
// are data, not playable), and it never lets the cursor run off either end.

import { PlaybackQueue, type QueueTrack } from '../playbackQueue';

const T = (id: string, uri: string | null = `spotify:track:${id}`): QueueTrack => ({ id, uri, title: id, artist: 'x' });

describe('PlaybackQueue — load & current', () => {
  it('loads a playlist and points at the first track', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b'), T('c')]);
    expect(q.current()?.id).toBe('a');
    expect(q.size()).toBe(3);
  });

  it('an empty load yields no current track', () => {
    const q = new PlaybackQueue();
    q.load([]);
    expect(q.current()).toBeNull();
    expect(q.hasNext()).toBe(false);
  });
});

describe('PlaybackQueue — navigation', () => {
  it('next advances, prev retreats', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b'), T('c')]);
    expect(q.next()?.id).toBe('b');
    expect(q.next()?.id).toBe('c');
    expect(q.prev()?.id).toBe('b');
  });

  it('next past the end returns null and does not move the cursor off the edge', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b')]);
    q.next(); // b
    expect(q.next()).toBeNull();  // past end
    expect(q.current()?.id).toBe('b'); // cursor stays on the last real track
    expect(q.hasNext()).toBe(false);
  });

  it('prev before the start clamps to the first track', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b')]);
    expect(q.prev()).toBeNull();
    expect(q.current()?.id).toBe('a');
  });
});

describe('PlaybackQueue — skip unplayable tracks', () => {
  it('next skips over tracks with no Spotify URI', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b', null), T('c', null), T('d')]);
    expect(q.current()?.id).toBe('a');
    expect(q.next()?.id).toBe('d'); // b and c (no uri) skipped
  });

  it('load skips a leading unplayable track to the first playable one', () => {
    const q = new PlaybackQueue();
    q.load([T('a', null), T('b')]);
    expect(q.current()?.id).toBe('b');
  });

  it('a playlist with NO playable tracks has a null current and no next', () => {
    const q = new PlaybackQueue();
    q.load([T('a', null), T('b', null)]);
    expect(q.current()).toBeNull();
    expect(q.hasNext()).toBe(false);
  });

  it('hasNext reflects whether a playable track remains ahead', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b', null)]);
    expect(q.hasNext()).toBe(false); // only unplayable ahead
  });
});

describe('PlaybackQueue — resilience', () => {
  it('FUZZ: garbage track entries are dropped, never crash', () => {
    const q = new PlaybackQueue();
    q.load([null as any, T('a'), undefined as any, { id: 'b' } as any, { uri: 'spotify:track:c' } as any]);
    // 'a' is fully valid; { id:'b' } has no uri → unplayable; { uri:... } has no id → dropped
    expect(q.current()?.id).toBe('a');
    expect(() => q.next()).not.toThrow();
  });
});
