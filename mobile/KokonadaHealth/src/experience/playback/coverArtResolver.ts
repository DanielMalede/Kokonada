// Resolves the LIVE App Remote player-state image URI into a local cover file and pushes
// it onto the now-playing store — DECOUPLED from the queue. The App Remote player state
// is authoritative for what is actually audible, so its imageUri (fetched client-side via
// the native imagesApi, exactly like the web read art off the Playback SDK) is the honest
// source for the Now Playing cover. Title/artist/receipt still come from our queue.
//
// Because the cover and our track come from different sources, every cover is PAIRED with
// the track URI App Remote reported in the same PlayerState (HX-4 M3, Spotify Developer
// Policy II.4: the cover must belong to the item the link-back opens). The screen shows it
// only while that URI is the track on screen, so a song played inside Spotify never lends
// its art to ours.
//
// Two resilience rules are load-bearing:
//   • DEDUPE — the native PlayerState stream fires on every position tick with the SAME
//     (imageUri, trackUri); fetch ONLY when that pair actually CHANGES, never per tick. A new
//     track on the same album re-fetches once (a cheap native cache hit) so the cover is
//     re-paired with it. That latch is the ONLY JS-side cache — there is deliberately no
//     resolved-path Map: native already caches the bitmap to a file keyed by the uri and
//     SELF-HEALS after a cacheDir purge via its own exists()+length check. A JS path cache
//     would go stale on that purge and stick a now-missing file forever (M4).
//   • NEVER BLOCK — resolution is fire-and-forget relative to playback/UI: onImageUri
//     returns immediately, a rejection leaves the cover null (placeholder), and a stale
//     in-flight fetch that lands after the track already changed is discarded.

export interface CoverArtResolverDeps {
  // Native bridge: resolve a Spotify image URI to a local file:// path (cached on-device).
  getTrackImage: (imageUri: string) => Promise<string>;
  // Push the resolved cover (or null on absence/failure) onto the now-playing store, with the
  // track URI it belongs to (null when there is no cover).
  setCover: (coverUri: string | null, trackUri: string | null) => void;
}

interface PlayerStateArt {
  imageUri: string | null;
  trackUri: string | null;
}

export class CoverArtResolver {
  // undefined = never seen a value yet (distinct from an explicit null "no art" track). Each
  // PlayerState that changes the pair gets a fresh object: only the latest one may write.
  private last: PlayerStateArt | undefined = undefined;

  constructor(private readonly deps: CoverArtResolverDeps) {}

  // Called on EVERY native PlayerState tick with the current track's image URI and track URI.
  onImageUri(imageUri: string | null, trackUri: string | null): void {
    const prev = this.last;
    if (prev && prev.imageUri === imageUri && prev.trackUri === trackUri) return; // same state — skip
    const current: PlayerStateArt = { imageUri, trackUri };
    this.last = current;
    if (!imageUri) { this.deps.setCover(null, null); return; } // track carries no art
    // Resolve OFF the playback path (native cache-hits the file when it already exists).
    // Guard against a stale resolution (the state changed again before this fetch returned)
    // so an old cover never flashes over the new, nor pairs with a track it no longer matches.
    this.deps.getTrackImage(imageUri)
      .then((file) => { if (this.last === current) this.deps.setCover(file, trackUri); })
      .catch(() => { if (this.last === current) this.deps.setCover(null, null); });
  }

  // Drop the dedupe latch (wired from the remoteDisconnected path) so a reconnect re-fetches
  // the current cover instead of being deduped into staleness.
  reset(): void {
    this.last = undefined;
  }
}
