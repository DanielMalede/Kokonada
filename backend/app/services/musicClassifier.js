'use strict';

// Music-vs-non-music classification for YouTube-sourced library tracks. A deterministic
// verdict from cheap signals (category / topicDetails / channel / title lexicon) ONLY — this
// module makes no LLM call at all, so no video title, channel or artist string reaches a model
// from here. The ambiguous residue is pooled as `unclassified` and revisited later, never
// guessed by an LLM. Spotify tracks come from a music catalog and are never classified. See
// docs/superpowers/specs/2026-07-07-music-classification-purge-design.md.

const youtube = require('./youtube');

// Wikipedia topicDetails slugs that mean "this is music" — the generic Music topic, any
// "*_music" genre topic, plus a few bare genre/song topics.
const MUSIC_TOPIC =
  /\/wiki\/(Music|[A-Za-z%_]*_music|Song|Album|Singing|Jazz|Blues|Reggae|Classical_music)\b/i;

// YouTube's auto-generated / official music channels.
const MUSIC_CHANNEL = /-\s*Topic\s*$|VEVO\s*$|Official Artist Channel\s*$/i;

// Music FORMS — these override the junk lexicon (a "Guitar Cover" or "DJ Set (live)" is
// music even though "cover"/"live" sit near junk-ish words). D5.
const MUSIC_FORM =
  /\b(dj set|live set|b2b|mix|mixtape|megamix|continuous mix|cover|acoustic|instrumental|remix|bootleg|edit|live at|live in|live performance|concert|unplugged|official audio|official video|official music video|music video|lyric video|lyrics|visualizer|full album|single)\b/i;

// Non-music title lexicon (expanded). A match with NO keep-signal ⇒ non_music.
const JUNK =
  /\b(vlog|podcast|tutorial|how to|review|unboxing|news|documentary|interview|reaction|gameplay|walkthrough|let'?s play|q\s*&\s*a|q and a|day in the life|commentary|lecture|webinar|sermon|trailer|teaser|recap|explained|top \d+|tier list|grwm|get ready with me|asmr|morning routine|night routine|storytime|rant|full episode|episode)\b/i;

// YouTube categoryIds that are never music (conservative — Entertainment 24 / Film 1 /
// Comedy 23 are deliberately excluded because they routinely carry music).
const NON_MUSIC_CATEGORY = new Set(['2', '15', '17', '19', '20', '22', '25', '26', '27', '28', '29']);

/**
 * Deterministic music/non-music verdict from a library entry + optional YouTube meta.
 * @param {{provider?:string,name?:string,artist?:string}} track
 * @param {{categoryId?:string|number,topicCategories?:string[]}} [meta]
 * @returns {'music'|'non_music'|'ambiguous'}
 */
function classifyByMetadata(track, meta = {}) {
  if (!track || track.provider !== 'youtube_music') return 'music';

  const title   = String(track.name ?? '');
  const channel = String(track.artist ?? '');
  const cat     = meta.categoryId != null ? String(meta.categoryId) : null;
  const topics  = Array.isArray(meta.topicCategories) ? meta.topicCategories : [];

  // KEEP signals (evaluated first, so a music signal always beats a junk one).
  if (cat === '10') return 'music';
  if (topics.some((u) => MUSIC_TOPIC.test(String(u)))) return 'music';
  if (MUSIC_CHANNEL.test(channel)) return 'music';
  if (MUSIC_FORM.test(title)) return 'music';

  // PURGE signals.
  if (JUNK.test(title)) return 'non_music';
  if (cat && NON_MUSIC_CATEGORY.has(cat)) return 'non_music';

  return 'ambiguous';
}

/**
 * Classify a batch of library tracks into music / non_music / unclassified.
 *   1. deterministic pass on stored fields (+ optional pre-supplied `metaById`),
 *   2. videos.list enrichment of the ambiguous set (when a token is given AND no metaById),
 *   3. any residue still inconclusive after YouTube's own signals is POOLED as
 *      `unclassified` — never deleted, never sent to an LLM (title/channel must not egress).
 * Non-`youtube_music` tracks pass straight through as music.
 *
 * `useLLM` is accepted for caller compatibility but is now inert — classification is fully
 * deterministic and never invokes any model.
 *
 * @param {Array} tracks
 * @param {{youtubeToken?:string|null, useLLM?:boolean, metaById?:Object|null}} [opts]
 * @returns {Promise<{music:Array, nonMusic:Array, unclassified:Array}>}
 */
async function classifyTracks(tracks, { youtubeToken = null, useLLM = true, metaById = null } = {}) {
  const music = [], nonMusic = [], unclassified = [];
  const list = Array.isArray(tracks) ? tracks : [];

  const ambiguous = [];
  for (const t of list) {
    if (t?.provider !== 'youtube_music') { music.push(t); continue; }
    const v = classifyByMetadata(t, (metaById && metaById[t.id]) || {});
    if (v === 'music') music.push(t);
    else if (v === 'non_music') nonMusic.push(t);
    else ambiguous.push(t);
  }
  if (!ambiguous.length) return { music, nonMusic, unclassified };

  // Fetch YouTube metadata for every still-ambiguous track we don't already have it for —
  // BEFORE the Groq step. This guarantees a Music-tagged track (categoryId 10 / a music topic)
  // is kept and never risked on an LLM guess. A track whose metadata we CANNOT obtain (fetch
  // failed / no token) is POOLED for a later retry — never deleted on a metadata-less guess.
  const fetched = {};
  const needFetch = ambiguous.filter((t) => !(metaById && metaById[t.id]));
  if (needFetch.length && youtubeToken) {
    let metas = [];
    try { metas = await youtube.fetchVideoTopics(youtubeToken, needFetch.map((t) => t.id), { cap: needFetch.length }); }
    catch { metas = []; }
    for (const m of metas) fetched[m.id] = m;
  }

  for (const t of ambiguous) {
    const meta = (metaById && metaById[t.id]) || fetched[t.id] || null;
    if (!meta) { unclassified.push(t); continue; } // no metadata → pool, never delete
    const v = classifyByMetadata(t, meta);
    if (v === 'music') music.push(t);
    else if (v === 'non_music') nonMusic.push(t);
    // Metadata present but YouTube's own signals are inconclusive → POOL as unclassified for a
    // later pass. Never guessed by an LLM: a title/channel string must not egress to any model.
    else unclassified.push(t);
  }

  return { music, nonMusic, unclassified };
}

module.exports = { classifyByMetadata, classifyTracks };
