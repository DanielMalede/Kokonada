import { friendlyStatus, displayStatus } from '../statusLabels';
import {
  STATE_LABEL_HIGH_ACTIVATION,
  STATE_LABEL_LOW_ENERGY,
  STATE_LABEL_FALLBACK,
  BACKEND_STATUS_LABELS,
  LEGACY_STATUS_LABELS,
  FORBIDDEN_STATE_TERMS,
} from '../stateDisplayVocabulary';

describe('friendlyStatus (defect D-4b)', () => {
  it('gives the bare "Neutral" default friendly copy (no raw engine word)', () => {
    expect(friendlyStatus('Neutral')).toBe('Balanced');
  });

  it('maps the legacy "natural" value case-insensitively', () => {
    expect(friendlyStatus('natural')).toBe('Balanced');
    expect(friendlyStatus('NATURAL')).toBe('Balanced');
  });

  it('passes the descriptive classifier labels through as-is (already user-facing)', () => {
    expect(friendlyStatus('Deep Focus / Flow State')).toBe('Deep Focus / Flow State');
    expect(friendlyStatus('Peak Athletic Performance')).toBe('Peak Athletic Performance');
    expect(friendlyStatus('Resting / Meditative')).toBe('Resting / Meditative');
  });

  it('never returns a raw/unknown string verbatim — title-cases it as a fallback', () => {
    expect(friendlyStatus('weird')).toBe('Weird');
    expect(friendlyStatus('some raw label')).toBe('Some Raw Label');
  });

  it('returns null for null/empty so the status block hides cleanly', () => {
    expect(friendlyStatus(null)).toBeNull();
    expect(friendlyStatus(undefined)).toBeNull();
    expect(friendlyStatus('   ')).toBeNull();
  });
});

// ── H1 / DT-8: the display map. The five D-4b tests above are deliberately unchanged. ──────────
// Hostile and variant inputs a render boundary must survive: case, spacing, prototype keys.
const FUZZ = [
  ...BACKEND_STATUS_LABELS,
  ...LEGACY_STATUS_LABELS,
  ...BACKEND_STATUS_LABELS.map((s) => s.toLowerCase()),
  ...BACKEND_STATUS_LABELS.map((s) => s.toUpperCase()),
  ...BACKEND_STATUS_LABELS.map((s) => `  ${s.replace(/ \/ /g, '/')}  `),
  'panic', 'pre-panic', 'PRE-PANIC', 'Burnout Risk', 'Anxiety Attack Warning', 'depressed mood',
  'early warning: arrhythmia', 'Clinical Stress', 'stress', 'at risk', 'Crisis', 'Alarm State',
  'weird', 'some raw label', 'constructor', '__proto__', 'toString', 'hasOwnProperty',
];

describe('friendlyStatus — the clinical backend key and prediction labels never render (H1)', () => {
  it('NEVER renders the pre-panic key: the backend label and its case/spacing variants map to the constant', () => {
    for (const v of ['High-Stress / Pre-Panic', 'high-stress / pre-panic', 'HIGH-STRESS / PRE-PANIC', '  High-Stress/Pre-Panic  ', 'High-Stress   /   Pre-Panic']) {
      expect(friendlyStatus(v)).toBe(STATE_LABEL_HIGH_ACTIVATION);
    }
  });

  it('maps "Exhausted Commute" (a health verdict on the body) to the low-energy constant', () => {
    expect(friendlyStatus('Exhausted Commute')).toBe(STATE_LABEL_LOW_ENERGY);
    expect(friendlyStatus('exhausted commute')).toBe(STATE_LABEL_LOW_ENERGY);
  });

  it('clinical / prediction labels fall back to the neutral constant — never verbatim, never title-cased', () => {
    for (const v of ['Burnout Risk', 'panic', 'pre-panic', 'Anxiety Attack Warning', 'depressed mood', 'early warning: arrhythmia', 'stress']) {
      expect(friendlyStatus(v)).toBe(STATE_LABEL_FALLBACK);
    }
  });

  it('keeps today\'s copy for every other classifier label (optional / counsel rows are not renamed in H1)', () => {
    expect(friendlyStatus('Peak Athletic Performance')).toBe('Peak Athletic Performance');
    expect(friendlyStatus('Intense Workout')).toBe('Intense Workout');
    expect(friendlyStatus('Active Recovery')).toBe('Active Recovery');
    expect(friendlyStatus('Screen-Off / Background Listening')).toBe('Screen-Off / Background Listening');
    expect(friendlyStatus('Deep Focus / Flow State')).toBe('Deep Focus / Flow State');
    expect(friendlyStatus('Morning Activation')).toBe('Morning Activation');
    expect(friendlyStatus('Resting / Meditative')).toBe('Resting / Meditative');
    expect(friendlyStatus('Neutral')).toBe('Balanced');
  });

  it('FUZZ: the result is always null or a string that never matches FORBIDDEN_STATE_TERMS', () => {
    for (const v of FUZZ) {
      const out = friendlyStatus(v);
      if (out === null) continue;
      expect(typeof out).toBe('string');
      expect(out).not.toMatch(FORBIDDEN_STATE_TERMS);
    }
  });

  it('every label the classifier can emit yields a non-null display with no forbidden term', () => {
    for (const label of BACKEND_STATUS_LABELS) {
      const out = friendlyStatus(label);
      expect(out).not.toBeNull();
      expect(out).not.toMatch(FORBIDDEN_STATE_TERMS);
    }
  });
});

describe('displayStatus — the Pulse render boundary FAILS CLOSED on any label the client does not know', () => {
  it('a known classifier label renders its friendly copy (same as friendlyStatus)', () => {
    for (const label of [...BACKEND_STATUS_LABELS, ...LEGACY_STATUS_LABELS]) {
      expect(displayStatus(label)).toBe(friendlyStatus(label));
    }
    expect(displayStatus('High-Stress / Pre-Panic')).toBe(STATE_LABEL_HIGH_ACTIVATION);
  });

  it('case / spacing variants of a known label are still known (not collapsed to the fallback)', () => {
    for (const v of ['deep focus/flow state', 'DEEP FOCUS  /  FLOW STATE', '  Resting/Meditative ']) {
      expect(displayStatus(v)).not.toBe(STATE_LABEL_FALLBACK);
      expect(displayStatus(v)).toBe(friendlyStatus(v));
    }
    expect(displayStatus('  NEUTRAL ')).toBe('Balanced');
  });

  it('an unknown label (legacy row, future rule) renders the neutral constant, never verbatim or title-cased', () => {
    for (const v of ['weird', 'some raw label', 'Some Future Rule', 'Burnout Risk', 'constructor', '__proto__']) {
      expect(displayStatus(v)).toBe(STATE_LABEL_FALLBACK);
    }
  });

  it('null / empty → null, so the calm placeholder path is unchanged', () => {
    expect(displayStatus(null)).toBeNull();
    expect(displayStatus(undefined)).toBeNull();
    expect(displayStatus('   ')).toBeNull();
  });

  it('FUZZ: never renders a forbidden term, never a non-string', () => {
    for (const v of FUZZ) {
      const out = displayStatus(v);
      if (out === null) continue;
      expect(typeof out).toBe('string');
      expect(out).not.toMatch(FORBIDDEN_STATE_TERMS);
    }
  });
});
