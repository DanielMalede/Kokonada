'use strict';

const llmClient = require('../llmClient');
const { clampFeatures, recordingKeyOf } = require('./featureProvider');

// Engineered LLM fallback for tracks the measured-features API cannot serve
// (YouTube-only recordings). Estimates are joined back by INDEX — never by a
// title echo the model could hallucinate — clamped through the shared trust
// boundary, and confidence is hard-capped below any measured value.

const CONFIDENCE_CAP = 0.7;
// Clamped ≥1 — see reccoBeatsAdapter: a zero batch size is an OOM spin-loop.
const BATCH_SIZE = () => {
  const n = parseInt(process.env.FEATURE_LLM_BATCH ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 20;
};
const MODEL      = () => process.env.FEATURE_LLM_MODEL || null; // llmClient default
const TIMEOUT_MS = () => parseInt(process.env.FEATURE_LLM_TIMEOUT_MS || '10000', 10);
// Bulk hydration is latency-tolerant and the heaviest Groq consumer, so it is
// the first to hit the free-tier TPM cap. Extra retry headroom (over the client
// default) lets each rate-limited batch ride out the Retry-After window and land.
const MAX_RETRIES = () => {
  const n = parseInt(process.env.FEATURE_LLM_RETRIES ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
};

// Numeric anchors keep the model grounded: real-world genre centroids for
// (bpm, energy, valence, acousticness, danceability, loudness).
const GENRE_ANCHORS = `Genre anchor table (bpm, energy, valence, acousticness, danceability, loudness):
ambient: 65, 0.15, 0.35, 0.85, 0.25, -18
classical: 90, 0.20, 0.40, 0.95, 0.30, -20
acoustic folk: 100, 0.35, 0.55, 0.80, 0.45, -12
lo-fi hip hop: 80, 0.30, 0.45, 0.50, 0.60, -14
r&b / soul: 95, 0.55, 0.60, 0.30, 0.65, -8
pop: 116, 0.70, 0.65, 0.15, 0.70, -6
house / edm: 126, 0.85, 0.60, 0.05, 0.80, -5
techno: 130, 0.90, 0.40, 0.02, 0.75, -6
metal: 140, 0.95, 0.35, 0.02, 0.40, -4.5
drum and bass: 174, 0.90, 0.50, 0.03, 0.60, -5`;

function supports(track) {
  return Boolean(track?.title ?? track?.name);
}

function _buildPrompt(batch) {
  const list = batch
    .map((t, i) => `${i}. "${t.title ?? t.name}" by ${t.artist ?? 'unknown artist'}${t.genres?.length ? ` [genres: ${t.genres.join(', ')}]` : ''}`)
    .join('\n');

  return `You are a music audio-analysis estimator. Estimate audio features for each numbered track using your knowledge of the artist, title and genres. Interpolate from the anchor rows below; stay conservative when unsure and reflect that in a lower confidence.

${GENRE_ANCHORS}

Tracks:
${list}

Respond with ONLY this JSON object, one entry per track, joined by the track's number as "i":
{"estimates":[{"i":0,"bpm":118,"energy":0.6,"valence":0.5,"acousticness":0.2,"danceability":0.6,"loudness":-8,"confidence":0.55}]}
Rules: bpm 30-260; energy/valence/acousticness/danceability 0-1; loudness -60 to 5 dB; confidence 0-1 reflecting how well you actually know this track.`;
}

function _parseEstimates(raw, batchSize) {
  const text = String(raw ?? '').replace(/```(?:json)?/gi, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Map();
  }
  const byIndex = new Map();
  for (const est of parsed?.estimates ?? []) {
    const i = Number(est?.i); // models emit "0" as often as 0 — coerce, then validate
    if (!Number.isInteger(i) || i < 0 || i >= batchSize || byIndex.has(i)) continue;
    const features = clampFeatures(est);
    if (!features) continue;
    const confRaw = Number(est.confidence);
    const confidence = Math.min(CONFIDENCE_CAP, Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0.3);
    byIndex.set(i, { features, confidence });
  }
  return byIndex;
}

async function getFeatures(tracks = []) {
  const supported = tracks.filter(supports);
  const results = [];

  for (let i = 0; i < supported.length; i += BATCH_SIZE()) {
    const batch = supported.slice(i, i + BATCH_SIZE());
    let byIndex = new Map();
    if (llmClient.isConfigured()) {
      try {
        const raw = await llmClient.generateJson(_buildPrompt(batch), {
          model: MODEL(),
          timeoutMs: TIMEOUT_MS(),
          temperature: 0.2,
          retries: MAX_RETRIES(),
        });
        byIndex = _parseEstimates(raw, batch.length);
      } catch (e) {
        console.error('[llmEstimator] batch failed:', e.message);
      }
    }
    batch.forEach((track, idx) => {
      const hit = byIndex.get(idx) ?? null;
      results.push({
        track,
        recordingKey: recordingKeyOf(track),
        features: hit?.features ?? null,
        source: 'llm',
        confidence: hit?.confidence ?? null,
      });
    });
  }
  return results;
}

module.exports = { supports, getFeatures, CONFIDENCE_CAP };
