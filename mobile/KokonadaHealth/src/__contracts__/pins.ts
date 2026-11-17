// QA-118 (Stage 0 Q1): the v1 pins. Each locks old pixels, timings or behaviour the approved plan
// reverses or replaces. A pin is a window of `statements` consecutive statements inside the test named
// by `file` (relative to the repository root) and `fullTitle` (jest's full name), recorded as the
// SHA-256 of that text with CRLF read as LF. The hash, not the text, because the pinned text carries
// colour literals the design-system lint bans outside src/design.
//
// src/__contracts__/__tests__/pins.test.ts holds the rule: while the test is there, its pinned text
// must hash the same (re-pointing a v1 pin to a v2 value is always red); once it is gone, a RETIRE
// entry in ./retire.ts must cite a DECIDED DEC (DEC-091, refined by DEC-142); v2 gets its own proof.
//
// This file is data: it imports nothing (D8 rule 5 counts src/__contracts__ as production).

export interface Pin {
  id: string;
  file: string;
  fullTitle: string;
  statements: number;
  sha256: string;
  description: string;
  ref: string;
}

export const PINS: readonly Pin[] = [
  {
    id: 'tokens-emotion-anchors',
    file: 'mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts',
    fullTitle: 'emotionAnchors stay in the cool Aurora band (HR aura ramp — NEVER alarming red) carries the exact Aurora sky→indigo values',
    statements: 1,
    sha256: 'e607536b7a756d56af589cf4e1107b328b867518b03771cc78548fd3d4f7488a',
    description: 'the four emotion anchors, exact',
    ref: 'QA-118 (tokens.test.ts:107-162)',
  },
  {
    id: 'tokens-content-muted',
    file: 'mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts',
    fullTitle: 'Aurora foundation tokens (the LOCKED direction — exact pins so the palette cannot drift) content.muted (the mockup --mut supporting-text hue) — exact, both themes',
    statements: 2,
    sha256: '16cdb0f143f9b99c2a9b5197e3f4ebfe833a0d4c1bc47b1570d85c12726e6eae',
    description: 'content.muted in both themes, exact',
    ref: 'QA-118 (tokens.test.ts:107-162)',
  },
  {
    id: 'tokens-gold-ink',
    file: 'mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts',
    fullTitle: 'Aurora foundation tokens (the LOCKED direction — exact pins so the palette cannot drift) accent.goldInk (the gold-signature text ink) — exact, both themes',
    statements: 2,
    sha256: '0c1c54425fd5d135d373d754a0ccd599193f967be3404361820af93488bdaf83',
    description: 'accent.goldInk in both themes, exact',
    ref: 'QA-118 (tokens.test.ts:107-162)',
  },
  {
    id: 'tokens-cta-pair',
    file: 'mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts',
    fullTitle: 'Aurora foundation tokens (the LOCKED direction — exact pins so the palette cannot drift) accent.ctaFill + content.onCtaFill (the primary-CTA ink pair) — exact hexes AND measured ratios',
    statements: 6,
    sha256: '2526a54b420be8685e651d5cf1165fcbfe9cc56777c7c0668a7c8210f42191ca',
    description: 'the primary CTA fill and ink pair with their measured contrast ratios',
    ref: 'QA-118 (tokens.test.ts:107-162)',
  },
  {
    id: 'tokens-text-scrim',
    file: 'mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts',
    fullTitle: 'Aurora foundation tokens (the LOCKED direction — exact pins so the palette cannot drift) surface.textScrim base + alpha ramp (aura-over-text legibility veil) — exact, both themes',
    statements: 2,
    sha256: 'ee3e55dfd70103b7050031162bcaeadad9847f377beb133fd0f464ae108c5dad',
    description: 'the text scrim base and alpha ramp in both themes',
    ref: 'QA-118 (tokens.test.ts:107-162)',
  },
  {
    id: 'tokens-aurora-surfaces',
    file: 'mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts',
    fullTitle: 'Aurora foundation tokens (the LOCKED direction — exact pins so the palette cannot drift) the new Aurora surface fields (canvas gradient / gold hairline / veil) — exact, both themes',
    statements: 8,
    sha256: 'c00d8729d43c9cf44d78bb612e8ffc7c4452469c429810499b3b817bd12fbda1',
    description: 'the canvas gradient, gold hairline and veil surfaces',
    ref: 'QA-118 (tokens.test.ts:107-162)',
  },
  {
    id: 'tokens-aurora-blobs',
    file: 'mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts',
    fullTitle: 'Aurora foundation tokens (the LOCKED direction — exact pins so the palette cannot drift) aurora blobs / motion / glass — shared hues in both themes, exact',
    statements: 1,
    sha256: 'f331d679126f0b1533f59e5e3cb6dfbb630e70881e9c78ccc8bef6ead7db9220',
    description: 'the aurora blobs, blur, flow, focal glow and glass values',
    ref: 'QA-118 (tokens.test.ts:107-162)',
  },
  {
    id: 'appflow-splash-dwell',
    file: 'mobile/KokonadaHealth/src/navigation/__tests__/AppFlow.test.tsx',
    fullTitle: 'AppFlow — 4-state route machine the splash dwell is the brand breath / 3 (a single inhale), derived from the token',
    statements: 1,
    sha256: 'a88564fbc17cc2f23eb88637c1a5f83ea304d6ecff9e3d6e1d8596334b2a52e5',
    description: 'the splash dwell equals the breath duration over three',
    ref: 'QA-118, QA-160, OPS-064 (AppFlow.test.tsx:72-73)',
  },
  {
    id: 'bioaura-breath-floor-ceiling',
    file: 'mobile/KokonadaHealth/src/experience/aura/__tests__/BioAura.test.tsx',
    fullTitle: 'auraBreath — REGULATOR ETHIC (breath slows + deepens as arousal rises, NEVER speeds up) resting is the FAST FLOOR (motion.duration.breath) and high arousal the SLOW ceiling',
    statements: 2,
    sha256: '02d55071a559a9cb07f45068b7cb7f4443bf694e1e7554d7343cb87f7f357d0b',
    description: 'the breath floor and ceiling in milliseconds',
    ref: 'QA-118 (BioAura.test.tsx:28-29)',
  },
  {
    id: 'bootsplash-one-face',
    file: 'mobile/KokonadaHealth/scripts/brand/__tests__/bootsplash.test.ts',
    fullTitle: 'bootsplash — the abyss still-frame fills the OS splash with the abyss background #060B11 (not the old placeholder)',
    statements: 2,
    sha256: '0addfea18604c4bffde2f69199f91130f72fab5e00b02e091475afe33245f1dd',
    description: 'the OS splash fills with one background colour (one face only)',
    ref: 'QA-118, OPS-064 (bootsplash.test.ts:14)',
  },
  {
    id: 'onboarding-one-way',
    file: 'mobile/KokonadaHealth/src/onboarding/__tests__/onboardingStore.test.ts',
    fullTitle: 'onboardingStore — one-shot persisted seen flag markSeen is ONE-WAY — there is no unset/reset surface (stays true forever)',
    statements: 9,
    sha256: 'ae2fcb8029ddb7c66b0976d890b744dc4722d79457ffca064041051c9111c5a9',
    description: 'the onboarding seen flag is one-way, per device',
    ref: 'QA-118, OPS-064 (onboardingStore.test.ts:33)',
  },
  {
    id: 'legal-consent-sheet-no-notice',
    file: 'mobile/KokonadaHealth/src/legal/__tests__/legalSingleSource.test.ts',
    fullTitle: 'the notice ships on exactly the three DT-7 surfaces the consent sheet uses neither — its disclosure waits for counsel and the version bump',
    statements: 3,
    sha256: 'db2ef3adc56e47f5df669c2a07426d1e2d8b0c471d945833785ded1f017bce4b',
    description: 'the consent sheet carries no legal notice until P5',
    ref: 'QA-118, OPS-064 (legalSingleSource.test.ts:80-84)',
  },
  {
    id: 'consent-rejects-older',
    file: 'backend/tests/consent.test.js',
    fullTitle: 'recordConsent clientVersion OLDER than CURRENT_CONSENT_VERSION → REJECTED, no row written',
    statements: 3,
    sha256: '6ebb783c9c8b5afb66ccbcb5d9c142e373b171d2dc2beb65649b9824c03317c8',
    description: 'the backend rejects a client one consent version behind',
    ref: 'QA-118, OPS-064 (backend/tests/consent.test.js:88-100)',
  },
  {
    id: 'consent-rejects-newer',
    file: 'backend/tests/consent.test.js',
    fullTitle: 'recordConsent clientVersion NEWER than CURRENT_CONSENT_VERSION (server behind a rolled-back client) → also rejected, not silently trusted',
    statements: 3,
    sha256: 'eb13d4e98bf083d0435a1516ad5dcb036ded485c34440d018f6d0fd35dbed191',
    description: 'the backend rejects a client one consent version ahead',
    ref: 'QA-118, OPS-064 (backend/tests/consent.test.js:88-100)',
  },
  {
    id: 'healthlane-ble-request-only-in-definition',
    file: 'mobile/KokonadaHealth/src/__tests__/shadow.healthLane.test.ts',
    // `\u0028` is "(": shadow.healthLane.test.ts scans every non-test file under src (this one too) for
    // the call spelled `requestMultiple` + "(", and this title would otherwise spell it.
    fullTitle: 'Bluetooth: the lane only CHECKS the grant — nothing asks until P6 ships the disclosure requestMultiple\u0028 and requestBlePermissions\u0028 exist only inside their own definition',
    statements: 2,
    sha256: '910d7a4f531a64b73cf3c19b134217589a7d83e331899adc5c46024ceab4c5c8',
    description: 'nothing asks for the Bluetooth grant until P6 ships the disclosure',
    ref: 'OPS-064 (shadow.healthLane.test.ts:98-102)',
  },
];
