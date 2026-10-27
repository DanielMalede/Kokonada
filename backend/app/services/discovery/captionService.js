'use strict';

const llmClient = require('../llmClient');
const { MOODS, normalizeActivity } = require('../moodDescriptors');

// Discovery caption service (Step 2). ONE batched Groq call writes a short, witty
// "why this discovery" one-liner per selected discovery track.
//
// COMPLIANCE-LOCKED (auditor option ii, 2026-07-14): the prompt is built ONLY from each
// track's audio FEATURES (tempo/energy/valence/danceability/acousticness) + an ALLOW-LIST of the
// session context the user chose: a preset mood, the emotion taps and the activity chip. It NEVER
// carries a track title, artist, or genre — those are Spotify Content and feeding them to an AI
// model at inference violates Policy §II. Nor any context field derived from health data (BE-221,
// the owner's ruling of 2026-10-27): no heart-rate band, no tempo target, no synthetic heart-branch
// mood key — whatever a caller passes, only the allow-list is read. This service cannot tell
// whether health data chose the TRACKS whose features it sends; that is the caller's guard, which
// does not call it for such a run (biometricHandler.js `healthShapedCaption`, failing closed on
// `targets.healthInputs`). captionService.test.js and llmHealthEgress.test.js assert the prompt is
// clean. Captions map back to tracks by INDEX (never
// a title echo the model could invent).
//
// Dark-launched behind DISCOVERY_CAPTION_LLM (read at call time). The whole call is wrapped
// in a hard budget timeout (DISCOVERY_CAPTION_BUDGET_MS); any timeout / HTTP error / parse
// error / empty response yields an EMPTY Map — the function NEVER throws and NEVER blocks
// generation past the budget.

const CAPTION_ENABLED = () => process.env.DISCOVERY_CAPTION_LLM === 'true';

const DEFAULT_BUDGET_MS = 2500;
const BUDGET_MS = () => {
  const n = parseInt(process.env.DISCOVERY_CAPTION_BUDGET_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_MS;
};

const DEFAULT_MAX_LEN = 90;
const MAX_LEN = () => {
  const n = parseInt(process.env.DISCOVERY_CAPTION_MAX_LEN ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_LEN;
};

const MODEL = () => process.env.DISCOVERY_CAPTION_MODEL || null; // llmClient default

function _round(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

// The ONLY per-track payload the prompt may carry: audio features. Never title/artist/genre.
function _featureLine(i, features) {
  const f = features || {};
  const bpm = Number.isFinite(Number(f.bpm)) ? Math.round(Number(f.bpm)) : '?';
  return `${i}. tempo=${bpm}bpm energy=${_round(f.energy)} valence=${_round(f.valence)} `
    + `danceability=${_round(f.danceability)} acousticness=${_round(f.acousticness)}`;
}

// The session context the user chose, read through an allow-list: a PRESET mood key (never a
// synthetic heart-branch key, which is built from a reading), the last emotion tap, and the
// activity chip validated to the preset enum. Any other field a caller passes is ignored.
const PRESET_MOODS = new Set(MOODS.map((m) => m.key));
function _sessionLine(ctx = {}) {
  const parts = [];
  if (PRESET_MOODS.has(ctx.moodKey)) parts.push(`mood=${ctx.moodKey}`);
  if (Array.isArray(ctx.emotionTaps) && ctx.emotionTaps.length) {
    const last = ctx.emotionTaps[ctx.emotionTaps.length - 1] || {};
    if (Number.isFinite(Number(last.x)) && Number.isFinite(Number(last.y))) {
      parts.push(`emotion=(valence ${_round(last.x)}, energy ${_round(last.y)})`);
    }
  }
  const activity = normalizeActivity(ctx.activity);
  if (activity) parts.push(`activity=${activity}`);
  return parts.length ? parts.join(', ') : 'no specific mood signal';
}

// L3 (ACCEPTED, audit): §II governs the INPUT and it is clean — no title/artist/genre is ever
// sent to the model (only audio features + the allow-listed session context; captionService.test.js
// pins this). The OUTPUT is constrained by the prompt below, which forbids the model from
// naming or inventing a song/artist/genre. A server-side proper-noun strip on the output is
// intentionally NOT added (disproportionate for a witty one-liner); revisit if brand-safety requires.
function _buildPrompt(tracks, sessionContext) {
  const lines = tracks.map((t, i) => _featureLine(i, t.features)).join('\n');
  return `You are Kokonada's in-house music curator writing a one-line "why this discovery" note for each track a listener is about to hear. You are given ONLY the sonic feel of each track (its audio features) and the listener's current mood/context — never a song name, artist, or genre, and you must never invent or guess one.

Listener context: ${_sessionLine(sessionContext)}.

Style contract (follow EXACTLY):
- Witty, human, a little clever — a knowing wink, in Kokonada's own voice.
- At most about 10 words. Specific to the track's sonic feel AND the listener's mood.
- Describe the FEEL (slow, smoky, driving, bright, high-energy, hazy) — never name a song, artist, or genre.
- No cliches, no generic filler ("great song", "you'll love this", "perfect vibe").
- Never mention Spotify or endorse any platform.

Tracks (each is described only by its audio feel):
${lines}

Respond with ONLY this JSON object, one entry per track, joined by the track's number as "i":
{"captions":[{"i":0,"caption":"A slow, smoky burner your quiet didn't know it needed"}]}`;
}

function _validCaption(raw, maxLen) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

// Parse the structured response and join captions back to recordingKeys BY INDEX (never a
// title echo). Junk / hallucinated / duplicate / out-of-range indices are dropped.
function _parseCaptions(rawText, tracks) {
  const out = new Map();
  const text = String(rawText ?? '').replace(/```(?:json)?/gi, '').trim();
  let parsed;
  try { parsed = JSON.parse(text); } catch { return out; }
  const list = Array.isArray(parsed?.captions) ? parsed.captions : null;
  if (!list) return out;

  const maxLen = MAX_LEN();
  const seen = new Set();
  for (const entry of list) {
    const i = Number(entry?.i); // models emit "0" as often as 0 — coerce, then validate
    if (!Number.isInteger(i) || i < 0 || i >= tracks.length || seen.has(i)) continue;
    const caption = _validCaption(entry?.caption, maxLen);
    if (!caption) continue;
    const rk = tracks[i]?.recordingKey;
    if (!rk) continue;
    seen.add(i);
    out.set(rk, caption);
  }
  return out;
}

// Hard budget: race the LLM call against a timer that resolves to null. Promise.race does
// not cancel the loser — the abandoned request settles later (timer unref'd). That is only
// harmless because the call makes ONE attempt (retries: 0 below): a 429 retry would wait out
// Retry-After and re-send after the caption was already dropped, spending shared quota.
function _withBudget(promise, ms) {
  let timer;
  const budget = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); timer.unref?.(); });
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer));
}

async function captionDiscovery(discoveryTracks, sessionContext = {}, { budgetMs } = {}) {
  if (!CAPTION_ENABLED()) return new Map();

  const tracks = (Array.isArray(discoveryTracks) ? discoveryTracks : [])
    .filter((t) => t && t.recordingKey && t.features);
  if (!tracks.length) return new Map();
  if (!llmClient.isConfigured()) return new Map();

  const ms = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : BUDGET_MS();
  const prompt = _buildPrompt(tracks, sessionContext);

  try {
    const raw = await _withBudget(
      llmClient.generateJson(prompt, { model: MODEL(), timeoutMs: ms, temperature: 0.8, retries: 0 }),
      ms,
    );
    if (raw == null) return new Map(); // budget timeout — no captions this generation
    return _parseCaptions(raw, tracks);
  } catch {
    // Any failure (HTTP error, unexpected throw) degrades to no captions — never blocks generation.
    return new Map();
  }
}

module.exports = { captionDiscovery };
