// The emotional prompt travels verbatim into the backend's Groq prompt with no
// server-side cap, so the client is the enforcement point. Cap the length, strip
// null/control bytes, collapse whitespace to a single line, and never throw — a
// paste can be a 50k-char blob, raw JSON, a SQL fragment, emoji, or a null byte.

export const MAX_PROMPT_LENGTH = 500;
// The activity key also travels verbatim into the Groq prompt. Chips only ever emit
// short preset keys, but the persisted blob is an untrusted surface (tamper/backup
// extraction), so activity must be bounded there just like the prompt. (QA4 Q2)
export const MAX_ACTIVITY_LENGTH = 64;

function stripAndCollapse(raw: string): string {
  return raw
    // tabs/newlines → a single space (stays one line)
    .replace(/[\t\n\r]+/g, ' ')
    // strip C0 controls (incl. NUL) and DEL; keep everything printable
    .replace(/[\0-\x1f\x7f]/g, '');
}

// LIVE input sanitizer — runs on EVERY keystroke (the reducer) and on rehydrate. It strips
// control/null bytes and hard-caps length, but deliberately does NOT trim: a live .trim() would
// eat the trailing space the instant it's typed, gluing the next word onto the previous one
// ("hello world" → "helloworld"). Spaces are the user's — internal AND in-progress trailing —
// so they are preserved verbatim; trimming is a SUBMIT-only concern (finalizePrompt).
export function sanitizePrompt(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return stripAndCollapse(raw).slice(0, MAX_PROMPT_LENGTH);
}

// SUBMIT-time finalizer — the ONE place the prompt is trimmed, applied where the committed intent
// leaves for the wire (KokonadaSocket.emitEmotion). Re-runs the same guards then strips the
// padding the user never meant to send. Internal spaces are never collapsed.
export function finalizePrompt(raw: unknown): string {
  return sanitizePrompt(raw).trim();
}

// Bounded activity: a non-string yields null (cleared); anything else is stripped,
// collapsed, capped, trimmed, and an emptied result normalizes back to null.
export function sanitizeActivity(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = stripAndCollapse(raw).slice(0, MAX_ACTIVITY_LENGTH).trim();
  return cleaned.length ? cleaned : null;
}
