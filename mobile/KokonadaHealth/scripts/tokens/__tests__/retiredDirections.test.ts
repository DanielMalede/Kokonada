import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The close-out (the owner's Round 5 choice: Abyss only): the two retired directions leave no trace in
// the token sources, the app, its scripts or the repo's scripts. Only Markdown may still name them
// (history, rulings, evidence). Their names are built at run time, so this file never matches its
// own scan; the test-only fixture directions carry their law paths under other names.

const REPO = path.resolve(__dirname, '../../../../..');
const ROOTS = ['design-tokens/', 'mobile/KokonadaHealth/src/', 'mobile/KokonadaHealth/scripts/', 'scripts/'];
const RETIRED = ['nenil', 'nisab'].map((w) => [...w].reverse().join(''));
const PATTERN = new RegExp(`\\b(?:${RETIRED.join('|')})\\b`, 'i');
const ALLOWED = (file: string) => file.toLowerCase().endsWith('.md');

/** Tracked files under the roots, and untracked ones git would add (not ignored). */
function filesUnderRoots(): string[] {
  const list = (...args: string[]) => {
    const r = spawnSync('git', ['-C', REPO, 'ls-files', '-z', ...args, '--', ...ROOTS], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
    return r.stdout.split('\0').filter(Boolean);
  };
  return [...new Set([...list(), ...list('--others', '--exclude-standard')])].filter((f) => fs.existsSync(path.join(REPO, f))).sort();
}

/** Each match as file:line, in the files that are not allow-listed. */
function offenders(files: readonly string[], read: (f: string) => string): string[] {
  return files.filter((f) => !ALLOWED(f)).flatMap((f) =>
    read(f).split(/\r?\n/).flatMap((line, i) => (PATTERN.test(line) ? [`${f}:${i + 1}`] : [])),
  );
}

describe('the retired directions leave no trace outside Markdown', () => {
  const files = filesUnderRoots();

  it('the scan sees the real tree, in every root', () => {
    expect(files.length).toBeGreaterThan(300);
    for (const root of ROOTS) expect(files.some((f) => f.startsWith(root))).toBe(true);
    expect(files).toContain('mobile/KokonadaHealth/scripts/tokens/__tests__/retiredDirections.test.ts');
  });

  it('no file under design-tokens/, the app’s src/ and scripts/, or the repo’s scripts/ names one', () => {
    expect(offenders(files, (f) => fs.readFileSync(path.join(REPO, f), 'utf8'))).toEqual([]);
  });

  it('bites on planted text, in any case, as a whole word; and only Markdown is allowed', () => {
    const planted: Record<string, string> = {
      'scripts/a.ts': `const id = '${RETIRED[0]}';`,
      'design-tokens/b.json': `{"directions": ["abyss", "${RETIRED[1].toUpperCase()}"]}`,
      'mobile/KokonadaHealth/src/c.ts': `// ${RETIRED[0]}en is a word that only contains one`,
      'mobile/KokonadaHealth/src/d.md': `${RETIRED[0]} was a direction`,
    };
    expect(offenders(Object.keys(planted), (f) => planted[f])).toEqual(['scripts/a.ts:1', 'design-tokens/b.json:1']);
  });
});
