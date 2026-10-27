/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { buildTokenModel } from '../../../../../scripts/tokens/lib/emit.mjs';
import { validateSources } from '../../../../../scripts/tokens/lib/schema.mjs';
import type { DirectionId } from '../../tokens/tokens.generated.ts';

// Test-only fixture directions (the close-out, architect re-rule 2026-10-27; the owner's choice 2-A:
// the field law stays generic). Abyss draws no plate shadow, fills the face and the ground, feathers its
// quiet zones and gives neutral placements a lobe, so after the close-out no shipped direction reaches
// the law's other paths. These two do, so each path keeps a positive control:
//   · fixture-outer: an outer plate shadow (plate.depth > 0, plate.shadow and plate.shadow2 on the light
//     face), a zero-extent face (field.mask.face 0) and neutral placements with no lobe (neutralLobe 0);
//   · fixture-inner: inner shadows (plate.depth < 0) on both faces with a lift (a negative strength in
//     plate.shadow2 on the light face), a zero-extent ground (field.mask.outside 0) and the quiet zones'
//     step path (field.mask.quietFeather 0).
// Each file is direction.abyss.tokens.json with only the $value of the leaf tokens in OVERRIDES
// replaced, the values copied from the two retired direction files at 440423c. Grounds and colours stay
// Abyss's. The ids carry a hyphen, not a dot: the generator's direction id is [a-z][a-z0-9-]*.
//
// They go through the real generator and schema (scripts/tokens/lib), never hand-built values, and
// reach the code under test only through a jest module mock of tokens.generated.ts and
// tokens.extensions.generated.ts: jest.requireActual plus the generated fixture entries, so BASE and
// DIRECTIONS.abyss stay the shipped objects. Only the test files on fixtureDirections.test.ts's
// allow-list mock them, and nothing outside __tests__ imports this folder (isolation.test.ts).

export const FIXTURE_OUTER = 'fixture-outer' as DirectionId;
export const FIXTURE_INNER = 'fixture-inner' as DirectionId;
export const FIXTURE_IDS: readonly DirectionId[] = [FIXTURE_OUTER, FIXTURE_INNER];

/** Per fixture, exactly the leaf tokens whose $value differs from Abyss's. */
export const OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  'fixture-outer': [
    'plate.depth',
    'plate.shadow.light.offsetY', 'plate.shadow.light.blur', 'plate.shadow.light.strength',
    'plate.shadow2.light.offsetY', 'plate.shadow2.light.blur', 'plate.shadow2.light.strength',
    'field.mask.face',
    'field.lobe.neutralLobe',
  ],
  'fixture-inner': [
    'plate.depth',
    'plate.shadow.dark.offsetY', 'plate.shadow.dark.blur', 'plate.shadow.dark.strength',
    'plate.shadow.light.offsetY', 'plate.shadow.light.blur', 'plate.shadow.light.strength',
    'plate.shadow2.light.offsetY', 'plate.shadow2.light.blur', 'plate.shadow2.light.strength',
    'field.mask.outside',
    'field.mask.quietFeather',
  ],
};

const DESIGN_TOKENS = path.resolve(__dirname, '../../../../../../../design-tokens');
/**
 * The two fixture files. They live beside the generator's tests, not here: the design-system gate
 * allows only source files under src/ (scripts/lint/collect.mjs).
 */
export const FIXTURE_DIR = path.resolve(__dirname, '../../../../../scripts/tokens/__tests__/__fixtures__');
export interface TokenSource { readonly name: string; readonly bytes: Buffer; readonly json: unknown }
const read = (dir: string, name: string): TokenSource => {
  const bytes = fs.readFileSync(path.join(dir, name));
  return { name, bytes, json: JSON.parse(bytes.toString('utf8')) };
};

/** The generator's inputs: the shipped base and Abyss files, and the two fixture files. */
export function fixtureSources(): TokenSource[] {
  return [
    read(DESIGN_TOKENS, 'base.tokens.json'),
    read(DESIGN_TOKENS, 'direction.abyss.tokens.json'),
    ...FIXTURE_IDS.map((id) => read(FIXTURE_DIR, `direction.${id}.tokens.json`)),
  ];
}

interface TokenModel { readonly base: unknown; readonly directions: Record<string, unknown>; readonly extensions: Record<string, unknown> }
let model: TokenModel | undefined;
/** The generator's model of the fixture sources (it throws if they fail the schema). */
export function fixtureModel(): TokenModel {
  return (model ??= buildTokenModel(fixtureSources()) as TokenModel);
}

/** The schema's errors for the fixture sources. */
export function fixtureSchemaErrors(sources: readonly TokenSource[] = fixtureSources()): string[] {
  return validateSources(sources).errors as string[];
}

const pick = (all: Record<string, unknown>) => Object.fromEntries(FIXTURE_IDS.map((id) => [id, all[id]]));

/** The jest.mock factory's module for tokens.generated.ts: the real one plus the fixture directions. */
export function mockedTokensModule(): Record<string, unknown> {
  const actual = jest.requireActual('../../tokens/tokens.generated.ts');
  return { __esModule: true, ...actual, DIRECTIONS: { ...actual.DIRECTIONS, ...pick(fixtureModel().directions) } };
}

/** The jest.mock factory's module for tokens.extensions.generated.ts: the real one plus the fixtures' extensions. */
export function mockedExtensionsModule(): Record<string, unknown> {
  const actual = jest.requireActual('../../tokens/tokens.extensions.generated.ts');
  return { __esModule: true, ...actual, EXTENSIONS: { ...actual.EXTENSIONS, ...pick(fixtureModel().extensions) } };
}

/** The real modules, for a mocked file's own pin: BASE and DIRECTIONS.abyss are the shipped objects. */
export const actualTokens = () => jest.requireActual('../../tokens/tokens.generated.ts');
export const actualExtensions = () => jest.requireActual('../../tokens/tokens.extensions.generated.ts');
