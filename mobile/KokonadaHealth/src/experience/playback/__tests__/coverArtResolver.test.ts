// The Now Playing cover comes from the LIVE App Remote player state (authoritative for
// what is actually audible), NOT the queue. This resolver turns each PlayerState
// imageUri into a local cover file and pushes it onto the now-playing store. Two hard
// resilience rules are pinned here:
//   • DEDUPE — fetch ONLY when imageUri CHANGES (position ticks fire constantly with the
//     SAME imageUri; a fetch per tick would hammer the native imagesApi).
//   • NEVER BLOCK — resolution is fire-and-forget; a rejection leaves the cover null (the
//     screen keeps its placeholder), and a stale in-flight fetch can never flash an old
//     cover after the track already changed.

import { CoverArtResolver } from '../coverArtResolver';

const flush = () => new Promise((r) => setImmediate(r));

function build() {
  const getTrackImage = jest.fn(async (uri: string) => `file:///cover/${uri}.jpg`);
  const setCover = jest.fn();
  const resolver = new CoverArtResolver({ getTrackImage, setCover });
  return { resolver, getTrackImage, setCover };
}

describe('CoverArtResolver — dedupe by imageUri (fetch once per track change)', () => {
  it('fetches exactly ONCE across repeated same-imageUri ticks (position updates), then again on a NEW imageUri', () => {
    const { resolver, getTrackImage } = build();
    resolver.onImageUri('img-a'); // track A → fetch
    resolver.onImageUri('img-a'); // same track, position tick → skip
    resolver.onImageUri('img-a'); // same track, position tick → skip
    expect(getTrackImage).toHaveBeenCalledTimes(1);
    resolver.onImageUri('img-b'); // track changed → fetch again
    expect(getTrackImage).toHaveBeenCalledTimes(2);
  });

  it('sets the resolved cover file on the store on success', async () => {
    const { resolver, getTrackImage, setCover } = build();
    getTrackImage.mockResolvedValueOnce('file:///cover/a.jpg');
    resolver.onImageUri('img-a');
    await flush();
    expect(setCover).toHaveBeenCalledWith('file:///cover/a.jpg');
  });

  it('sets the cover to null on a rejected fetch (screen falls back to the placeholder)', async () => {
    const { resolver, getTrackImage, setCover } = build();
    getTrackImage.mockRejectedValueOnce(new Error('imagesApi failed'));
    resolver.onImageUri('img-a');
    await flush();
    expect(setCover).toHaveBeenCalledWith(null);
  });

  it('a null imageUri clears the cover WITHOUT calling the native bridge', () => {
    const { resolver, getTrackImage, setCover } = build();
    resolver.onImageUri(null);
    expect(getTrackImage).not.toHaveBeenCalled();
    expect(setCover).toHaveBeenCalledWith(null);
  });

  it('never re-fetches or re-clears on a repeated null (dedupe applies to null too)', () => {
    const { resolver, getTrackImage, setCover } = build();
    resolver.onImageUri(null);
    resolver.onImageUri(null);
    expect(getTrackImage).not.toHaveBeenCalled();
    expect(setCover).toHaveBeenCalledTimes(1);
  });
});

describe('CoverArtResolver — no JS cache (native owns the file cache) + stale-fetch resilience', () => {
  // M4: the resolver keeps NO JS cache — native caches to a file keyed by the uri and
  // self-heals after a cacheDir purge via its own exists()+length check. The JS-side dedupe
  // is purely the lastImageUri latch (prevents per-tick re-fetch), so A→B→A re-fetches A.
  it('re-selecting a track RE-FETCHES via native (no stale JS cache short-circuit)', async () => {
    const { resolver, getTrackImage, setCover } = build();
    resolver.onImageUri('img-a'); await flush(); // fetch A (1)
    resolver.onImageUri('img-b'); await flush(); // fetch B (2)
    setCover.mockClear();
    resolver.onImageUri('img-a'); await flush(); // back to A — re-fetch (3), native cache-hits the file
    expect(getTrackImage).toHaveBeenCalledTimes(3);
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/img-a.jpg');
  });

  it('a fetch that resolves AFTER the track changed again does not overwrite the current cover', async () => {
    const { resolver, getTrackImage, setCover } = build();
    let resolveA!: (v: string) => void;
    getTrackImage
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveA = r; })) // A hangs
      .mockResolvedValueOnce('file:///cover/b.jpg');                                // B resolves
    resolver.onImageUri('img-a'); // A in-flight (hangs)
    resolver.onImageUri('img-b'); // track moved on to B
    await flush();
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/b.jpg');
    resolveA('file:///cover/a.jpg'); // A finally resolves — but A is stale now
    await flush();
    expect(setCover).not.toHaveBeenCalledWith('file:///cover/a.jpg');
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/b.jpg');
  });

  // L5(c): A→B→A where B resolves LATE must not clobber the now-current A cover.
  it('A→B→A: a late B resolution never overwrites the re-selected A cover', async () => {
    const { resolver, getTrackImage, setCover } = build();
    let resolveB!: (v: string) => void;
    getTrackImage
      .mockResolvedValueOnce('file:///cover/a1.jpg')                                  // A (1)
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveB = r; }))    // B hangs (2)
      .mockResolvedValueOnce('file:///cover/a2.jpg');                                 // A again (3)
    resolver.onImageUri('img-a'); await flush();
    resolver.onImageUri('img-b'); // B in-flight (hangs)
    resolver.onImageUri('img-a'); await flush(); // A is current again
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/a2.jpg');
    resolveB('file:///cover/b.jpg'); await flush(); // late B — stale
    expect(setCover).not.toHaveBeenCalledWith('file:///cover/b.jpg');
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/a2.jpg');
  });

  // L5(b): a failed fetch must NOT permanently stick — re-selecting the same imageUri later
  // re-fetches (no JS cache marks it as failed/absent).
  it('a rejected fetch clears the cover, and a later re-select of the same imageUri re-fetches', async () => {
    const { resolver, getTrackImage, setCover } = build();
    getTrackImage.mockRejectedValueOnce(new Error('imagesApi boom')); // only the first (A) fails
    resolver.onImageUri('img-a'); await flush();
    expect(setCover).toHaveBeenLastCalledWith(null);
    resolver.onImageUri('img-b'); await flush(); // navigate away
    resolver.onImageUri('img-a'); await flush(); // back to A — re-fetch, now succeeds
    expect(getTrackImage).toHaveBeenCalledTimes(3);
    expect(setCover).toHaveBeenLastCalledWith('file:///cover/img-a.jpg');
  });

  // M4: reset() clears the dedupe latch (wired from the remoteDisconnected path) so a
  // reconnect re-fetches the current cover instead of being deduped into staleness.
  it('reset() clears the latch so the same imageUri re-fetches after a disconnect', async () => {
    const { resolver, getTrackImage } = build();
    resolver.onImageUri('img-a'); await flush(); // fetch (1)
    resolver.onImageUri('img-a');                // deduped — no fetch
    expect(getTrackImage).toHaveBeenCalledTimes(1);
    resolver.reset();
    resolver.onImageUri('img-a'); await flush(); // latch cleared → re-fetch (2)
    expect(getTrackImage).toHaveBeenCalledTimes(2);
  });
});
