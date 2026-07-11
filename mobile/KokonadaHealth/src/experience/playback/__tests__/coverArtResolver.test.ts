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

describe('CoverArtResolver — caching + stale-fetch resilience', () => {
  it('re-selecting a previously-resolved track serves the cached file instantly (no second fetch)', async () => {
    const { resolver, getTrackImage, setCover } = build();
    resolver.onImageUri('img-a'); await flush(); // fetch A
    resolver.onImageUri('img-b'); await flush(); // fetch B
    expect(getTrackImage).toHaveBeenCalledTimes(2);
    setCover.mockClear();
    resolver.onImageUri('img-a'); // back to A — cached, no fetch
    expect(getTrackImage).toHaveBeenCalledTimes(2);
    expect(setCover).toHaveBeenCalledWith('file:///cover/img-a.jpg');
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
});
