import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import type { DirectionId, Face } from '../../tokens/tokens.generated.ts';
import { ABYSS_DARK_REST_BEFORE_ITEM_6, E4_CADENCES, E4_CASES, FRAME_MS, flashReport, lobeLattices, naiveDriver, samplePoints, worstFlashesPerSecond } from '../flashCount.ts';
import { stormDeps } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// QA-068, the event path: E4, the rendered flash count, in the sweeps project (jest.sweeps.config.js).
// Its text, its cases and its counter are in the harness (field/flashCount.ts). WCAG 2.3.1: at most two
// general flashes in any one-second window, at every sample point, under every storm.

const LONG = 15 * 60_000;
// The ledger counts the case's face's rest lobes (UI-112: Abyss one on dark, two on light).
const deps = (id: DirectionId, face: Face) => stormDeps(id, staticsFor(id, EXTENSIONS as never), face);
// Law round 2 (designer item 2 (iii), resilience B1): E4 is also run on Abyss's dark rest table from
// before item 6, its two symmetric lobes, so the law's fix is proven on its own merits, not by the
// token change that removed a lobe.
const beforeItem6 = () => {
  const s = staticsFor('abyss', EXTENSIONS as never);
  return stormDeps('abyss', { ...s, restLobes: { ...s.restLobes, dark: ABYSS_DARK_REST_BEFORE_ITEM_6 } }, 'dark');
};

describe('E4’s planted controls: the counter and the guard bite', () => {
  it('the counter on a 4 Hz square wave (Y 0.05 ↔ 0.30) returns 4; on a single step, 0', () => {
    const square = Array.from({ length: 240 }, (_, i) => (Math.floor((i * FRAME_MS) / 125) % 2 === 0 ? 0.05 : 0.3));
    expect(worstFlashesPerSecond(square, FRAME_MS)).toBe(4);
    const step = Array.from({ length: 240 }, (_, i) => (i < 120 ? 0.05 : 0.3));
    expect(worstFlashesPerSecond(step, FRAME_MS)).toBe(0);
  });

  // Resilience B1: a per-frame change test (y[i] − y[i−1] ≥ 0.1) keeps the square wave at 4 but counts
  // no smooth crossfade; the sine kills it. The low sine pins the 0.1 threshold from below, and the high
  // square the darker-side clause (< 0.8).
  it('a 3 Hz sine of pk-pk 0.12 (Y 0.15 ± 0.06) returns 3; at pk-pk 0.09, 0; a 4 Hz square between 0.85 and 0.98, 0', () => {
    const sine = (amplitude: number) => Array.from({ length: 240 }, (_, i) => 0.15 + amplitude * Math.sin(2 * Math.PI * 3 * ((i * FRAME_MS) / 1000)));
    expect(Math.max(...sine(0.06).slice(1).map((y, i) => Math.abs(y - sine(0.06)[i])))).toBeLessThan(0.1); // no single frame changes by 0.1
    expect(worstFlashesPerSecond(sine(0.06), FRAME_MS)).toBe(3);
    expect(worstFlashesPerSecond(sine(0.045), FRAME_MS)).toBe(0);
    const bright = Array.from({ length: 240 }, (_, i) => (Math.floor((i * FRAME_MS) / 125) % 2 === 0 ? 0.85 : 0.98));
    expect(worstFlashesPerSecond(bright, FRAME_MS)).toBe(0);
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

  // Resilience B1: a 5×5 lattice at ±0.05 R around every rest-lobe centre and every placement-lobe
  // centre at the storm's first frame (a placement's drift is its drift key's, mod the three tables).
  it('the lobe-centre lattices: 25 points around each rest lobe and each tap’s lobe at ordinals 0–2, centred on the builder’s centres', () => {
    const toggle = lobeLattices({ id: 'abyss', face: 'dark', mode: 'settle', kind: 'toggle', every: 50 }, deps('abyss', 'dark'));
    expect(toggle.centres).toHaveLength(1 + 1 * 3);
    expect(toggle.points).toHaveLength(25 * toggle.centres.length);
    const light = lobeLattices({ id: 'abyss', face: 'light', mode: 'reduced', kind: 'cycle4', every: 50 }, deps('abyss', 'light'));
    expect(light.centres).toHaveLength(2 + 4 * 3);
    const old = lobeLattices({ id: 'abyss', face: 'dark', mode: 'settle', kind: 'toggle', every: 50 }, beforeItem6());
    expect(old.centres).toHaveLength(2 + 1 * 3);
    // Each lattice is centred on its lobe: its middle point is the centre, its corners ±0.05 R away.
    toggle.centres.forEach((c, i) => {
      expect(toggle.points[25 * i + 12]).toEqual(c);
      expect(toggle.points[25 * i]).toEqual([c[0] - 0.05, c[1] - 0.05]);
    });
    // The rest lobe's centre is the table's plus the drift: near (−0.3, 0.35), never on it exactly.
    expect(Math.hypot(toggle.centres[0][0] + 0.3, toggle.centres[0][1] - 0.35)).toBeLessThan(0.15);
  });

  it.each(E4_CASES.map((c) => [c.id, c.face, c.mode, c.kind, c.every, c] as const))('%s %s, %s, %s every %s ms', (id, _face, _mode, _kind, _every, c) => {
    const report = flashReport(c, deps(id, c.face));
    expect({ worst: report.worst, at: report.worst > 2 ? report.at : null }).toEqual({ worst: Math.min(report.worst, 2), at: null });
  }, LONG);
});

describe('E4 on Abyss dark’s rest table before item 6 (two lobes): the law, not the tokens, keeps it at most 2', () => {
  const cases = E4_CASES.filter((c) => c.face === 'dark' && c.kind !== 'neutral3');
  it('runs every dark toggle and cycle4 case', () => {
    expect(cases).toHaveLength(2 * 2 * 5);
    expect(ABYSS_DARK_REST_BEFORE_ITEM_6).toEqual([[-0.35, -0.3], [0.4, 0.35]]);
  });

  it.each(cases.map((c) => [c.mode, c.kind, c.every, c] as const))('abyss dark (two rest lobes), %s, %s every %s ms', (_mode, _kind, _every, c) => {
    const report = flashReport(c, beforeItem6());
    expect({ worst: report.worst, at: report.worst > 2 ? report.at : null }).toEqual({ worst: Math.min(report.worst, 2), at: null });
  }, LONG);
});
