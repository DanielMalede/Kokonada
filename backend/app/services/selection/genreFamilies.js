'use strict';

// W4-010 (d) · Static curated genre → family taxonomy.
//
// score's genre term is a two-rung step: a track whose genres hit the mood allow-list scores
// 1.0, everything else scores 0.3. So against an allow-list of "house", the genre "deep house"
// is judged exactly as wrong as "death metal" — the scorer has no notion that two genres can
// be NEARLY the same thing. This map supplies that notion, and W4-010 spends it on a middle
// rung (same family → 0.7).
//
// It is STATIC CURATED DATA, not a model (ADR-0012): no provider ids, no audio features, no
// fitted coefficients, nothing derived from Spotify or YouTube content. It is a taxonomy in
// the same sense as `TAG_TO_GENRE` / `WIKI_TOPIC_TO_GENRE` in musicProfileService, just wider,
// and it is safe to consult on the serving path for any user.
//
// Two levels, by construction: ~15 families over ~150 genres, every genre in exactly one
// family (pinned). The vocabulary is the intersection of what Spotify artist genres actually
// emit, what our own YouTube tag/topic mappers produce, and what MusicBrainz/AcousticBrainz
// tags look like — biased toward head terms, because the head-noun fallback below covers the
// long tail of modifiers ("chicago house", "norwegian black metal") without listing them.

const GENRE_FAMILIES = {
  electronic: [
    'electronic', 'electronica', 'edm', 'house', 'deep house', 'tech house', 'progressive house',
    'techno', 'minimal techno', 'trance', 'psytrance', 'dubstep', 'drum and bass', 'dnb',
    'jungle', 'breakbeat', 'garage', 'uk garage', 'idm', 'glitch', 'synthwave', 'electro',
    'electro house', 'big room', 'future bass', 'hardstyle', 'trap edm', 'eurodance',
    'indietronica', 'electropop', 'nu disco', 'bass music',
  ],
  'ambient-chill': [
    'ambient', 'dark ambient', 'drone', 'downtempo', 'chillout', 'chillwave', 'trip hop',
    'lo-fi', 'lofi hip hop', 'new age', 'meditation', 'binaural', 'field recording',
    'space music', 'atmospheric',
  ],
  rock: [
    'rock', 'classic rock', 'hard rock', 'alternative rock', 'alternative', 'indie',
    'indie rock', 'indie pop', 'punk', 'punk rock', 'post-punk', 'pop punk', 'garage rock',
    'psychedelic rock', 'psych rock', 'progressive rock', 'prog rock', 'grunge', 'shoegaze',
    'post-rock', 'math rock', 'emo', 'britpop', 'surf rock', 'noise rock', 'art rock',
  ],
  metal: [
    'metal', 'heavy metal', 'death metal', 'black metal', 'doom metal', 'thrash metal',
    'power metal', 'progressive metal', 'metalcore', 'deathcore', 'nu metal', 'sludge',
    'grindcore', 'hardcore', 'industrial metal', 'symphonic metal',
  ],
  pop: [
    'pop', 'dance pop', 'synth pop', 'art pop', 'teen pop', 'k-pop', 'j-pop', 'c-pop',
    'europop', 'power pop', 'bubblegum pop', 'chamber pop', 'dream pop', 'hyperpop',
    'singer-songwriter', 'adult contemporary',
  ],
  'hip-hop': [
    'hip-hop', 'rap', 'trap', 'boom bap', 'conscious hip hop', 'gangsta rap', 'drill',
    'grime', 'cloud rap', 'east coast hip hop', 'west coast hip hop', 'southern hip hop',
    'alternative hip hop', 'instrumental hip hop', 'crunk',
  ],
  'r&b-soul': [
    'r&b', 'contemporary r&b', 'soul', 'neo soul', 'northern soul', 'motown', 'quiet storm',
    'new jack swing', 'gospel', 'doo-wop',
  ],
  'funk-disco': [
    'funk', 'disco', 'p-funk', 'boogie', 'g-funk', 'afro funk', 'jazz funk', 'italo disco',
  ],
  jazz: [
    'jazz', 'bebop', 'hard bop', 'cool jazz', 'free jazz', 'smooth jazz', 'jazz fusion',
    'swing', 'big band', 'vocal jazz', 'modal jazz', 'nu jazz', 'ragtime',
  ],
  classical: [
    'classical', 'baroque', 'romantic', 'opera', 'orchestral', 'chamber music', 'symphony',
    'choral', 'minimalism', 'contemporary classical', 'piano', 'neoclassical', 'soundtrack',
    'film score', 'video game music',
  ],
  'folk-country': [
    'folk', 'indie folk', 'folk rock', 'americana', 'country', 'classic country',
    'country rock', 'bluegrass', 'alt-country', 'singer songwriter folk', 'celtic',
    'acoustic', 'roots',
  ],
  blues: [
    'blues', 'delta blues', 'chicago blues', 'electric blues', 'blues rock', 'rhythm and blues',
    'boogie woogie',
  ],
  latin: [
    'latin', 'reggaeton', 'salsa', 'bachata', 'merengue', 'cumbia', 'bossa nova', 'samba',
    'mpb', 'tango', 'flamenco', 'latin pop', 'latin jazz', 'banda', 'ranchera',
  ],
  'reggae-caribbean': [
    'reggae', 'dancehall', 'dub', 'ska', 'rocksteady', 'roots reggae', 'soca', 'calypso',
  ],
  global: [
    'world', 'afrobeat', 'afrobeats', 'highlife', 'amapiano', 'bollywood', 'indian classical',
    'arabic', 'k-indie', 'j-rock', 'balkan', 'klezmer', 'gamelan', 'fado', 'chanson',
    'schlager', 'enka',
  ],
};

// genre → family, built once at require time.
const _byGenre = new Map();
for (const [family, genres] of Object.entries(GENRE_FAMILIES)) {
  for (const g of genres) _byGenre.set(g, family);
}

/**
 * Lowercase, collapse whitespace, and normalise the separators the three vocabularies
 * disagree on ("hip hop" / "hip-hop" / "hip_hop" are one genre, not three).
 */
function _normalize(genre) {
  if (typeof genre !== 'string') return '';
  return genre.toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The map keys use hyphens for the few compound heads that are conventionally hyphenated. */
function _lookup(norm) {
  if (!norm) return null;
  return _byGenre.get(norm) ?? _byGenre.get(norm.replace(/ /g, '-')) ?? _byGenre.get(norm.replace(/-/g, ' ')) ?? null;
}

/**
 * The family a genre belongs to, or null when the map genuinely does not know it.
 *
 * Exact lookup first; then a HEAD-NOUN fallback, because provider genre vocabularies are
 * overwhelmingly `<modifier> <head>` ("chicago house", "melodic dubstep", "norwegian black
 * metal") and enumerating the modifiers is hopeless. The fallback walks suffixes from the
 * longest to the shortest, so "norwegian black metal" resolves via "black metal" before it
 * would via "metal" — the more specific head wins, which matters wherever two families share
 * a trailing word.
 *
 * Returning null rather than guessing is deliberate: an unknown genre must fall to the
 * scorer's existing "miss" rung, not invent a similarity that isn't there.
 */
function familyOf(genre) {
  const norm = _normalize(genre);
  if (!norm) return null;
  const direct = _lookup(norm);
  if (direct) return direct;
  const words = norm.split(' ');
  for (let start = 1; start < words.length; start++) {
    const suffix = words.slice(start).join(' ');
    const hit = _lookup(suffix);
    if (hit) return hit;
  }
  return null;
}

/** Every family named by a list of genres (unknown genres contribute nothing). */
function familiesOf(genres) {
  const out = new Set();
  for (const g of genres || []) {
    const f = familyOf(g);
    if (f) out.add(f);
  }
  return out;
}

/**
 * True when the two genre lists share at least one family. False whenever either side is
 * empty or wholly unknown — "I cannot tell" is not "they match".
 */
function sameFamilyAny(genresA, genresB) {
  const a = familiesOf(genresA);
  if (!a.size) return false;
  for (const g of genresB || []) {
    const f = familyOf(g);
    if (f && a.has(f)) return true;
  }
  return false;
}

module.exports = { GENRE_FAMILIES, familyOf, familiesOf, sameFamilyAny };
