// HX-4 (CMP-008, Spotify Developer Policy II.4): the link-back must land on the EXACT item whose
// metadata and cover are on screen. This pure parser is the single gate for that: it accepts only a
// Spotify URI for a track, album or playlist with a base-62 id, and yields both link targets — the
// app URI (Spotify installed) and the open.spotify.com page (not installed, Spotify's documented web
// fallback). Spotify documents the id as base-62 and documents no length, so no length is pinned.

import { parseSpotifyContentUri } from '../spotifyContentLink';
import { PlaybackQueue } from '../../playback/playbackQueue';

describe('parseSpotifyContentUri — accepts exactly a track, album or playlist URI with a base-62 id', () => {
  it.each([
    ['spotify:track:11dFghVXANMlKmJXsNCbNl', 'track', '11dFghVXANMlKmJXsNCbNl'],
    ['spotify:album:4aawyAB9vmqN3uQ7FjRGTy', 'album', '4aawyAB9vmqN3uQ7FjRGTy'],
    ['spotify:playlist:3cEYpjA9oz9GiPac4AsH4n', 'playlist', '3cEYpjA9oz9GiPac4AsH4n'],
  ])('%s → the app URI unchanged and the open.spotify.com page for the same item', (uri, type, id) => {
    expect(parseSpotifyContentUri(uri)).toEqual({
      type,
      id,
      uri,
      webUrl: `https://open.spotify.com/${type}/${id}`,
    });
  });

  it.each(['a', '1', 'Z9', 't1', 'xyz', '123456789012345678901', '12345678901234567890123', 'A'.repeat(40)])(
    'a base-62 id of any length is accepted (no length is documented): %s',
    (id) => {
      expect(parseSpotifyContentUri(`spotify:track:${id}`)?.id).toBe(id);
    },
  );

  it.each([
    ['bare scheme', 'spotify:'],
    ['type with no id', 'spotify:track:'],
    ['a user URI', 'spotify:user:someone'],
    ['a legacy user playlist URI', 'spotify:user:someone:playlist:3cEYpjA9oz9GiPac4AsH4n'],
    ['an artist URI (not a linkable item type here)', 'spotify:artist:0OdUWJ0sBjDrqHygGUXeCF'],
    ['an episode URI', 'spotify:episode:512ojhOuo1ktJprKbVcKyQ'],
    ['a query string', 'spotify:track:11dFghVXANMlKmJXsNCbNl?si=abc'],
    ['a path separator', 'spotify:track:11dFghVXANMlKmJXsNCbNl/extra'],
    ['a fragment', 'spotify:track:11dFghVXANMlKmJXsNCbNl#t=10'],
    ['an inner space', 'spotify:track:11dFgh VXANMlKmJXsNCbNl'],
    ['a leading space', ' spotify:track:11dFghVXANMlKmJXsNCbNl'],
    ['a trailing space', 'spotify:track:11dFghVXANMlKmJXsNCbNl '],
    ['a trailing newline', 'spotify:track:11dFghVXANMlKmJXsNCbNl\n'],
    ['a tab', 'spotify:track:11dFghVXANMlKmJXsNCbNl\t'],
    ['an underscore (not base-62)', 'spotify:track:SOMETHING_ELSE'],
    ['a hyphen (not base-62)', 'spotify:track:abc-def'],
    ['a non-ASCII letter', 'spotify:track:abcé'],
    ['an upper-case scheme', 'SPOTIFY:TRACK:11dFghVXANMlKmJXsNCbNl'],
    ['a web URL (not a URI)', 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl'],
    ['an extra segment', 'spotify:track:11dFghVXANMlKmJXsNCbNl:extra'],
    ['the empty string', ''],
  ])('rejects %s', (_label, uri) => {
    expect(parseSpotifyContentUri(uri)).toBeNull();
  });

  it.each([null, undefined, 42, {}, ['spotify:track:a']])('rejects a non-string (%p)', (value) => {
    expect(parseSpotifyContentUri(value)).toBeNull();
  });
});

describe('parseSpotifyContentUri — every URI the queue accepts as playable is linkable', () => {
  // The backend mints a playable URI as `spotify:track:<id>` (toClientTrack), and the suite's queue
  // fixtures use short ids of every length. Run them through the REAL PlaybackQueue and walk its
  // playable cursor: whatever the queue will play, the link-back must be able to link.
  const IDS = [
    '11dFghVXANMlKmJXsNCbNl', '4iV5W9uYEdYUVa79Axb7Rh', '0VjIjW4GlUZAMYd2vXMi3b', // real 22-char ids
    'a', 'b', '1', '9', 't1', 'b1', 'cur', 'xyz', 'FOREIGN', 'foreign', // fixture ids across the suite
  ];

  // URIs the queue must NEVER play: each would put metadata on screen with no link-back to it
  // (Policy II.4). The queue accepted any non-empty string before HX-4 round 1.
  const UNLINKABLE_IN_PAYLOAD = [
    'spotify:episode:x',
    'spotify:track:11dFghVXANMlKmJXsNCbNl?si=1',
    'spotify:local:a:b:c:1',
    'youtube:x',
  ];

  it('walks the whole playable queue: every current().uri is a linkable TRACK, and no other URI is ever yielded', () => {
    const q = new PlaybackQueue();
    q.load([
      { id: 'data-only', uri: null, title: 'YouTube-only', artist: 'x' }, // never playable, skipped
      ...UNLINKABLE_IN_PAYLOAD.map((uri, i) => ({ id: `bad${i}`, uri, title: `bad${i}`, artist: 'x' })),
      ...IDS.map((id) => ({ id, uri: `spotify:track:${id}`, title: id, artist: 'x' })),
    ]);
    const seen: string[] = [];
    let t = q.current();
    while (t) {
      seen.push(t.uri as string);
      expect(parseSpotifyContentUri(t.uri)?.type).toBe('track');
      t = q.hasNext() ? q.next() : null;
    }
    expect(seen).toHaveLength(IDS.length); // the walk covered every playable track, not a vacuous zero
    for (const bad of UNLINKABLE_IN_PAYLOAD) expect(seen).not.toContain(bad);
  });
});
