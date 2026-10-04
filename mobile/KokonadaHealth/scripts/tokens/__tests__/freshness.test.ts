import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTokenModel, generateExtensionsModule, generateTokensModule } from '../lib/emit.mjs';
import { readTokenSources } from '../lib/sources.mjs';
import * as committed from '../../../src/design/v2/tokens/tokens.generated.ts';
import * as committedExtensions from '../../../src/design/v2/tokens/tokens.extensions.generated.ts';

// tokens.generated.ts is committed, so a token edit that skips the generator would ship stale
// values while every other test still read the stale file. This test is the gate against that,
// and it rides on jest, which CI runs.

const APP_ROOT = path.resolve(__dirname, '../../..');
const DESIGN_TOKENS = path.resolve(APP_ROOT, '../../design-tokens');
const GENERATED = path.join(APP_ROOT, 'src/design/v2/tokens/tokens.generated.ts');
const GENERATED_EXTENSIONS = path.join(APP_ROOT, 'src/design/v2/tokens/tokens.extensions.generated.ts');
const CLI = path.join(APP_ROOT, 'scripts/tokens/generate.mjs');

describe('tokens.generated.ts is fresh', () => {
  it('is byte for byte what the generator makes from design-tokens/', () => {
    expect(fs.readFileSync(GENERATED, 'utf8')).toBe(generateTokensModule(readTokenSources(DESIGN_TOKENS)));
  });

  it('tokens.extensions.generated.ts is byte for byte what the generator makes, too', () => {
    expect(fs.readFileSync(GENERATED_EXTENSIONS, 'utf8')).toBe(generateExtensionsModule(readTokenSources(DESIGN_TOKENS)));
  });

  it('records the sha256 of each source file it was made from', () => {
    const expected = Object.fromEntries(
      readTokenSources(DESIGN_TOKENS).map((s: { name: string; bytes: Buffer }) => [s.name, crypto.createHash('sha256').update(s.bytes).digest('hex')]),
    );
    expect(committed.TOKENS_SOURCE).toEqual(expected);
  });

  it('holds exactly the values the generator’s model holds', () => {
    const model = buildTokenModel(readTokenSources(DESIGN_TOKENS));
    expect(committed.BASE).toEqual(model.base);
    expect(committed.DIRECTIONS).toEqual(model.directions);
    expect(committedExtensions.EXTENSIONS).toEqual(model.extensions);
    expect(committedExtensions.EXTENSIONS_SOURCE).toEqual(committed.TOKENS_SOURCE);
  });

  it('a planted edit to one token makes it stale', () => {
    const planted = readTokenSources(DESIGN_TOKENS).map((s: { name: string; bytes: Buffer; json: any }) => {
      if (s.name !== 'direction.linen.tokens.json') return s;
      const json = structuredClone(s.json);
      json.field.pivot.$value = 0.25;
      return { ...s, json, bytes: Buffer.from(JSON.stringify(json, null, 2)) };
    });
    expect(generateTokensModule(planted)).not.toBe(fs.readFileSync(GENERATED, 'utf8'));
  });
});

// The CLI under plain Node: the route a developer and CI take, with the colour core loaded by
// Node's own type stripping rather than by Babel.
describe('node scripts/tokens/generate.mjs', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: APP_ROOT, encoding: 'utf8' });

  it('--check passes on the committed files', () => {
    const result = run('--check');
    expect(result.stderr).not.toMatch(/stale|error/i);
    expect(result.status).toBe(0);
  });

  it('--check fails, and names the file, when a source changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
    try {
      for (const name of fs.readdirSync(DESIGN_TOKENS)) fs.copyFileSync(path.join(DESIGN_TOKENS, name), path.join(dir, name));
      const file = path.join(dir, 'direction.basin.tokens.json');
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      json.field.shimmer.deg.$value = 4;
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
      const result = run('--check', '--sources', dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/tokens\.generated\.ts is stale/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check fails, and names the file, when only the extensions module is stale', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
    try {
      const out = path.join(dir, 'tokens.generated.ts');
      fs.copyFileSync(GENERATED, out);
      fs.writeFileSync(path.join(dir, 'tokens.extensions.generated.ts'), '// stale\n');
      const result = run('--check', '--out', out);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/tokens\.extensions\.generated\.ts is stale/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses sources that fail the schema, with the error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
    try {
      for (const name of fs.readdirSync(DESIGN_TOKENS)) fs.copyFileSync(path.join(DESIGN_TOKENS, name), path.join(dir, name));
      const file = path.join(dir, 'direction.abyss.tokens.json');
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      json.color.dark.surface2.$value.hex = '#000000';
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
      const out = path.join(dir, 'out.ts');
      const result = run('--sources', dir, '--out', out);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/direction\.abyss\.tokens\.json: color\.dark\.surface2: generated hex #000000 should be #10212D/);
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
