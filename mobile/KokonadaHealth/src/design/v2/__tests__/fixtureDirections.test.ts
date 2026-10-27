/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { DIRECTIONS } from '../tokens/tokens.generated.ts';
import { FIXTURE_IDS, OVERRIDES, fixtureModel, fixtureSchemaErrors, fixtureSources } from './__fixtures__/fixtureTokens.ts';

// The test-only fixture directions (__fixtures__/fixtureTokens.ts), unmocked: they are what they say,
// they pass the schema, the generator builds them, and only the named test files mock them in.

const APP = path.resolve(__dirname, '../../../..');
const rel = (f: string) => path.relative(APP, f).split(path.sep).join('/');

/**
 * Every leaf token of a token tree by its path, and every group's own metadata ($extensions,
 * $description) by `<path>.<$key>` (`$root.<$key>` at the top).
 */
function entries(node: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    const o = node as Record<string, unknown>;
    if ('$value' in o) {
      out.set(prefix, JSON.stringify(o));
      return out;
    }
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('$')) out.set(`${prefix || '$root'}.${k}`, JSON.stringify(v));
      else entries(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}
const differing = (a: unknown, b: unknown) => {
  const [ea, eb] = [entries(a), entries(b)];
  return [...new Set([...ea.keys(), ...eb.keys()])].filter((k) => ea.get(k) !== eb.get(k)).sort();
};

describe('the fixture directions are Abyss plus their declared overrides, and nothing else', () => {
  const sources = fixtureSources();
  const abyss = sources.find((s) => s.name === 'direction.abyss.tokens.json')!.json;

  it.each(FIXTURE_IDS.map((id) => [id]))('%s: the tokens and group metadata that differ from Abyss are exactly its OVERRIDES', (id) => {
    const fixture = sources.find((s) => s.name === `direction.${id}.tokens.json`)!.json;
    expect(differing(abyss, fixture)).toEqual([...OVERRIDES[id]].sort());
  });

  it('bites: a planted extra change to a token or to a group’s metadata, or a declared override set back to Abyss’s value, is seen', () => {
    const fixture = structuredClone(sources.find((s) => s.name === 'direction.fixture-outer.tokens.json')!.json) as Record<string, any>;
    fixture.field.pivot.$value += 0.01;
    expect(differing(abyss, fixture)).toContain('field.pivot');
    fixture.field.rest.$extensions['com.kokonada'].lobes = [[0, 0]];
    expect(differing(abyss, fixture)).toContain('field.rest.$extensions');
    const back = structuredClone(sources.find((s) => s.name === 'direction.fixture-outer.tokens.json')!.json) as Record<string, any>;
    back.plate.depth.$value = (abyss as Record<string, any>).plate.depth.$value;
    expect(differing(abyss, back)).not.toContain('plate.depth');
  });

  it('the schema reports no errors for the fixture sources, and still bites on them', () => {
    expect(fixtureSchemaErrors()).toEqual([]);
    const planted = sources.map((s) => {
      if (s.name !== 'direction.fixture-inner.tokens.json') return s;
      const json = structuredClone(s.json) as Record<string, any>;
      json.field.pivot.$type = 'planted';
      return { ...s, json };
    });
    expect(fixtureSchemaErrors(planted)).toEqual(expect.arrayContaining(['direction.fixture-inner.tokens.json: field.pivot: unknown $type "planted"']));
  });

  it('the generator builds them beside Abyss, with Abyss’s values unchanged', () => {
    const model = fixtureModel();
    expect(Object.keys(model.directions)).toEqual(['abyss', 'fixture-inner', 'fixture-outer']);
    expect(model.directions.abyss).toEqual(DIRECTIONS.abyss);
  });
});

// Pin (a): the generated token modules are mocked only by the named files: the fixture files, which
// mock both with the fixture factory, and one older mock, with its reason.
const FIXTURE_MOCKS = [
  'src/design/v2/field/__tests__/fieldScenes.skia.test.ts',
  'src/design/v2/field/__tests__/fixturePaths.skia.test.ts',
  'src/design/v2/field/__tests__/fixturePaths.test.ts',
  'src/design/v2/field/__tests__/ledgerStorms.fixture.test.ts',
];
const OTHER_MOCKS: Record<string, string> = {
  'src/design/v2/clock/__tests__/fieldClock.test.tsx': 'one dt law (B4 item 6): a planted motion.dtClamp in an isolated module registry, BASE only',
};
const MOCK_ALLOW_LIST = [...FIXTURE_MOCKS, ...Object.keys(OTHER_MOCKS)].sort();
const MOCK = /\bjest\.(?:mock|doMock|unstable_mockModule|setMock)\s*\(\s*(['"`])([^'"`\n]*tokens(?:\.extensions)?\.generated(?:\.ts)?)\1/g;
const mocksOfTokens = (source: string) => Array.from(source.matchAll(MOCK), (m) => m[2]);

function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) testFiles(full, out);
    else if (/\.[mc]?[jt]sx?$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('only the allow-listed files mock the generated token modules', () => {
  it('the files that mock either module are exactly the allow-list, each mocking both', () => {
    const files = ['src', 'scripts', '__tests__', 'modules', 'tools'].flatMap((d) => (fs.existsSync(path.join(APP, d)) ? testFiles(path.join(APP, d)) : []));
    expect(files.length).toBeGreaterThan(300);
    const mocking = files.filter((f) => mocksOfTokens(fs.readFileSync(f, 'utf8')).length > 0).map(rel).sort();
    expect(mocking).toEqual(MOCK_ALLOW_LIST);
    for (const f of FIXTURE_MOCKS) {
      const source = fs.readFileSync(path.join(APP, f), 'utf8');
      expect(mocksOfTokens(source).map((s) => path.basename(s)).sort()).toEqual(['tokens.extensions.generated.ts', 'tokens.generated.ts']);
      expect(source.match(/mocked(?:Tokens|Extensions)Module\(\)/g)?.sort()).toEqual(['mockedExtensionsModule()', 'mockedTokensModule()']);
    }
  });

  it('bites on planted sources: jest.mock and jest.doMock of either module, by any relative path', () => {
    const q = String.fromCharCode(39);
    expect(mocksOfTokens('jest.mock(' + q + '../../tokens/tokens.generated.ts' + q + ', () => ({}));')).toEqual(['../../tokens/tokens.generated.ts']);
    expect(mocksOfTokens('jest.doMock(' + q + '../tokens.extensions.generated' + q + ');')).toEqual(['../tokens.extensions.generated']);
    expect(mocksOfTokens('jest.mock(' + q + '../tokens/statics.ts' + q + ');')).toEqual([]);
  });
});
