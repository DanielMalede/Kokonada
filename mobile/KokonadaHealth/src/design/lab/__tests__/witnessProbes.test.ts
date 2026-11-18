import type { ProbeRect } from '../probe/geometry';
import { witnessColours } from '../witness/witnessFrames';
import { PATCH_DP, witnessLayout, type WitnessLayout } from '../witness/witnessLayout';
import { PROBED_KINDS, PROBE_TOLERANCE_PX, WITNESS_PROBES, witnessProbeId, witnessProbeProblems } from '../witness/witnessProbes';

// The designer's witness BLOCK, item ii: the React Native Views of the witness (W1a and W3) are the only patches a layout
// direction can move, so each has a probe whose frame READY reports in px, and a row whose probe misses its layout rect by
// more than 1 px is refused. witnessProbeProblems is that refusal on the scene's side: what the harness calls on READY.

const K = 2.625;
const W = 1080 / K;
const H = 2340 / K;
const INSETS = { top: 74 / K, right: 0, bottom: 48, left: 0 };
const layout: WitnessLayout = witnessLayout('dark', W, H, K, 1, INSETS);
type R = { x: number; y: number; width: number; height: number };
const probeOf = (dp: R): ProbeRect => ({ dp, px: { x: dp.x * K, y: dp.y * K, width: dp.width * K, height: dp.height * K } });

/** READY's probes where every View landed on its layout rect, the stage at the window's origin. */
function landed(l: WitnessLayout = layout): Record<string, ProbeRect> {
  const out: Record<string, ProbeRect> = { stage: probeOf({ x: 0, y: 0, width: l.width, height: l.height }), region: probeOf(l.region) };
  for (const p of l.patches) if ((PROBED_KINDS as readonly string[]).includes(p.kind)) out[witnessProbeId(p.kind, p.colour)] = probeOf(p.rect);
  return out;
}
const shiftPx = (r: ProbeRect, dx: number, dy = 0): ProbeRect => ({ dp: { ...r.dp, x: r.dp.x + dx / K, y: r.dp.y + dy / K }, px: { ...r.px, x: r.px.x + dx, y: r.px.y + dy } });

describe('the witness probes, named per patch', () => {
  it('the stage, the capture region the scene laid out in, then W1a and W3 of every colour, as `<kind>.<colour>`', () => {
    const names = witnessColours('dark').map((c) => c.name);
    expect(witnessColours('light').map((c) => c.name)).toEqual(names);
    expect(PROBED_KINDS).toEqual(['W1a', 'W3']);
    expect(WITNESS_PROBES).toEqual(['stage', 'region', ...names.map((c) => `W1a.${c}`), ...names.map((c) => `W3.${c}`)]);
    expect(new Set(WITNESS_PROBES).size).toBe(12);
    for (const id of WITNESS_PROBES) expect(id).toMatch(/^[A-Za-z0-9._-]+$/); // a plan's probe id (capture.mjs TOKEN)
  });
});

describe('witnessProbeProblems: a row whose probe misses its layout rect by more than 1 px is refused', () => {
  it('every probe on its rect: no problem', () => {
    expect(PROBE_TOLERANCE_PX).toBe(1);
    expect(witnessProbeProblems(layout, landed())).toEqual([]);
  });

  it('a probe 1 px off is the pixel grid\'s rounding, and passes; 1.01 px off is refused, naming the probe and its edge', () => {
    const probes = landed();
    expect(witnessProbeProblems(layout, { ...probes, 'W3.joy': shiftPx(probes['W3.joy'], 1, -1) })).toEqual([]);
    const problems = witnessProbeProblems(layout, { ...probes, 'W3.joy': shiftPx(probes['W3.joy'], 1.01) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^probe W3\.joy .*1\.01 px.*more than 1 px/);
  });

  it('a wrong size is refused too (the far edges are checked, not only the origin)', () => {
    const probes = landed();
    const p = probes['W1a.calm'];
    const grown = { dp: { ...p.dp, width: p.dp.width + 2 / K }, px: { ...p.px, width: p.px.width + 2 } };
    expect(witnessProbeProblems(layout, { ...probes, 'W1a.calm': grown })).toEqual([expect.stringMatching(/^probe W1a\.calm /)]);
  });

  it('the dry run\'s mirrored Views (x\' = W - x - 24, under RTL) are refused, every one', () => {
    const probes = landed();
    const mirrored = { ...probes };
    for (const p of layout.patches.filter((x) => x.kind === 'W1a' || x.kind === 'W3')) {
      mirrored[witnessProbeId(p.kind, p.colour)] = probeOf({ ...p.rect, x: W - p.rect.x - PATCH_DP });
    }
    const refused = witnessProbeProblems(layout, mirrored).map((s) => s.split(' ')[1]).sort();
    expect(refused).toEqual(WITNESS_PROBES.filter((id) => id !== 'stage' && id !== 'region').sort());
  });

  it('a missing probe is refused (a dropped probe never reads as a passing one)', () => {
    const without = (id: string) => Object.fromEntries(Object.entries(landed()).filter(([k]) => k !== id));
    expect(witnessProbeProblems(layout, without('W1a.intense'))).toEqual(['probe W1a.intense is missing from READY']);
    expect(witnessProbeProblems(layout, without('stage'))[0]).toMatch(/^probe stage is missing/);
  });

  it('a region probe that is not the layout\'s capture region is refused: READY must carry the insets the layout used', () => {
    const probes = landed();
    expect(witnessProbeProblems(layout, { ...probes, region: shiftPx(probes.region, 0, -74) })).toEqual([expect.stringMatching(/^probe region /)]);
    const other = witnessLayout('dark', W, H, K, 1); // the same stage laid out with no insets
    expect(witnessProbeProblems(other, probes).some((s) => s.startsWith('probe region '))).toBe(true);
  });

  it('the probes are read relative to READY\'s stage, as the layout is written', () => {
    const probes = landed();
    const moved = Object.fromEntries(Object.entries(probes).map(([id, r]) => [id, shiftPx(r, 5, 7)]));
    expect(witnessProbeProblems(layout, moved)).toEqual([]);
  });
});
