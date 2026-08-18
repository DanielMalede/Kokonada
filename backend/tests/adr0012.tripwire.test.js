'use strict';

// Structural tripwire (ADR-0012 — learning compliance). Wave 4 makes selection LEARN, and a
// learned artifact cannot be purged into compliance after the fact: the prohibited content is
// smeared across the parameters. So containment is enforced at the SCHEMA, fail-closed:
//
//   Track A  state-space rewards for everyone — buckets of {stateDomain, targetBand, hourBin},
//            NEVER track identity of any provider.
//   Track B  track-level posteriors for CC0 `mbid:` recordings ONLY, rejected by a schema-level
//            validator when the key does not match /^mbid:/ (ADR-0010 identity, ADR-0011 §3).
//
// This guard is FORWARD-BINDING: the learned artifacts below mostly do not exist yet, and the
// assertions arm themselves automatically the moment each file lands. Every new learned artifact
// MUST be added to LEARNED_ARTIFACTS in the same PR that introduces it.

const fs = require('fs');
const path = require('path');

// id                 → human name in failure output
// rel                → path relative to this test file
// trackLevelKeys     → true when the artifact keys rows by RECORDING (then /^mbid:/ is mandatory)
const LEARNED_ARTIFACTS = [
  { id: 'RewardEvent (model)',        rel: '../app/models/RewardEvent.js',                          trackLevelKeys: true  },
  { id: 'PersonalWeights (model)',    rel: '../app/models/PersonalWeights.js',                      trackLevelKeys: false },
  { id: 'feedbackLoop (engine)',      rel: '../app/agents/runtime/learning/feedbackLoop.js',        trackLevelKeys: false },
  { id: 'personalization (engine)',   rel: '../app/agents/runtime/learning/personalization.js',     trackLevelKeys: false },
  { id: 'noveltyController (engine)', rel: '../app/agents/runtime/knowledge/noveltyController.js',  trackLevelKeys: false },
];

// Comments are stripped before the literal scan so PROSE may name the excluded providers (this
// file does) while CODE may not. The [^:] guard keeps `http://` from eating a line.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A provider-scheme literal in CODE means the artifact can name a Spotify/YouTube recording.
// A bare `spotifyId` field is the same leak without the scheme (AudioFeature stores it that way).
function providerLeaks(src) {
  const code = stripComments(src);
  return [
    ...(code.match(/['"`]\s*(?:spotify|youtube(?:_music)?):/gi) || []),
    ...(code.match(/\bspotifyId\b/g) || []),
  ];
}

// A fail-closed CC0 gate is an ANCHORED mbid match — `/^mbid:/`. An unanchored `mbid:` test
// would pass for `spotify:...mbid:...` and is not a gate.
function hasAnchoredMbidGuard(src) {
  return /\^mbid:/.test(stripComments(src));
}

function readIfPresent(rel) {
  const abs = path.join(__dirname, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

describe('ADR-0012 tripwire — learned artifacts', () => {
  // A structural guard that silently stops matching is a FALSE GREEN. Prove the detectors have
  // teeth on every run, not just the day they were written.
  describe('detector self-test (the guard must be able to fail)', () => {
    it('flags provider-scheme keys and bare spotifyId in code', () => {
      expect(providerLeaks(`const k = 'spotify:track:4iV5W9';`)).toHaveLength(1);
      expect(providerLeaks(`const k = "youtube:abc";`)).toHaveLength(1);
      expect(providerLeaks(`schema.add({ spotifyId: String });`)).toHaveLength(1);
    });

    it('does NOT flag prose in comments (documentation may name what it excludes)', () => {
      expect(providerLeaks(`// rejects 'spotify:' and 'youtube:' keys\nconst ok = 1;`)).toHaveLength(0);
      expect(providerLeaks(`/* spotify: and youtube: are excluded */`)).toHaveLength(0);
    });

    it('accepts only an ANCHORED mbid gate', () => {
      expect(hasAnchoredMbidGuard(`validate: (v) => /^mbid:/.test(v)`)).toBe(true);
      expect(hasAnchoredMbidGuard(`validate: (v) => v.includes('mbid:')`)).toBe(false);
    });
  });

  it('keeps a non-empty registry (nobody may empty the guard to make it pass)', () => {
    expect(LEARNED_ARTIFACTS.length).toBeGreaterThanOrEqual(5);
  });

  it('no learned artifact names a Spotify/YouTube recording in code (ADR-0012 §3)', () => {
    const offenders = [];
    for (const a of LEARNED_ARTIFACTS) {
      const src = readIfPresent(a.rel);
      if (src === null) continue; // not built yet — assertion arms itself when the file lands
      const leaks = providerLeaks(src);
      if (leaks.length) offenders.push(`${a.id}: ${[...new Set(leaks)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every track-keyed learned artifact gates recordings behind a fail-closed /^mbid:/ validator (ADR-0012 §2)', () => {
    const missing = [];
    for (const a of LEARNED_ARTIFACTS.filter((x) => x.trackLevelKeys)) {
      const src = readIfPresent(a.rel);
      if (src === null) continue; // forward-binding
      if (!hasAnchoredMbidGuard(src)) missing.push(a.id);
    }
    expect(missing).toEqual([]);
  });

  it('the ADR itself is present and Accepted (the rule must stay discoverable)', () => {
    const adr = readIfPresent('../../docs/adr/0012-learning-compliance.md');
    expect(adr).not.toBeNull();
    expect(adr).toMatch(/^\s*-\s\*\*Status:\*\*\s*Accepted/m);
    expect(adr).toMatch(/\^mbid:/);
  });
});
