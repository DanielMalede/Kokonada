'use strict';

const { byId } = require('./stateTaxonomy');

/**
 * §0.4 S13 — THE HONEST "WHY THIS MIX" LINE.
 *
 * Every taxonomy state carries an `explainTemplate {text, claims}`. The `text` describes the
 * MUSIC and the moment it was shaped for; `claims` names the evidence axes that sentence leans
 * on. This module turns the pair into a line the listener may actually be shown — or into
 * silence, which is the more important half.
 *
 * WHY THE CLAIMS LIST EXISTS. "Coming down from effort — meeting the pace, then letting it fall
 * away" is a statement about a person's exertion. The HMM will happily report
 * `post-exertion-recovery` as its most probable state on thin evidence, because most probable is
 * not the same as well evidenced; if the exertion axis abstained (no heart rate, a dead sensor, a
 * cold start), that sentence is a fabrication that happens to fit. So a line is emitted ONLY when
 * every axis it claims carries real evidence. The app can be wrong about someone's state — that
 * is inference — but it must not TELL them something it had no way to know.
 *
 * Silence is a perfectly good answer here. The receipt already says "Tuned to your heart rate ·
 * 88 BPM"; a missing why-line costs a nicety, while a fabricated one costs the user's reason to
 * believe any of it.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN: the state id. `acute-stress` and `mental-fatigue` read
 * as assessments of a person, and whether an app should surface such a thing at all is HITL H6 —
 * Daniel's open decision pending a compliance pass on the wording. H6's recorded safe default is
 * implemented here: the TONE, never the name. The ids stay internal, encrypted at rest, and out
 * of every prompt and log (R10).
 *
 * PURE (S9): no clock, no randomness, no environment, no I/O.
 */

/**
 * The evidence floor a claimed axis must clear.
 *
 * `mass` is the fraction of an axis that is DATA (`evidence/(evidence + 0.35)` in the affect
 * engine), so it approaches 0 smoothly rather than switching off. A strictly-positive test would
 * therefore let a single stale, heavily-shrunk observation license a confident sentence. This is
 * low enough that any genuine reading passes and high enough that numerical residue does not.
 */
const EXPLAIN_MIN_MASS = 0.05;

const massOf = (axes, name) => {
  const m = axes && typeof axes === 'object' ? axes[name]?.mass : undefined;
  return typeof m === 'number' && Number.isFinite(m) ? m : 0;
};

/**
 * The explain line for this affect, or null when there is nothing honest to say.
 *
 * @param {object|null} affect - an `AffectState` from `affectEngine.updateAffect`
 * @returns {string|null}
 */
function explainFor(affect) {
  const label = typeof affect?.label === 'string' ? affect.label : null;
  const state = label ? byId(label) : null;
  if (!state) return null;

  const template = state.explainTemplate;
  const text = typeof template?.text === 'string' ? template.text.trim() : '';
  if (!text || !Array.isArray(template?.claims)) return null;

  for (const axis of template.claims) {
    if (massOf(affect?.axes, axis) <= EXPLAIN_MIN_MASS) return null;
  }
  return text;
}

module.exports = { explainFor, EXPLAIN_MIN_MASS };
