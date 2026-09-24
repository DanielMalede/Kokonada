/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import {
  STATE_LABEL_HIGH_ACTIVATION,
  STATE_LABEL_LOW_ENERGY,
  STATE_LABEL_FALLBACK,
  STATE_LABEL_BALANCED,
  STATE_DISPLAY_MAP,
  BACKEND_STATUS_LABELS,
  LEGACY_STATUS_LABELS,
  FORBIDDEN_STATE_TERMS,
  normalizeStatusKey,
} from '../stateDisplayVocabulary';

// The client display vocabulary for the Pulse state headline (H1 / DT-8). The backend keys stay
// untouched (they are lookup keys in stateTaxonomy and drive the wash); only what is RENDERED is
// mapped. Every display string is one exported constant, pinned exactly here.

// The classifier that produces stateVector.status. Read from the real backend file so a new or
// renamed rule label cannot drift past the client vocabulary unnoticed.
const CLASSIFIER = path.resolve(__dirname, '../../../../../../backend/app/services/medicalProfileService.js');
// Any quote style (', " or `): a label restyled in the backend must still be seen, never skipped.
const parseStatusLabels = (src: string): string[] => [...src.matchAll(/status:\s*(['"`])(.+?)\1/g)].map((m) => m[2]);
const classifierLabels = (): string[] => parseStatusLabels(fs.readFileSync(CLASSIFIER, 'utf8'));

describe('state display vocabulary — one exported constant per display string', () => {
  it('pins each display label exactly (regulatory draft copy; final at G5)', () => {
    expect(STATE_LABEL_HIGH_ACTIVATION).toBe('Highly activated');
    expect(STATE_LABEL_LOW_ENERGY).toBe('Low on energy');
    expect(STATE_LABEL_FALLBACK).toBe('Current state');
    expect(STATE_LABEL_BALANCED).toBe('Balanced');
  });

  it('remaps exactly the two backend keys the regulatory brief classes as clinical / a health verdict', () => {
    expect(STATE_DISPLAY_MAP).toStrictEqual({
      'high-stress / pre-panic': STATE_LABEL_HIGH_ACTIVATION,
      'exhausted commute': STATE_LABEL_LOW_ENERGY,
    });
  });

  it('every map key is already in normalised form (a lookup can never miss on formatting)', () => {
    for (const key of Object.keys(STATE_DISPLAY_MAP)) expect(normalizeStatusKey(key)).toBe(key);
  });
});

describe('normalizeStatusKey — trim, lowercase, collapse spacing around "/"', () => {
  it('folds case and spacing variants onto the one backend key', () => {
    const want = 'high-stress / pre-panic';
    for (const v of ['High-Stress / Pre-Panic', 'HIGH-STRESS / PRE-PANIC', '  High-Stress/Pre-Panic  ', 'High-Stress   /   Pre-Panic', 'high-stress\t/\tpre-panic']) {
      expect(normalizeStatusKey(v)).toBe(want);
    }
  });

  it('collapses inner whitespace runs', () => {
    expect(normalizeStatusKey('Exhausted    Commute')).toBe('exhausted commute');
  });
});

describe('BACKEND_STATUS_LABELS — the fixture IS the real classifier (drift guard)', () => {
  it('lists every label medicalProfileService.js can emit, and nothing else', () => {
    const real = classifierLabels();
    expect(real.length).toBe(10); // 9 rules + the Neutral default — a parse that finds nothing must fail
    expect([...BACKEND_STATUS_LABELS].sort()).toEqual([...real].sort());
  });

  it('the parse reads every quote style, so a label restyled to " or ` cannot slip past the guard', () => {
    expect(parseStatusLabels('status: \'A\', status: "B", status:`C`, status: rule.status')).toStrictEqual(['A', 'B', 'C']);
  });

  it('keeps the legacy classifier value as a known label', () => {
    expect(LEGACY_STATUS_LABELS).toEqual(['natural']);
  });
});

describe('FORBIDDEN_STATE_TERMS — condition names, predictions and alarm words (union of the H1 briefs)', () => {
  const CLINICAL = [
    'Pre-Panic', 'panic', 'Panic Attack', 'Anxiety', 'anxious', 'Depression', 'depressed', 'Burnout',
    'burnout risk', 'Disorder', 'Symptoms', 'at risk', 'Early Warning', 'early-warning', 'predicts',
    'Prediction', 'Diagnosis', 'diagnosed', 'clinical', 'crisis', 'Alarm', 'danger', 'stress', 'High-Stress',
  ];

  it('matches every clinical / prediction / alarm term in the fixture', () => {
    for (const term of CLINICAL) expect(term).toMatch(FORBIDDEN_STATE_TERMS);
  });

  it('matches none of the display constants (a display label can never trip its own guard)', () => {
    for (const label of [STATE_LABEL_HIGH_ACTIVATION, STATE_LABEL_LOW_ENERGY, STATE_LABEL_FALLBACK, STATE_LABEL_BALANCED, ...Object.values(STATE_DISPLAY_MAP)]) {
      expect(label).not.toMatch(FORBIDDEN_STATE_TERMS);
    }
  });

  it('is a non-global regex (a /g lastIndex would make .test() alternate true/false)', () => {
    expect(FORBIDDEN_STATE_TERMS.global).toBe(false);
    expect(FORBIDDEN_STATE_TERMS.ignoreCase).toBe(true);
  });
});
