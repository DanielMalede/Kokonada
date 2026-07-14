// The playback queue holds a generated playlist and a cursor. It knows how to
// advance/retreat, how to skip tracks that have no Spotify URI (YouTube-only tracks
// are data, not playable), and it never lets the cursor run off either end.

import { PlaybackQueue, type QueueTrack } from '../playbackQueue';

const T = (id: string, uri: string | null = `spotify:track:${id}`): QueueTrack => ({ id, uri, title: id, artist: 'x', receipt: null, recordingKey: null });

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

describe('PlaybackQueue — receipt payload (Wave 2.8; cover now comes from the SDK, not the queue)', () => {
  it('carries the receipt through sanitize onto the current track, and carries NO imageUrl', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      imageUrl: 'https://img/a', receipt: { label: 'New discovery', detail: 'Matched to your mood · 128 BPM' } } as any]);
    const cur = q.current();
    expect(cur?.receipt).toEqual({ label: 'New discovery', detail: 'Matched to your mood · 128 BPM' });
    // The cover is decoupled — it is resolved from the live App Remote player state, so the
    // queue track must not carry imageUrl (a stale server URL would 403 / be wrong).
    expect(cur).not.toHaveProperty('imageUrl');
  });

  it('defaults the receipt to null when a legacy payload omits it (backward compatible)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x' } as any]); // no receipt
    const cur = q.current();
    expect(cur?.receipt).toBeNull();
    expect(cur).not.toHaveProperty('imageUrl');
  });

  it('keeps a receipt with only a label (detail is optional)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x', receipt: { label: 'Familiar favorite' } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'Familiar favorite' });
  });

  it('drops a malformed receipt defensively (never crashes)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x', receipt: 'nope' } as any]);
    expect(q.current()?.receipt).toBeNull();
  });
});

describe('PlaybackQueue — receipt anchor (Wave 2.8 enriched discovery; additive, back-compat)', () => {
  it('keeps a valid anchor { title, artist } on a discovery receipt', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', detail: 'Matched to your mood', anchor: { title: 'Blue', artist: 'Joni Mitchell' } } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery', detail: 'Matched to your mood', anchor: { title: 'Blue', artist: 'Joni Mitchell' } });
  });

  it('strips the anchor when the title is missing (honest — no half claim)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', anchor: { artist: 'Joni Mitchell' } } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery' });
  });

  it('strips the anchor when the artist is blank / whitespace', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', anchor: { title: 'Blue', artist: '   ' } } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery' });
  });

  it('strips the anchor when the title is an empty string (detail is preserved)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', detail: 'd', anchor: { title: '', artist: 'Joni Mitchell' } } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery', detail: 'd' });
  });

  it('strips a non-object anchor defensively (never crashes)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', anchor: 'Joni Mitchell' } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery' });
  });

  it('a receipt with NO anchor is byte-identical to before (back-compat)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', detail: 'Matched to your mood · 128 BPM' } } as any]);
    const r = q.current()?.receipt;
    expect(r).toEqual({ label: 'New discovery', detail: 'Matched to your mood · 128 BPM' });
    expect(r).not.toHaveProperty('anchor');
  });
});

describe('PlaybackQueue — receipt caption (discovery-caption LLM; the witty "why this discovery" one-liner)', () => {
  it('keeps a valid non-empty caption string on a discovery receipt', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', detail: 'Matched to your calm', caption: 'A slow jam your calm didn\'t know it needed.' } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery', detail: 'Matched to your calm', caption: 'A slow jam your calm didn\'t know it needed.' });
  });

  it('trims a caption with surrounding whitespace before keeping it', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', caption: '  Smooth enough to lower your heart rate.  ' } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery', caption: 'Smooth enough to lower your heart rate.' });
  });

  it('strips an empty-string caption', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', detail: 'd', caption: '' } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery', detail: 'd' });
  });

  it('strips a whitespace-only caption (never surfaces a blank enriched line)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', caption: '   ' } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery' });
  });

  it('strips a non-string caption defensively (never crashes)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', caption: 123 } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery' });
  });

  it('a receipt with NO caption is byte-identical to before (back-compat)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', detail: 'Matched to your mood · 128 BPM' } } as any]);
    const r = q.current()?.receipt;
    expect(r).toEqual({ label: 'New discovery', detail: 'Matched to your mood · 128 BPM' });
    expect(r).not.toHaveProperty('caption');
  });

  it('keeps BOTH a caption and an anchor when both are present (transition window — Step 4 removes anchor)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x',
      receipt: { label: 'New discovery', detail: 'd', caption: 'A slow jam.', anchor: { title: 'Blue', artist: 'Joni Mitchell' } } } as any]);
    expect(q.current()?.receipt).toEqual({ label: 'New discovery', detail: 'd', caption: 'A slow jam.', anchor: { title: 'Blue', artist: 'Joni Mitchell' } });
  });
});

describe('PlaybackQueue — recordingKey payload (Phase 2; identifies a discovery track for failure reporting)', () => {
  it('carries a discovery track recordingKey through sanitize onto the current track', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x', recordingKey: 'youtube:abc' } as any]);
    expect(q.current()?.recordingKey).toBe('youtube:abc');
  });

  it('defaults recordingKey to null for a familiar track that carries none', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x' } as any]); // no recordingKey
    expect(q.current()?.recordingKey).toBeNull();
  });

  it('coerces a non-string recordingKey to null (never trusts a malformed payload)', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x', recordingKey: 123 } as any]);
    expect(q.current()?.recordingKey).toBeNull();
    const q2 = new PlaybackQueue();
    q2.load([{ id: 'b', uri: 'spotify:track:b', title: 'B', artist: 'x', recordingKey: {} } as any]);
    expect(q2.current()?.recordingKey).toBeNull();
  });

  it('coerces an empty-string recordingKey to null', () => {
    const q = new PlaybackQueue();
    q.load([{ id: 'a', uri: 'spotify:track:a', title: 'A', artist: 'x', recordingKey: '' } as any]);
    expect(q.current()?.recordingKey).toBeNull();
  });
});

describe('PlaybackQueue — seekToId (Up-Next tap-to-jump to a specific queued track)', () => {
  it('moves the cursor to the playable track with that id and returns it', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b'), T('c')]);
    expect(q.seekToId('c')?.id).toBe('c');
    expect(q.current()?.id).toBe('c');
  });

  it('returns null and leaves the cursor put for an id we never queued', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b')]);
    expect(q.seekToId('zzz')).toBeNull();
    expect(q.current()?.id).toBe('a');
  });

  it('returns null for a data-only (unplayable) row and does not move the cursor', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b', null)]);
    expect(q.seekToId('b')).toBeNull();
    expect(q.current()?.id).toBe('a');
  });

  it('is defensive against a non-string / empty id (never throws, never moves)', () => {
    const q = new PlaybackQueue();
    q.load([T('a')]);
    expect(q.seekToId(undefined as any)).toBeNull();
    expect(q.seekToId('')).toBeNull();
    expect(q.current()?.id).toBe('a');
  });
});

describe('PlaybackQueue — list (read-only snapshot for the Up-Next sheet)', () => {
  it('returns every queued track in order, including data-only rows', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b', null), T('c')]);
    expect(q.list().map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns a copy — mutating the snapshot cannot corrupt the queue', () => {
    const q = new PlaybackQueue();
    q.load([T('a'), T('b')]);
    q.list().pop();
    expect(q.list().map((t) => t.id)).toEqual(['a', 'b']);
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
