// Friendly display copy for the MedicalProfile stateVector.status classifier labels
// (backend medicalProfileService.js). The descriptive labels are already user-facing and
// pass through; the bare 'Neutral' default (which is what shows when restingHeartRate is
// missing — see defect D-4a) and any legacy/unknown raw value get user-facing copy so a raw
// engine string is NEVER rendered verbatim. (defect D-4b)
//
// H1 / DT-8 adds two layers on top, and changes no backend key:
//   • friendlyStatus remaps the clinical keys (stateDisplayVocabulary) and never lets a condition
//     name, prediction or alarm word through — whatever path produced it, the final string is
//     checked against FORBIDDEN_STATE_TERMS and replaced by the neutral constant on a match.
//   • displayStatus is the Pulse RENDER boundary: an allow-list that fails CLOSED. A label the
//     classifier is not known to emit (a legacy row, a future rule) renders the neutral constant,
//     because the pass-through is exactly how a clinical label reached the screen before.
// statusQuadrant (pulsePresentation) still reads the RAW key, so the wash is unchanged.

import {
  STATE_DISPLAY_MAP,
  STATE_LABEL_FALLBACK,
  STATE_LABEL_BALANCED,
  BACKEND_STATUS_LABELS,
  LEGACY_STATUS_LABELS,
  FORBIDDEN_STATE_TERMS,
  normalizeStatusKey,
} from './stateDisplayVocabulary';

const REMAP: Readonly<Record<string, string>> = {
  neutral: STATE_LABEL_BALANCED,
  natural: STATE_LABEL_BALANCED, // legacy classifier value
};

// Own keys only: a status like "constructor" must never resolve to an Object.prototype member.
const lookup = (table: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function friendlyStatus(raw?: string | null): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const key = normalizeStatusKey(s);
  // Descriptive labels ("Deep Focus / Flow State", "Peak Athletic Performance", …) already
  // read well and contain uppercase/punctuation — keep them as-is. Only lowercase engine-ish
  // strings get title-cased so nothing raw ever surfaces.
  const shown = lookup(STATE_DISPLAY_MAP, key) ?? lookup(REMAP, key) ?? (/[A-Z]/.test(s) ? s : titleCase(s));
  return FORBIDDEN_STATE_TERMS.test(shown) ? STATE_LABEL_FALLBACK : shown;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(
  [...BACKEND_STATUS_LABELS, ...LEGACY_STATUS_LABELS].map(normalizeStatusKey),
);

/** What the Pulse headline renders: friendlyStatus for a label the classifier is known to emit,
 *  the neutral constant for anything else, null (→ the calm placeholder) for nothing. */
export function displayStatus(raw?: string | null): string | null {
  const shown = friendlyStatus(raw);
  if (shown === null) return null;
  return KNOWN_KEYS.has(normalizeStatusKey(String(raw))) ? shown : STATE_LABEL_FALLBACK;
}
