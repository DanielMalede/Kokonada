// The witness's probes and the check a row must pass (the designer's witness BLOCK, 2026-11-15, item ii). Lab only.
//
// Under RTL, React Native on Android swaps left and right, so a View placed with `left` can land mirrored while the Skia
// canvas draws at the layout's own coordinates. The scene sets `direction: 'ltr'` on its stage, and proves where its Views
// landed: W1a and W3, the patches React Native lays out, each have a probe, and READY reports every probe's window rect in
// px. So does the capture region the scene laid out in (`region`): the stage minus the insets, how READY carries them.
// witnessProbeProblems is what the harness must run on a witness row's READY: any problem refuses the row.

import { FIELD_FACES } from '../fieldScenes';
import type { ProbeRect, Rect } from '../probe/geometry';
import { witnessColours, type PatchKind } from './witnessFrames';
import type { WitnessLayout } from './witnessLayout';

/** The kinds React Native lays out: the only patches a layout direction can move. */
export const PROBED_KINDS = ['W1a', 'W3'] as const satisfies readonly PatchKind[];
/** How far a probe may land from its layout rect: the pixel grid's rounding. */
export const PROBE_TOLERANCE_PX = 1;

export const witnessProbeId = (kind: PatchKind, colour: string): string => `${kind}.${colour}`;

const colourNames = (): readonly string[] => {
  const [first, ...rest] = FIELD_FACES.map((face) => witnessColours(face).map((c) => c.name).join(','));
  // One scene list serves every face (sceneGroups/witness.ts), so every face must name the same colours.
  if (rest.some((names) => names !== first)) throw new Error('the witness faces name different colours: one probe list cannot serve them');
  return first.split(',');
};

/** Every witness probe: the stage, the capture region, then each probed kind of each colour. */
export const WITNESS_PROBES: readonly string[] = ['stage', 'region', ...PROBED_KINDS.flatMap((kind) => colourNames().map((c) => witnessProbeId(kind, c)))];

/**
 * Why a witness row's READY probes do not show the layout, or none: a probe missing, or a probed View (or the region) whose
 * window rect is more than PROBE_TOLERANCE_PX from where the layout put it, on any edge. Read relative to READY's stage,
 * as the layout is written, at the layout's px per dp.
 */
export function witnessProbeProblems(layout: WitnessLayout, probes: Readonly<Record<string, ProbeRect | undefined>>): string[] {
  const stage = probes.stage;
  if (stage === undefined) return ['probe stage is missing from READY: the layout has no origin to be read against'];
  const k = layout.pxPerDp;
  const expected: Array<[string, Rect]> = [['region', layout.region]];
  for (const p of layout.patches) if ((PROBED_KINDS as readonly PatchKind[]).includes(p.kind)) expected.push([witnessProbeId(p.kind, p.colour), p.rect]);
  const problems: string[] = [];
  for (const [id, rect] of expected) {
    const got = probes[id];
    if (got === undefined) {
      problems.push(`probe ${id} is missing from READY`);
      continue;
    }
    const want = { x: stage.px.x + rect.x * k, y: stage.px.y + rect.y * k, width: rect.width * k, height: rect.height * k };
    const edges: Array<[string, number]> = [
      ['left', got.px.x - want.x],
      ['top', got.px.y - want.y],
      ['right', got.px.x + got.px.width - (want.x + want.width)],
      ['bottom', got.px.y + got.px.height - (want.y + want.height)],
    ];
    const off = edges.filter(([, d]) => Math.abs(d) > PROBE_TOLERANCE_PX + 1e-9);
    if (off.length > 0) {
      problems.push(`probe ${id} landed ${off.map(([edge, d]) => `${edge} ${+Math.abs(d).toFixed(2)} px`).join(', ')} from its layout rect: more than ${PROBE_TOLERANCE_PX} px`);
    }
  }
  return problems;
}
