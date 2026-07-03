// The Emotional Prompt box feeds free text straight into the backend, which prints
// it VERBATIM into the Groq prompt with NO server-side cap. So the client is the
// only enforcement point: it must cap length (token/cost/freeze guard), strip
// control/null bytes (JSON-serialization + LLM-API safety), and never throw on any
// paste — a 50,000-char blob, raw JSON, SQL fragments, emoji, or a null byte.

import { sanitizePrompt, MAX_PROMPT_LENGTH } from '../promptSanitizer';

describe('sanitizePrompt — length cap (overflow)', () => {
  it('caps a 50,000-character paste to the max length', () => {
    const huge = 'a'.repeat(50_000);
    const out = sanitizePrompt(huge);
    expect(out.length).toBe(MAX_PROMPT_LENGTH);
  });

  it('leaves a normal-length prompt intact', () => {
    expect(sanitizePrompt('late night melancholy jazz')).toBe('late night melancholy jazz');
  });

  it('MAX_PROMPT_LENGTH is a sane bound (a few hundred chars, not thousands)', () => {
    expect(MAX_PROMPT_LENGTH).toBeGreaterThanOrEqual(100);
    expect(MAX_PROMPT_LENGTH).toBeLessThanOrEqual(1000);
  });
});

describe('sanitizePrompt — control/null byte stripping', () => {
  it('strips null bytes', () => {
    expect(sanitizePrompt('rai\0ny')).toBe('rainy');
  });

  it('strips C0 control characters but keeps normal spaces', () => {
    expect(sanitizePrompt('a\x01b\x1fc\x7fd')).toBe('abcd');
    expect(sanitizePrompt('cozy   evening')).toBe('cozy   evening');
  });

  it('collapses newlines/tabs to spaces (single-line prompt)', () => {
    expect(sanitizePrompt('sad\nsong\there')).toBe('sad song here');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizePrompt('   focus   ')).toBe('focus');
  });
});

describe('sanitizePrompt — injection payloads are neutral text, never executed or crashing', () => {
  it('keeps JSON/SQL fragments as plain text (they are just vibe words to an LLM)', () => {
    expect(sanitizePrompt('{"drop":"table"}')).toBe('{"drop":"table"}');
    expect(sanitizePrompt("'; DROP TABLE users;--")).toBe("'; DROP TABLE users;--");
  });

  it('survives an injection payload combined with overflow + null bytes without throwing', () => {
    const nasty = ('{"x":1}\0' + "' OR 1=1 --").repeat(10_000);
    let out = '';
    expect(() => { out = sanitizePrompt(nasty); }).not.toThrow();
    expect(out.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(out).not.toContain('\0');
  });

  it('preserves multibyte emoji/unicode within the cap', () => {
    expect(sanitizePrompt('rainy 🌧️ mood')).toBe('rainy 🌧️ mood');
  });
});

describe('sanitizePrompt — fuzz / non-string input', () => {
  it('returns an empty string for non-string input, never throws', () => {
    for (const bad of [null, undefined, 123, {}, [], true, NaN]) {
      expect(sanitizePrompt(bad as any)).toBe('');
    }
  });
});
