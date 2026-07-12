// Resolves the LIVE App Remote player-state image URI into a local cover file and pushes
// it onto the now-playing store — DECOUPLED from the queue. The App Remote player state
// is authoritative for what is actually audible, so its imageUri (fetched client-side via
// the native imagesApi, exactly like the web read art off the Playback SDK) is the honest
// source for the Now Playing cover. Title/artist/receipt still come from our queue.
//
// Two resilience rules are load-bearing:
//   • DEDUPE — the native PlayerState stream fires on every position tick with the SAME
//     imageUri; fetch ONLY when the imageUri actually CHANGES, never per tick. That latch
//     is the ONLY JS-side cache — there is deliberately no resolved-path Map: native already
//     caches the bitmap to a file keyed by the uri and SELF-HEALS after a cacheDir purge via
//     its own exists()+length check. A JS path cache would go stale on that purge and stick
//     a now-missing file forever (M4). The redundant native round-trip on re-select is cheap.
//   • NEVER BLOCK — resolution is fire-and-forget relative to playback/UI: onImageUri
//     returns immediately, a rejection leaves the cover null (placeholder), and a stale
//     in-flight fetch that lands after the track already changed is discarded.

export interface CoverArtResolverDeps {
  // Native bridge: resolve a Spotify image URI to a local file:// path (cached on-device).
  getTrackImage: (imageUri: string) => Promise<string>;
  // Push the resolved cover (or null on absence/failure) onto the now-playing store.
  setCover: (coverUri: string | null) => void;
}

export class CoverArtResolver {
  // undefined = never seen a value yet (distinct from an explicit null "no art" track).
  private lastImageUri: string | null | undefined = undefined;

  constructor(private readonly deps: CoverArtResolverDeps) {}

  // Called on EVERY native PlayerState tick with the current track's image URI.
  onImageUri(imageUri: string | null): void {
    if (imageUri === this.lastImageUri) return; // same track (or same "no art") — skip
    this.lastImageUri = imageUri;
    if (!imageUri) { this.deps.setCover(null); return; } // track carries no art
    // Resolve OFF the playback path (native cache-hits the file when it already exists).
    // Guard against a stale resolution (the track changed again before this fetch returned)
    // so an old cover never flashes over the new.
    this.deps.getTrackImage(imageUri)
      .then((file) => { if (this.lastImageUri === imageUri) this.deps.setCover(file); })
      .catch(() => { if (this.lastImageUri === imageUri) this.deps.setCover(null); });
  }

  // Drop the dedupe latch (wired from the remoteDisconnected path) so a reconnect re-fetches
  // the current cover instead of being deduped into staleness.
  reset(): void {
    this.lastImageUri = undefined;
  }
}
