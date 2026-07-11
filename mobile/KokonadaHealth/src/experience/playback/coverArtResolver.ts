// Resolves the LIVE App Remote player-state image URI into a local cover file and pushes
// it onto the now-playing store — DECOUPLED from the queue. The App Remote player state
// is authoritative for what is actually audible, so its imageUri (fetched client-side via
// the native imagesApi, exactly like the web read art off the Playback SDK) is the honest
// source for the Now Playing cover. Title/artist/receipt still come from our queue.
//
// Two resilience rules are load-bearing:
//   • DEDUPE — the native PlayerState stream fires on every position tick with the SAME
//     imageUri; fetch ONLY when the imageUri actually CHANGES, never per tick.
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
  // Resolved imageUri → local file path, so re-selecting a track is instant.
  private readonly cache = new Map<string, string>();

  constructor(private readonly deps: CoverArtResolverDeps) {}

  // Called on EVERY native PlayerState tick with the current track's image URI.
  onImageUri(imageUri: string | null): void {
    if (imageUri === this.lastImageUri) return; // same track (or same "no art") — skip
    this.lastImageUri = imageUri;
    if (!imageUri) { this.deps.setCover(null); return; } // track carries no art
    const cached = this.cache.get(imageUri);
    if (cached) { this.deps.setCover(cached); return; } // already resolved — instant
    // New art: resolve OFF the playback path. Guard against a stale resolution (the track
    // changed again before this fetch returned) so an old cover never flashes over the new.
    this.deps.getTrackImage(imageUri)
      .then((file) => {
        this.cache.set(imageUri, file);
        if (this.lastImageUri === imageUri) this.deps.setCover(file);
      })
      .catch(() => {
        if (this.lastImageUri === imageUri) this.deps.setCover(null);
      });
  }

  // Drop the dedupe latch + cache (e.g. on remote disconnect / teardown).
  reset(): void {
    this.lastImageUri = undefined;
    this.cache.clear();
  }
}
