import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BAND_LAW_INPUT_FILES, BAND_LAW_TOKEN_MODULES, STAMP_FILE, bandLawInputs, bandLawTokens, stampVerdict, type BandEvidenceStamp } from '../bandLawInputs.ts';

// Law round 2, D6-2 (the designer's ruling at UI-153): (2) the band's three samples on the full 8-bit grid and
// (4) its margin certificate, with the local refinement, for α and β, both Abyss faces, now five rows a band
// (UI-161) with q8 over every cell (UI-163); and the β pair family (iv) on its full grid (UI-165). Too slow for CI's
// 15-minute sweeps budget, so by the ruling they live in an evidence lane, never thinned: scripts/field/
// bandEvidence.mts, a script that exits 1 on any failure. UI-160 (the designer, D6 round 2): it runs by hand at the
// V1 law freeze and again in every PR that changes an input that moves a sampled band colour; no schedule. A
// committed stamp holds the inputs' SHA-256, the commit the lane ran at, its PASS line and the run file's sha256,
// and this test fails whenever the inputs no longer hash to the stamp's. This pins what the script would run (its
// --plan), the stamp, and that no CI job runs the lane, so nobody reads a green PR as its evidence.

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/field/bandEvidence.mts');

describe('D6-2 (UI-153): the band grid’s evidence lane', () => {
  it('the script’s plan: both faces, α and β, the full 8-bit grid, the samples, five certificate rows, q8 over all cells, the β pair family on its full grid', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--plan'], { cwd: APP, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith('{'));
    expect(line).toBeDefined();
    const plan = JSON.parse(line as string);
    expect(plan).toEqual({
      cases: [
        { direction: 'abyss', face: 'dark', edge: 'alpha' },
        { direction: 'abyss', face: 'dark', edge: 'beta' },
        { direction: 'abyss', face: 'light', edge: 'alpha' },
        { direction: 'abyss', face: 'light', edge: 'beta' },
      ],
      grid: { kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.1, pixelKStep: 0.1, chromaScales: [0.25, 0.5, 1], pixelShimmerStepDeg: 1 },
      samples: [0.25, 0.5, 0.75],
      certificateSamples: [0, 0.25, 0.5, 0.75, 1],
      q8Source: 'all cells',
      step: 0.25,
      refineStep: 0.02,
      refine: true,
      betaPair: {
        cases: [
          { direction: 'abyss', face: 'dark' },
          { direction: 'abyss', face: 'light' },
        ],
        resolution: 'full',
        bandSteps: 10,
      },
      stamp: 'scripts/field/bandEvidence.stamp.json',
    });
  });

  it('no CI job runs it (the lane runs by hand, UI-160)', () => {
    const ci = fs.readFileSync(path.resolve(APP, '../../.github/workflows/ci.yml'), 'utf8');
    expect(ci).not.toMatch(/bandEvidence/);
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });
});

// ------------------------------------------------------------------ UI-160: the evidence stamp

/** Every file a module imports, relative to the app, followed from the lane down (import and import type alike). */
function importClosure(start: string): string[] {
  const seen = new Set<string>();
  const visit = (rel: string) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const text = fs.readFileSync(path.join(APP, rel), 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']+)'/g)) {
      visit(path.relative(APP, path.resolve(path.dirname(path.join(APP, rel)), m[1])).split(path.sep).join('/'));
    }
  };
  visit(start);
  return [...seen].sort();
}

describe('UI-160: the band evidence stamp', () => {
  const readStamp = () => JSON.parse(fs.readFileSync(path.join(APP, STAMP_FILE), 'utf8')) as BandEvidenceStamp;

  it('the law inputs are the lane’s whole import closure: every module but the token modules (hashed by value) and the hasher itself', () => {
    const closure = importClosure('scripts/field/bandEvidence.mts');
    expect(closure).toContain('scripts/field/bandLawInputs.ts');
    expect([...BAND_LAW_INPUT_FILES].sort()).toEqual(closure.filter((f) => f !== 'scripts/field/bandLawInputs.ts' && !BAND_LAW_TOKEN_MODULES.includes(f)));
    for (const f of BAND_LAW_TOKEN_MODULES) expect(closure).toContain(f);
    expect(BAND_LAW_INPUT_FILES).toEqual(expect.arrayContaining(['src/design/v2/field/fieldLaw.ts', 'src/design/v2/tokens/neverRedSweeps.ts', 'scripts/field/bandEvidence.mts']));
  });

  it('the committed stamp: a PASS of the lane at a commit, with its run file’s sha256', () => {
    const stamp = readStamp();
    expect(stamp.ruling).toBe('UI-160');
    expect(stamp.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(stamp.pass).toMatch(/^PASS: 0 failures; [0-9.]+ s in all$/);
    expect(stamp.runFile.name).toMatch(/\.txt$/);
    expect(stamp.runFile.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the law inputs still hash to the stamp’s: otherwise re-run bandEvidence.mts and re-stamp', () => {
    const verdict = stampVerdict(readStamp(), bandLawInputs(APP));
    if (verdict !== null) throw new Error(verdict);
  });

  it('a planted change to one token value, without re-stamping, fails, naming bandEvidence.mts and UI-160', () => {
    const tokens = bandLawTokens();
    const abyss = tokens.directions.abyss;
    const planted = { ...tokens, directions: { ...tokens.directions, abyss: { ...abyss, field: { ...abyss.field, cap: { ...abyss.field.cap, dark: abyss.field.cap.dark + 0.01 } } } } };
    const verdict = stampVerdict(readStamp(), bandLawInputs(APP, planted));
    expect(verdict).not.toBeNull();
    expect(verdict).toContain('bandEvidence.mts');
    expect(verdict).toContain('UI-160');
    expect(verdict).toContain('token values');
  });

  it('a planted change to one input file fails too, naming the file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'band-inputs-'));
    try {
      for (const f of BAND_LAW_INPUT_FILES) {
        fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
        fs.copyFileSync(path.join(APP, f), path.join(tmp, f));
      }
      fs.appendFileSync(path.join(tmp, 'src/design/v2/field/fieldLaw.ts'), '\n// a planted edit\n');
      const verdict = stampVerdict(readStamp(), bandLawInputs(tmp));
      expect(verdict).toContain('src/design/v2/field/fieldLaw.ts');
      expect(verdict).toContain('UI-160');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the hash is the same over CRLF line endings (a Windows checkout) as over LF (CI)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'band-inputs-'));
    try {
      for (const f of BAND_LAW_INPUT_FILES) {
        fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
        const text = fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
        fs.writeFileSync(path.join(tmp, f), text.replace(/\n/g, '\r\n'));
      }
      expect(bandLawInputs(tmp)).toEqual(bandLawInputs(APP));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
