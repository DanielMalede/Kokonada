import { BREATH_OPACITY as fromBreath } from '../breath';
import { BREATH_OPACITY as fromGlow } from '../BreathingGlow';

// The breath curve lives in ONE pure module (./breath) so the RN aura AND the pure Node asset
// scripts read the same numbers. BreathingGlow re-exports it — this guards that the seam stays
// single-sourced (no drift) and that the exact values the bootsplash bake depends on hold.

describe('BREATH_OPACITY — the single breath source', () => {
  it('holds the exact rest / peak / still curve', () => {
    expect(fromBreath).toEqual({ rest: 0.45, peak: 0.75, still: 0.55 });
  });

  it('is re-exported unchanged by BreathingGlow (one source, no drift)', () => {
    expect(fromGlow).toBe(fromBreath);
  });
});
