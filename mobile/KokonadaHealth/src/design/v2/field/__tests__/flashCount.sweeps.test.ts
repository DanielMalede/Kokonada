import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import type { DirectionId, Face } from '../../tokens/tokens.generated.ts';
import { E4_CADENCES, E4_CASES, FRAME_MS, flashReport, naiveDriver, samplePoints, worstFlashesPerSecond } from '../flashCount.ts';
import { stormDeps } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// QA-068, the event path: E4, the rendered flash count, in the sweeps project (jest.sweeps.config.js).
// Its text, its cases and its counter are in the harness (field/flashCount.ts). WCAG 2.3.1: at most two
// general flashes in any one-second window, at every sample point, under every storm.

const LONG = 15 * 60_000;
// The ledger counts the case's face's rest lobes (UI-112: Abyss one on dark, two on light).
const deps = (id: DirectionId, face: Face) => stormDeps(id, staticsFor(id, EXTENSIONS as never), face);

describe('E4’s planted controls: the counter and the guard bite', () => {
  it('the counter on a 4 Hz square wave (Y 0.05 ↔ 0.30) returns 4; on a single step, 0', () => {
    const square = Array.from({ length: 240 }, (_, i) => (Math.floor((i * FRAME_MS) / 125) % 2 === 0 ? 0.05 : 0.3));
    expect(worstFlashesPerSecond(square, FRAME_MS)).toBe(4);
    const step = Array.from({ length: 240 }, (_, i) => (i < 120 ? 0.05 : 0.3));
    expect(worstFlashesPerSecond(step, FRAME_MS)).toBe(0);
  });

  it('a naive driver that restarts in 0 / out 1 on every tap, Abyss dark, reduced, toggle every 143 ms, gives 3 or more', () => {
    const plant = flashReport({ id: 'abyss', face: 'dark', mode: 'reduced', kind: 'toggle', every: 143 }, deps('abyss', 'dark'), naiveDriver('reduced'));
    expect(plant.worst).toBeGreaterThanOrEqual(3);
  }, LONG);

  it('a case run on deps of the other face is refused: the ledger would count the wrong face’s rest lobes', () => {
    expect(() => flashReport({ id: 'abyss', face: 'light', mode: 'settle', kind: 'toggle', every: 143 }, deps('abyss', 'dark'))).toThrow(/face/);
  });
});

describe('E4: the rendered flash count, at most 2 a second at every sample point', () => {
  it('the cases and samples are the ruled ones', () => {
    expect(E4_CADENCES).toEqual([50, 100, 143, 167, 250]);
    expect(E4_CASES).toHaveLength(2 * 2 * 2 * 5 + 2 * 2 * 5);
    expect(new Set(E4_CASES.map((c) => c.id))).toEqual(new Set(['abyss']));
    expect(E4_CASES.filter((c) => c.kind === 'neutral3').map((c) => c.face).sort()).toEqual([...Array(10).fill('dark'), ...Array(10).fill('light')]);
    expect(samplePoints('toggle').length).toBeGreaterThan(144);
    expect(samplePoints('cycle4').length - 144).toBe(4 * (samplePoints('toggle').length - 144));
  });

  it.each(E4_CASES.map((c) => [c.id, c.face, c.mode, c.kind, c.every, c] as const))('%s %s, %s, %s every %s ms', (id, _face, _mode, _kind, _every, c) => {
    const report = flashReport(c, deps(id, c.face));
    expect({ worst: report.worst, at: report.worst > 2 ? report.at : null }).toEqual({ worst: Math.min(report.worst, 2), at: null });
  }, LONG);
});
