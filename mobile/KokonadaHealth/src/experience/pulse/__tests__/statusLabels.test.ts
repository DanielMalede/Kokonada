import { friendlyStatus } from '../statusLabels';

describe('friendlyStatus (defect D-4b)', () => {
  it('gives the bare "Neutral" default friendly copy (no raw engine word)', () => {
    expect(friendlyStatus('Neutral')).toBe('Balanced');
  });

  it('maps the legacy "natural" value case-insensitively', () => {
    expect(friendlyStatus('natural')).toBe('Balanced');
    expect(friendlyStatus('NATURAL')).toBe('Balanced');
  });

  it('passes the descriptive classifier labels through as-is (already user-facing)', () => {
    expect(friendlyStatus('Deep Focus / Flow State')).toBe('Deep Focus / Flow State');
    expect(friendlyStatus('Peak Athletic Performance')).toBe('Peak Athletic Performance');
    expect(friendlyStatus('Resting / Meditative')).toBe('Resting / Meditative');
  });

  it('never returns a raw/unknown string verbatim — title-cases it as a fallback', () => {
    expect(friendlyStatus('weird')).toBe('Weird');
    expect(friendlyStatus('some raw label')).toBe('Some Raw Label');
  });

  it('returns null for null/empty so the status block hides cleanly', () => {
    expect(friendlyStatus(null)).toBeNull();
    expect(friendlyStatus(undefined)).toBeNull();
    expect(friendlyStatus('   ')).toBeNull();
  });
});
