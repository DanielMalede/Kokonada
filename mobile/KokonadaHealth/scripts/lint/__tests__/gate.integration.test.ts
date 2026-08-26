import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectFindings, severityOf } from '../collect.mjs';

// Everything else about the ratchet is tested against hand-built rows. That is not enough for the
// gate: it is the thing that audits everything else, and its inputs are ESLint's own output
// shapes — `suppressedMessages[].suppressions[].justification`, `message.fatal`, which files
// lintFiles() even returns. If any of those shapes changes or is absent, the `|| []` fallbacks
// turn whole checks into no-ops while every unit test still passes.
//
// So this drives the REAL ESLint API over a real fixture tree, one directory per bypass route.

type Found = {
  counts: Record<string, Record<string, number>>;
  fatals: Array<{ file: string; line: number }>;
  unjustified: Array<{ file: string; ruleId: string }>;
  configComments: Array<{ file: string; line: number }>;
  unlinted: string[];
  foreign: string[];
  disarmed: Array<{ file: string; rule: string }>;
};

const eslintModule = require('eslint') as {
  ESLint: new (opts: Record<string, unknown>) => { lintFiles(t: string[]): Promise<unknown[]> };
};
const plugin = require('../../../tools/eslint-plugin-kokonada');

const HEX = "'#BADA55'";
let root: string;

const write = (rel: string, body: string) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-gate-'));
  write('src/clean.ts', 'export const a = 1;\n');
  write('src/newhex.ts', `export const c = ${HEX};\n`);
  write('src/scale.ts', 'export const s = { padding: 13 };\n');
  write('src/blanket.ts', `/* eslint-disable */\nexport const c = ${HEX};\n`);
  write('src/bare.ts', `// eslint-disable-next-line kokonada/no-color-literals\nexport const c = ${HEX};\n`);
  write('src/reasoned.ts', `// eslint-disable-next-line kokonada/no-color-literals -- vendor SDK wants a raw hex\nexport const c = ${HEX};\n`);
  write('src/broken.ts', 'export const c = ;\n');
  write('src/configoff.ts', `/* eslint kokonada/no-color-literals: off */\nexport const c = ${HEX};\n`);
  write('src/data.json', '{"c":"#BADA55"}\n');
  write('src/never-linted.tsx', `export const c = ${HEX};\n`); // .tsx is outside `extensions` below
});

afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

async function collect(): Promise<Found> {
  const eslint = new eslintModule.ESLint({
    cwd: root,
    useEslintrc: false,
    // .ts only, on purpose: the .tsx fixture then exercises "ESLint never visited this file",
    // which is what .eslintignore and a stray extension look like from the gate's side.
    extensions: ['.ts'],
    plugins: { kokonada: plugin },
    overrideConfig: {
      parser: require.resolve('@typescript-eslint/parser'),
      parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
      plugins: ['kokonada'],
      rules: {
        'kokonada/no-color-literals': 'error',
        'kokonada/no-scale-literals': 'error',
        'kokonada/require-disable-reason': 'error',
      },
    },
  });
  // collect.mjs is plain JS, so TS infers the empty-literal shapes rather than the populated
  // ones; `Found` above is the contract this test actually asserts against.
  return (await collectFindings(eslint, root, { sourceDir: 'src' })) as unknown as Found;
}

describe('the gate, against real ESLint output', () => {
  let found: Found;
  beforeAll(async () => { found = await collect(); });

  it('counts a plain new violation, per file per rule', () => {
    expect(found.counts['src/newhex.ts']).toEqual({ 'kokonada/no-color-literals': 1 });
    expect(found.counts['src/scale.ts']).toEqual({ 'kokonada/no-scale-literals': 1 });
  });

  it('leaves a clean file out of the counts entirely', () => {
    expect(found.counts['src/clean.ts']).toBeUndefined();
  });

  // The C3 hole: a blanket disable silences the finding AND the rule that would report it, so the
  // file reads as clean. Only suppressedMessages reveals it.
  it('catches a line-1 blanket disable, which no rule can report on itself', () => {
    const files = found.unjustified.map((u) => u.file);
    expect(files).toContain('src/blanket.ts');
    expect(found.counts['src/blanket.ts']).toBeUndefined(); // invisible in messages — the point
  });

  it('catches a bare disable naming the rule', () => {
    expect(found.unjustified.map((u) => u.file)).toContain('src/bare.ts');
  });

  it('lets a reasoned disable through — the one escape hatch still works', () => {
    expect(found.unjustified.map((u) => u.file)).not.toContain('src/reasoned.ts');
    expect(found.counts['src/reasoned.ts']).toBeUndefined();
  });

  // The C-1 hole: not a directive at all, so it never reaches suppressedMessages.
  it('catches an inline config comment switching the rule off', () => {
    expect(found.configComments.map((c) => c.file)).toEqual(['src/configoff.ts']);
    expect(found.counts['src/configoff.ts']).toBeUndefined(); // also invisible in messages
  });

  it('catches a file it could not parse, rather than scoring it zero', () => {
    expect(found.fatals.map((f) => f.file)).toContain('src/broken.ts');
  });

  it('catches a source file ESLint never visited', () => {
    expect(found.unlinted).toContain('src/never-linted.tsx');
  });

  it('catches a file type under src/ that no rule covers', () => {
    expect(found.foreign).toEqual(['src/data.json']);
  });

  // If ESLint ever stops populating these shapes, the checks above degrade to no-ops silently.
  it('ESLint really populates the shapes the gate depends on', () => {
    expect(found.unjustified.length).toBeGreaterThan(0);
    expect(found.fatals.length).toBeGreaterThan(0);
    expect(Object.keys(found.counts).length).toBeGreaterThan(0);
  });
});

// Route 6: the rule is not silenced, it is DISARMED — a nested .eslintrc under src/ is closer to
// the file than the root config and wins, so the rule never runs for that directory. `root: true`
// does not help: it only stops the search going UP. The config file is itself a .js file, so the
// extension check does not see it, and no comment exists for the comment scan to find. The only
// way to know is to ask ESLint what it would ACTUALLY apply, per file.
describe('the config sweep', () => {
  const lintOne = (file: string) => ({
    lintFiles: async () => [{ filePath: path.join(root, file), messages: [], suppressedMessages: [] }],
    calculateConfigForFile: async () => ({ rules: disarm }),
  });
  let disarm: Record<string, unknown> = {};
  const POLICY = {
    'kokonada/no-color-literals': ['src/design/*.ts', 'src/design/__tests__/**'],
    'kokonada/no-scale-literals': ['src/design/*.ts', 'src/design/__tests__/**'],
  };
  const sweep = async (file: string) => {
    const found = await collectFindings(lintOne(file) as never, root, { sourceDir: 'src', enforced: POLICY });
    return (found as unknown as Found).disarmed;
  };

  it('flags a screen whose rule config says off', async () => {
    disarm = { 'kokonada/no-color-literals': 'off', 'kokonada/no-scale-literals': 'error' };
    expect(await sweep('src/experience/Badge.ts'))
      .toEqual([{ file: 'src/experience/Badge.ts', rule: 'kokonada/no-color-literals' }]);
  });

  it('flags a rule downgraded to a warning — a warning does not fail anything', async () => {
    disarm = { 'kokonada/no-color-literals': 'warn', 'kokonada/no-scale-literals': 'error' };
    expect(await sweep('src/experience/Badge.ts')).toHaveLength(1);
  });

  it('flags a rule that is simply absent from the resolved config', async () => {
    disarm = { 'kokonada/no-scale-literals': 'error' };
    expect(await sweep('src/experience/Badge.ts')).toHaveLength(1);
  });

  it('is quiet when both rules resolve to error', async () => {
    disarm = { 'kokonada/no-color-literals': ['error', {}], 'kokonada/no-scale-literals': 2 };
    expect(await sweep('src/experience/Badge.ts')).toEqual([]);
  });

  // The exemptions are policy, not a bypass — they have to stay quiet or the gate cries wolf.
  it('respects the declared exemption globs', async () => {
    disarm = {};
    expect(await sweep('src/design/tokens.ts')).toEqual([]);
    expect(await sweep('src/design/__tests__/tokens.test.ts')).toEqual([]);
  });

  // ...but only exactly as far as they are declared: * does not cross a slash.
  it('does NOT extend an exemption glob past its own directory', async () => {
    disarm = {};
    expect(await sweep('src/design/system/EmptyState.ts')).toHaveLength(2);
  });
});

describe('severityOf', () => {
  it.each([
    ['error', 2], [2, 2], [['error', {}], 2], [[2], 2],
    ['warn', 1], [1, 1],
    ['off', 0], [0, 0], [undefined, 0], [null, 0],
  ])('reads %p as %i', (entry, expected) => {
    expect(severityOf(entry)).toBe(expected);
  });
});
