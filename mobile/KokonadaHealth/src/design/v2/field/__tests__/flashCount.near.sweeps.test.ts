import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type Face } from '../../tokens/tokens.generated.ts';
import { E4_CADENCES, E4_NEAR_CASES, NEAR_DELTAS, flashReport, lobeLattices, nearTap, samplePoints } from '../flashCount.ts';
import { QUAD, stormDeps } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// Law round 2, item 2b (designer L7 (iii), the reconciliation's E4 line): E4's near-spot toggles, in the
// sweeps project beside flashCount.sweeps.test.ts (its own file, so the two run on separate workers).
// "Add near-spot toggles at δ ∈ {0.25, 0.5, 0.75, 1.0}·r_L, with halo lattices. If any near-spot case
// exceeds 2, ν may go from 1.25 to 1.5. That is pre-authorised, and nothing else is."
// Pass, as every E4 case: worstFlashesPerSecond ≤ 2 at every sample point (the 12×12 grid, both taps'
// halo lattices and the lobe-centre lattices of the rest lobes and of both taps at ordinals 0–2).

const LONG = 15 * 60_000;
const deps = (face: Face) => stormDeps('abyss', staticsFor('abyss', EXTENSIONS as never), face);

describe('E4 near-spot toggles: at most 2 flashes a second at every sample point', () => {
  it('the cases are the ruled ones: both faces × both modes × δ ∈ {0.25, 0.5, 0.75, 1.0}·r_L × every E4 cadence', () => {
    expect(NEAR_DELTAS).toEqual([0.25, 0.5, 0.75, 1]);
    expect(E4_NEAR_CASES).toHaveLength(2 * 2 * 4 * E4_CADENCES.length);
    expect(new Set(E4_NEAR_CASES.map((c) => c.face))).toEqual(new Set(['dark', 'light']));
  });

  it('each near tap keeps QUAD[1]’s radius, with its undrifted lobe centre δ·r_L from QUAD[1]’s', () => {
    const bead = DIRECTIONS.abyss.bead.diameter / 2 / (BASE.plate.maxDiameter / 2);
    for (const delta of NEAR_DELTAS) {
      const t = nearTap(delta);
      expect(Math.hypot(t.x, t.y)).toBeCloseTo(Math.hypot(QUAD[1].x, QUAD[1].y), 12);
      expect(Math.hypot(t.x - QUAD[1].x, t.y - QUAD[1].y) * (1 - bead)).toBeCloseTo(delta * DIRECTIONS.abyss.field.lobe.radius, 12);
    }
  });

  it('the samples hold both taps’ halo lattices and lobe-centre lattices', () => {
    const c = E4_NEAR_CASES.find((x) => x.face === 'dark' && x.delta === 0.5)!;
    expect(samplePoints('near', 0.5).length - 144).toBe(2 * (samplePoints('toggle').length - 144));
    expect(lobeLattices(c, deps('dark')).centres).toHaveLength(1 + 2 * 3);
    expect(lobeLattices({ ...c, face: 'light' }, deps('light')).centres).toHaveLength(2 + 2 * 3);
  });

  it.each(E4_NEAR_CASES.map((c) => [c.face, c.mode, c.delta, c.every, c] as const))('abyss %s, %s, near-spot δ = %s·r_L every %s ms', (_face, _mode, _delta, _every, c) => {
    const report = flashReport(c, deps(c.face));
    expect({ worst: report.worst, at: report.worst > 2 ? report.at : null }).toEqual({ worst: Math.min(report.worst, 2), at: null });
  }, LONG);
});
