/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

// tokens.extensions.generated.ts holds the hero scenes, hardest placements and sampling tables:
// capture and test data, not app styling. The architect's seam (v1lab-r1-reconciliation) keeps it
// out of the shipped app: only the lab, scripts and tests import it. Scripts live outside src/;
// this test holds src/ to the rule.

const SRC = path.resolve(__dirname, '../../../..');
const MODULE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])[^'"\n]*tokens\.extensions\.generated(?:\.ts)?\1/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');
/** Tests and the lab may import the extensions; nothing else under src/ may. */
const allowed = (file: string) => /(^|\/)__tests__\//.test(file) || file.startsWith('design/lab/');
const offenders = (files: Array<{ file: string; source: string }>) =>
  files.filter(({ file, source }) => MODULE.test(source) && !allowed(file)).map(({ file }) => file);

describe('only the lab, scripts and tests import tokens.extensions.generated.ts', () => {
  const files = sourceFiles(SRC).map((full) => ({ file: rel(full), source: fs.readFileSync(full, 'utf8') }));

  it('the scan sees the real tree, including a test that does import it', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => f.file)).toContain('design/v2/tokens/useTokens.ts');
    expect(files.filter(({ source }) => MODULE.test(source)).map((f) => f.file)).toContain(
      'design/v2/tokens/__tests__/tokens.rules.test.ts',
    );
  });

  it('no app module imports it', () => {
    expect(offenders(files)).toEqual([]);
  });

  it('bites: an app module that imports it is flagged, a lab module is not', () => {
    const importLine = ["import { EXTENSIONS } from './tokens.extensions", ".generated.ts';"].join('');
    expect(offenders([{ file: 'design/v2/tokens/useTokens.ts', source: importLine }])).toEqual(['design/v2/tokens/useTokens.ts']);
    expect(offenders([{ file: 'design/lab/LabRoot.tsx', source: importLine }])).toEqual([]);
  });
});
