import { graphSegments, sweepNeverRed, type BlendGraph, type NeverRedSweep } from '../../color/blendSpace.ts';
import { contrastRatio } from '../../color/contrast.ts';
import { hueSeparationViolations } from '../../color/deltaE.ts';
import { srgbToOklab, type Oklab, type Srgb } from '../../color/oklab.ts';
import { isRed, type RedBand } from '../../color/redBand.ts';
import { breathLawViolations, type BreathLaw } from '../../motion/breathLaw.ts';
import { BASE, DIRECTIONS, EXTENSIONS, type ColorValue, type DirectionId, type Face } from '../tokens.generated.ts';

// The rules the committed tokens must keep, per direction and per face, read from the generated
// module the app uses. The never-red bands are base.neverRed: the designer's proposal, PENDING
// DEC-081, so these tests run on whatever the owner rules once the token file carries it.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: Face[] = ['dark', 'light'];
const CASES = IDS.flatMap((id) => FACES.map((face) => [id, face] as const));
const QUADRANTS = ['joy', 'calm', 'reflective', 'intense'] as const;

const band = (b: { hueStart: number; hueEnd: number; chromaFloor: number }): RedBand => ({
  hueFrom: b.hueStart,
  hueTo: b.hueEnd,
  chromaFloor: b.chromaFloor,
});
const DESIGN_BAND = band(BASE.neverRed.design);
const CHECK_BAND = band(BASE.neverRed.check);

const lab = (c: ColorValue): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const rgb = (c: ColorValue): Srgb => [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16) / 255) as unknown as Srgb;
/** Dark faces carry the core tier of each emotion, light faces the deep tier (designer §1.1). */
const tierFor = (face: Face) => (face === 'dark' ? 'core' : 'deep');

describe('the bands are the designer’s proposal, pending DEC-081', () => {
  it('base.neverRed is marked proposed', () => {
    expect(EXTENSIONS.base.neverRed).toEqual({ status: 'proposed' });
  });
});

// QA-063: no emotion or field hue in the red band. In float against the design band, and as the
// 8-bit hex the app paints against the check band.
describe.each(CASES)('QA-063 (pending DEC-081): %s, %s face', (id, face) => {
  const colours: Array<[string, ColorValue]> = [
    ...QUADRANTS.map((q) => [`emotion.${q}.${tierFor(face)}`, BASE.emotion[q][tierFor(face)]] as [string, ColorValue]),
    ['field.restGlow', DIRECTIONS[id].color[face].field.restGlow],
  ];

  it.each(colours)('%s is clear of the design band in float and the check band as its hex', (_name, colour) => {
    expect(isRed(lab(colour), DESIGN_BAND)).toBe(false);
    expect(isRed(srgbToOklab(rgb(colour)), CHECK_BAND)).toBe(false);
  });
});

describe('QA-063 bites', () => {
  it('sRGB red is red under both bands', () => {
    expect(isRed(srgbToOklab([1, 0, 0]), DESIGN_BAND)).toBe(true);
    expect(isRed(srgbToOklab([1, 0, 0]), CHECK_BAND)).toBe(true);
  });
});

// QA-064: the emotion hues stay at least emotion.minHueGap apart. The shimmer is common-mode, so
// it moves every hue together and the gaps hold.
describe('QA-064', () => {
  it.each(['core', 'deep'] as const)('the %s tier keeps every pair at least minHueGap apart', (tier) => {
    const hues = Object.fromEntries(QUADRANTS.map((q) => [q, BASE.emotion[q][tier].oklch[2]]));
    expect(hueSeparationViolations(hues, BASE.emotion.minHueGap)).toEqual([]);
  });

  it('bites: a 65° pair fails', () => {
    expect(hueSeparationViolations({ joy: 80, calm: 145 }, BASE.emotion.minHueGap)).toHaveLength(1);
  });
});

// QA-065 over the signed blend graph (addendum §2.4): every reachable segment, every local ground
// the field or a halo lands on, k up to max(cap, halo peak), the pivot, the shimmer, and the
// field's L dither on 8-bit pixels.
const GRAPH = EXTENSIONS.base['field.graph'] as unknown as {
  edges: { straight: Array<[string, string]>; waypoint: Array<[string, string]>; restIntense: [string, string] };
};

function sweepFor(id: DirectionId, face: Face, edges?: { straight: Array<[string, string]>; waypoint: Array<[string, string]> }): NeverRedSweep {
  const d = DIRECTIONS[id];
  const colours = d.color[face];
  const tier = tierFor(face);
  const routed = d.field.graph.restIntenseRoute === 'waypoint';
  const graph: BlendGraph = {
    nodes: {
      J: lab(BASE.emotion.joy[tier]),
      C: lab(BASE.emotion.calm[tier]),
      R: lab(BASE.emotion.reflective[tier]),
      I: lab(BASE.emotion.intense[tier]),
      R0: lab(colours.field.restGlow),
    },
    straight: edges?.straight ?? [...GRAPH.edges.straight, ...(routed ? [] : [GRAPH.edges.restIntense])],
    waypoint: edges?.waypoint ?? [...GRAPH.edges.waypoint, ...(routed ? [GRAPH.edges.restIntense] : [])],
  };
  const grounds: Record<string, Oklab> = { face: lab(colours.plate.face), ring: lab(colours.plate.ring) };
  if (d.field.mask.outside > 0) grounds.ground = lab(colours.ground);
  const halo = face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight;
  return {
    graph,
    grounds,
    kMax: Math.max(d.field.cap[face], halo),
    kp: d.field.pivot,
    shimmerDeg: d.field.shimmer.deg,
    designBand: DESIGN_BAND,
    checkBand: CHECK_BAND,
    ditherAmplitude: BASE.field.dither.amplitude + Math.max(d.field.grain.ground, d.field.grain.inside),
    grid: { kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.1, pixelKStep: 0.1, chromaScales: [0.25, 0.5, 1] },
  };
}

describe.each(CASES)('QA-065 (pending DEC-081): %s, %s face', (id, face) => {
  // The sweep's inputs, pinned: dropping a ground, a k bound, a segment or the grain from the
  // amplitude would otherwise leave this block green while it checked less.
  it('sweeps the grounds, k range, segments and dither amplitude this direction can show', () => {
    const cfg = sweepFor(id, face);
    const d = DIRECTIONS[id];
    expect(Object.keys(cfg.grounds).sort()).toEqual(d.field.mask.outside > 0 ? ['face', 'ground', 'ring'] : ['face', 'ring']);
    expect(cfg.kMax).toBe(Math.max(d.field.cap[face], face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight));
    expect(graphSegments(cfg.graph)).toHaveLength(d.field.graph.restIntenseRoute === 'waypoint' ? 17 : 16);
    expect(cfg.ditherAmplitude).toBe(BASE.field.dither.amplitude + Math.max(d.field.grain.ground, d.field.grain.inside));
  });

  it('nothing the field can show is red, in float or on 8-bit pixels', () => {
    const report = sweepNeverRed(sweepFor(id, face));
    expect(report.failures).toEqual([]);
    expect(report.pixelSamples).toBeGreaterThan(0);
  });

  it('bites: the planted straight joy–intense edge fails', () => {
    const planted = sweepFor(id, face, { straight: [['J', 'I']], waypoint: [] });
    const report = sweepNeverRed({ ...planted, grid: { ...planted.grid, pixelTStep: 0.5, pixelKStep: 0.5 } });
    expect(report.failures.some((f) => f.segment === 'J-I' && f.check === 'design-band')).toBe(true);
  });
});

// QA-066 and QA-067, DEC-015 and DSN-035: rest 5–6 s, never shorter under stress, at most 10 s,
// exhale longer than inhale. DSN-032: no breath faster than 0.2 Hz.
const RULES = { restMinMs: 5000, restMaxMs: 6000, ceilingMs: 10000, stressStep: 0.01 };
const lawFor = (id: DirectionId): BreathLaw => ({
  masterPeriodMs: BASE.field.clock.T,
  nRest: DIRECTIONS[id].field.breath.nRest,
  nStress: DIRECTIONS[id].field.breath.nStress,
  inhale: DIRECTIONS[id].field.breath.inhale,
});

describe.each(IDS)('QA-066 and QA-067: %s', (id) => {
  it('the breath law keeps every rule', () => {
    expect(breathLawViolations(lawFor(id), RULES)).toEqual([]);
  });
});

describe('the breath bounds', () => {
  it('the fastest breath base allows is no faster than 0.2 Hz (DSN-032)', () => {
    expect(BASE.field.clock.T / BASE.field.clock.breath.nMax).toBeGreaterThanOrEqual(5000);
  });

  it('bites: a direction breathing at nRest 13 would fail the rest band', () => {
    expect(breathLawViolations({ ...lawFor(IDS[0]), nRest: 13 }, RULES).map((v) => v.rule)).toEqual(['rest-out-of-band']);
  });
});

// Contrast by construction (designer §1.3, §1.5, §1.6, DSN-044), on the 8-bit hexes the app paints.
// Any failure here is a STOP: the values are the designer's to change, not the build's.
function pairsFor(id: DirectionId, face: Face): Array<[string, ColorValue, ColorValue, number]> {
  const c = DIRECTIONS[id].color[face];
  const d = DIRECTIONS[id];
  const tier = tierFor(face);
  const navLabelGround = d.nav.active.capsule.opacity > 0 ? c.nav.activeFill : c.nav.surface;
  return [
    ...(['ground', 'surface1', 'surface2'] as const).flatMap((s) => [
      [`text.primary on ${s}`, c.text.primary, c[s], 4.5] as [string, ColorValue, ColorValue, number],
      [`text.secondary on ${s}`, c.text.secondary, c[s], 4.5] as [string, ColorValue, ColorValue, number],
    ]),
    ['text.tertiary on surface2', c.text.tertiary, c.surface2, 4.5],
    ['text.tertiary on ground', c.text.tertiary, c.ground, 4.5],
    ['line.control on ground', c.line.control, c.ground, 3],
    ['line.control on surface2', c.line.control, c.surface2, 3],
    ['plate.rim.base against the moat (ground)', c.plate.rim.base, c.ground, 3],
    ['plate.rim.base against the ring', c.plate.rim.base, c.plate.ring, 3],
    ['plate.rim.lit against the moat (ground)', c.plate.rim.lit, c.ground, 3],
    ['plate.rim.lit against the ring', c.plate.rim.lit, c.plate.ring, 3],
    ...QUADRANTS.map((q) => [`CTA label on the ${q} ${tier} tint`, c.text.onTint, BASE.emotion[q][tier], 4.5] as [string, ColorValue, ColorValue, number]),
    ['CTA label on the neutral fill', c.text.onInk, c.text.primary, 4.5],
    ['nav active label on its ground', c.nav.activeLabel, navLabelGround, 4.5],
    ['nav inactive label on the nav surface', c.nav.inactive, c.nav.surface, 4.5],
  ];
}

describe.each(CASES)('contrast: %s, %s face', (id, face) => {
  it.each(pairsFor(id, face))('%s reaches its minimum', (_what, fg, bg, minimum) => {
    expect(contrastRatio(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(minimum);
  });
});

describe('contrast bites', () => {
  it('the ring on itself is 1:1 and fails 3:1', () => {
    const ring = DIRECTIONS[IDS[0]].color.dark.plate.ring;
    expect(contrastRatio(rgb(ring), rgb(ring))).toBeLessThan(3);
  });
});
