import { contrastRatio } from '../../color/contrast.ts';
import { hueSeparationViolations } from '../../color/deltaE.ts';
import { srgbToOklab, type Oklab, type Srgb } from '../../color/oklab.ts';
import { hueInBand, isRed, type RedBand } from '../../color/redBand.ts';
import { mixSafe } from '../../color/mixSafe.ts';
import { breathLawViolations, type BreathLaw } from '../../motion/breathLaw.ts';
import { EXTENSIONS } from '../tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type ColorValue, type DirectionId, type Face } from '../tokens.generated.ts';

// The rules the committed tokens must keep, per direction and per face, read from the generated
// module the app uses. The never-red bands are base.neverRed, as DEC-081 ruled them, read from
// the token file rather than repeated here.

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

describe('the bands are DEC-081’s ruling', () => {
  it('base.neverRed is marked decided, with the rule the code applies', () => {
    expect(EXTENSIONS.base.neverRed).toEqual({ status: 'decided', rule: 'red iff hue in [start,end] inclusive and C >= floor' });
  });
});

// QA-063: no emotion or field hue in the red band. In float against the design band, and as the
// 8-bit hex the app paints against the check band.
describe.each(CASES)('QA-063: %s, %s face', (id, face) => {
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

// QA-064 covers the anchors (≥ 70°). Marks never shimmer; the field's common-mode shimmer keeps field-to-mark separation ≥ emotion.minFieldMarkGap (64°).
describe('QA-064', () => {
  it.each(['core', 'deep'] as const)('the %s tier keeps every pair at least minHueGap apart', (tier) => {
    const hues = Object.fromEntries(QUADRANTS.map((q) => [q, BASE.emotion[q][tier].oklch[2]]));
    expect(hueSeparationViolations(hues, BASE.emotion.minHueGap)).toEqual([]);
  });

  it('bites: a 65° pair fails', () => {
    expect(hueSeparationViolations({ joy: 80, calm: 145 }, BASE.emotion.minHueGap)).toHaveLength(1);
  });

  /** The tightest gap between neighbouring anchor hues, round the circle. */
  const tightestAnchorGap = () => {
    const hues = QUADRANTS.map((q) => BASE.emotion[q].core.oklch[2]).sort((a, b) => a - b);
    return Math.min(...hues.map((h, i) => (i === hues.length - 1 ? hues[0] + 360 - h : hues[i + 1] - h)));
  };

  // DSN-014: on screen a field hue stays at least minFieldMarkGap from a mark of another quadrant.
  it.each(IDS)('%s: the tightest anchor gap less the shimmer is at least minFieldMarkGap', (id) => {
    expect(tightestAnchorGap() - DIRECTIONS[id].field.shimmer.deg).toBeGreaterThanOrEqual(BASE.emotion.minFieldMarkGap);
  });

  it('bites: a shimmer of 9° would leave 63°, under 64°', () => {
    expect(tightestAnchorGap() - 9).toBeLessThan(BASE.emotion.minFieldMarkGap);
  });
});

// The signed blend graph (addendum §2.4). The QA-065 sweeps over it and over the anti-aliased
// pairs live in neverRed.field.test.ts and neverRed.edges.test.ts.
const GRAPH = EXTENSIONS.base['field.graph'] as unknown as {
  edges: { straight: Array<[string, string]>; waypoint: Array<[string, string]>; restIntense: [string, string] };
};

describe('the blend graph and the bands', () => {
  // topTwoSoft can pick any two beads, so every pair of nodes needs exactly one edge.
  it('the blend graph joins every pair of nodes exactly once', () => {
    const key = (a: string, b: string) => [a, b].sort().join('-');
    const n = ['J', 'C', 'R', 'I', 'R0'];
    const listed = [...GRAPH.edges.straight, ...GRAPH.edges.waypoint, GRAPH.edges.restIntense].map(([a, b]) => key(a, b)).sort();
    expect(listed).toEqual(n.flatMap((a, i) => n.slice(i + 1).map((b) => key(a, b))).sort());
  });

  it('the design band contains the check band, and its floor is no higher', () => {
    for (let h = 0; h < 360; h += 0.25) if (hueInBand(h, CHECK_BAND)) expect(hueInBand(h, DESIGN_BAND)).toBe(true);
    expect(DESIGN_BAND.chromaFloor).toBeLessThanOrEqual(CHECK_BAND.chromaFloor);
  });
});

// DEC-081's margin rule (DSN-013): every authored colour and every sweep maximum stays at least
// neverRed.margin below the floor of each band it is checked against.
const MARGIN = BASE.neverRed.margin;
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - MARGIN;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - MARGIN;

/** Every colour value in a token tree, with its path. */
function colourLeaves(node: unknown, prefix: string, out: Array<[string, ColorValue]> = []): Array<[string, ColorValue]> {
  if (node && typeof node === 'object' && 'hex' in node && 'oklab' in node) {
    out.push([prefix, node as ColorValue]);
  } else if (Array.isArray(node)) {
    node.forEach((child, i) => colourLeaves(child, `${prefix}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) colourLeaves(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

const hueOf = (colour: Oklab) => ((((Math.atan2(colour.b, colour.a) * 180) / Math.PI) % 360) + 360) % 360;
const chromaOf = (colour: Oklab) => Math.hypot(colour.a, colour.b);

describe('DEC-081’s margin on every authored colour', () => {
  const authored: Array<[string, ColorValue]> = [
    ...colourLeaves(BASE.emotion, 'emotion'),
    ...IDS.flatMap((id) => [...colourLeaves(DIRECTIONS[id].color, `${id}.color`), ...colourLeaves(DIRECTIONS[id].elevation, `${id}.elevation`)]),
  ];

  it('the margin is 0.0005', () => {
    expect(MARGIN).toBe(0.0005);
  });

  it.each(authored)('%s keeps the margin in float and as its hex', (_path, colour) => {
    const float = lab(colour);
    if (hueInBand(hueOf(float), DESIGN_BAND)) expect(chromaOf(float)).toBeLessThanOrEqual(DESIGN_LIMIT);
    const painted = srgbToOklab(rgb(colour));
    if (hueInBand(hueOf(painted), CHECK_BAND)) expect(chromaOf(painted)).toBeLessThanOrEqual(CHECK_LIMIT);
  });
});

// DSN-019 (designer rulings §1, gaps §b): every edge ink is achromatic, or inside the ground window,
// or a near-neutral warm ink, per direction and face.
describe.each(CASES)('DSN-019 edge inks: %s, %s face', (id, face) => {
  const rule = EXTENSIONS.base['neverRed.edgeInk'] as unknown as { tokens: string[] };
  const ink = BASE.neverRed.edgeInk;
  const windowBand: RedBand = { hueFrom: BASE.neverRed.window.hueStart, hueTo: BASE.neverRed.window.hueEnd, chromaFloor: 0 };
  const warmBand: RedBand = { hueFrom: ink.hueMin, hueTo: ink.hueMax, chromaFloor: 0 };
  const colourAt = (path: string) => path.split('.').reduce<any>((node, key) => node[key], DIRECTIONS[id].color[face]) as ColorValue;

  it('lists exactly the eight edge inks, text.onInk among them', () => {
    expect(rule.tokens).toEqual([
      'text.primary',
      'text.onTint',
      'text.onInk',
      'plate.rim.base',
      'plate.rim.lit',
      'plate.ringHighlight',
      'bead.setting',
      'bead.shadow',
    ]);
  });

  it.each(rule.tokens)('%s meets the edge-ink rule', (path) => {
    const [, C, h] = colourAt(path).oklch;
    const ok = C === 0 || hueInBand(h, windowBand) || (C <= ink.maxChroma && hueInBand(h, warmBand));
    expect({ path, C, h, ok }).toEqual({ path, C, h, ok: true });
  });
});

// Designer gaps §b: text.onInk is text.onTint, so the CTA label never changes colour while mixSafe
// carries the fill from neutral to orchid to amber and back.
describe.each(CASES)('the CTA label through a mixSafe transition: %s, %s face', (id, face) => {
  it('is the same colour in every frame', () => {
    const c = DIRECTIONS[id].color[face];
    const tier = tierFor(face);
    const legs: Array<[Oklab, Oklab]> = [
      [lab(c.text.primary), lab(BASE.emotion.intense[tier])],
      [lab(BASE.emotion.intense[tier]), lab(BASE.emotion.joy[tier])],
      [lab(BASE.emotion.joy[tier]), lab(c.text.primary)],
    ];
    const labels: ColorValue[] = [];
    legs.forEach(([from, to], leg) => {
      for (let i = 0; i <= 20; i++) {
        // The fill this frame; the label is onInk only while the fill is the neutral one.
        mixSafe(from, to, i / 20, DESIGN_BAND);
        const neutral = (leg === 0 && i === 0) || (leg === 2 && i === 20);
        labels.push(neutral ? c.text.onInk : c.text.onTint);
      }
    });
    for (const label of labels) expect(label).toEqual(labels[0]);
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

describe('the breath curve', () => {
  // breathLevel implements cosine halves and nothing else, so the token must name that curve.
  it('is cosineHalves, the one breathLevel draws', () => {
    expect(BASE.breath.curve).toBe('cosineHalves');
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
