import {
  AI_DISCLOSURE_LONG,
  AI_DISCLOSURE_SHORT,
  MEDICAL_DISCLAIMER,
  GENERATE_LEGAL_LINES,
  ONBOARDING_LEGAL_LINES,
  PULSE_LEGAL_LINES,
} from '../legalCopy';

// Track H / H1 legal copy. One exported constant per string, pinned VERBATIM here: a wording change
// is a regulatory decision (gate G5), so it must fail this file before it can reach a screen.
// Source: the regulatory brief D1/D2 (draft copy for counsel, not cleared copy).

const ALL = [AI_DISCLOSURE_LONG, AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER];

describe('legal copy — exact strings', () => {
  it('AI_DISCLOSURE_LONG is the UI-005 invariant sentence (TASKS.md:240), reused verbatim', () => {
    expect(AI_DISCLOSURE_LONG).toBe(
      "An AI system infers your emotional state here. It is a machine's reading, not a person's — and it can be wrong.",
    );
  });

  it('AI_DISCLOSURE_SHORT drops "here" for the persistent chrome', () => {
    expect(AI_DISCLOSURE_SHORT).toBe('An AI system infers your emotional state. It can be wrong.');
  });

  it('MEDICAL_DISCLAIMER mirrors the Play store-listing phrase', () => {
    expect(MEDICAL_DISCLAIMER).toBe(
      'Kokonada is not a medical device and does not diagnose, treat, cure, or prevent any medical condition.',
    );
  });

  it('pins the punctuation: an em dash (U+2014) and straight apostrophes (U+0027), never curly', () => {
    expect(AI_DISCLOSURE_LONG).toContain('—');
    for (const s of ALL) {
      expect(s).not.toMatch(/[‘’“”]/);
      expect(s).toBe(s.trim());
    }
  });
});

describe('legal copy — which string each surface shows (regulatory brief, "Where it goes")', () => {
  it('Generate (first in-app surface) shows the LONG sentence', () => {
    expect(GENERATE_LEGAL_LINES).toEqual([AI_DISCLOSURE_LONG]);
  });

  it('the Onboarding chrome shows the SHORT sentence (no processing happens there)', () => {
    expect(ONBOARDING_LEGAL_LINES).toEqual([AI_DISCLOSURE_SHORT]);
  });

  it('Pulse shows the SHORT sentence, then the not-a-medical-device line, in that order', () => {
    expect(PULSE_LEGAL_LINES).toEqual([AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER]);
  });

  it('the surface lists cannot be mutated at runtime', () => {
    for (const lines of [GENERATE_LEGAL_LINES, ONBOARDING_LEGAL_LINES, PULSE_LEGAL_LINES]) {
      expect(Object.isFrozen(lines)).toBe(true);
    }
  });
});

describe('legal copy — compliance constraints on the wording', () => {
  it('names no provider and implies no provider does or endorses the inference', () => {
    for (const s of ALL) expect(s).not.toMatch(/spotify|youtube|garmin|health connect|google|apple|samsung/i);
  });

  it('adds no efficacy or clinical claim', () => {
    for (const s of ALL) expect(s).not.toMatch(/clinically|proven|accurate|science|certified|approved/i);
  });

  it('says "AI system" and "emotional state" (never softened to "automated" or "mood")', () => {
    for (const s of [AI_DISCLOSURE_LONG, AI_DISCLOSURE_SHORT]) {
      expect(s).toContain('An AI system infers your emotional state');
      expect(s).toContain('can be wrong');
      expect(s).not.toMatch(/automated/i);
    }
  });
});
