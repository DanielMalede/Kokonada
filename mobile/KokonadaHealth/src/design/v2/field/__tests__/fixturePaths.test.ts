jest.mock('../../tokens/tokens.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule());
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());

import { fieldSweepFor, plateShadowGrounds, type GraphEdges } from '../../tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { FIXTURE_IDS, FIXTURE_INNER, FIXTURE_OUTER, actualExtensions, actualTokens } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { blueNoiseValue } from '../blueNoise.ts';
import { buildFieldFrame, type FieldGeometry, type FieldState, type Placement } from '../fieldFrame.ts';
import { NODE, fieldOklab, groundAt, inertShadow, quietFactor, regionOf, shadowFactor, smoothstep, type FieldFrame, type QuietRect, type Region } from '../fieldLaw.ts';
import { throughLedger } from '../fieldScenes.ts';
import { neutral, stormDeps } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// The field law's paths that Abyss does not draw, on the test-only fixture directions
// (__fixtures__/fixtureTokens.ts), each control asserting only its own path, and none asserting
// never-red: fixture-outer — an outer plate shadow on the light face, a zero-extent face, neutral
// placements with no lobe; fixture-inner — inner shadows on both faces with a lift on the light face,
// a zero-extent ground, the quiet zones' step path. Abyss is the control beside each: none of them.
// The real-Skia half is fixturePaths.skia.test.ts; E3's binding neutral3 case is ledgerStorms.fixture.test.ts.

const R_DP = BASE.plate.maxDiameter / 2;
const geometry = (quietRects: readonly QuietRect[] = []): FieldGeometry => ({ centrePx: [300, 300], radiusPx: R_DP, pxPerDp: 1, fontScale: 1, quietRects });
const statics = (id: DirectionId) => staticsFor(id, EXTENSIONS as never);
const state = (id: DirectionId, face: Face, more: Partial<FieldState> = {}): FieldState => ({
  direction: id,
  face,
  placements: [{ x: 0.566, y: -0.566, fade: 1 }],
  restFade: 0,
  stress: 0,
  confidence: 1,
  genesis: false,
  tMs: 7000,
  breathPhase: 0.3,
  tier: 'full',
  ...more,
});
const frameOf = (id: DirectionId, face: Face, more: Partial<FieldState> = {}, rects: readonly QuietRect[] = []) => buildFieldFrame(state(id, face, more), geometry(rects), statics(id));
const tokensOf = (id: DirectionId, face: Face) => [DIRECTIONS[id].plate.shadow[face], DIRECTIONS[id].plate.shadow2[face]];
const ABYSS = 'abyss' as DirectionId;

describe('the fixture mock (pin c): the fixture ids exist, and everything else is the shipped module', () => {
  it('BASE, DIRECTIONS.abyss and the base extensions are the actual modules’ objects; the fixtures are added', () => {
    expect(BASE).toBe(actualTokens().BASE);
    expect(DIRECTIONS.abyss).toBe(actualTokens().DIRECTIONS.abyss);
    expect(EXTENSIONS.base).toBe(actualExtensions().EXTENSIONS.base);
    expect(Object.keys(DIRECTIONS)).toEqual([...Object.keys(actualTokens().DIRECTIONS), ...FIXTURE_IDS]);
    for (const id of FIXTURE_IDS) expect((EXTENSIONS as Record<string, unknown>)[id]).toBeDefined();
  });
});

describe('the builder takes each fixture path from the tokens', () => {
  it.each(FIXTURE_IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const)))('%s, %s face: mode by the sign of plate.depth, offset and blur in plate units', (id, face) => {
    const f = frameOf(id, face);
    const depth = DIRECTIONS[id].plate.depth;
    tokensOf(id, face).forEach((t, i) => {
      if (t.strength === 0 || t.blur === 0) expect(f.shadows[i]).toEqual(inertShadow());
      else expect(f.shadows[i]).toEqual({ mode: Math.sign(depth), offset: expect.closeTo(-t.offsetY / R_DP, 15), blur: expect.closeTo(t.blur / R_DP, 15), strength: t.strength });
    });
  });

  it('which fixture shades: outer on the light face only; inner on both, with a lift on light; Abyss none', () => {
    const modes = (id: DirectionId, face: Face) => frameOf(id, face).shadows.map((s) => [s.mode, Math.sign(s.strength)]);
    expect(modes(FIXTURE_OUTER, 'dark')).toEqual([[0, 0], [0, 0]]);
    expect(modes(FIXTURE_OUTER, 'light')).toEqual([[1, 1], [1, 1]]);
    expect(modes(FIXTURE_INNER, 'dark')).toEqual([[-1, 1], [0, 0]]);
    expect(modes(FIXTURE_INNER, 'light')).toEqual([[-1, 1], [-1, -1]]);
    expect(modes(ABYSS, 'dark')).toEqual([[0, 0], [0, 0]]);
    expect(modes(ABYSS, 'light')).toEqual([[0, 0], [0, 0]]);
  });

  it('the shadows are static: no clock, breath, tension, confidence or placement moves one', () => {
    for (const id of FIXTURE_IDS) {
      const a = frameOf(id, 'light');
      const b = frameOf(id, 'light', { tMs: 41234, breathPhase: 0.9, stress: 1, confidence: null, genesis: true, placements: [], restFade: 1 });
      expect(b.shadows).toEqual(a.shadows);
    }
  });

  it('the masks: a zero-extent face on fixture-outer, a zero-extent ground on fixture-inner, both 1 on Abyss', () => {
    expect([frameOf(FIXTURE_OUTER, 'dark').mask.face, frameOf(FIXTURE_OUTER, 'dark').mask.outside]).toEqual([0, 1]);
    expect([frameOf(FIXTURE_INNER, 'dark').mask.face, frameOf(FIXTURE_INNER, 'dark').mask.outside]).toEqual([1, 0]);
    expect([frameOf(ABYSS, 'dark').mask.face, frameOf(ABYSS, 'dark').mask.outside]).toEqual([1, 1]);
  });

  it('the quiet feather: 0 on fixture-inner (the step path), above 0 on Abyss', () => {
    const rect = [{ cx: 10, cy: 20, hx: 30, hy: 4 }];
    expect(frameOf(FIXTURE_INNER, 'dark', {}, rect).quiet.feather).toBe(0);
    expect(frameOf(ABYSS, 'dark', {}, rect).quiet.feather).toBeGreaterThan(0);
  });

  // Designer 2.6 (the E4 neutral3 property, now structural): with only neutral placements in the
  // frame and neutralLobe 0, no placement carries a lobe, so the rest lobes stay lit at fade 1 whatever
  // restFade the caller passes: there is no rest crossfade. A neutral placement draws no lobe of its own.
  describe('neutral placements with no lobe (fixture-outer, neutralLobe 0)', () => {
    const neutrals: Placement[] = [{ x: 0.01, y: -0.02, fade: 1 }, { x: 0.03, y: -0.02, fade: 0.4 }];
    const restLobes = (f: FieldFrame) => f.nodes.filter((n) => n.id === NODE.R0 && n.bead === null && n.fade > 0);
    const neutralNodes = (f: FieldFrame) => f.nodes.filter((n) => n.id === NODE.R0 && n.bead !== null);

    it('only neutral placements: restFade is forced to 1 and every rest lobe is lit, at any restFade passed', () => {
      for (const restFade of [0, 0.3, 1]) {
        const f = frameOf(FIXTURE_OUTER, 'dark', { placements: neutrals, restFade });
        expect(restLobes(f).map((n) => n.fade)).toEqual(statics(FIXTURE_OUTER).restLobes.map(() => 1));
        expect(neutralNodes(f).map((n) => n.radius)).toEqual([0, 0]);
      }
    });

    it('a non-neutral placement beside them: restFade is the caller’s again', () => {
      const f = frameOf(FIXTURE_OUTER, 'dark', { placements: [...neutrals, { x: 0.566, y: -0.566, fade: 1 }], restFade: 0 });
      expect(restLobes(f)).toEqual([]);
    });

    it('Abyss (neutralLobe 1): neutral placements carry lobes, so restFade is the caller’s', () => {
      const f = frameOf(ABYSS, 'dark', { placements: neutrals, restFade: 0 });
      expect(restLobes(f)).toEqual([]);
      expect(neutralNodes(f).every((n) => n.radius > 0)).toBe(true);
    });

    it('the ledger agrees: through a settle, with only neutral taps, restFade stays 1 at every step on fixture-outer and falls to 0 on Abyss', () => {
      const taps = [neutral(1), neutral(2), neutral(3)];
      const outer = throughLedger(stormDeps(FIXTURE_OUTER, statics(FIXTURE_OUTER)), [], taps);
      expect(outer.map((s) => s.shown.restFade)).toEqual(outer.map(() => 1));
      const abyss = throughLedger(stormDeps(ABYSS, statics(ABYSS)), [], taps);
      expect(abyss[abyss.length - 1].shown.restFade).toBe(0);
    });
  });
});

describe('the law on the fixture paths, exactly as ruled', () => {
  /** The ruled shadow factor, by hand, in plate units. */
  const expected = (f: FieldFrame, qx: number, qy: number) => {
    const d = Math.sqrt(qx * qx + qy * qy);
    const region = regionOf(d, f);
    let sum = 0;
    for (const s of f.shadows) {
      if (s.mode === 0) continue;
      const dist = Math.sqrt(qx * qx + (qy - s.offset) * (qy - s.offset));
      if (s.mode > 0 && (region === 'moat' || region === 'outside')) sum += s.strength * smoothstep(-s.blur, s.blur, 1 - dist);
      if (s.mode < 0 && region === 'face') sum += s.strength * smoothstep(-s.blur, s.blur, dist - f.ringInner);
    }
    return 1 - sum;
  };
  const at = (f: FieldFrame) => (qx: number, qy: number) => shadowFactor(f, regionOf(Math.hypot(qx, qy), f), qx, qy);

  it.each([[FIXTURE_OUTER, 'light'], [FIXTURE_INNER, 'dark'], [FIXTURE_INNER, 'light']] as const)('%s, %s face: the shadow factor at points across the plate and beyond', (id, face) => {
    const f = frameOf(id, face);
    let shaded = 0;
    for (let qy = -1.4; qy <= 1.4; qy += 0.01) {
      for (const qx of [0, 0.3, -0.7]) {
        const got = at(f)(qx, qy);
        expect(got).toBe(expected(f, qx, qy));
        if (got !== 1) shaded++;
      }
    }
    expect(shaded).toBeGreaterThan(20);
  });

  it('outer (fixture-outer light): only outside the rim, darkest below the plate', () => {
    const f = at(frameOf(FIXTURE_OUTER, 'light'));
    for (const [qx, qy] of [[0, 0], [0, 0.9], [0, -0.99], [0.7, -0.7]]) expect(f(qx, qy)).toBe(1);
    expect(f(0, -1.03)).toBeLessThan(f(0, 1.03));
    expect(f(0, -1.03)).toBeLessThan(1);
  });

  it('inner (fixture-inner): only on the face, darkest at the top inner lip; the light face’s negative strength lifts', () => {
    const frame = frameOf(FIXTURE_INNER, 'dark');
    const f = at(frame);
    const lip = frame.ringInner - 0.005;
    expect(f(0, lip)).toBeLessThan(f(0, -lip));
    expect(f(0, 0.95)).toBe(1);
    expect(f(0, 1.05)).toBe(1);
    const light = frameOf(FIXTURE_INNER, 'light');
    const lift = { ...light, shadows: [inertShadow(), light.shadows[1]] };
    expect(at(lift)(0, -lip)).toBeGreaterThan(1);
  });

  it('L only: on a neutral ground the fixture shadows change L and leave a and b exactly 0', () => {
    const grey = { L: 0.6, a: 0, b: 0 };
    for (const [id, face] of [[FIXTURE_OUTER, 'light'], [FIXTURE_INNER, 'dark'], [FIXTURE_INNER, 'light']] as const) {
      const f = { ...frameOf(id, face, { placements: [] }), grounds: { outside: grey, face: grey, ring: grey }, grain: { inside: 0, ground: 0 }, dither: 0, vignette: 0, centreLift: 0, kField: 0 };
      let changed = 0;
      for (let y = 100; y < 520; y += 3) {
        const c = fieldOklab(f, 300.5, y + 0.5);
        expect([c.a, c.b]).toEqual([0, 0]);
        if (c.L !== 0.6) changed++;
      }
      expect(changed).toBeGreaterThan(0);
    }
  });

  it('the outer shadow shades the ground where the field does not land (fixture-outer light, mask.outside 0)', () => {
    const frame = frameOf(FIXTURE_OUTER, 'light');
    const noField = { ...frame, mask: { ...frame.mask, outside: 0 }, grain: { inside: 0, ground: 0 }, dither: 0 };
    const [qx, qy] = [0, -1.02];
    const x = noField.centrePx[0] + qx * noField.radiusPx;
    const y = noField.centrePx[1] - qy * noField.radiusPx;
    const factor = shadowFactor(noField, regionOf(Math.hypot(qx, qy), noField), qx, qy);
    expect(factor).toBeLessThan(0.99);
    expect(fieldOklab(noField, x, y).L).toBeCloseTo(noField.grounds.outside.L * factor, 12);
  });

  // A zero extent: the field weight never lands there, so scaling kField changes no pixel in that
  // region, while it does in the others (and in Abyss's same region).
  const pixelsIn = (f: FieldFrame, regions: readonly Region[]) => {
    const out: Array<[number, number]> = [];
    for (let y = 2.5; y < 600; y += 9) {
      for (let x = 2.5; x < 600; x += 9) {
        const d = Math.hypot((x - f.centrePx[0]) / f.radiusPx, (y - f.centrePx[1]) / f.radiusPx);
        if (regions.includes(regionOf(d, f))) out.push([x, y]);
      }
    }
    return out;
  };
  const kFieldReaches = (f: FieldFrame, regions: readonly Region[]) => {
    const heavier = { ...f, kField: f.kField * 3 + 0.5 };
    const points = pixelsIn(f, regions);
    expect(points.length).toBeGreaterThan(50);
    return points.filter(([x, y]) => JSON.stringify(fieldOklab(f, x, y)) !== JSON.stringify(fieldOklab(heavier, x, y))).length;
  };
  const wide: Partial<FieldState> = { placements: [{ x: 0.2, y: 0.1, fade: 1 }, { x: -0.5, y: -0.3, fade: 1 }, { x: 0.6, y: 0.6, fade: 1 }] };

  it('a zero-extent face (fixture-outer): the field weight reaches no face pixel, but reaches the ring and the ground', () => {
    const f = frameOf(FIXTURE_OUTER, 'dark', wide);
    expect(kFieldReaches(f, ['face'])).toBe(0);
    expect(kFieldReaches(f, ['ring', 'outside'])).toBeGreaterThan(0);
    expect(kFieldReaches(frameOf(ABYSS, 'dark', wide), ['face'])).toBeGreaterThan(0);
  });

  it('a zero-extent ground (fixture-inner): the field weight reaches no moat or outside pixel, but reaches the face', () => {
    const f = frameOf(FIXTURE_INNER, 'dark', wide);
    expect(kFieldReaches(f, ['moat', 'outside'])).toBe(0);
    expect(kFieldReaches(f, ['face'])).toBeGreaterThan(0);
    expect(kFieldReaches(frameOf(ABYSS, 'dark', wide), ['moat', 'outside'])).toBeGreaterThan(0);
  });

  it('the quiet step path (fixture-inner): the bound’s corner + 0.70·g is quiet, + 0.75·g is exactly 1, and the factor is only ever 0 or 1', () => {
    const RECT: QuietRect = { cx: 100, cy: 100, hx: 40, hy: 10 };
    const f = frameOf(FIXTURE_INNER, 'dark', {}, [RECT]);
    const g = f.quiet.grow;
    const [cx, cy] = [RECT.cx + RECT.hx, RECT.cy + RECT.hy];
    expect(quietFactor(f, cx + 0.7 * g, cy + 0.7 * g)).toBe(0);
    expect(quietFactor(f, cx + 0.75 * g, cy + 0.75 * g)).toBe(1);
    const line = (fr: FieldFrame) => Array.from({ length: 200 }, (_, i) => quietFactor(fr, RECT.cx + RECT.hx + i * 0.25, RECT.cy));
    expect(new Set(line(f))).toEqual(new Set([0, 1]));
    expect(line(frameOf(ABYSS, 'dark', {}, [RECT])).some((v) => v > 0 && v < 1)).toBe(true);
  });
});

// The designer's planted-rect test (ruling 2.9) on the fixture paths: inside a grown rect every pixel is
// identical across s, c, t and placements, and is the ground, shadowed where a plate shadow reaches,
// with the static grain and dither.
describe('a planted quiet rect on the fixture paths: nothing the field does reaches inside it', () => {
  const cases: Array<[DirectionId, Face, QuietRect]> = [
    [FIXTURE_OUTER, 'light', { cx: 300, cy: 520, hx: 150, hy: 14 }], // below the plate, under the outer shadow
    // On the face at the upper inner lip, under the inner shadow (and on light the lift), away from every
    // moment's beads: a bead's halo is drawn inside a quiet zone by design.
    [FIXTURE_INNER, 'dark', { cx: 393, cy: 200, hx: 10, hy: 8 }],
    [FIXTURE_INNER, 'light', { cx: 393, cy: 200, hx: 10, hy: 8 }],
  ];
  const moments: Array<Partial<FieldState>> = [
    { stress: 0, confidence: 1, genesis: true, tMs: 1000, breathPhase: 0.1 },
    { stress: 1, confidence: null, genesis: false, tMs: 37000, breathPhase: 0.7, placements: [{ x: -0.566, y: 0.566, fade: 1 }, { x: 0.3, y: 0.8, fade: 0.4 }] },
    { stress: 0.5, confidence: 0.2, genesis: false, tMs: 59999, breathPhase: 0.95, placements: [], restFade: 1 },
  ];

  it.each(cases)('%s, %s face: identical across s, c, t and placements, and equal to the shadowed ground + grain + dither', (id, face, rect) => {
    const frames = moments.map((m) => frameOf(id, face, m, [rect]));
    let inside = 0;
    let shadowed = 0;
    for (let y = Math.floor(rect.cy - rect.hy - 8); y <= rect.cy + rect.hy + 8; y++) {
      for (let x = Math.floor(rect.cx - rect.hx - 8); x <= rect.cx + rect.hx + 8; x++) {
        const [px, py] = [x + 0.5, y + 0.5];
        if (quietFactor(frames[0], px, py) !== 0) continue;
        inside++;
        const first = fieldOklab(frames[0], px, py);
        for (const f of frames.slice(1)) expect(fieldOklab(f, px, py)).toEqual(first);
        const f = frames[0];
        const qx = (px - f.centrePx[0]) / f.radiusPx;
        const qy = -(py - f.centrePx[1]) / f.radiusPx;
        const d = Math.sqrt(qx * qx + qy * qy);
        const region = regionOf(d, f);
        const g = groundAt(region, d, f);
        const grain = region === 'face' ? f.grain.inside : f.grain.ground;
        const factor = shadowFactor(f, region, qx, qy);
        if (factor !== 1) shadowed++;
        expect([first.a, first.b]).toEqual([g.a, g.b]);
        expect(first.L).toBeCloseTo(g.L * factor + grain * blueNoiseValue('grain', x, y) + f.dither * blueNoiseValue('dither', x, y), 14);
      }
    }
    expect(inside).toBeGreaterThan(100);
    expect(shadowed).toBeGreaterThan(10);
  });
});

// The sweep's sampler (T7; resilience, rulings after T5d, §3), on the fixtures: the grounds it
// enumerates include each shadowed ground at P 0.5 and 1, L only, summed over both shadows. Structure
// only: this never asserts that a fixture is never-red.
describe('the never-red sampler enumerates the fixtures’ shadowed grounds', () => {
  const GRAPH = EXTENSIONS.base['field.graph'] as unknown as { edges: GraphEdges };
  const CASES = [ABYSS, ...FIXTURE_IDS].flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const));
  const sumOf = (id: DirectionId, face: Face) => tokensOf(id, face).filter((t) => t.strength !== 0 && t.blur > 0).reduce((t, x) => t + x.strength, 0);
  const lab = (c: { oklab: readonly number[] }) => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });

  it('the field sweep’s grounds: the shadowed ground where a shadow lands under the field, and the ground only where the field lands outside', () => {
    const keys = CASES.map(([id, face]) => [id, face, Object.keys(fieldSweepFor(id, face, GRAPH.edges).grounds).sort()]);
    expect(keys).toEqual([
      [ABYSS, 'dark', ['face', 'ground', 'ring']],
      [ABYSS, 'light', ['face', 'ground', 'ring']],
      [FIXTURE_OUTER, 'dark', ['face', 'ground', 'ring']],
      [FIXTURE_OUTER, 'light', ['face', 'ground', 'ground shadowed 0.5', 'ground shadowed 1', 'ring']],
      [FIXTURE_INNER, 'dark', ['face', 'face shadowed 0.5', 'face shadowed 1', 'ring']],
      [FIXTURE_INNER, 'light', ['face', 'face shadowed 0.5', 'face shadowed 1', 'ring']],
    ]);
  });

  it.each([[FIXTURE_OUTER, 'light', 'ground'], [FIXTURE_INNER, 'dark', 'face'], [FIXTURE_INNER, 'light', 'face']] as const)('%s, %s face: each %s shadowed ground is its ground at L·(1 − Σ strength·P), a and b unchanged, in both samplers', (id, face, side) => {
    const sum = sumOf(id, face);
    expect(sum).not.toBe(0);
    const c = DIRECTIONS[id].color[face];
    const g = side === 'face' ? lab(c.plate.face) : lab(c.ground);
    const field = fieldSweepFor(id, face, GRAPH.edges).grounds;
    const edge = plateShadowGrounds(id, face)[side];
    for (const P of [0.5, 1]) {
      const want = { L: g.L * (1 - sum * P), a: g.a, b: g.b };
      expect(field[`${side} shadowed ${P}`]).toEqual(want);
      expect(edge[`${side} shadowed ${P}`]).toEqual(want);
    }
    expect(Object.keys(edge).sort()).toEqual([side, `${side} shadowed 0.5`, `${side} shadowed 1`]);
  });

  it('the edge sweep’s surfaces: no shadowed ground where no shadow is drawn (Abyss, fixture-outer dark)', () => {
    for (const [id, face] of [[ABYSS, 'dark'], [ABYSS, 'light'], [FIXTURE_OUTER, 'dark']] as const) {
      const g = plateShadowGrounds(id, face);
      expect([Object.keys(g.face), Object.keys(g.ground)]).toEqual([['face'], ['ground']]);
    }
  });
});
