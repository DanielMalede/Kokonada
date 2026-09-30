// The one gate every Spotify link-back passes through (HX-4, CMP-008). Spotify Developer Policy II.4
// requires metadata and cover art to link back to the applicable content, so a link-back may only
// ever open the EXACT item on screen: a track, album or playlist named by its Spotify URI.
//
// Spotify documents an id as base-62 and documents no length, so none is enforced here: a length
// check would silently drop the link-back from a valid item. Anything else — the bare scheme with
// no item, a user or artist URI, an id carrying `?`, `/`, `#` or whitespace — yields null, and the
// caller then draws no control and opens nothing.
//
// Pure (no native imports), so the attribution mark can decide whether to draw its control without
// pulling in the playback graph.

export type SpotifyContentType = 'track' | 'album' | 'playlist';

export interface SpotifyContentLink {
  type: SpotifyContentType;
  id: string;
  // Opened when Spotify is installed ("OPEN SPOTIFY").
  uri: string;
  // Opened when it is not ("GET SPOTIFY FREE"): Spotify's documented web page for the same item.
  webUrl: string;
}

const SPOTIFY_CONTENT_URI = /^spotify:(track|album|playlist):([0-9A-Za-z]+)$/;

export function parseSpotifyContentUri(uri: unknown): SpotifyContentLink | null {
  if (typeof uri !== 'string') return null;
  const m = SPOTIFY_CONTENT_URI.exec(uri);
  if (!m) return null;
  const type = m[1] as SpotifyContentType;
  const id = m[2];
  return { type, id, uri, webUrl: `https://open.spotify.com/${type}/${id}` };
}
