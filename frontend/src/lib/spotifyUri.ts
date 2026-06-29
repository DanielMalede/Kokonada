// Mirror of backend/app/utils/spotifyUri.js so the client never POSTs a URI the
// server would reject. Spotify track ids are exactly 22 base-62 chars; a single
// malformed URI makes the Spotify Web API 400 the whole play/add-tracks request,
// so we filter before sending.
const SPOTIFY_TRACK_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/;

export function isSpotifyTrackUri(uri: unknown): uri is string {
  return typeof uri === 'string' && SPOTIFY_TRACK_URI_RE.test(uri);
}

/** Valid, de-duplicated Spotify track URIs, order preserved. */
export function sanitizeTrackUris(uris: readonly unknown[]): string[] {
  if (!Array.isArray(uris)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const uri of uris) {
    if (!isSpotifyTrackUri(uri) || seen.has(uri)) continue;
    seen.add(uri);
    out.push(uri);
  }
  return out;
}
