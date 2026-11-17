// The reports' common library (B8-8c; the architect's B8 plan at 199b138, TASKS UI-071): what every report under
// scripts/lab/reports/ needs from a capture run (scripts/lab/capture.mjs).
//
//   · the manifest and its rows, read through a typed reader that refuses, naming the field (EvidenceInputError), a row
//     the harness's own validateRow (scripts/lab/lib/manifest.mjs, the schema's authority) refuses, and a row lacking what
//     a report needs: a missing or malformed field is never read as a default;
//   · each row's PNG (lib/png.mjs), checked against the row's sha256 and its region's size, and crops of it by probe;
//   · the law twin of a shot, rendered in CanvasKit through the v2 builder (the .ts sources, imported as
//     scripts/field/bandEvidence.mts imports them): the scene from the row's `expect` {direction, face, hero, tier}
//     (fork F4: scene facts never come from tap coordinates on a lab line), the frame time from the fixed clock READY
//     reported (`clock.t`), the px per dp READY's pixel ratio (`pixelRatio`, see readPxPerDp; UI-240), and the
//     stage rect, the font scale (`fontScale.app`), renderScale and sampling;
//   · the never-red test of an 8-bit pixel: the v2 definition (redBand.ts isRed over neverRedSweeps.ts CHECK_BAND), used
//     as it is, never restated.
//
// The twin repeats the few Skia calls of the app's drawing that live in .tsx files node cannot load: renderFieldImage's
// offscreen pass and FieldImage's bilinear upscale (fieldImage.tsx), and FieldFallback's picture played at the density
// (FieldFallback.tsx). scripts/lab/__tests__/reportsTwin.skia.test.ts holds the twin to those functions byte for byte,
// and reportsEvidence.test.ts holds its inputs to the props the lab's FieldScene and FallbackScene really pass.
//
// The rows' shape is the harness's (B8-5a/5b): a row carries no launch args; its px per dp is READY's `pixelRatio` (UI-240). The frame time is
// READY's `clock` {mode, t}; the density, `device.density` (wm density), only cross-checks it; the stage is READY's stage probe in screen px,
// the app window, which the harness holds to the whole screen (UI-216), so it reaches under the system bars that the PNG
// (the app region) leaves out: the reports compare the stage only where it lies in the app region. The field names this
// library reads are all here, in the readers below; scripts/lab/__tests__/reportsHarness.test.ts feeds them the
// manifest the harness itself writes.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { srgbToOklab } from '../../../../src/design/v2/color/oklab.ts';
import { isRed } from '../../../../src/design/v2/color/redBand.ts';
import { BLUE_NOISE_SIZE, blueNoiseRgba } from '../../../../src/design/v2/field/blueNoise.ts';
import { recordFieldFallback, type FallbackSkia } from '../../../../src/design/v2/field/fallbackDraw.ts';
import { fallbackPlan, type FallbackPlan } from '../../../../src/design/v2/field/fallbackModel.ts';
import { fallbackScenes, heroLayout } from '../../../../src/design/v2/field/fallbackScenes.ts';
import { fieldStep, renderGeometry, renderScaleFor, renderSize, stateFromLedger, type FieldLayout, type FrameParams } from '../../../../src/design/v2/field/fieldDriver.ts';
import { buildFieldFrame, fixedFieldBreath, type FieldStatics } from '../../../../src/design/v2/field/fieldFrame.ts';
import { QUIET_SLOTS, type FieldFrame } from '../../../../src/design/v2/field/fieldLaw.ts';
import { FIELD_SKSL } from '../../../../src/design/v2/field/fieldShader.ts';
import { emptyLedger, fades, type Tap } from '../../../../src/design/v2/field/placementLedger.ts';
import { ledgerConfigFor, staticsFor } from '../../../../src/design/v2/field/statics.ts';
import { FIELD_UNIFORM_FLOATS, packFrame } from '../../../../src/design/v2/field/uniforms.ts';
import { CHECK_BAND } from '../../../../src/design/v2/tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../../../src/design/v2/tokens/tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId, type Face } from '../../../../src/design/v2/tokens/tokens.generated.ts';
import { rowPixelRatio, validateManifest, validateRow } from '../../lib/manifest.mjs';
import { cropRegion, decodePng } from '../../lib/png.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(APP, 'package.json'));

/** A report's input it cannot use: a manifest field missing or malformed, a PNG that is not the row's, an output that exists. */
export class EvidenceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceInputError';
  }
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

// ---------------------------------------------------------------------------------------- the typed reader

type Row = Record<string, unknown>;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX64 = /^[0-9a-f]{64}$/;
const FACES: readonly Face[] = ['dark', 'light'];
const TIERS = ['full', 'low', 'still'] as const;
type Tier = (typeof TIERS)[number];

/** `<shot>.<repeat>`, the PNG's own name in capture.mjs. */
export function rowName(row: unknown): string {
  if (!isObject(row) || typeof row.shot !== 'string') return '(a row with no shot)';
  return `${row.shot}.${typeof row.repeat === 'number' ? row.repeat : '?'}`;
}

function refuse(row: unknown, report: string, field: string, why: string): never {
  throw new EvidenceInputError(`${report}: row ${rowName(row)}: the manifest field "${field}" ${why}`);
}

/** The value at a dotted path; a missing step is refused, naming the first missing one. */
function need(row: Row, report: string, dotted: string): unknown {
  let at: unknown = row;
  const keys = dotted.split('.');
  for (let i = 0; i < keys.length; i++) {
    const here = keys.slice(0, i + 1).join('.');
    if (!isObject(at) || at[keys[i]] === undefined || at[keys[i]] === null) {
      if (i > 0 && !isObject(at)) refuse(row, report, keys.slice(0, i).join('.'), 'is not an object');
      refuse(row, report, here, 'is missing');
    }
    at = (at as Record<string, unknown>)[keys[i]];
  }
  return at;
}

function needString(row: Row, report: string, dotted: string): string {
  const v = need(row, report, dotted);
  if (typeof v !== 'string' || v.length === 0) refuse(row, report, dotted, `must be a non-empty string, got ${JSON.stringify(v)}`);
  return v;
}

function needPositive(row: Row, report: string, dotted: string): number {
  const v = need(row, report, dotted);
  if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) refuse(row, report, dotted, `must be a finite number above 0, got ${JSON.stringify(v)}`);
  return v;
}

function needRect(row: Row, report: string, dotted: string, whole: boolean): Rect {
  need(row, report, dotted);
  const r: Record<string, number> = {};
  for (const k of ['x', 'y', 'width', 'height']) {
    const v = need(row, report, `${dotted}.${k}`);
    if (typeof v !== 'number' || !Number.isFinite(v) || (whole && !Number.isInteger(v))) refuse(row, report, `${dotted}.${k}`, `must be a finite ${whole ? 'whole ' : ''}number, got ${JSON.stringify(v)}`);
    r[k] = v;
  }
  if (!(r.width > 0 && r.height > 0)) refuse(row, report, dotted, `has no area: ${JSON.stringify(r)}`);
  return r as unknown as Rect;
}

export interface CaptureRow {
  readonly name: string;
  readonly scene: string;
  readonly file: string;
  readonly sha256: string;
  /** The app region in screen px: the PNG is this crop of the screen. */
  readonly region: Rect;
}

/** A harness validateRow sentence ("<path> <says>") as the reports name a field. */
const named = (error: string) => {
  const at = error.indexOf(' ');
  return at > 0 ? `the manifest field "${error.slice(0, at)}" ${error.slice(at + 1)}` : error;
};

/** What every report reads of a row: its PNG, the PNG's sha256, the region it is a crop of, and the scene. */
export function readCaptureRow(row: unknown, report: string): CaptureRow {
  if (!isObject(row)) throw new EvidenceInputError(`${report}: a manifest row is not an object`);
  // The harness's schema is the authority: a row it would not have written is no capture of it, whatever a report reads.
  const errors = validateRow(row) as string[];
  if (errors.length > 0) {
    throw new EvidenceInputError(`${report}: row ${rowName(row)}: not a row the harness writes (scripts/lab/lib/manifest.mjs validateRow): ${errors.map(named).join('; ')}`);
  }
  const file = needString(row, report, 'file');
  if (file !== path.basename(file) || file === '.' || file === '..') refuse(row, report, 'file', `must be a file name beside the manifest, got ${JSON.stringify(file)}`);
  const sha256 = needString(row, report, 'sha256');
  if (!HEX64.test(sha256)) refuse(row, report, 'sha256', 'must be 64 lowercase hex characters');
  const region = needRect(row, report, 'region', true);
  const scene = needString(row, report, 'scene');
  return { name: rowName(row), scene, file, sha256, region };
}

/**
 * How far from a whole pixel a stage edge may be and still be that pixel: READY's px are dp × the pixel ratio, unrounded
 * (src/design/lab/probe/geometry.ts), and the dp went through Android's float division, so a whole-pixel window comes
 * back some 1e-5 px off. A placement, never a colour tolerance.
 */
const WHOLE_PX = 1e-3;
const isWhole = (v: number) => Math.abs(v - Math.round(v)) <= WHOLE_PX;

/** The last segment of a policy scene's id (src/design/lab/fieldScenes.ts POLICY_SUFFIX, B8-6). */
const POLICY = 'policy';

/**
 * The stage: READY's stage rect in screen px, placed on the PNG (its top left from the PNG's, in whole pixels; negative
 * where the window reaches under a system bar above the app region). It must share pixels with the app region: the
 * reports compare the stage where it lies in the PNG, and only there.
 */
function readStage(row: Row, report: string, region: Rect): Rect {
  const s = needRect(row, report, 'stage', false);
  const x = s.x - region.x;
  const y = s.y - region.y;
  if (!isWhole(x) || !isWhole(y)) {
    refuse(row, report, 'stage', `does not sit on whole pixels of the PNG (at ${x}, ${y} from the region's top left), so the twin cannot be placed`);
  }
  const rx = Math.round(x);
  const ry = Math.round(y);
  const size = stagePx(s);
  if (rx >= region.width || ry >= region.height || rx + size.width <= 0 || ry + size.height <= 0) {
    refuse(row, report, 'stage', `${JSON.stringify(s)} has no pixel in the app region ${JSON.stringify(region)}`);
  }
  return { x: rx, y: ry, width: s.width, height: s.height };
}

// Android's float density for a dpi: lib/manifest.mjs owns it now (UI-240), the cross-check of READY's pixel ratio.
export { androidDensity } from '../../lib/manifest.mjs';

/**
 * The row's px per dp: READY's pixel ratio (`pixelRatio`, PixelRatio.get()), never one derived from the density; the
 * device's density is only its cross-check, Android's float density for the dpi within 1e-6 (lib/manifest.mjs
 * rowPixelRatio, UI-240). A row without it, or one its density contradicts, is refused, naming the field.
 */
export function readPxPerDp(row: Row, report: string): number {
  const k = rowPixelRatio(row) as { pixelRatio: number } | { field: string; why: string };
  if ('field' in k) refuse(row, report, k.field, k.why);
  return (k as { pixelRatio: number }).pixelRatio;
}

const HERO = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: Record<string, { placements?: ReadonlyArray<{ x: number; y: number }> }> } } } }).base.$root.hero.scenes;
type Hardest = Parameters<typeof fallbackScenes>[1];
const hardestOf = (direction: DirectionId): Hardest => (EXTENSIONS as unknown as Record<string, { $root: { hardest: Hardest } }>)[direction].$root.hardest;

function readDirectionFace(row: Row, report: string): { direction: DirectionId; face: Face } {
  need(row, report, 'expect');
  const direction = needString(row, report, 'expect.direction');
  if (!Object.prototype.hasOwnProperty.call(DIRECTIONS, direction)) refuse(row, report, 'expect.direction', `is not a direction: ${JSON.stringify(direction)}`);
  const face = needString(row, report, 'expect.face');
  if (!FACES.includes(face as Face)) refuse(row, report, 'expect.face', `must be dark or light, got ${JSON.stringify(face)}`);
  return { direction: direction as DirectionId, face: face as Face };
}

// FIELD_SAMPLING (fieldImage.tsx) as the harness writes it: Skia's mode names (capture.mjs SAMPLING, pinned by capturePlans.test.ts).
const FIELD_FILTER = 'linear';
const FIELD_MIPMAP = 'none';

export interface FieldShot extends CaptureRow {
  readonly direction: DirectionId;
  readonly face: Face;
  readonly hero: string;
  readonly tier: Tier;
  readonly renderScale: number;
  readonly pxPerDp: number;
  readonly fontScale: number;
  /** The fixed clock's time, ms: READY's `clock.t`. */
  readonly tMs: number;
  /** The stage on the PNG, in px. */
  readonly stage: Rect;
}

/** A `field.*` row, everything the field's twin is built from, or a refusal naming the field. */
export function readFieldShot(row: unknown, report: string): FieldShot {
  const cap = readCaptureRow(row, report);
  const r = row as Row;
  const { direction, face } = readDirectionFace(r, report);
  const hero = needString(r, report, 'expect.hero');
  if (!Object.prototype.hasOwnProperty.call(HERO, hero)) refuse(r, report, 'expect.hero', `is not a hero scene: ${JSON.stringify(hero)}`);
  const tier = needString(r, report, 'expect.tier');
  if (!TIERS.includes(tier as Tier)) refuse(r, report, 'expect.tier', `must be full, low or still, got ${JSON.stringify(tier)}`);
  // B8-6: a policy scene's id names no tier (the motion policy picks it on the device): its expect.tier is the tier the
  // shot's device state implies, READY must have observed that tier (motion.tier), and its twin is the sibling scene at it.
  const policy = cap.scene.endsWith(`.${POLICY}`);
  const id = `field.${direction}.${face}.${hero}.${policy ? POLICY : tier}`;
  if (cap.scene !== id) refuse(r, report, 'scene', `is ${JSON.stringify(cap.scene)}, but expect names ${id}`);
  if (policy) {
    const observed = isObject(r.motion) ? r.motion.tier : undefined;
    if (observed !== tier) refuse(r, report, 'motion.tier', `is ${JSON.stringify(observed ?? null)}, but the manifest field "expect.tier" is ${JSON.stringify(tier)}: the motion policy did not pick the tier the shot's device state implies`);
  }
  // The frame time READY says it drew: the twin of a still needs the fixed clock and its t.
  const mode = needString(r, report, 'clock.mode');
  if (mode !== 'fixed') refuse(r, report, 'clock.mode', `is ${JSON.stringify(mode)}: a still's twin needs the fixed clock`);
  const tMs = need(r, report, 'clock.t');
  if (typeof tMs !== 'number' || !Number.isFinite(tMs)) refuse(r, report, 'clock.t', `must be the fixed frame time in ms, got ${JSON.stringify(tMs)}`);
  const renderScale = need(r, report, 'renderScale');
  if (typeof renderScale !== 'number' || renderScale !== renderScaleFor(tier as Tier)) {
    refuse(r, report, 'renderScale', `is ${JSON.stringify(renderScale)}, not the ${tier} tier's ${renderScaleFor(tier as Tier)} (field.tiers)`);
  }
  need(r, report, 'sampling');
  const filter = need(r, report, 'sampling.filter');
  const mipmap = need(r, report, 'sampling.mipmap');
  if (filter !== FIELD_FILTER || mipmap !== FIELD_MIPMAP) {
    refuse(r, report, 'sampling', `is ${JSON.stringify({ filter, mipmap })}, not FieldImage's bilinear upscale with no mipmaps (FIELD_SAMPLING)`);
  }
  const status = needString(r, report, 'shaderStatus');
  if (status !== 'ready') refuse(r, report, 'shaderStatus', `is ${JSON.stringify(status)} (${JSON.stringify(r.shaderReason ?? null)}): a field.* shot must be drawn by the field shader`);
  const stage = readStage(r, report, cap.region);
  const pxPerDp = readPxPerDp(r, report);
  need(r, report, 'fontScale');
  const fontScale = needPositive(r, report, 'fontScale.app');
  return { ...cap, direction, face, hero, tier: tier as Tier, renderScale, pxPerDp, fontScale, tMs, stage };
}

export interface FallbackShot extends CaptureRow {
  readonly direction: DirectionId;
  readonly face: Face;
  /** T13's fallback scene (fallbackScenes.ts), the id's last part. */
  readonly fallbackScene: string;
  readonly pxPerDp: number;
  readonly fontScale: number;
  readonly stage: Rect;
}

const fallbackTaps = (direction: DirectionId, name: string): readonly Tap[] | undefined =>
  fallbackScenes(HERO, hardestOf(direction)).find((s) => s.id === name)?.taps;

/** A `fallback.*` row, everything the fallback's twin is built from, or a refusal naming the field. */
export function readFallbackShot(row: unknown, report: string): FallbackShot {
  const cap = readCaptureRow(row, report);
  const r = row as Row;
  const { direction, face } = readDirectionFace(r, report);
  const prefix = `fallback.${direction}.${face}.`;
  if (!cap.scene.startsWith(prefix)) refuse(r, report, 'scene', `is ${JSON.stringify(cap.scene)}, not a fallback scene of ${direction} ${face} (${prefix}*)`);
  const fallbackScene = cap.scene.slice(prefix.length);
  if (fallbackTaps(direction, fallbackScene) === undefined) refuse(r, report, 'scene', `names no fallback scene: ${JSON.stringify(fallbackScene)}`);
  const status = needString(r, report, 'shaderStatus');
  if (status !== 'fallback-scene') refuse(r, report, 'shaderStatus', `is ${JSON.stringify(status)}: a fallback.* shot must be drawn by the lab fallback scene`);
  const stage = readStage(r, report, cap.region);
  const pxPerDp = readPxPerDp(r, report);
  need(r, report, 'fontScale');
  const fontScale = needPositive(r, report, 'fontScale.app');
  return { ...cap, direction, face, fallbackScene, pxPerDp, fontScale, stage };
}

// ---------------------------------------------------------------------------------------- the manifest and its PNGs

export interface Manifest {
  readonly file: string;
  readonly dir: string;
  readonly sha256: string;
  readonly plan: unknown;
  readonly outcome: unknown;
  readonly failure: unknown;
  readonly commit: unknown;
  readonly rows: readonly unknown[];
}

export function loadManifest(file: string): Manifest {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    throw new EvidenceInputError(`cannot read the manifest ${file}: ${(e as Error).message}`);
  }
  let m: unknown;
  try {
    m = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    throw new EvidenceInputError(`the manifest ${file} is not JSON: ${(e as Error).message}`);
  }
  if (!isObject(m)) throw new EvidenceInputError(`the manifest ${file} is not an object`);
  // UI-240: the harness's validateManifest holds the top level, as validateRow holds each row (readCaptureRow).
  const top = validateManifest(m) as string[];
  if (top.length > 0) {
    throw new EvidenceInputError(`the manifest ${file} is not one the harness writes (scripts/lab/lib/manifest.mjs validateManifest): ${top.map(named).join('; ')}`);
  }
  return {
    file: path.resolve(file), dir: path.dirname(path.resolve(file)), sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    plan: m.plan ?? null, outcome: m.outcome ?? null, failure: m.failure ?? null, commit: m.commit ?? null, rows: m.rows,
  };
}

/** The row's PNG, beside the manifest: its bytes must be the row's sha256 and its size the region's. */
export async function loadCapture(manifest: Manifest, cap: CaptureRow): Promise<Rgba> {
  const file = path.join(manifest.dir, cap.file);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    throw new EvidenceInputError(`row ${cap.name}: cannot read the manifest field "file"'s PNG ${file}: ${(e as Error).message}`);
  }
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== cap.sha256) throw new EvidenceInputError(`row ${cap.name}: ${cap.file} hashes to ${sha}, not the manifest field "sha256" ${cap.sha256}`);
  const img = (await decodePng(bytes)) as Rgba;
  if (img.width !== cap.region.width || img.height !== cap.region.height) {
    throw new EvidenceInputError(`row ${cap.name}: ${cap.file} is ${img.width}x${img.height}, not the manifest field "region"'s ${cap.region.width}x${cap.region.height}`);
  }
  return img;
}

/** A whole-pixel rect of an image. */
export function cropRgba(img: Rgba, rect: Rect): Rgba {
  return { width: rect.width, height: rect.height, rgba: cropRegion(img, rect) as Uint8Array };
}

/** Each pixel repeated factor × factor times (nearest): the ×8 crops. */
export function magnify(img: Rgba, factor: number): Rgba {
  const width = img.width * factor;
  const height = img.height * factor;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / factor) * img.width + Math.floor(x / factor)) * 4;
      rgba.set(img.rgba.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** Writes a new file; an existing one is refused and left as it was (a report never overwrites). */
export function writeNewFile(file: string, data: string | Uint8Array): void {
  try {
    fs.writeFileSync(file, data, { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new EvidenceInputError(`refusing to overwrite ${file}: a report never replaces an earlier one`);
    throw e;
  }
}

/** Makes a new directory; an existing one is refused. */
export function makeNewDir(dir: string): void {
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new EvidenceInputError(`refusing to reuse ${dir}: a report never replaces an earlier one`);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------- never-red

/** Is an 8-bit sRGB pixel red by the v2 check band (redBand.ts isRed over CHECK_BAND, DEC-081)? */
export function isCheckBandRed(r: number, g: number, b: number): boolean {
  return isRed(srgbToOklab([r / 255, g / 255, b / 255]), CHECK_BAND);
}

// ---------------------------------------------------------------------------------------- the twin's inputs

/** FieldScene's own inputs (scenes/FieldScene.tsx): the dev preview's stress, confidence and genesis. */
const LAB_FIELD = { stress: 0, confidence: 1, genesis: false } as const;

function sceneLayout(shot: { direction: DirectionId; stage: Rect; pxPerDp: number; fontScale: number; name: string }): FieldLayout {
  const layout = heroLayout(shot.direction, shot.stage.width / shot.pxPerDp, shot.stage.height / shot.pxPerDp, shot.fontScale);
  const count = layout.quietRects?.length ?? 0;
  if (count > QUIET_SLOTS) throw new Error(`row ${shot.name}: ${count} quiet rects, at most ${QUIET_SLOTS}; the lab never clamps`);
  return layout;
}

export interface FieldTwinInputs {
  readonly direction: DirectionId;
  readonly face: Face;
  readonly taps: readonly Tap[];
  readonly layout: FieldLayout;
  readonly pxPerDp: number;
  readonly tier: Tier;
  readonly renderScale: number;
  readonly stress: number;
  readonly confidence: number | null;
  readonly genesis: boolean;
  readonly tMs: number;
}

/** FieldView's props for the shot's scene, as the lab's FieldScene makes them from its measured view. */
export function fieldTwinInputs(shot: FieldShot): FieldTwinInputs {
  const taps = (HERO[shot.hero]?.placements ?? []).map((p) => ({ x: p.x, y: p.y }));
  return {
    direction: shot.direction, face: shot.face, taps, layout: sceneLayout(shot), pxPerDp: shot.pxPerDp, tier: shot.tier,
    renderScale: shot.renderScale, ...LAB_FIELD, tMs: shot.tMs,
  };
}

export interface FallbackTwinInputs {
  readonly direction: DirectionId;
  readonly face: Face;
  readonly taps: readonly Tap[];
  readonly layout: FieldLayout;
  readonly pxPerDp: number;
  /** FallbackScene passes none: every zone present. */
  readonly quietPresence: null;
}

/** FieldFallback's props for the shot's scene, as the lab's FallbackScene makes them. */
export function fallbackTwinInputs(shot: FallbackShot): FallbackTwinInputs {
  const taps = fallbackTaps(shot.direction, shot.fallbackScene);
  if (taps === undefined) throw new EvidenceInputError(`row ${shot.name}: no fallback scene ${shot.fallbackScene}`);
  return { direction: shot.direction, face: shot.face, taps: taps.map((t) => ({ x: t.x, y: t.y })), layout: sceneLayout(shot), pxPerDp: shot.pxPerDp, quietPresence: null };
}

// ---------------------------------------------------------------------------------------- CanvasKit

interface Skia {
  readonly Skia: FallbackSkia['Skia'];
  readonly enums: {
    ClipOp: FallbackSkia['ClipOp'];
    TileMode: FallbackSkia['TileMode'] & { Repeat: number };
    FilterMode: { Nearest: number; Linear: number };
    MipmapMode: { None: number };
    ColorType: { RGBA_8888: number };
    AlphaType: { Unpremul: number };
  };
}
let skia: Promise<Skia> | null = null;

/** RN Skia's own web API over the locked canvaskit-wasm: the Skia the tests draw with, here in plain node. */
function loadSkia(): Promise<Skia> {
  skia = skia ?? (async () => {
    const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit.js');
    const ck = await CanvasKitInit({});
    const { JsiSkApi } = require('@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia.js');
    const enums = require('@shopify/react-native-skia/lib/commonjs/skia/types/index.js');
    return { Skia: JsiSkApi(ck), enums };
  })();
  return skia;
}

const fieldStatics = new Map<DirectionId, FieldStatics>();
const staticsOf = (direction: DirectionId): FieldStatics => {
  if (!fieldStatics.has(direction)) fieldStatics.set(direction, staticsFor(direction, EXTENSIONS as never));
  return fieldStatics.get(direction)!;
};

type Effect = { effect: ReturnType<FallbackSkia['Skia']['RuntimeEffect']['Make']>; noise: unknown };
let effectMade: Effect | null = null;

/** The field effect and its blue-noise child, as effect.ts makes them (repeat, nearest, no mipmaps). */
function fieldEffect(s: Skia): Effect {
  if (effectMade !== null) return effectMade;
  const effect = s.Skia.RuntimeEffect.Make(FIELD_SKSL);
  if (!effect) throw new Error('the field shader did not compile in CanvasKit');
  if (effect.getUniformFloatCount() !== FIELD_UNIFORM_FLOATS) throw new Error(`the field shader declares ${effect.getUniformFloatCount()} uniform floats, the builder packs ${FIELD_UNIFORM_FLOATS}`);
  const image = s.Skia.Image.MakeImage(
    { width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE, colorType: s.enums.ColorType.RGBA_8888, alphaType: s.enums.AlphaType.Unpremul } as never,
    s.Skia.Data.fromBytes(blueNoiseRgba()),
    BLUE_NOISE_SIZE * 4,
  );
  if (!image) throw new Error('the blue-noise image was not made');
  const noise = image.makeShaderOptions(s.enums.TileMode.Repeat as never, s.enums.TileMode.Repeat as never, s.enums.FilterMode.Nearest as never, s.enums.MipmapMode.None as never);
  effectMade = { effect, noise };
  return effectMade;
}

function readSurface(s: Skia, surface: { flush(): void; makeImageSnapshot(): { readPixels(x: number, y: number, info: unknown): unknown } }, width: number, height: number): Uint8Array {
  surface.flush();
  const px = surface.makeImageSnapshot().readPixels(0, 0, { width, height, colorType: s.enums.ColorType.RGBA_8888, alphaType: s.enums.AlphaType.Unpremul });
  if (!px) throw new Error('CanvasKit could not read the twin back');
  return new Uint8Array(px as Uint8Array);
}

/** The stage's whole px: what the twin covers and the reports compare. */
const stagePx = (stage: Rect) => ({
  width: isWhole(stage.width) ? Math.round(stage.width) : Math.floor(stage.width),
  height: isWhole(stage.height) ? Math.round(stage.height) : Math.floor(stage.height),
});

export interface FieldTwin extends Rgba {
  readonly inputs: FieldTwinInputs;
  /** The frame the law drew, in render px. */
  readonly frame: FieldFrame;
  readonly renderScale: number;
}

/**
 * The field's twin over the stage: fieldStep on the scene's inputs (one build, one pack, the first input shown at once),
 * renderFieldImage's offscreen pass at render resolution, then FieldImage's bilinear upscale (no mipmaps) under the
 * density's scale, as RN Skia's canvas draws it. A frame that moves between two steps of the ledger is not a still and
 * is refused, as is a pack that is not the builder's frame.
 */
export async function renderFieldTwin(shot: FieldShot): Promise<FieldTwin> {
  const s = await loadSkia();
  const inputs = fieldTwinInputs(shot);
  const { direction, face, taps, layout, pxPerDp: k, renderScale: rs, tMs } = inputs;
  const statics = staticsOf(direction);
  const geometry = renderGeometry(layout, k, rs);
  const size = renderSize(layout, k, rs);
  const params: FrameParams = { direction, face, stress: inputs.stress, confidence: inputs.confidence, genesis: inputs.genesis, tier: inputs.tier };
  const phase = fixedFieldBreath(direction, inputs.stress, tMs).phase;
  const input = { seq: 0, taps };
  const first = fieldStep(emptyLedger(ledgerConfigFor(direction, face, statics, geometry)), input, 0, params, geometry, statics, tMs, phase);
  if (first.uniforms === null) throw new Error(`row ${shot.name}: the builder threw: ${first.error}`);
  const later = fieldStep(first.ledger, input, 10000, params, geometry, statics, tMs, phase);
  if (later.uniforms === null || later.uniforms.some((v, i) => v !== first.uniforms![i])) throw new Error(`row ${shot.name}: the frame moves between steps, so it is not a still`);
  const frame = buildFieldFrame({ ...stateFromLedger(fades(first.ledger), params, tMs, phase), quietPresence: undefined }, geometry, statics);
  if (packFrame(frame).some((v, i) => v !== first.uniforms![i])) throw new Error(`row ${shot.name}: the twin's frame is not the one fieldStep packed`);

  const { effect, noise } = fieldEffect(s);
  const target = s.Skia.Surface.Make(size.width, size.height);
  if (!target) throw new Error(`row ${shot.name}: no ${size.width}x${size.height} render target`);
  const paint = s.Skia.Paint();
  paint.setDither(false);
  paint.setShader(effect!.makeShaderWithChildren([...first.uniforms], [noise as never]));
  target.getCanvas().drawPaint(paint);
  target.flush();
  const image = target.makeImageSnapshot();

  const out = stagePx(shot.stage);
  const surface = s.Skia.Surface.Make(out.width, out.height);
  if (!surface) throw new Error(`row ${shot.name}: no ${out.width}x${out.height} stage surface`);
  const canvas = surface.getCanvas();
  canvas.scale(k, k);
  // imageRect (fieldImage.tsx): the image at its own scale from the top left, in dp; FieldImage draws it with fit "fill".
  const kr = k * rs;
  canvas.drawImageRectOptions(
    image,
    s.Skia.XYWHRect(0, 0, size.width, size.height),
    s.Skia.XYWHRect(0, 0, size.width / kr, size.height / kr),
    s.enums.FilterMode.Linear as never,
    s.enums.MipmapMode.None as never,
    s.Skia.Paint(),
  );
  return { ...out, rgba: readSurface(s, surface, out.width, out.height), inputs, frame, renderScale: rs };
}

export interface FallbackTwin extends Rgba {
  readonly inputs: FallbackTwinInputs;
  /** What FieldFallback drew, in device px from the stage's top left. */
  readonly plan: FallbackPlan;
}

/** FieldFallback's twin over the stage: its picture (fallbackPlan, recordFieldFallback) played under the density's scale. */
export async function renderFallbackTwin(shot: FallbackShot): Promise<FallbackTwin> {
  const s = await loadSkia();
  const inputs = fallbackTwinInputs(shot);
  const plan = fallbackPlan({ direction: inputs.direction, face: inputs.face, statics: staticsOf(inputs.direction), taps: inputs.taps, layout: inputs.layout, pxPerDp: inputs.pxPerDp });
  const picture = recordFieldFallback({ Skia: s.Skia, ClipOp: s.enums.ClipOp, TileMode: s.enums.TileMode }, plan, inputs.layout.width, inputs.layout.height);
  const out = stagePx(shot.stage);
  const surface = s.Skia.Surface.Make(out.width, out.height);
  if (!surface) throw new Error(`row ${shot.name}: no ${out.width}x${out.height} stage surface`);
  surface.getCanvas().scale(inputs.pxPerDp, inputs.pxPerDp);
  surface.getCanvas().drawPicture(picture);
  const rgba = readSurface(s, surface, out.width, out.height);
  picture.dispose();
  return { ...out, rgba, inputs, plan };
}
