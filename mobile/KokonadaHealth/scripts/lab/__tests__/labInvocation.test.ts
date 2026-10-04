/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

// MB-084 (round-1 review, C2). The lab's scripts are called as `node scripts/lab/<name>.mjs`, never
// through npm: package.json is in the iOS job's path filter (.github/workflows/ci.yml), so an edit
// that only adds scripts would start a macOS run on every push, the costliest job CI has.

const APP = path.resolve(__dirname, '../../..');
const REPO = path.resolve(APP, '../..');
const read = (f: string) => fs.readFileSync(f, 'utf8');

const filesUnder = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? filesUnder(full) : [full];
});

describe('the lab is never invoked through npm', () => {
  it('package.json has no lab script and no script that runs scripts/lab', () => {
    const scripts = JSON.parse(read(path.join(APP, 'package.json'))).scripts as Record<string, string>;
    expect(Object.keys(scripts).filter((name) => name.startsWith('lab'))).toEqual([]);
    expect(Object.values(scripts).filter((cmd) => cmd.includes('scripts/lab'))).toEqual([]);
  });

  it('nothing tells anyone to run `npm run lab:...` (the scripts, their README, the lab entry, CI)', () => {
    const SELF = path.join(__dirname, 'labInvocation.test.ts');
    const files = [
      ...filesUnder(path.join(APP, 'scripts/lab')).filter((f) => f !== SELF),
      path.join(APP, 'index.lab.js'),
      path.join(REPO, '.github/workflows/ci.yml'),
    ];
    expect(files.length).toBeGreaterThan(10); // the walk sees the real tree
    const npmRun = ['npm', 'run', 'lab:'].join(' ');
    const offenders = files.filter((f) => /\.(mjs|js|ts|md|yml|json)$/.test(f) && read(f).includes(npmRun));
    expect(offenders.map((f) => path.relative(REPO, f).split(path.sep).join('/'))).toEqual([]);
  });

  it('CI calls the exclusion check directly', () => {
    const ci = read(path.join(REPO, '.github/workflows/ci.yml')).split(/\r?\n/).map((l) => l.trim());
    expect(ci).toContain('run: node scripts/lab/assertLabExcluded.mjs');
  });

  it('the README states the rule, with its reason', () => {
    expect(read(path.join(APP, 'scripts/lab/README.md'))).toContain(
      'No npm scripts for the lab: `package.json` is in the iOS job\'s filter (ci.yml), and a scripts-only edit buys a macOS run.',
    );
  });
});
