/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

// HX-3 (DEC-122; CMP-038, CMP-040): YouTube is sealed in code and only ever shown as deferred. The
// copy it used to carry is withdrawn, and a static scan over the real production tree keeps it from
// creeping back through any screen, comment or constant — a render test only sees the screens it
// renders. Tests are excluded: they may name a withdrawn phrase to assert its absence.

const SRC = path.resolve(__dirname, '../../..');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full, out); }
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
};
const isTest = (f: string) => /[\\/]__tests__[\\/]/.test(f) || /\.test\.(ts|tsx|js|jsx)$/.test(f);
const PROD = walk(SRC).filter((f) => !isTest(f));
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const filesSaying = (phrase: string) => {
  const re = new RegExp(escape(phrase), 'i');
  return PROD.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
};

const WITHDRAWN = ['YouTube Music', 'plays it natively', 'our Google review', 'Rebuilt your Spotify library'];

describe('no withdrawn YouTube copy anywhere in the mobile source (HX-3)', () => {
  it('the scan sees the real tree (a walk that finds nothing must fail, not pass)', () => {
    expect(PROD.length).toBeGreaterThan(100);
    expect(PROD.map(rel)).toEqual(expect.arrayContaining([
      'experience/connect/providers.ts',
      'experience/connect/ConnectServicesScreen.tsx',
      'experience/profile/ProfileScreen.tsx',
    ]));
    expect(PROD.map(rel).filter((f) => f.includes('__tests__'))).toEqual([]);
  });

  it.each(WITHDRAWN)('"%s" appears in no production file', (phrase) => {
    expect(filesSaying(phrase)).toEqual([]);
  });
});
