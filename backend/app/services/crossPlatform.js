'use strict';

const spotify = require('./spotify');
const { isYoutubeContent } = require('../utils/youtubeContent');
const { YOUTUBE_EGRESS_ENABLED } = require('../config/youtubeSeal');

// Serve-time translation onto Spotify, the only playback engine. A track with a spotify: URI passes
// through untouched; a catalogue (CC0 mbid:) discovery candidate with no URI is resolved to a
// playable Spotify track through the Spotify Search API.
//
// DEC-040 (HX-3 T5): YouTube Content is NEVER searched. Spotify Developer Policy III.5 forbids
// translating a YouTube track into a Spotify one in every state, and YouTube Developer Policies
// III.E.3.b forbid passing a user's YouTube data to anyone they have not approved. So while
// YOUTUBE_EGRESS_ENABLED is false — which config/youtubeSeal.js says it must stay — a track the ONE
// shared predicate calls YouTube Content is counted missed and skipped before its title is parsed and
// before the search. That also stops a YouTube row arriving from anywhere else (a stale cached pool).

// Noise commonly appended to YouTube music titles that hurts an exact Spotify match.
const TITLE_NOISE =
  /\((official\s*)?(music\s*)?(video|audio|lyrics?|visualizer|hd|hq|4k)\)|\[[^\]]*\]|\((official|lyric|audio|visualizer)[^)]*\)|official\s*(music\s*)?video|lyric video|\(feat\.?[^)]*\)/gi;

/** Strip YouTube channel decorations so "Artist - Topic" / "ArtistVEVO" -> "Artist". */
function cleanYouTubeArtist(channelTitle) {
  if (!channelTitle) return '';
  return String(channelTitle)
    .replace(/\s*-\s*Topic\s*$/i, '')
    .replace(/\s*-\s*Official Artist Channel\s*$/i, '')
    .replace(/VEVO\s*$/i, '')
    .replace(/\s*-?\s*Official\s*$/i, '')
    .trim();
}

/**
 * Parse a YouTube video's title + channel into a best-guess { title, artist } for a
 * Spotify search. Handles the ubiquitous "Artist - Song (Official Video)" pattern and
 * falls back to the cleaned channel name as the artist (typical of "- Topic" uploads).
 */
function parseYouTubeTitle(rawTitle, channelTitle) {
  const channelArtist = cleanYouTubeArtist(channelTitle);
  const title = String(rawTitle || '').replace(TITLE_NOISE, ' ').replace(/\s+/g, ' ').trim();

  // A dash in the title is the "Artist - Song" music-video pattern -> the left side is
  // the artist as the uploader intended (usually cleaner than a decorated VEVO channel).
  // No dash is the auto-generated "- Topic" pattern -> the cleaned channel is the artist.
  const dash = title.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) {
    return { title: dash.slice(1).join(' - ').trim(), artist: dash[0].trim() };
  }
  return { title, artist: channelArtist };
}

/** The true origin a translated track carries (M5, BE-054; YouTube Developer Policies III.F.2.b). */
function _originOf(t) {
  return isYoutubeContent(t) ? 'youtube' : 'catalog';
}

/**
 * Translate a list of pipeline tracks into PLAYABLE Spotify tracks. Already-Spotify
 * tracks pass through; catalogue tracks are resolved via Spotify search (best-effort -
 * an unmatched track is dropped, never blocks the rest); YouTube Content is dropped unsearched. Searches run in PARALLEL with a
 * concurrency cap and an overall deadline so a slow/rate-limited Spotify can never stall
 * generation (sequential translation of ~50 tracks took minutes). A per-run promise cache
 * dedupes repeat lookups even under parallelism. Returns the list plus counts.
 *
 * @param {Array} tracks               pipeline tracks ({ uri, name|title, artist, provider })
 * @param {string} accessToken         Spotify access token (the playback account)
 * @param {{ searchFn?:Function, cache?:Map, concurrency?:number, deadlineMs?:number }} [opts]
 * @returns {Promise<{ tracks: Array, translated: number, missed: number }>}
 */
async function translateToSpotify(tracks, accessToken, opts = {}) {
  const searchFn = opts.searchFn || spotify.searchTrackUri;
  // Cache stores the in-flight PROMISE (set synchronously before awaiting) so concurrent
  // lookups of the same title|artist share ONE search - dedup survives parallelism.
  const cache = opts.cache || new Map();
  // Low concurrency so a burst of searches doesn't trip Spotify's search rate limit (which
  // returns a large Retry-After that withRetry then waits out — the source of the hang).
  const concurrency = opts.concurrency ?? 4;
  const deadlineMs = opts.deadlineMs ?? 9000;
  const list = Array.isArray(tracks) ? tracks : [];

  // Positioned result -> compacted at the end, so playlist ORDER is preserved even though
  // the parallel searches finish out of order.
  const result = new Array(list.length);
  let translated = 0;
  let missed = 0;
  const deadline = Date.now() + deadlineMs;

  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const t = list[i];
      if (typeof t?.uri === 'string' && t.uri.startsWith('spotify:')) { result[i] = t; continue; }
      // DEC-040: before the title is parsed and before any search.
      if (!YOUTUBE_EGRESS_ENABLED && isYoutubeContent(t)) { missed++; continue; }
      // Out of time: stop STARTING new searches (in-flight ones still finish). Best-effort -
      // whatever resolved is served, so a slow/rate-limited Spotify can't stall generation.
      if (Date.now() >= deadline) { missed++; continue; }

      const { title, artist } = parseYouTubeTitle(t?.name ?? t?.title, t?.artist);
      if (!title) { missed++; continue; }

      const key = `${title} ${artist}`.toLowerCase();
      let p = cache.get(key);
      if (!p) { p = Promise.resolve(searchFn(accessToken, { title, artist })).catch(() => null); cache.set(key, p); }
      const hit = await p;

      if (hit?.uri) {
        translated++;
        result[i] = { ...t, id: hit.id, uri: hit.uri, name: hit.name ?? title, artist: hit.artist ?? artist, provider: 'spotify', translatedFrom: _originOf(t) };
      } else {
        missed++;
      }
    }
  };

  // HARD overall bound: race the workers against a wall-clock timer. A rate-limited search
  // can wait out a large Retry-After (via withRetry) and effectively never return; awaiting
  // Promise.all on those stalled generation for MINUTES. Once the deadline fires we return
  // whatever resolved and ABANDON the stuck searches (they settle later, discarded).
  const workers = Promise.all(Array.from({ length: Math.min(concurrency, list.length) || 0 }, worker));
  let timer;
  await Promise.race([workers, new Promise((resolve) => { timer = setTimeout(resolve, deadlineMs); })]);
  clearTimeout(timer);
  return { tracks: result.filter(Boolean), translated, missed };
}

module.exports = { cleanYouTubeArtist, parseYouTubeTitle, translateToSpotify, _originOf };
