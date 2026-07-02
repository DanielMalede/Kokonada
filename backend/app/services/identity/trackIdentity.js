'use strict';

const { cleanYouTubeArtist, parseYouTubeTitle } = require('../crossPlatform');

// Canonical track identity: every track resolves to one key so the same song is
// recognized across providers (Spotify vs YouTube), releases (remasters, radio
// edits) and metadata noise. ISRC wins when present; otherwise a normalized
// artist|title fingerprint. Remixes are deliberately NOT collapsed — a remix is
// a different song.

// Featured-artist decorations: "(feat. X)" / "[ft. X]" anywhere, or a bare
// "feat./ft./featuring …" tail. Bare "with" is never stripped ("Dancing With
// Myself" must survive).
const PAREN_FEAT = /[(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g;
const BARE_FEAT = /\s(?:feat\.?|ft\.?|featuring)\s.*$/;

// Release/upload noise in parentheses or brackets. Word-bounded so "(Alive)"
// is not eaten by "live". "remix" is intentionally absent.
const PAREN_NOISE =
  /[(\[][^)\]]*\b(?:remaster\w*|live|radio edit|lyric\w*|official|video|audio|visualizer|mono|stereo|deluxe|version|bonus|anniversary)\b[^)\]]*[)\]]/g;

// Spotify-style dash-suffixed descriptors: "Song - Remastered 2011", "Song - Radio Edit".
const DASH_NOISE =
  /\s+[-–—]\s+(?:\d{4}\s+)?(?:remaster\w*|radio edit|single version|album version|mono|stereo|bonus track|live\b.*|acoustic\b.*)(?:\s+\d{4})?\s*$/;

function _fold(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin combining diacritics only (U+0300–U+036F)
    .normalize('NFC')      // re-compose so CJK voicing marks (e.g. ゼ) round-trip intact
    .toLowerCase();
}

// Apostrophes vanish ("don't" ≡ "dont"); all other punctuation becomes a space.
// Unicode-aware (\p{L}\p{N}) so Cyrillic/CJK/Arabic titles keep a real fingerprint
// instead of scrubbing to empty and falling back to per-provider ids.
function _scrub(value) {
  return value
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(title) {
  return _scrub(
    _fold(title)
      .replace(PAREN_FEAT, ' ')
      .replace(BARE_FEAT, ' ')
      .replace(PAREN_NOISE, ' ')
      .replace(DASH_NOISE, ' ')
  );
}

function normalizeArtist(artist) {
  return _scrub(_fold(artist).replace(PAREN_FEAT, ' ').replace(BARE_FEAT, ' '));
}

// Real ISRCs are exactly 12 chars: country (2 letters) + registrant (3 alphanumeric)
// + year (2 digits) + designation (5 digits). Anything else ("n/a", "TBD", objects)
// is provider junk — keying on it would collide unrelated tracks.
const ISRC_SHAPE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

function canonicalKey(track) {
  if (!track) return null;

  const isrc = String(track.isrc ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();
  if (ISRC_SHAPE.test(isrc)) return `isrc:${isrc}`;

  let title = track.title ?? track.name;
  let artist = track.artist;
  if (String(track.provider ?? '').startsWith('youtube')) {
    ({ title, artist } = parseYouTubeTitle(title, cleanYouTubeArtist(artist)));
  }

  const normTitle = normalizeTitle(title);
  const normArtist = normalizeArtist(artist);
  if (normTitle || normArtist) return `at:${normArtist}|${normTitle}`;

  if (track.provider && track.id) return `${track.provider}:${track.id}`;
  return null;
}

function attachCanonicalKeys(tracks = []) {
  for (const track of tracks) {
    if (track) track.canonicalKey = canonicalKey(track);
  }
  return tracks;
}

module.exports = { canonicalKey, normalizeArtist, normalizeTitle, attachCanonicalKeys };
