// backend/app/services/features/acousticBrainzFeatures.js
'use strict';

// Map a (merged low-level + high-level) AcousticBrainz record into Kokonada's canonical identity +
// the 6 buildVector feature dims. AcousticBrainz is CC0, keyed by MusicBrainz recording id (MBID) —
// so the resulting track is PROVIDER-AGNOSTIC (no Spotify/YouTube id). Two of the six dims are
// measured directly (bpm, danceability); the rest are re-mapped/derived approximations from
// AcousticBrainz's own analysis (documented per dim). A dim whose source fields are absent is OMITTED
// (not fabricated) so buildVector neutral-fills it rather than faking an extreme.

const first = (v) => (Array.isArray(v) ? v[0] : v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const clamp01 = (x) => (x === undefined ? undefined : Math.min(1, Math.max(0, x)));
const prob = (node, key) => (node && node.all ? num(node.all[key]) : undefined);
const avgDefined = (...xs) => {
  const ok = xs.filter((x) => Number.isFinite(x));
  return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : undefined;
};

function mapRecord(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const tags = rec.metadata?.tags || {};
  const mbid = first(tags.musicbrainz_recordingid);
  if (!mbid || typeof mbid !== 'string') return null; // no canonical key → cannot enter the corpus

  const hl = rec.highlevel || {};
  const features = {};

  // Direct, measured dims.
  const bpm = num(rec.rhythm?.bpm);
  if (bpm !== undefined) features.bpm = bpm;
  const dance = prob(hl.danceability, 'danceable');
  if (dance !== undefined) features.danceability = clamp01(dance);

  // Loudness: AcousticBrainz average_loudness is a 0..1 RELATIVE measure, NOT Spotify's dB LUFS.
  // Re-map into the dB space buildVector normalizes ((loudness+60)/65) so the normalized dim equals
  // average_loudness — i.e. loudness = avg*65 - 60. (Documented re-map, per the compliance/feasibility gate.)
  const avgLoud = num(rec.lowlevel?.average_loudness);
  if (avgLoud !== undefined) features.loudness = clamp01(avgLoud) * 65 - 60;

  // Derived dims from high-level mood models (approximations — different semantics than Spotify's
  // trained targets; expect calibration drift → the mixed corpus gets a DISCOVERY_MIN_COSINE retune).
  const happy = prob(hl.mood_happy, 'happy');
  const sad = prob(hl.mood_sad, 'sad');
  const valence = avgDefined(happy, sad === undefined ? undefined : 1 - sad);
  if (valence !== undefined) features.valence = clamp01(valence);

  const acoustic = prob(hl.mood_acoustic, 'acoustic');
  if (acoustic !== undefined) features.acousticness = clamp01(acoustic);

  const aggressive = prob(hl.mood_aggressive, 'aggressive');
  const party = prob(hl.mood_party, 'party');
  const relaxed = prob(hl.mood_relaxed, 'relaxed');
  const energy = avgDefined(aggressive, party, relaxed === undefined ? undefined : 1 - relaxed);
  if (energy !== undefined) features.energy = clamp01(energy);

  return {
    mbid,
    recordingKey: `mbid:${mbid}`,
    artist: first(tags.artist) ?? null,
    title: first(tags.title) ?? null,
    features,
  };
}

module.exports = { mapRecord };
