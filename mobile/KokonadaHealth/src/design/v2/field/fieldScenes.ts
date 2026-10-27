// The never-red scenes (QA-065; resilience MEDIUM-2 item 1; architect re-rule T9): the pure scene
// builders shared by the default skia project's structural checks (fieldScenes.skia.test.ts) and the
// CanvasKit sweeps project's frames, agreement and planted catch (fieldScenes.sweeps.skia.test.ts).
// Test-only, like ledgerStorms.ts: never imported by app code, not a worklet module, and it never
// imports the token extensions; the caller passes them in (sceneCatalogue) with the statics.
//   · The bead scenes (seam, ringHalo, backlight) over tension × confidence × genesis.
//   · restToIntense through the placement ledger: the placement fading in along u and the rest lobes
//     out along 1 − u², at every 50 ms of the settle ramp (the reduced ramp draws the same pairs).
//   · A replace dissolve through the ledger, every direction: the seam's intense bead swapped for its
//     joy bead in one crossfade, I out along 1 − u² as J comes in along u.
//   · Every frame carries the builder's plate shadows.

import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import { buildFieldFrame, fixedFieldBreath, type FieldState, type FieldStatics, type Placement } from './fieldFrame.ts';
import type { FieldFrame } from './fieldLaw.ts';
import type { StormDeps } from './ledgerStorms.ts';
import { emptyLedger, fades, reconcile, type Tap } from './placementLedger.ts';

export const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const T = BASE.field.clock.T;
const R_DP = BASE.plate.maxDiameter / 2;

export interface Bead { readonly node: string; readonly x: number; readonly y: number }
export interface NeverRedScene {
  readonly id: string;
  readonly faces: readonly Face[];
  readonly beads?: readonly Bead[];
  readonly scene?: string;
  readonly steppedThroughMs?: number;
}

/** Drawn here: the field and its halos alone. */
export const FIELD_SCENES = ['seam', 'ringHalo', 'backlight', 'restToIntense'];
/** Named by the designer, and drawn elsewhere: each with the work that draws it. */
export const DEFERRED: Record<string, string> = { ctaKeyline: 'B6: the CTA keyline over the field needs the CTA' };
/** The replace dissolve: the seam's pair, intense out as joy comes in. */
export const SEAM: readonly Bead[] = [{ node: 'I', x: -0.15, y: 0.8 }, { node: 'J', x: 0.15, y: 0.8 }];
export const STEP_MS = 50;

/** The shimmer peaks one way at a quarter of its period and the other way at three quarters. */
const SHIMMER_PEAK_MS = T / (4 * BASE.field.clock.shimmer.harmonic);
export interface Combo { readonly stress: number; readonly confidence: number | null; readonly genesis: boolean }
/** s × c × genesis. Genesis off is drawn at the shimmer's positive peak, on at its negative one. */
export const GRID: readonly Combo[] = [0, 0.5, 1].flatMap((stress) => [null, 1].flatMap((confidence) => [false, true].map((genesis) => ({ stress, confidence, genesis }))));
/** The extremes: no tension and the most presence, full tension and the least. */
export const EXTREMES: readonly Combo[] = [0, 1].flatMap((stress) => [{ stress, confidence: 1, genesis: true }, { stress, confidence: null, genesis: false }]);
export const HEAVIEST: Combo = { stress: 0, confidence: 1, genesis: true };
export const comboLabel = (c: Combo) => `s ${c.stress}, c ${c.confidence ?? 'none'}, genesis ${c.genesis ? 'on' : 'off'}`;

export interface Shown { readonly placements: readonly Placement[]; readonly restFade: number; readonly restSlots?: readonly number[] }
export interface SceneFrame { readonly label: string; readonly state: FieldState }

export function stateFor(id: DirectionId, face: Face, combo: Combo, shown: Shown, tOffset = 0): FieldState {
  const tMs = (combo.genesis ? 3 * SHIMMER_PEAK_MS : SHIMMER_PEAK_MS) + tOffset;
  return {
    direction: id, face, placements: shown.placements, restFade: shown.restFade, restSlots: shown.restSlots,
    stress: combo.stress, confidence: combo.confidence, genesis: combo.genesis, tMs, breathPhase: fixedFieldBreath(id, combo.stress, tMs).phase, tier: 'full',
  };
}

/** Beads at fade 1, the rest lobes out (the builder lights them where no bead carries a lobe). */
export const still = (beads: readonly Bead[]): Shown => ({ placements: beads.map((b, i) => ({ x: b.x, y: b.y, fade: 1, ordinal: i })), restFade: 0 });

/** A ledger driven from `from` to `to` (one store change at 1 ms), sampled every STEP_MS through the settle ramp. */
export function throughLedger(deps: StormDeps, from: readonly Tap[], to: readonly Tap[]): Array<{ ms: number; shown: Shown }> {
  let ledger = emptyLedger(deps.config);
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

export interface Drawn { readonly id: DirectionId; readonly scene: string; readonly face: Face; readonly beads: readonly Bead[]; readonly frames: () => SceneFrame[]; readonly heaviest: () => SceneFrame }

const tapsOf = (beads: readonly Bead[]): Tap[] => beads.map((b) => ({ x: b.x, y: b.y }));
const steppedFrames = (id: DirectionId, face: Face, steps: () => Array<{ ms: number; shown: Shown }>) => ({
  frames: () => steps().flatMap(({ ms, shown }) => EXTREMES.map((combo) => ({ label: `${ms} ms, ${comboLabel(combo)}`, state: stateFor(id, face, combo, shown, ms) }))),
  heaviest: () => {
    const all = steps();
    const mid = all[Math.floor(all.length / 2)];
    return { label: `${mid.ms} ms`, state: stateFor(id, face, HEAVIEST, mid.shown, mid.ms) };
  },
});

/**
 * The catalogue: the token scenes of every direction (drawn here or named as deferred) and the replace
 * dissolve, from the extensions and the statics the caller holds.
 */
export function sceneCatalogue(extensions: unknown, depsOf: (id: DirectionId) => StormDeps) {
  const roots = extensions as Record<string, { $root: { neverRedScenes?: readonly NeverRedScene[]; hero?: { scenes: Record<string, { placements?: readonly Bead[] }> } } }>;
  const scenesOf = (id: DirectionId): readonly NeverRedScene[] => roots[id].$root.neverRedScenes ?? [];
  const restTo = roots.base.$root.hero?.scenes['one.intense']?.placements ?? [];
  const drawnOf = (id: DirectionId, scene: NeverRedScene, face: Face): Drawn => {
    if (scene.steppedThroughMs !== undefined) {
      return { id, scene: scene.id, face, beads: restTo, ...steppedFrames(id, face, () => throughLedger(depsOf(id), [], tapsOf(restTo))) };
    }
    const beads = scene.beads ?? [];
    return {
      id, scene: scene.id, face, beads,
      frames: () => GRID.map((combo) => ({ label: comboLabel(combo), state: stateFor(id, face, combo, still(beads)) })),
      heaviest: () => ({ label: comboLabel(HEAVIEST), state: stateFor(id, face, HEAVIEST, still(beads)) }),
    };
  };
  const replaceOf = (id: DirectionId, face: Face): Drawn => ({
    id, scene: 'replaceDissolve', face, beads: SEAM, ...steppedFrames(id, face, () => throughLedger(depsOf(id), tapsOf([SEAM[0]]), tapsOf([SEAM[1]]))),
  });
  const drawn: readonly Drawn[] = [
    ...IDS.flatMap((id) => scenesOf(id).filter((s) => FIELD_SCENES.includes(s.id)).flatMap((s) => s.faces.map((face) => drawnOf(id, s, face)))),
    ...IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => replaceOf(id, face))),
  ];
  return { scenesOf, restTo, drawn };
}

/** A window on the field: its centre and half-size in plate units (R = 1, y up), at rPx px per R. */
export interface View { readonly name: string; readonly centre: readonly [number, number]; readonly half: readonly [number, number]; readonly rPx: number }
/** The whole field: lobes reach about 2.3R from the plate centre. */
export const WHOLE: View = { name: 'whole field', centre: [0, 0], half: [2.5, 2.5], rPx: 10 };
export function beadsView(beads: readonly Bead[]): View {
  const xs = beads.map((b) => b.x);
  const ys = beads.map((b) => b.y);
  const pad = 0.35;
  const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  return { name: 'beads', centre: [(x0 + x1) / 2, (y0 + y1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2], rPx: 40 };
}
export const viewsOf = (d: Drawn): View[] => (d.beads.length > 0 ? [WHOLE, beadsView(d.beads)] : [WHOLE]);
export const sizeOf = (view: View) => [Math.round(2 * view.half[0] * view.rPx), Math.round(2 * view.half[1] * view.rPx)] as const;

export function frameIn(view: View, state: FieldState, statics: FieldStatics): FieldFrame {
  const [w, h] = sizeOf(view);
  return buildFieldFrame(
    state,
    { centrePx: [w / 2 - view.centre[0] * view.rPx, h / 2 + view.centre[1] * view.rPx], radiusPx: view.rPx, pxPerDp: view.rPx / R_DP, fontScale: 1 },
    statics,
  );
}

/** The planted shader: every edge straight, J–I included. */
export const noWaypoint = (sksl: string) => sksl.replace(/bool isWaypoint\(float a, float b\) \{[^}]*\}/, 'bool isWaypoint(float a, float b) { return false; }');
