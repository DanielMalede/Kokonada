'use strict';

// Music-vs-non-music classification for YouTube-sourced library tracks. A deterministic
// verdict from cheap signals (category / topicDetails / channel / title lexicon), with a
// Groq tie-breaker (classifyTracks) for the ambiguous residue. Spotify tracks come from a
// music catalog and are never classified. See
// docs/superpowers/specs/2026-07-07-music-classification-purge-design.md.

const youtube = require('./youtube');
const llmClient = require('./llmClient');

// Groq batch size for the ambiguous-residue tie-breaker. ~40 short lines keeps each call
// well under the free-tier per-request budget and lets withRetry pace them under 6000 TPM.
const GROQ_BATCH = 40;

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

// Ask Groq which items in a batch are NOT music. Throws on outage / malformed JSON so the
// caller pools the batch (never deletes on uncertainty).
async function _groqNonMusicIndices(batch) {
  const lines = batch
    .map((t, i) => `${i}: ${String(t.name ?? '').slice(0, 120)} — ${String(t.artist ?? '').slice(0, 80)}`)
    .join('\n');
  const prompt =
    'Classify each numbered YouTube item as a music track or not. MUSIC = official songs, ' +
    'live performances, DJ sets, mixes, covers, instrumentals, remixes. NOT MUSIC = vlogs, ' +
    'podcasts, tutorials, reviews, interviews, reactions, gameplay, news, documentaries, etc. ' +
    'Return ONLY JSON {"non_music":[indices]} listing the indices that are NOT music.\n\n' + lines;
  const raw = await llmClient.generateJson(prompt, { temperature: 0 });
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed.non_music) ? parsed.non_music : [];
  return new Set(arr.filter((n) => Number.isInteger(n)));
}

/**
 * Classify a batch of library tracks into music / non_music / unclassified.
 *   1. deterministic pass on stored fields (+ optional pre-supplied `metaById`),
 *   2. videos.list enrichment of the ambiguous set (when a token is given AND no metaById),
 *   3. Groq tie-breaker on the residue; a batch that can't be adjudicated (LLM off /
 *      unconfigured / errored) lands in `unclassified` — pooled, never deleted (safety floor).
 * Non-`youtube_music` tracks pass straight through as music.
 *
 * @param {Array} tracks
 * @param {{youtubeToken?:string|null, useLLM?:boolean, metaById?:Object|null}} [opts]
 * @returns {Promise<{music:Array, nonMusic:Array, unclassified:Array}>}
 */
async function classifyTracks(tracks, { youtubeToken = null, useLLM = true, metaById = null } = {}) {
  const music = [], nonMusic = [], unclassified = [];
  const list = Array.isArray(tracks) ? tracks : [];

  let ambiguous = [];
  for (const t of list) {
    if (t?.provider !== 'youtube_music') { music.push(t); continue; }
    const v = classifyByMetadata(t, (metaById && metaById[t.id]) || {});
    if (v === 'music') music.push(t);
    else if (v === 'non_music') nonMusic.push(t);
    else ambiguous.push(t);
  }

  if (ambiguous.length && youtubeToken && !metaById) {
    let metas = [];
    try {
      metas = await youtube.fetchVideoTopics(youtubeToken, ambiguous.map((t) => t.id), { cap: ambiguous.length });
    } catch { metas = []; }
    const byId = {};
    for (const m of metas) byId[m.id] = m;
    const next = [];
    for (const t of ambiguous) {
      const v = classifyByMetadata(t, byId[t.id] || {});
      if (v === 'music') music.push(t);
      else if (v === 'non_music') nonMusic.push(t);
      else next.push(t);
    }
    ambiguous = next;
  }

  if (!ambiguous.length) return { music, nonMusic, unclassified };
  if (!useLLM || !llmClient.isConfigured()) {
    unclassified.push(...ambiguous);
    return { music, nonMusic, unclassified };
  }
  for (let i = 0; i < ambiguous.length; i += GROQ_BATCH) {
    const batch = ambiguous.slice(i, i + GROQ_BATCH);
    try {
      const nonIdx = await _groqNonMusicIndices(batch);
      batch.forEach((t, j) => (nonIdx.has(j) ? nonMusic : music).push(t));
    } catch {
      unclassified.push(...batch);
    }
  }
  return { music, nonMusic, unclassified };
}

module.exports = { classifyByMetadata, classifyTracks };
