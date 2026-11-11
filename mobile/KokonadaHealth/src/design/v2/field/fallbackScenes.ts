// The hero's layout and the fallback's scenes (T13; the designer's rulings Q1–Q5 of 2026-11-11), for FieldFallback's
// tests and the T13 board. Test-only, like fieldScenes.ts: never imported by app code, not a worklet module, and it never
// imports the token extensions (the caller passes the hero scenes and the hardest placements in).
//
// heroLayout is the V1 boards' construction (d3 to d6, the layout the designer measured the T13 rulings on), in dp, left
// to right, until B6 measures the real hero: a 24 dp status bar and a 16 dp gesture bar; the top bar with the avatar's
// 36 dp disc at the leading edge; the AI line at the content width, three ui.legal lines; the block [voice line, plate,
// well] centred between the AI line's bottom and the nav's top, the voice line two voice.l lines; the CTA in the well,
// 288 dp wide at most; the nav at the foot. Its quiet rects are the shown boxes in QUIET_ZONE's slot order (avatar, AI
// line, nav, voice box, CTA). Above font scale 1 the text and the label band grow, and the plate grows with the band by
// 2 × (band − 28) dp, capped at the view less 32 dp (the hero spec).

import { BASE, DIRECTIONS, type DirectionId } from '../tokens/tokens.generated.ts';
import type { FieldLayout, LayoutRect } from './fieldDriver.ts';
import type { Tap } from './placementLedger.ts';

/** The board's phone: 1080 × 2400 px at density 2.625 (420 dpi), in dp. */
export const PHONE = { pxPerDp: 2.625, width: 1080 / 2.625, height: 2400 / 2.625 } as const;

const STATUS_BAR = 24;
const GESTURE_BAR = 16;
const AI_LINES = 3;
const CTA_MAX_WIDTH = 288;

/** The hero's layout in dp, at a font scale: the plate's centre and radius R, and its quiet rects by slot. */
export function heroLayout(id: DirectionId, width: number, height: number, fontScale = 1): FieldLayout {
  const d = DIRECTIONS[id];
  const gutter = d.layout.gutter;
  const content = width - 2 * gutter;
  const av = BASE.avatar.size;
  const avatar: LayoutRect = { x: gutter, y: STATUS_BAR + BASE.topBar.height / 2 - av / 2, width: av, height: av };
  const ai: LayoutRect = {
    x: gutter,
    y: STATUS_BAR + BASE.topBar.height + BASE.spacing['2'],
    width: content,
    height: AI_LINES * BASE.type.ui.legal.latin.lineHeight * fontScale,
  };
  const navY = height - GESTURE_BAR - d.nav.insetBottom - BASE.nav.height;
  const nav: LayoutRect = {
    x: d.nav.insetSide,
    y: navY,
    width: width - 2 * d.nav.insetSide,
    height: d.nav.insetBottom === 0 ? BASE.nav.height + GESTURE_BAR : BASE.nav.height,
  };
  const band = Math.max(BASE.plate.labelBand.min, BASE.plate.labelBand.min * fontScale);
  const atOne = Math.min(Math.max(width - 2 * d.plate.inset, BASE.plate.minDiameter), BASE.plate.maxDiameter, width - 2 * BASE.plate.viewportMargin);
  const diameter = Math.min(atOne + 2 * (band - BASE.plate.labelBand.min), width - 2 * BASE.plate.viewportMargin);
  const radius = diameter / 2;
  const gap = d.layout.gap;
  const voiceHeight = 2 * d.type.voice.l.latin.lineHeight * fontScale;
  const block = voiceHeight + gap.voiceToPlate + diameter + gap.plateToWell + BASE.well.height;
  const aiBottom = ai.y + ai.height;
  const top = aiBottom + Math.max(gap.aiToVoice, (navY - aiBottom - block) / 2);
  const voice: LayoutRect = { x: gutter, y: top, width: content, height: voiceHeight };
  const centreY = top + voiceHeight + gap.voiceToPlate + radius;
  const wellY = centreY + radius + gap.plateToWell;
  const ctaWidth = Math.min(CTA_MAX_WIDTH, content);
  const cta: LayoutRect = { x: (width - ctaWidth) / 2, y: wellY + (BASE.well.height - BASE.cta.height) / 2, width: ctaWidth, height: BASE.cta.height };
  return { width, height, centre: [width / 2, centreY], radius, fontScale, quietRects: [avatar, ai, nav, voice, cta] };
}

export interface FallbackScene {
  readonly id: string;
  readonly taps: readonly Tap[];
}

type Placements = ReadonlyArray<{ readonly x: number; readonly y: number }>;
type HeroScenes = Readonly<Record<string, { readonly placements?: Placements }>>;
type Hardest = ReadonlyArray<{ readonly id: string; readonly face?: string; readonly x?: number; readonly y?: number; readonly beads?: Placements }>;

/** The designer's bright-edge scene (Q3): calm at the right edge of the lens. */
export const ONE_C_RIGHT: Tap = { x: 0.95, y: -0.05 };

const tapsOf = (placements: Placements | undefined): Tap[] => (placements ?? []).map((p) => ({ x: p.x, y: p.y }));

/**
 * The scenes the rulings name, from the token extensions the caller holds: rest, one.J/C/R/I/neutral and three (the
 * hero's scenes), reach.top and reach.bottom (the hardest beads), and the board's two edge scenes: one.J at the top (the
 * dark face's hardest word.top placement) and one.C at the right edge (ONE_C_RIGHT).
 */
export function fallbackScenes(hero: HeroScenes, hardest: Hardest): FallbackScene[] {
  const reach = (id: string) => tapsOf(hardest.find((h) => h.id === id)?.beads);
  const top = hardest.find((h) => h.id === 'word.top' && h.face === 'dark');
  return [
    { id: 'rest', taps: tapsOf(hero.rest?.placements) },
    { id: 'one.J', taps: tapsOf(hero['one.joy']?.placements) },
    { id: 'one.C', taps: tapsOf(hero['one.calm']?.placements) },
    { id: 'one.R', taps: tapsOf(hero['one.reflective']?.placements) },
    { id: 'one.I', taps: tapsOf(hero['one.intense']?.placements) },
    { id: 'one.neutral', taps: tapsOf(hero['one.neutral']?.placements) },
    { id: 'three', taps: tapsOf(hero.three?.placements) },
    { id: 'reach.top', taps: reach('reach.top') },
    { id: 'reach.bottom', taps: reach('reach.bottom') },
    { id: 'one.J.top', taps: top?.x === undefined || top.y === undefined ? [] : [{ x: top.x, y: top.y }] },
    { id: 'one.C.right', taps: [ONE_C_RIGHT] },
  ];
}

export type Quadrant = 'J' | 'C' | 'R' | 'I';
const SIGNS: Readonly<Record<Quadrant, readonly [number, number]>> = { J: [1, 1], C: [1, -1], R: [-1, -1], I: [-1, 1] };

/**
 * J, C, R and I at p ∈ {0, 0.25, 0.5, 0.75, 1} on their diagonals (Q3's never-red sweep): r = neutralRadius + p ×
 * (rampEnd − neutralRadius), with p = 0 a hair outside the neutral disc, so it is the node's own colour at its ramp's
 * foot, not the neutral placement.
 */
export function rampPlacements(): Array<{ readonly node: Quadrant; readonly p: number; readonly tap: Tap }> {
  const { neutralRadius, rampEnd } = BASE.placement;
  const out: Array<{ node: Quadrant; p: number; tap: Tap }> = [];
  for (const node of ['J', 'C', 'R', 'I'] as const) {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const r = (neutralRadius + p * (rampEnd - neutralRadius)) * (p === 0 ? 1 + 1e-9 : 1);
      const [sx, sy] = SIGNS[node];
      out.push({ node, p, tap: { x: (sx * r) / Math.SQRT2, y: (sy * r) / Math.SQRT2 } });
    }
  }
  return out;
}
