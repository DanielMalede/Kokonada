/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

// SINGLE-SOURCE GUARD for the interim legal copy (H1). Static scans over the real production tree,
// the same idiom as shadow.authMigration.test.ts. They pin three things a green screen test cannot:
//   1. the legal sentences are DEFINED once (legalCopy.ts) — a second inline copy is how wording
//      drifts from the one text counsel reviews;
//   2. the clinical backend key is spelled in exactly one production file (the display vocabulary),
//      so it cannot creep back into a screen;
//   3. the scope decision (DT-7): the notice ships on Generate, the Onboarding chrome and Pulse —
//      and NOT on the consent sheet, which waits for counsel's copy and one consent-version bump.

const SRC = path.resolve(__dirname, '../..');
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
const read = (f: string) => fs.readFileSync(f, 'utf8');

const filesMatching = (re: RegExp) => PROD.filter((f) => re.test(read(f))).map(rel).sort();

// Every production file whose imports resolve to `target` (a src-relative module path, no extension).
const importersOf = (target: string) => {
  const want = path.join(SRC, target);
  return PROD.filter((f) =>
    [...read(f).matchAll(/from\s+['"]([^'"]+)['"]/g)].some((m) => {
      const spec = m[1];
      return spec.startsWith('.') && path.resolve(path.dirname(f), spec) === want;
    }),
  ).map(rel).sort();
};

const SCREENS = [
  'experience/generate/GenerateScreen.tsx',
  'experience/pulse/PulseScreen.tsx',
  'onboarding/OnboardingScreen.tsx',
];

describe('legal copy is defined once', () => {
  it('the scan sees the real tree (a walk that finds nothing must fail, not pass)', () => {
    expect(PROD.length).toBeGreaterThan(100);
    expect(PROD.map(rel)).toContain('legal/legalCopy.ts');
  });

  it('"infers your emotional state" is spelled only in legal/legalCopy.ts', () => {
    expect(filesMatching(/infers your emotional state/i)).toEqual(['legal/legalCopy.ts']);
  });

  it('"not a medical device" is spelled only in legal/legalCopy.ts', () => {
    expect(filesMatching(/not a medical device/i)).toEqual(['legal/legalCopy.ts']);
  });

  it('"consult a healthcare professional" is spelled only in legal/legalCopy.ts', () => {
    expect(filesMatching(/consult a healthcare professional/i)).toEqual(['legal/legalCopy.ts']);
  });

  it('the clinical pre-panic backend key is spelled only in the display vocabulary', () => {
    expect(filesMatching(/pre[\s-]*panic/i)).toEqual(['experience/pulse/stateDisplayVocabulary.ts']);
  });
});

describe('the notice ships on exactly the three DT-7 surfaces', () => {
  it('LegalNote is rendered by Generate, Onboarding and Pulse — and nothing else', () => {
    expect(importersOf('legal/LegalNote')).toEqual(SCREENS);
    for (const s of SCREENS) expect(read(path.join(SRC, s))).toMatch(/<LegalNote\s+lines=\{[A-Z_]+_LEGAL_LINES\}\s*\/>/);
  });

  it('the legal copy is consumed only by those screens and the primitive', () => {
    expect(importersOf('legal/legalCopy')).toEqual([...SCREENS, 'legal/LegalNote.tsx'].sort());
  });

  it('the consent sheet uses neither — its disclosure waits for counsel and the version bump', () => {
    const sheet = read(path.join(SRC, 'experience/profile/ConsentSheet.tsx'));
    expect(sheet).not.toMatch(/legal\/(LegalNote|legalCopy)/);
    expect(sheet).not.toMatch(/AI_DISCLOSURE|MEDICAL_DISCLAIMER|LegalNote/);
  });
});
