import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, TileMode, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { oklabToOklch, srgbToOklab } from '../../color/oklab.ts';
import { hueInBand } from '../../color/redBand.ts';
import { CHECK_BAND } from '../../tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { BLUE_NOISE_SIZE, blueNoiseRgba } from '../blueNoise.ts';
import { buildFieldFrame, fixedFieldBreath, type FieldState, type Placement } from '../fieldFrame.ts';
import { fieldPixel, regionOf, shadowFactor, type FieldFrame } from '../fieldLaw.ts';
import { FIELD_SKSL } from '../fieldShader.ts';
import { stormDeps } from '../ledgerStorms.ts';
import { emptyLedger, fades, reconcile, type Tap } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';
import { packFrame } from '../uniforms.ts';

// QA-065 on the never-red scenes (resilience MEDIUM-2 item 1; architect re-rule T9): each direction's
// scenes, built by the uniform builder from the tokens, with the plate's shadows, drawn by the field
// shader in real Skia (CanvasKit), and every pixel held outside the check band with DEC-081's margin.
//   · The bead scenes (seam, ringHalo, backlight) over tension × confidence × genesis.
//   · restToIntense through the placement ledger: the placement fading in along u and the rest lobes
//     out along 1 − u², at every 50 ms of the settle ramp (the reduced ramp draws the same pairs).
//   · A replace dissolve through the ledger, every direction: the seam's intense bead swapped for its
//     joy bead in one crossfade, I out along 1 − u² as J comes in along u.
//   · The shadowed grounds: every frame carries the builder's plate shadows; Linen light's outer
//     shadow and Basin's inner ones are shown to reach the drawn pixels.
//   · A planted shader whose J–I edge runs straight (no waypoint) must put pixels in the check band on
//     the dark faces' seam, so the check is shown to bite.
// CanvasKit draws this shader slowly, so each frame is drawn in two views: the whole field at a coarse
// scale (it reaches about 2.3R from the plate centre), and the scene's beads at a fine scale, where the
// halos, the ring and the moat are thin. The float and 8-bit sweeps (neverRedSweeps.ts) are
// exhaustive over the colours; this proves the shader and the builder draw only those colours here.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const T = BASE.field.clock.T;
const R_DP = BASE.plate.maxDiameter / 2;
const LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
const LONG = 600_000;
const deps = (id: DirectionId) => stormDeps(id, staticsFor(id, EXTENSIONS as never));

// ------------------------------------------------------------------------------------- scenes

interface Bead { readonly node: string; readonly x: number; readonly y: number }
interface NeverRedScene {
  readonly id: string;
  readonly faces: readonly Face[];
  readonly beads?: readonly Bead[];
  readonly scene?: string;
  readonly steppedThroughMs?: number;
}
const ROOTS = EXTENSIONS as unknown as Record<string, { $root: { neverRedScenes?: readonly NeverRedScene[] } }>;
const HERO = EXTENSIONS.base.$root.hero.scenes as unknown as Record<string, { placements?: readonly Bead[] }>;
const scenesOf = (id: DirectionId): readonly NeverRedScene[] => ROOTS[id].$root.neverRedScenes ?? [];

/** Drawn here: the field and its halos alone. */
const FIELD_SCENES = ['seam', 'ringHalo', 'backlight', 'restToIntense'];
/** Named by the designer, and drawn elsewhere: each with the work that draws it. */
const DEFERRED: Record<string, string> = { ctaKeyline: 'B6: the CTA keyline over the field needs the CTA' };

const REST_TO = HERO['one.intense'].placements ?? [];
/** The replace dissolve: the seam's pair, intense out as joy comes in. */
const SEAM: readonly Bead[] = [{ node: 'I', x: -0.15, y: 0.8 }, { node: 'J', x: 0.15, y: 0.8 }];
const STEP_MS = 50;

/** The shimmer peaks one way at a quarter of its period and the other way at three quarters. */
const SHIMMER_PEAK_MS = T / (4 * BASE.field.clock.shimmer.harmonic);
interface Combo { readonly stress: number; readonly confidence: number | null; readonly genesis: boolean }
/** s × c × genesis. Genesis off is drawn at the shimmer's positive peak, on at its negative one. */
const GRID: readonly Combo[] = [0, 0.5, 1].flatMap((stress) => [null, 1].flatMap((confidence) => [false, true].map((genesis) => ({ stress, confidence, genesis }))));
/** The extremes: no tension and the most presence, full tension and the least. */
const EXTREMES: readonly Combo[] = [0, 1].flatMap((stress) => [{ stress, confidence: 1, genesis: true }, { stress, confidence: null, genesis: false }]);
const HEAVIEST: Combo = { stress: 0, confidence: 1, genesis: true };
const comboLabel = (c: Combo) => `s ${c.stress}, c ${c.confidence ?? 'none'}, genesis ${c.genesis ? 'on' : 'off'}`;

interface Shown { readonly placements: readonly Placement[]; readonly restFade: number; readonly restSlots?: readonly number[] }
interface SceneFrame { readonly label: string; readonly state: FieldState }

function stateFor(id: DirectionId, face: Face, combo: Combo, shown: Shown, tOffset = 0): FieldState {
  const tMs = (combo.genesis ? 3 * SHIMMER_PEAK_MS : SHIMMER_PEAK_MS) + tOffset;
  return {
    direction: id, face, placements: shown.placements, restFade: shown.restFade, restSlots: shown.restSlots,
    stress: combo.stress, confidence: combo.confidence, genesis: combo.genesis, tMs, breathPhase: fixedFieldBreath(id, combo.stress, tMs).phase, tier: 'full',
  };
}

/** Beads at fade 1, the rest lobes out (the builder lights them where no bead carries a lobe). */
const still = (beads: readonly Bead[]): Shown => ({ placements: beads.map((b, i) => ({ x: b.x, y: b.y, fade: 1, ordinal: i })), restFade: 0 });

/** A ledger driven from `from` to `to` (one store change at 1 ms), sampled every STEP_MS through the settle ramp. */
function throughLedger(id: DirectionId, from: readonly Tap[], to: readonly Tap[]): Array<{ ms: number; shown: Shown }> {
  let ledger = emptyLedger(deps(id).config);
  const out: Array<{ ms: number; shown: Shown }> = [];
  const end = 1 + BASE.motion.settle.duration;
  for (let t = 0; t <= end; t++) {
    ledger = reconcile(ledger, t === 0 ? { seq: 0, taps: from } : { seq: 1, taps: to }, t, 'settle');
    if (t >= 1 && (t - 1) % STEP_MS === 0) {
      const f = fades(ledger);
      out.push({ ms: t - 1, shown: { placements: f.placements.map((p) => ({ x: p.x, y: p.y, fade: p.fade, ordinal: p.ordinal, slot: p.slot, role: p.role })), restFade: f.restFade, restSlots: f.restSlots } });
    }
  }
  return out;
}

interface Drawn { readonly id: DirectionId; readonly scene: string; readonly face: Face; readonly beads: readonly Bead[]; readonly frames: () => SceneFrame[]; readonly heaviest: () => SceneFrame }

function drawnOf(id: DirectionId, scene: NeverRedScene, face: Face): Drawn {
  if (scene.steppedThroughMs !== undefined) {
    const steps = () => throughLedger(id, [], REST_TO.map((b) => ({ x: b.x, y: b.y })));
    return {
      id, scene: scene.id, face, beads: REST_TO,
      frames: () => steps().flatMap(({ ms, shown }) => EXTREMES.map((combo) => ({ label: `${ms} ms, ${comboLabel(combo)}`, state: stateFor(id, face, combo, shown, ms) }))),
      heaviest: () => { const mid = steps()[Math.floor(steps().length / 2)]; return { label: `${mid.ms} ms`, state: stateFor(id, face, HEAVIEST, mid.shown, mid.ms) }; },
    };
  }
  const beads = scene.beads ?? [];
  return {
    id, scene: scene.id, face, beads,
    frames: () => GRID.map((combo) => ({ label: comboLabel(combo), state: stateFor(id, face, combo, still(beads)) })),
    heaviest: () => ({ label: comboLabel(HEAVIEST), state: stateFor(id, face, HEAVIEST, still(beads)) }),
  };
}

function replaceOf(id: DirectionId, face: Face): Drawn {
  const steps = () => throughLedger(id, [{ x: SEAM[0].x, y: SEAM[0].y }], [{ x: SEAM[1].x, y: SEAM[1].y }]);
  return {
    id, scene: 'replaceDissolve', face, beads: SEAM,
    frames: () => steps().flatMap(({ ms, shown }) => EXTREMES.map((combo) => ({ label: `${ms} ms, ${comboLabel(combo)}`, state: stateFor(id, face, combo, shown, ms) }))),
    heaviest: () => { const mid = steps()[Math.floor(steps().length / 2)]; return { label: `${mid.ms} ms`, state: stateFor(id, face, HEAVIEST, mid.shown, mid.ms) }; },
  };
}

const DRAWN: readonly Drawn[] = [
  ...IDS.flatMap((id) => scenesOf(id).filter((s) => FIELD_SCENES.includes(s.id)).flatMap((s) => s.faces.map((face) => drawnOf(id, s, face)))),
  ...IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => replaceOf(id, face))),
];
const CASES = DRAWN.map((d) => [d.id, d.scene, d.face, d] as const);

// ------------------------------------------------------------------------------------- views

/** A window on the field: its centre and half-size in plate units (R = 1, y up), at rPx px per R. */
interface View { readonly name: string; readonly centre: readonly [number, number]; readonly half: readonly [number, number]; readonly rPx: number }
/** The whole field: lobes reach about 2.3R from the plate centre. */
const WHOLE: View = { name: 'whole field', centre: [0, 0], half: [2.5, 2.5], rPx: 10 };
function beadsView(beads: readonly Bead[]): View {
  const xs = beads.map((b) => b.x);
  const ys = beads.map((b) => b.y);
  const pad = 0.35;
  const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  return { name: 'beads', centre: [(x0 + x1) / 2, (y0 + y1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2], rPx: 40 };
}
const viewsOf = (d: Drawn): View[] => (d.beads.length > 0 ? [WHOLE, beadsView(d.beads)] : [WHOLE]);
const sizeOf = (view: View) => [Math.round(2 * view.half[0] * view.rPx), Math.round(2 * view.half[1] * view.rPx)] as const;

function frameIn(view: View, state: FieldState): FieldFrame {
  const [w, h] = sizeOf(view);
  return buildFieldFrame(
    state,
    { centrePx: [w / 2 - view.centre[0] * view.rPx, h / 2 + view.centre[1] * view.rPx], radiusPx: view.rPx, pxPerDp: view.rPx / R_DP, fontScale: 1 },
    deps(state.direction).statics,
  );
}

// ------------------------------------------------------------------------------------- Skia

let effect: SkRuntimeEffect;
let planted: SkRuntimeEffect;
let blueNoise: SkShader;
/** The planted shader: every edge straight, J–I included. */
const NO_WAYPOINT = FIELD_SKSL.replace(/bool isWaypoint\(float a, float b\) \{[^}]*\}/, 'bool isWaypoint(float a, float b) { return false; }');

beforeAll(() => {
  const made = Skia.RuntimeEffect.Make(FIELD_SKSL);
  const plantedMade = Skia.RuntimeEffect.Make(NO_WAYPOINT);
  if (!made || !plantedMade) throw new Error('a field shader did not compile');
  effect = made;
  planted = plantedMade;
  const image = Skia.Image.MakeImage(
    { width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(blueNoiseRgba()),
    BLUE_NOISE_SIZE * 4,
  );
  if (!image) throw new Error('the blue-noise image was not made');
  blueNoise = image.makeShaderOptions(TileMode.Repeat, TileMode.Repeat, FilterMode.Nearest, MipmapMode.None);
});

function render(frame: FieldFrame, w: number, h: number, source: SkRuntimeEffect): Uint8Array {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('no surface');
  const paint = Skia.Paint();
  paint.setDither(false);
  paint.setShader(source.makeShaderWithChildren(packFrame(frame), [blueNoise]));
  surface.getCanvas().drawPaint(paint);
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!pixels) throw new Error('no pixels');
  return pixels as Uint8Array;
}

// ------------------------------------------------------------------------------------- the check

/** Per 8-bit colour, its OKLCh chroma if its hue is in the check band, else −1. */
const IN_BAND = new Map<number, number>();
interface Worst { readonly chroma: number; readonly rgb: readonly number[]; readonly at: readonly [number, number]; readonly view: string }

function worstInBand(pixels: Uint8Array, w: number, h: number, view: string): Worst {
  let worst: Worst = { chroma: 0, rgb: [], at: [-1, -1], view };
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = [pixels[4 * i], pixels[4 * i + 1], pixels[4 * i + 2]];
    const key = r * 65536 + g * 256 + b;
    let chroma = IN_BAND.get(key);
    if (chroma === undefined) {
      const lch = oklabToOklch(srgbToOklab([r / 255, g / 255, b / 255]));
      chroma = hueInBand(lch.h, CHECK_BAND) ? lch.C : -1;
      IN_BAND.set(key, chroma);
    }
    if (chroma > worst.chroma) worst = { chroma, rgb: [r, g, b], at: [i % w, Math.floor(i / w)], view };
  }
  return worst;
}

function worstOfFrame(d: Drawn, state: FieldState, source: SkRuntimeEffect): Worst {
  let worst: Worst = { chroma: 0, rgb: [], at: [-1, -1], view: '' };
  for (const view of viewsOf(d)) {
    const [w, h] = sizeOf(view);
    const found = worstInBand(render(frameIn(view, state), w, h, source), w, h, view.name);
    if (found.chroma > worst.chroma) worst = found;
  }
  return worst;
}
const describeWorst = (w: Worst) => `C ${w.chroma.toFixed(5)} at (${w.rgb.join(', ')}), ${w.view} view pixel (${w.at.join(', ')})`;

/** Each scene's largest in-band chroma, for the evidence run (FIELD_SCENES_REPORT=1). */
const MARGINS: string[] = [];
afterAll(() => {
  if (process.env.FIELD_SCENES_REPORT) console.log(`limit C <= ${LIMIT}\n${MARGINS.join('\n')}`);
});

// ------------------------------------------------------------------------------------- tests

describe('the never-red scenes the designer named, and the two the plan adds', () => {
  it('every token scene of every direction is drawn here or named as deferred, and each kind is drawn somewhere', () => {
    const ids = IDS.flatMap((id) => scenesOf(id).map((scene) => scene.id));
    expect(ids.filter((s) => !FIELD_SCENES.includes(s) && !(s in DEFERRED))).toEqual([]);
    expect([...new Set(DRAWN.map((d) => d.scene))].sort()).toEqual([...FIELD_SCENES, 'replaceDissolve'].sort());
    expect(REST_TO.map((b) => b.node)).toEqual(['I']);
  });

  it('restToIntense runs through the ledger along u and 1 − u²; the replace dissolve swaps the seam’s pair in one crossfade', () => {
    const rest = throughLedger('linen', [], REST_TO.map((b) => ({ x: b.x, y: b.y })));
    expect(rest.map((s) => s.ms)).toEqual(Array.from({ length: 13 }, (_, k) => k * STEP_MS));
    const mid = rest[6].shown;
    expect(mid.placements).toHaveLength(1);
    expect(mid.restFade).toBeCloseTo(1 - mid.placements[0].fade ** 2, 12);
    expect([rest[0].shown.placements[0].fade, rest[12].shown.placements[0].fade, rest[12].shown.restFade]).toEqual([0, 1, 0]);
    const swap = throughLedger('abyss', [{ x: SEAM[0].x, y: SEAM[0].y }], [{ x: SEAM[1].x, y: SEAM[1].y }]);
    const half = swap[6].shown.placements;
    expect(half.map((p) => p.role)).toEqual(['leaving', 'live']);
    expect(half[0].fade).toBeCloseTo(1 - half[1].fade ** 2, 12);
  });

  it('the planted shader differs from the real one only in the waypoint, and compiles', () => {
    expect(NO_WAYPOINT).not.toBe(FIELD_SKSL);
    expect(NO_WAYPOINT).toContain('bool isWaypoint(float a, float b) { return false; }');
    expect(planted).toBeDefined();
  });

  // The plate's shadows on the drawn pixels (designer 2.9): Linen light's outer shadow below the plate,
  // Basin's inner ones on the face; Abyss draws none.
  it.each([['abyss', 'dark', false], ['linen', 'light', true], ['linen', 'dark', false], ['basin', 'dark', true], ['basin', 'light', true]] as const)(
    '%s, %s face: shadowed grounds drawn: %s',
    (id, face, expected) => {
      const frame = frameIn(WHOLE, stateFor(id, face, HEAVIEST, still(SEAM)));
      const [w, h] = sizeOf(WHOLE);
      let shadowed = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const qx = (x + 0.5 - frame.centrePx[0]) / frame.radiusPx;
          const qy = -(y + 0.5 - frame.centrePx[1]) / frame.radiusPx;
          if (Math.abs(shadowFactor(frame, regionOf(Math.hypot(qx, qy), frame), qx, qy) - 1) > 0.01) shadowed++;
        }
      }
      expect(shadowed > 10).toBe(expected);
    },
  );
});

describe('QA-065 on the scenes, in real Skia: no pixel comes within the margin of the check band', () => {
  it.each(CASES)(
    '%s, %s, %s face',
    (id, scene, face, d) => {
      const over: string[] = [];
      let max: Worst = { chroma: 0, rgb: [], at: [-1, -1], view: '' };
      let label = '';
      const frames = d.frames();
      for (const frame of frames) {
        const worst = worstOfFrame(d, frame.state, effect);
        if (worst.chroma > LIMIT) over.push(`${frame.label}: ${describeWorst(worst)}`);
        if (worst.chroma > max.chroma) { max = worst; label = frame.label; }
      }
      MARGINS.push(`${id} ${scene} ${face}: ${frames.length} frames, max ${max.chroma > 0 ? `${describeWorst(max)} (${label})` : 'none in band'}, margin ${(LIMIT - max.chroma).toFixed(5)}`);
      expect(over).toEqual([]);
    },
    LONG,
  );
});

describe('the scenes agree with the TypeScript law, pixel for pixel (±1 LSB)', () => {
  it.each(CASES)(
    '%s, %s, %s face, the heaviest frame',
    (_id, _scene, _face, d) => {
      const { state } = d.heaviest();
      for (const view of viewsOf(d)) {
        const [w, h] = sizeOf(view);
        const frame = frameIn(view, state);
        const pixels = render(frame, w, h, effect);
        let worst = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const law = fieldPixel(frame, x + 0.5, y + 0.5);
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(pixels[4 * (y * w + x) + c] - law[c]));
          }
        }
        expect({ view: view.name, worst }).toEqual({ view: view.name, worst: Math.min(worst, 1) });
      }
    },
    LONG,
  );
});

describe('the planted shader (J–I straight) is caught on every dark face', () => {
  const seams = DRAWN.filter((d) => d.scene === 'seam' && d.face === 'dark');

  it('the seam is a scene of every direction', () => {
    expect(seams.map((d) => d.id).sort()).toEqual([...IDS].sort());
  });

  it.each(seams.map((d) => [d.id, d] as const))(
    '%s: the seam drawn straight puts pixels in the check band',
    (_id, d) => {
      const worst = worstOfFrame(d, d.heaviest().state, planted);
      expect(worst.chroma).toBeGreaterThanOrEqual(CHECK_BAND.chromaFloor);
    },
    LONG,
  );
});
