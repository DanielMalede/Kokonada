// The Now Playing cover comes from the LIVE App Remote player state (authoritative for
// what is actually audible), NOT the queue. This resolver turns each PlayerState
// imageUri into a local cover file and pushes it onto the now-playing store, PAIRED with
// the track URI reported in the same PlayerState (HX-4 M3: the cover must belong to the
// linked item, so the screen shows it only while that URI is the track on screen). Three
// hard rules are pinned here:
//   • DEDUPE — fetch ONLY when the (imageUri, trackUri) pair CHANGES (position ticks fire
//     constantly with the SAME pair; a fetch per tick would hammer the native imagesApi).
//   • NEVER BLOCK — resolution is fire-and-forget; a rejection leaves the cover null (the
//     screen keeps its placeholder), and a stale in-flight fetch can never flash an old
//     cover after the track already changed.
//   • PAIR — every cover written carries the track it was resolved for; it is never paired
//     with a track it was not reported with.

import { CoverArtResolver } from '../coverArtResolver';

const flush = () => new Promise((r) => setImmediate(r));

const A = 'spotify:track:a';
const B = 'spotify:track:b';

function build() {
  const getTrackImage = jest.fn(async (uri: string) => `file:///cover/${uri}.jpg`);
  const setCover = jest.fn();
  const resolver = new CoverArtResolver({ getTrackImage, setCover });
  return { resolver, getTrackImage, setCover };
}

describe('CoverArtResolver — dedupe by (imageUri, trackUri) (fetch once per track change)', () => {
  it('fetches exactly ONCE across repeated same-state ticks (position updates), then again on a NEW imageUri', () => {
    const { resolver, getTrackImage } = build();
    resolver.onImageUri('img-a', A); // track A → fetch
    resolver.onImageUri('img-a', A); // same track, position tick → skip
    resolver.onImageUri('img-a', A); // same track, position tick → skip
    expect(getTrackImage).toHaveBeenCalledTimes(1);
    resolver.onImageUri('img-b', B); // track changed → fetch again
    expect(getTrackImage).toHaveBeenCalledTimes(2);
  });

  it('sets the resolved cover file on the store on success, paired with its track', async () => {
    const { resolver, getTrackImage, setCover } = build();
    getTrackImage.mockResolvedValueOnce('file:///cover/a.jpg');
    resolver.onImageUri('img-a', A);
    await flush();
    expect(setCover).toHaveBeenCalledWith('file:///cover/a.jpg', A);
  });

  it('sets the cover to null on a rejected fetch (screen falls back to the placeholder)', async () => {
    const { resolver, getTrackImage, setCover } = build();
    getTrackImage.mockRejectedValueOnce(new Error('imagesApi failed'));
    resolver.onImageUri('img-a', A);
    await flush();
    expect(setCover).toHaveBeenCalledWith(null, null);
  });

  it('a null imageUri clears the cover WITHOUT calling the native bridge', () => {
    const { resolver, getTrackImage, setCover } = build();
    resolver.onImageUri(null, A);
    expect(getTrackImage).not.toHaveBeenCalled();
    expect(setCover).toHaveBeenCalledWith(null, null);
  });

  it('never re-fetches or re-clears on a repeated null (dedupe applies to null too)', () => {
    const { resolver, getTrackImage, setCover } = build();
    resolver.onImageUri(null, A);
    resolver.onImageUri(null, A);
    expect(getTrackImage).not.toHaveBeenCalled();
    expect(setCover).toHaveBeenCalledTimes(1);
  });
});

describe('CoverArtResolver — no JS cache (native owns the file cache) + stale-fetch resilience', () => {
  // M4: the resolver keeps NO JS cache — native caches to a file keyed by the uri and
  // self-heals after a cacheDir purge via its own exists()+length check. The JS-side dedupe
  // is purely the last-state latch (prevents per-tick re-fetch), so A→B→A re-fetches A.
  it('re-selecting a track RE-FETCHES via native (no stale JS cache short-circuit)', async () => {
    const { resolver, getTrackImage, setCover } = build();
    resolver.onImageUri('img-a', A); await flush(); // fetch A (1)
    resolver.onImageUri('img-b', B); await flush(); // fetch B (2)
    setCover.mockClear();
    resolver.onImageUri('img-a', A); await flush(); // back to A — re-fetch (3), native cache-hits the file
    expect(getTrackImage).toHaveBeenCalledTimes(3);
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/img-a.jpg', A);
  });

  it('a fetch that resolves AFTER the track changed again does not overwrite the current cover', async () => {
    const { resolver, getTrackImage, setCover } = build();
    let resolveA!: (v: string) => void;
    getTrackImage
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveA = r; })) // A hangs
      .mockResolvedValueOnce('file:///cover/b.jpg');                                // B resolves
    resolver.onImageUri('img-a', A); // A in-flight (hangs)
    resolver.onImageUri('img-b', B); // track moved on to B
    await flush();
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/b.jpg', B);
    resolveA('file:///cover/a.jpg'); // A finally resolves — but A is stale now
    await flush();
    expect(setCover).not.toHaveBeenCalledWith('file:///cover/a.jpg', expect.anything());
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/b.jpg', B);
  });

  // L5(c): A→B→A where B resolves LATE must not clobber the now-current A cover.
  it('A→B→A: a late B resolution never overwrites the re-selected A cover', async () => {
    const { resolver, getTrackImage, setCover } = build();
    let resolveB!: (v: string) => void;
    getTrackImage
      .mockResolvedValueOnce('file:///cover/a1.jpg')                                  // A (1)
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveB = r; }))    // B hangs (2)
      .mockResolvedValueOnce('file:///cover/a2.jpg');                                 // A again (3)
    resolver.onImageUri('img-a', A); await flush();
    resolver.onImageUri('img-b', B); // B in-flight (hangs)
    resolver.onImageUri('img-a', A); await flush(); // A is current again
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/a2.jpg', A);
    resolveB('file:///cover/b.jpg'); await flush(); // late B — stale
    expect(setCover).not.toHaveBeenCalledWith('file:///cover/b.jpg', expect.anything());
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/a2.jpg', A);
  });

  // L5(b): a failed fetch must NOT permanently stick — re-selecting the same imageUri later
  // re-fetches (no JS cache marks it as failed/absent).
  it('a rejected fetch clears the cover, and a later re-select of the same imageUri re-fetches', async () => {
    const { resolver, getTrackImage, setCover } = build();
    getTrackImage.mockRejectedValueOnce(new Error('imagesApi boom')); // only the first (A) fails
    resolver.onImageUri('img-a', A); await flush();
    expect(setCover).toHaveBeenLastCalledWith(null, null);
    resolver.onImageUri('img-b', B); await flush(); // navigate away
    resolver.onImageUri('img-a', A); await flush(); // back to A — re-fetch, now succeeds
    expect(getTrackImage).toHaveBeenCalledTimes(3);
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/img-a.jpg', A);
  });

  // M4: reset() clears the dedupe latch (wired from the remoteDisconnected path) so a
  // reconnect re-fetches the current cover instead of being deduped into staleness.
  it('reset() clears the latch so the same imageUri re-fetches after a disconnect', async () => {
    const { resolver, getTrackImage } = build();
    resolver.onImageUri('img-a', A); await flush(); // fetch (1)
    resolver.onImageUri('img-a', A);                // deduped — no fetch
    expect(getTrackImage).toHaveBeenCalledTimes(1);
    resolver.reset();
    resolver.onImageUri('img-a', A); await flush(); // latch cleared → re-fetch (2)
    expect(getTrackImage).toHaveBeenCalledTimes(2);
  });
});

// HX-4 M3: the cover must belong to the linked item. App Remote reports the image and the track in
// ONE PlayerState, so the resolver pairs them there — and nowhere else.
describe('CoverArtResolver — the cover is paired with the track it was reported with (HX-4 M3)', () => {
  it('pairs the resolved cover with the trackUri from the same PlayerState', async () => {
    const { resolver, setCover } = build();
    resolver.onImageUri('img-a', A);
    await flush();
    expect(setCover.mock.calls).toEqual([['file:///cover/img-a.jpg', A]]);
  });

  it('the SAME image on a NEW track (same album) re-pairs with the new track — never left on the old one', async () => {
    const { resolver, getTrackImage, setCover } = build();
    resolver.onImageUri('img-album', A); await flush();
    resolver.onImageUri('img-album', B); await flush(); // next track, same album art
    expect(getTrackImage).toHaveBeenCalledTimes(2); // a cheap native cache hit, once per track change
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/img-album.jpg', B);
  });

  it('a same-image fetch for the OLD track that lands after the track changed never pairs the old track', async () => {
    const { resolver, getTrackImage, setCover } = build();
    let resolveOld!: (v: string) => void;
    getTrackImage
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveOld = r; })) // (img, A) hangs
      .mockResolvedValueOnce('file:///cover/album.jpg');                              // (img, B) resolves
    resolver.onImageUri('img-album', A);
    resolver.onImageUri('img-album', B);
    await flush();
    resolveOld('file:///cover/album.jpg');
    await flush();
    expect(setCover.mock.calls).toEqual([['file:///cover/album.jpg', B]]);
  });

  it('a PlayerState with no track URI yields a cover paired with null (which no track on screen can match)', async () => {
    const { resolver, setCover } = build();
    resolver.onImageUri('img-a', null);
    await flush();
    expect(setCover.mock.calls).toEqual([['file:///cover/img-a.jpg', null]]);
  });
});
