// The client DISPLAY vocabulary for the Pulse state headline (H1 / DT-8).
//
// stateVector.status is a BACKEND LOOKUP KEY (medicalProfileService.js rules, keyed again in
// stateTaxonomy.js and read raw by statusQuadrant for the wash), so the keys never change here.
// What changes is what a person SEES: a condition name or a prediction ("pre-" anything) can read as
// medical-device language (the regulatory brief's classification; counsel decides), so it is
// remapped on the client before it can render. One exported constant per display string; the copy is
// draft for counsel, conformance-checked at G5.
//
// This file is the ONLY production file allowed to spell the clinical backend key
// (legalSingleSource.test.ts pins that), so the word cannot creep back into a screen.

export const STATE_LABEL_HIGH_ACTIVATION = 'Highly activated';
export const STATE_LABEL_LOW_ENERGY = 'Low on energy';
// The fail-closed neutral: shown instead of any label the client cannot vouch for.
export const STATE_LABEL_FALLBACK = 'Current state';
// The bare 'Neutral' default's friendly copy (defect D-4b), lifted out of statusLabels' REMAP.
export const STATE_LABEL_BALANCED = 'Balanced';

// Every label the classifier (backend/app/services/medicalProfileService.js) can emit: its nine
// rules plus the 'Neutral' default. stateDisplayVocabulary.test.ts reads the real backend file and
// fails if this list drifts, so a new rule label forces a display decision here.
export const BACKEND_STATUS_LABELS = [
  'High-Stress / Pre-Panic',
  'Peak Athletic Performance',
  'Intense Workout',
  'Active Recovery',
  'Exhausted Commute',
  'Screen-Off / Background Listening',
  'Deep Focus / Flow State',
  'Morning Activation',
  'Resting / Meditative',
  'Neutral',
] as const;

// A pre-rename classifier value still present on old profile rows.
export const LEGACY_STATUS_LABELS = ['natural'] as const;

/** One canonical form per label: trimmed, lowercased, single-spaced, " / " around every slash.
 *  So "HIGH-STRESS/PRE-PANIC" and "High-Stress  /  Pre-Panic" land on the same key. */
export function normalizeStatusKey(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();
}

// Backend key (normalised) → display constant. Only the keys the regulatory brief classes as a
// condition/prediction (REQUIRED) or a health verdict (Recommended). Everything else keeps its copy.
export const STATE_DISPLAY_MAP: Readonly<Record<string, string>> = Object.freeze({
  'high-stress / pre-panic': STATE_LABEL_HIGH_ACTIVATION,
  'exhausted commute': STATE_LABEL_LOW_ENERGY,
});

// Condition names, predictions and alarm words — the union of the three H1 briefs' lists. Any
// label whose DISPLAY form matches is replaced by STATE_LABEL_FALLBACK, never rendered. Deliberately
// broad: a harmless label caught here degrades to a visible neutral, never to a clinical claim.
export const FORBIDDEN_STATE_TERMS =
  /panic|anxi|depress|disorder|attack|burnout|symptom|risk|early[\s-]*warning|predict|diagnos|clinical|crisis|alarm|danger|stress/i;
