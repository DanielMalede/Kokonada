// The band evidence lane's law inputs and its stamp (UI-160, the designer, D6 round 2).
//
// bandEvidence.mts runs by hand at the V1 law freeze and again in every PR that changes an input that moves a sampled
// band colour. The inputs are defined here, in code: the token values the lane reads (BASE, DIRECTIONS and the graph's
// edges, hashed as parsed values, so formatting and comments in the generated modules never count) and the text of
// every other module the lane imports, followed down (scripts/field/__tests__/bandEvidence.test.ts holds this list to
// the lane's import closure), each with CRLF read as LF, so a Windows checkout and a Linux CI hash the same.
//
// After a PASS, `bandEvidence.mts --stamp` writes bandEvidence.stamp.json with the inputs' SHA-256, the commit the lane
// ran at and its PASS line; `--seal <run file>` adds the run file's name and sha256. The default jest run recomputes
// the inputs' hash and fails on any difference from the stamp's (stampVerdict).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { EXTENSIONS } from '../../src/design/v2/tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS } from '../../src/design/v2/tokens/tokens.generated.ts';

/** Every module the lane imports but the token modules and this one, relative to the app (mobile/KokonadaHealth). */
export const BAND_LAW_INPUT_FILES: readonly string[] = [
  'scripts/field/bandEvidence.mts',
  'src/design/v2/color/blendSpace.ts',
  'src/design/v2/color/edgeSweep.ts',
  'src/design/v2/color/mixSafe.ts',
  'src/design/v2/color/oklab.ts',
  'src/design/v2/color/redBand.ts',
  'src/design/v2/color/sweepConvert.ts',
  'src/design/v2/field/blueNoise.generated.ts',
  'src/design/v2/field/blueNoise.ts',
  'src/design/v2/field/fieldLaw.ts',
  'src/design/v2/tokens/neverRedSweeps.ts',
];

/** The token modules: they enter by value (bandLawTokens), never by text. */
export const BAND_LAW_TOKEN_MODULES: readonly string[] = ['src/design/v2/tokens/tokens.generated.ts', 'src/design/v2/tokens/tokens.extensions.generated.ts'];

export const STAMP_FILE = 'scripts/field/bandEvidence.stamp.json';

export interface BandLawTokens {
  readonly base: typeof BASE;
  readonly directions: typeof DIRECTIONS;
  readonly graphEdges: unknown;
}

/** The token values the lane reads: BASE, DIRECTIONS and the blend graph's edges. */
export function bandLawTokens(): BandLawTokens {
  return { base: BASE, directions: DIRECTIONS, graphEdges: (EXTENSIONS.base['field.graph'] as unknown as { edges: unknown }).edges };
}

export interface BandLawInputs {
  /** The SHA-256 over the tokens' hash and every file's, in BAND_LAW_INPUT_FILES order. */
  readonly sha256: string;
  readonly tokens: string;
  readonly files: Readonly<Record<string, string>>;
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** The law inputs' hashes under an app root, the token values given or the committed ones. */
export function bandLawInputs(appRoot: string, tokens: BandLawTokens = bandLawTokens()): BandLawInputs {
  const files: Record<string, string> = {};
  for (const f of BAND_LAW_INPUT_FILES) files[f] = sha256(fs.readFileSync(path.join(appRoot, f), 'utf8').replace(/\r\n/g, '\n'));
  const tokenHash = sha256(JSON.stringify(tokens));
  return { sha256: sha256(JSON.stringify({ tokens: tokenHash, files: BAND_LAW_INPUT_FILES.map((f) => [f, files[f]]) })), tokens: tokenHash, files };
}

export interface BandEvidenceStamp {
  readonly ruling: 'UI-160';
  readonly inputs: BandLawInputs;
  /** The commit the lane ran at. */
  readonly commit: string;
  /** The lane's last line. */
  readonly pass: string;
  readonly runFile: { readonly name: string; readonly sha256: string };
}

/** Null when the inputs hash to the stamp's; otherwise what changed, and what to do. */
export function stampVerdict(stamp: BandEvidenceStamp, inputs: BandLawInputs): string | null {
  if (stamp.inputs.sha256 === inputs.sha256) return null;
  const changed = [
    ...(stamp.inputs.tokens === inputs.tokens ? [] : ['the token values']),
    ...BAND_LAW_INPUT_FILES.filter((f) => stamp.inputs.files[f] !== inputs.files[f]),
  ];
  return (
    `The band's law inputs changed since the evidence stamp (UI-160): ${changed.join(', ') || 'the input set'}. ` +
    `Re-run the evidence lane at the head, node scripts/field/bandEvidence.mts --stamp, then --seal <run file>, and commit ${STAMP_FILE} alone. ` +
    `Stamp ${stamp.inputs.sha256.slice(0, 12)} at ${stamp.commit.slice(0, 12)}; now ${inputs.sha256.slice(0, 12)}.`
  );
}
