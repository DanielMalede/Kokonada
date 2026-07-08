// Friendly display copy for the MedicalProfile stateVector.status classifier labels
// (backend medicalProfileService.js). The descriptive labels are already user-facing and
// pass through; the bare 'Neutral' default (which is what shows when restingHeartRate is
// missing — see defect D-4a) and any legacy/unknown raw value get user-facing copy so a raw
// engine string is NEVER rendered verbatim. (defect D-4b)

const REMAP: Record<string, string> = {
  neutral: 'Balanced',
  natural: 'Balanced', // legacy classifier value
};

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function friendlyStatus(raw?: string | null): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const remapped = REMAP[s.toLowerCase()];
  if (remapped) return remapped;
  // Descriptive labels ("Deep Focus / Flow State", "Peak Athletic Performance", …) already
  // read well and contain uppercase/punctuation — keep them as-is. Only lowercase engine-ish
  // strings get title-cased so nothing raw ever surfaces.
  if (/[A-Z]/.test(s)) return s;
  return titleCase(s);
}
