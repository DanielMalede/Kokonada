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

export function sanitizePrompt(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Cap BEFORE trim so a giant leading-whitespace paste can't hide length, then trim.
  return stripAndCollapse(raw).slice(0, MAX_PROMPT_LENGTH).trim();
}

// Bounded activity: a non-string yields null (cleared); anything else is stripped,
// collapsed, capped, trimmed, and an emptied result normalizes back to null.
export function sanitizeActivity(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = stripAndCollapse(raw).slice(0, MAX_ACTIVITY_LENGTH).trim();
  return cleaned.length ? cleaned : null;
}
