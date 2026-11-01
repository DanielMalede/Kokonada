import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Law round 2, D6-2 (the designer's ruling at UI-153): (2) the band's three samples on the full 8-bit grid and
// (4) its margin certificate, with the local refinement, for α and β, both Abyss faces. They cost 656 s locally in
// node and 754 s in jest's sandbox (c4fb628); beside the sweeps project's files, in CI's two-worker file-size order,
// that projects the sweeps job to 12.9-16.8 min, across its 15-minute budget, so by the ruling they live in the
// scheduled evidence lane, never thinned: scripts/field/bandEvidence.mts, an opt-in script that exits 1 on any
// failure. Wiring it into a scheduled workflow is a later step (ci.yml is owner class a). This pins what the script would run, by
// asking it (--plan), and that no CI job runs it today, so nobody reads a green PR as its evidence.

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/field/bandEvidence.mts');

describe('D6-2 (UI-153): the band grid’s evidence lane', () => {
  it('the script’s plan: both faces, α and β, the full 8-bit grid, the samples 0.25/0.5/0.75, Δ 0.25, refinement every 0.02', () => {
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
      step: 0.25,
      refineStep: 0.02,
      refine: true,
    });
  });

  it('no CI job runs it (the lane is opt-in until a scheduled workflow does)', () => {
    const ci = fs.readFileSync(path.resolve(APP, '../../.github/workflows/ci.yml'), 'utf8');
    expect(ci).not.toMatch(/bandEvidence/);
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });
});
