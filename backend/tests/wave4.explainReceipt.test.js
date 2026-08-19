'use strict';

// W4-006 (seam half) — §0.4 S13: EXPLAINABILITY RECEIPTS.
//
// The taxonomy carries an `explainTemplate` per state: a sentence describing the MUSIC and the
// moment it was shaped for, plus a `claims` list naming the axes that sentence leans on. This is
// where that reaches the listener, and the whole design is about two refusals.
//
//   1. NEVER CLAIM A SIGNAL YOU LACK. "Coming down from effort" is a statement about the person's
//      exertion. If the exertion axis abstained — no heart rate, a dead sensor, a cold start —
//      that sentence is a fabrication, however well it happens to fit. So a line is emitted only
//      when EVERY axis it claims carries real evidence. This is what makes the receipt honest by
//      construction rather than by the author's care in wording it.
//
//   2. NEVER SHOW THE STATE ID. `acute-stress` and `mental-fatigue` read as assessments of a
//      person, and whether an app should say such a thing at all is HITL H6 — Daniel's open
//      decision, pending a compliance pass. H6's recorded safe default is exactly what ships
//      here: the explain line's TONE, never the id.
//
// The line is resolved at the SEAM (where the axes are) and travels to the receipt as a vetted
// string, so the socket layer cannot accidentally render something the evidence does not support.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { explainFor, EXPLAIN_MIN_MASS } = require('../app/agents/runtime/knowledge/explain');
const taxonomy = require('../app/agents/runtime/knowledge/stateTaxonomy');
const { toClientTrack } = require('../app/sockets/biometricHandler');

const AXES = ['arousal', 'stress', 'recovery', 'exertion', 'fatigue', 'circadianAlertness', 'valence'];

/** An affect whose every axis is fully evidenced. */
const evidenced = (label, over = {}) => ({
  label,
  confidence: 0.8,
  axes: Object.fromEntries(AXES.map((a) => [a, { value: 0.5, mass: 0.9 }])),
  ...over,
});

/** The same, but with the named axes abstaining (mass 0 — the engine's "I do not know"). */
function abstaining(label, ...blind) {
  const a = evidenced(label);
  for (const axis of blind) a.axes[axis] = { value: 0.5, mass: 0 };
  return a;
}

// ── the resolver ────────────────────────────────────────────────────────────────────────────

describe('explainFor', () => {
  test('returns the state\'s own line when every claimed axis is evidenced', () => {
    const state = taxonomy.byId('post-exertion-recovery');
    expect(explainFor(evidenced('post-exertion-recovery'))).toBe(state.explainTemplate.text);
  });

  test('withholds the line when ANY claimed axis abstains', () => {
    const state = taxonomy.byId('post-exertion-recovery');
    expect(state.explainTemplate.claims.length).toBeGreaterThan(0);

    for (const axis of state.explainTemplate.claims) {
      // One blind axis at a time — so the test proves each claim is individually load-bearing,
      // not that some combination happens to trip a guard.
      expect(explainFor(abstaining('post-exertion-recovery', axis))).toBeNull();
    }
  });

  test('an axis the line does NOT claim may abstain freely', () => {
    const state = taxonomy.byId('post-exertion-recovery');
    const unclaimed = AXES.filter((a) => !state.explainTemplate.claims.includes(a));
    expect(unclaimed.length).toBeGreaterThan(0);
    expect(explainFor(abstaining('post-exertion-recovery', ...unclaimed)))
      .toBe(state.explainTemplate.text);
  });

  test('a trace of evidence is not evidence — mass must clear the floor', () => {
    const state = taxonomy.byId('post-exertion-recovery');
    const a = evidenced('post-exertion-recovery');
    a.axes[state.explainTemplate.claims[0]] = { value: 0.5, mass: EXPLAIN_MIN_MASS / 2 };
    expect(explainFor(a)).toBeNull();
  });

  test('no affect, no label, or an unknown label yields nothing', () => {
    expect(explainFor(null)).toBeNull();
    expect(explainFor({})).toBeNull();
    expect(explainFor({ label: 'vibes', axes: {} })).toBeNull();
    expect(explainFor({ label: 'deep-rest' })).toBeNull(); // axes missing entirely
  });

  test('malformed axes are survivable, not fatal (S8)', () => {
    for (const axes of [null, 'nope', { arousal: null }, { arousal: { mass: NaN } }, { arousal: { mass: Infinity } }]) {
      expect(() => explainFor({ label: 'deep-rest', axes })).not.toThrow();
    }
  });

  test('every state in the taxonomy can produce its line under full evidence', () => {
    // If a state's template were malformed, the honest failure is silence — which would hide the
    // defect forever. Checked here instead.
    for (const s of taxonomy.STATES) {
      expect(explainFor(evidenced(s.id))).toBe(s.explainTemplate.text);
    }
  });
});

// ── H6 / R10: what a line may contain ───────────────────────────────────────────────────────

describe('the emitted vocabulary is closed and non-clinical', () => {
  test('no line names a state, carries a digit, or uses clinical language', () => {
    const CLINICAL = ['heart', 'hrv', 'bpm', 'panic', 'anxiety', 'anxious', 'diagnos', 'symptom',
      'stress level', 'disorder', 'condition', 'patient'];

    for (const s of taxonomy.STATES) {
      const line = explainFor(evidenced(s.id));
      expect(line).not.toMatch(/\d/);
      for (const word of CLINICAL) expect(line.toLowerCase()).not.toContain(word);
      // The id itself must never be the copy, nor appear inside it (H6 point 3).
      for (const other of taxonomy.STATES) expect(line).not.toContain(other.id);
    }
  });
});

// ── the receipt ─────────────────────────────────────────────────────────────────────────────

const track = (over = {}) => ({ id: 'abc123', title: 'T', artist: 'A', ...over });

describe('buildReceipt surfaces the line without changing what was already there', () => {
  test('the line arrives as an ADDITIVE `why`, leaving label and detail untouched', () => {
    const line = taxonomy.byId('deep-rest').explainTemplate.text;

    const before = toClientTrack(track(), 'spotify', { trigger: 'biometric', params: { target_bpm: 88 } });
    const after = toClientTrack(track(), 'spotify', {
      trigger: 'biometric', params: { target_bpm: 88 }, targets: { explain: line },
    });

    expect(after.receipt.label).toBe(before.receipt.label);
    expect(after.receipt.detail).toBe(before.receipt.detail);
    expect(after.receipt.why).toBe(line);
    expect(before.receipt.why).toBeUndefined();
  });

  test('no explain on the targets means no `why` — never an empty or placeholder string', () => {
    for (const targets of [undefined, {}, { explain: null }, { explain: '' }, { explain: '   ' }]) {
      const ct = toClientTrack(track(), 'spotify', { trigger: 'biometric', params: {}, targets });
      expect(ct.receipt.why).toBeUndefined();
    }
  });

  test('a non-string explain is ignored rather than serialized into the DTO', () => {
    const ct = toClientTrack(track(), 'spotify', {
      trigger: 'biometric', params: {}, targets: { explain: { text: 'nope' } },
    });
    expect(ct.receipt.why).toBeUndefined();
  });

  test('the favorites double-failure fallback stays honest and unadorned', () => {
    // That path deliberately claims nothing about mood or heart rate (L1). A "why this mix" line
    // there would be describing a state that had no part in choosing the track.
    const ct = toClientTrack(track(), 'spotify', {
      source: 'favorites', targets: { explain: taxonomy.byId('deep-rest').explainTemplate.text },
    });
    expect(ct.receipt.detail).toBe('From your favorites');
    expect(ct.receipt.why).toBeUndefined();
  });

  test('the DECORATED target travels in the context but only the vetted line leaves', () => {
    const line = taxonomy.byId('deep-rest').explainTemplate.text;
    // The whole regulated target is handed to the receipt builder, state id, arc, telemetry and
    // all — because that is the object the serving path already has. What must never happen is
    // any of it reaching the wire (§0.2.2, R10). `receipt.why` is the only door.
    const ct = toClientTrack(track(), 'spotify', {
      trigger: 'biometric',
      params: { target_bpm: 88 },
      targets: {
        explain: line,
        stateId: 'deep-rest',
        trajectory: { archetype: 'monotone-wind-down', start: { energy: 0.3, bpm: 80 } },
        telemetry: '[regulator] v=regulator/v1 state=deep-rest band=resting demand=0.4',
        regulator: { v: 'regulator/v1', demand: 0.4 },
      },
    });

    const json = JSON.stringify(ct);
    expect(ct.receipt.why).toBe(line);
    for (const leak of ['deep-rest', 'monotone-wind-down', 'regulator/v1', 'demand', 'stateId', 'trajectory']) {
      expect(json).not.toContain(leak);
    }
  });

  test('a discovery caption and a why-line coexist — they answer different questions', () => {
    const line = taxonomy.byId('deep-rest').explainTemplate.text;
    const ct = toClientTrack(track({ isDiscovery: true, caption: 'A slow bloom of strings.' }), 'spotify', {
      trigger: 'biometric', params: {}, targets: { explain: line },
    });
    expect(ct.receipt.caption).toBe('A slow bloom of strings.');
    expect(ct.receipt.why).toBe(line);
  });
});
