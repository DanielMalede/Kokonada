import { checkCopy, CopyError, createCopyPort, type CopySpec } from '../CopyPort.ts';

// F3-B: every T11 string lives on one held branch, written in one drafting pass and approved under
// the owner's (c). A batch tree carries keys, neutral copy and placeholders, so here an R key can
// never carry text, draft or otherwise. These tests plant a draft in every place text could hide
// (the key's spec entry, the en catalogue, another locale's catalogue, an extra option) and show
// that a strict build refuses it and a release build never shows it.
//
// The held branch opens the approved-text channel together with the approved text. Until then the
// port has no such channel, which the last describe pins.

const DRAFT = 'PROPOSAL draft line for review';

const SPEC = {
  'signIn.busy': { class: 'N' },
  'signIn.tagline': { class: 'R', budget: { chars: 48, lines: 2 } },
  'onboarding.step.1.line': { class: 'R', budget: { chars: 90, lines: 3 } },
} as const satisfies CopySpec;

const EN = { 'signIn.busy': 'Signing in…' };
const R_KEYS = ['signIn.tagline', 'onboarding.step.1.line'] as const;

/** The CopyError `fn` throws; anything else (or nothing) fails the test. */
function copyErrorOf(fn: () => unknown): CopyError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CopyError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a CopyError, and nothing was thrown');
}

describe('an R key carries no text in its spec entry', () => {
  it('an R entry holds its class and budget and nothing else', () => {
    for (const field of ['text', 'en', 'he', 'draft', 'proposal', 'copy', 'intent', 'message']) {
      const spec = { 'signIn.tagline': { class: 'R', budget: { chars: 48, lines: 2 }, [field]: DRAFT } };
      expect(checkCopy(spec as unknown as CopySpec, { en: {} }).map((p) => [p.code, p.key])).toEqual([['bad-spec', 'signIn.tagline']]);
      expect(copyErrorOf(() => createCopyPort({ spec: spec as unknown as CopySpec, catalogs: { en: {} }, mode: 'strict' })).code).toBe('invalid-copy');
    }
  });

  it('an N entry holds its class only: its text lives in the catalogue', () => {
    const spec = { 'signIn.busy': { class: 'N', text: DRAFT } };
    expect(checkCopy(spec as unknown as CopySpec, { en: EN }).map((p) => [p.code, p.key])).toEqual([['bad-spec', 'signIn.busy']]);
  });
});

describe('an R key carries no text in a catalogue', () => {
  it('a strict build refuses en text for an R key', () => {
    for (const key of R_KEYS) {
      const en = { ...EN, [key]: DRAFT };
      expect(checkCopy(SPEC, { en }).map((p) => [p.code, p.key, p.locale])).toEqual([['regulated-text', key, 'en']]);
      const error = copyErrorOf(() => createCopyPort({ spec: SPEC, catalogs: { en }, mode: 'strict' }));
      expect(error.code).toBe('invalid-copy');
      expect(error.problems.map((p) => p.code)).toEqual(['regulated-text']);
    }
  });

  it('a release build given that catalogue still resolves the R key as reserved, and never shows the draft', () => {
    const en = { ...EN, 'signIn.tagline': DRAFT, 'onboarding.step.1.line': DRAFT };
    const port = createCopyPort({ spec: SPEC, catalogs: { en }, mode: 'release' });
    for (const key of R_KEYS) {
      const result = port.resolve(key);
      expect(result.kind).toBe('reserved');
      expect(JSON.stringify(result)).not.toContain(DRAFT);
      expect(port.text(key as never)).toBe('…');
    }
    expect(port.text('signIn.busy')).toBe('Signing in…');
  });

  it('a draft in another locale’s catalogue never reaches a release build either', () => {
    const catalogs = { en: EN, he: { 'signIn.tagline': DRAFT } };
    const port = createCopyPort({ spec: SPEC, catalogs, mode: 'release' });
    expect(JSON.stringify(port.resolve('signIn.tagline'))).not.toContain(DRAFT);
    expect(port.text('signIn.tagline' as never)).not.toContain(DRAFT);
  });
});

describe('the port has no channel for regulated text in this tree', () => {
  it('an option that would carry approved or draft text is refused, in either mode', () => {
    for (const mode of ['strict', 'release'] as const) {
      for (const channel of ['regulated', 'approved', 'regulatedCatalog', 'overrides']) {
        const options = { spec: SPEC, catalogs: { en: EN }, mode, [channel]: { en: { 'signIn.tagline': DRAFT } } };
        expect(copyErrorOf(() => createCopyPort(options)).code).toBe('bad-option');
      }
    }
  });

  it('every R key resolves to its budget and no text, whatever the build, so a ReservedSlot is all it can show', () => {
    for (const mode of ['strict', 'release'] as const) {
      const port = createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode });
      expect(port.resolve('signIn.tagline')).toEqual({ kind: 'reserved', reason: 'regulated', budget: { chars: 48, lines: 2 } });
      expect(port.resolve('onboarding.step.1.line')).toEqual({ kind: 'reserved', reason: 'regulated', budget: { chars: 90, lines: 3 } });
    }
  });
});
