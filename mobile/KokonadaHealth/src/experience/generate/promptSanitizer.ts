// The emotional prompt travels verbatim into the backend's Groq prompt with no
// server-side cap, so the client is the enforcement point. Cap the length, strip
// null/control bytes, collapse whitespace to a single line, and never throw — a
// paste can be a 50k-char blob, raw JSON, a SQL fragment, emoji, or a null byte.

export const MAX_PROMPT_LENGTH = 500;

export function sanitizePrompt(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const collapsed = raw
    // tabs/newlines → a single space (this stays a one-line vibe prompt)
    .replace(/[\t\n\r]+/g, ' ')
    // strip C0 controls (incl. NUL) and DEL; keep everything printable
    .replace(/[\0-\x1f\x7f]/g, '');
  // Cap BEFORE trim so a giant leading-whitespace paste can't hide length, then trim.
  return collapsed.slice(0, MAX_PROMPT_LENGTH).trim();
}
