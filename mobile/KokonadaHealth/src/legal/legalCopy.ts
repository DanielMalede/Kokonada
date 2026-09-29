// Legal copy for the interim Track H / H1 disclosures on the v1 screens. ONE exported constant per
// string, and this is the only production file that spells them (legalSingleSource.test.ts pins
// that); screens import the constants, never inline a copy. The wording is draft copy for counsel,
// conformance-checked at G5 and pinned verbatim in legalCopy.test.ts — changing a word goes back
// through regulatory and counsel.
//
// Deliberately NOT used by the consent sheet: that surface gets counsel's final, scope-framed copy
// together with one consent-version bump, so a grant is always tied to the text actually shown.

// AI Act Art. 50(3) notice — the UI-005 invariant sentence, reused verbatim (TASKS.md:240).
export const AI_DISCLOSURE_LONG =
  "An AI system infers your emotional state here. It is a machine's reading, not a person's — and it can be wrong.";

// The same notice for persistent chrome; it drops "here" because no processing happens there.
export const AI_DISCLOSURE_SHORT = 'An AI system infers your emotional state. It can be wrong.';

// Mirrors the Play store-listing phrase, so there is one claim everywhere.
export const MEDICAL_DISCLAIMER =
  'Kokonada is not a medical device and does not diagnose, treat, cure, or prevent any medical condition.';

// Play's Health and Medical Functionalities rule: "Apps must also remind users to consult a healthcare
// professional for medical advice, diagnosis, or treatment." Its own line, so MEDICAL_DISCLAIMER stays
// the listing phrase word for word.
export const MEDICAL_CONSULT_REMINDER = 'Consult a healthcare professional for medical advice, diagnosis, or treatment.';

export type LegalLine =
  | typeof AI_DISCLOSURE_LONG
  | typeof AI_DISCLOSURE_SHORT
  | typeof MEDICAL_DISCLAIMER
  | typeof MEDICAL_CONSULT_REMINDER;

// Which lines each surface renders (regulatory brief, "Where it goes"; the reminder sits with the
// disclaimer, per the compliance review).
export const GENERATE_LEGAL_LINES: readonly LegalLine[] = Object.freeze([AI_DISCLOSURE_LONG]);
export const ONBOARDING_LEGAL_LINES: readonly LegalLine[] = Object.freeze([AI_DISCLOSURE_SHORT]);
export const PULSE_LEGAL_LINES: readonly LegalLine[] = Object.freeze([
  AI_DISCLOSURE_SHORT,
  MEDICAL_DISCLAIMER,
  MEDICAL_CONSULT_REMINDER,
]);
