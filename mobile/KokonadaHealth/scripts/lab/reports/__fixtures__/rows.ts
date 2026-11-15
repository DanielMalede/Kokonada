// Planted manifest rows for the report tests (B8-8c, B8-8a, B8-8b), in the harness's own row schema
// (scripts/lab/lib/manifest.mjs, the authority) and built, where the harness has a builder, with the harness's own
// functions: the app region from the screen and its system bars (lib/png.mjs appRegion), the probes kept or excluded
// (lib/protocol.mjs classifyProbes), the render facts an expect tier implies (capture.mjs renderFacts, from the token file)
// and the Skia version (lib/manifest.mjs readSkiaVersion, from the lockfile). The rest is the literal shape
// capture.mjs captureShot assembles. Every row is checked by the harness's validateRow before it is returned: this
// builder cannot make a row the harness would refuse to write. Synthetic values only: no device, no person. Imported by
// the jest tests and by makeFixtures.mts.
//
// The harness has no exported row builder (capture.mjs assembles the row inline), so the end-to-end test
// (reportsHarness.test.ts) is the other half of the proof: the rows the harness itself writes on its fake phone, fed
// unmodified to every report.

import fs from 'node:fs';
import path from 'node:path';

import { renderFacts } from '../../capture.mjs';
import { readSkiaVersion, validateRow } from '../../lib/manifest.mjs';
import { appRegion } from '../../lib/png.mjs';
import { classifyProbes } from '../../lib/protocol.mjs';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RowInput {
  readonly shot: string;
  readonly repeat?: number;
  readonly scene: string;
  readonly expect: { readonly direction: string | null; readonly face: string | null; readonly hero: string | null; readonly tier: string | null };
  readonly file: string;
  readonly sha256: string;
  /** The screen in px (`wm size`). */
  readonly screen: { readonly width: number; readonly height: number };
  /** The visible system bars in screen px (dumpsys window); the app region is what they leave. None by default. */
  readonly bars?: readonly Rect[];
  /** READY's stage probe in screen px: the app window, so the whole screen by default (UI-216). */
  readonly stage?: Rect;
  /** `wm density`, dpi: the device's px per dp is Android's density from it. */
  readonly density: number;
  readonly fontScale?: number;
  /** The clock READY reports: fixed at t 11000 by default; realtime has no t. */
  readonly clock?: { readonly mode: 'fixed' | 'stepped' | 'realtime'; readonly t: number | null };
  readonly shaderStatus: string | null;
  readonly shaderReason?: string | null;
}

const ZERO64 = '0'.repeat(64);

/** The nearest folder at or above `from` that holds `rel`. */
function findUp(from: string, rel: string): string {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, rel))) return path.join(dir, rel);
    if (path.dirname(dir) === dir) throw new Error(`no ${rel} above ${from}`);
  }
}
let facts: { tiers: unknown; skia: string } | null = null;
/** field.tiers from the token file and Skia's version from the lockfile, as the harness reads them. */
function harnessFacts(): { tiers: unknown; skia: string } {
  if (facts !== null) return facts;
  const tiers = (JSON.parse(fs.readFileSync(findUp(process.cwd(), 'design-tokens/base.tokens.json'), 'utf8')) as { field: { tiers: unknown } }).field.tiers;
  const { version, reason } = readSkiaVersion(fs.readFileSync(findUp(process.cwd(), 'package-lock.json'), 'utf8')) as { version: string | null; reason: string | null };
  if (version === null) throw new Error(`the fixture cannot read the Skia version: ${reason}`);
  facts = { tiers, skia: version };
  return facts;
}

/** A complete row, as capture.mjs writes it, checked by the harness's validateRow. */
export function row(input: RowInput): Record<string, unknown> {
  const { tiers, skia } = harnessFacts();
  const fontScale = input.fontScale ?? 1;
  const clock = input.clock ?? { mode: 'fixed', t: 11000 };
  const night = input.expect.face !== 'light';
  const still = input.expect.tier === 'still';
  const screen = { width: input.screen.width, height: input.screen.height };
  const region = appRegion(screen, input.bars ?? []) as Rect;
  const stage = input.stage ?? { x: 0, y: 0, ...screen };
  const r: Record<string, unknown> = {
    shot: input.shot,
    repeat: input.repeat ?? 1,
    file: input.file,
    sha256: input.sha256,
    appRegionHash: ZERO64,
    commit: { sha: 'a'.repeat(40), porcelainEmpty: true },
    stamp: { bundleSha256: ZERO64, tokens: {} },
    device: { model: 'fixture', fingerprint: 'fixture/planted', width: screen.width, height: screen.height, density: input.density, refreshRate: 120 },
    app: { package: 'com.kokonadahealth.lab', apkSha256: ZERO64, buildType: 'lab', hermes: true, dev: false },
    scene: input.scene,
    direction: input.expect.direction,
    face: input.expect.face,
    fontScale: { requested: fontScale, observed: fontScale, app: fontScale },
    motion: { reduceMotionObserved: still, powerSaveObserved: false, tier: input.expect.tier },
    locale: 'he-IL',
    isRTL: true,
    clock: { mode: clock.mode, t: clock.t, seq: 0 },
    shaderStatus: input.shaderStatus,
    uimode: night ? 'night' : 'day',
    animatorScales: { window: 1, transition: still ? 0 : 1, animator: still ? 0 : 1 },
    forceDark: false,
    colorSpace: 'sRGB',
    region: { ...region },
    probes: classifyProbes({ stage: { px: { ...stage } } }, screen, region),
    timestamps: { launched: '2026-11-15T00:00:00Z', ready: '2026-11-15T00:00:01Z', captured: '2026-11-15T00:00:02Z' },
    expect: { ...input.expect },
    ...renderFacts(input.expect.tier, tiers),
    gl: { renderer: 'fixture GPU', gles: 'OpenGL ES 3.2 fixture', reason: null },
    display: { colorMode: 'ColorMode::SRGB (7)', wideColor: false, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: null },
    skiaVersion: skia,
    shaderReason: input.shaderReason ?? null,
    stage: { ...stage },
  };
  const errors = validateRow(r) as string[];
  if (errors.length > 0) throw new Error(`the fixture row ${input.shot} is not one the harness writes: ${errors.join('; ')}`);
  return r;
}

/** A manifest around rows, with exactly the top-level fields capture.mjs writes (pinned by reportsHarness.test.ts). */
export function manifest(rows: readonly Record<string, unknown>[], outcome: 'passed' | 'failed' = 'passed', plan = 'fixture'): Record<string, unknown> {
  return {
    plan,
    outcome,
    failure: outcome === 'passed' ? null : 'planted failure',
    restoreFailures: [],
    commit: 'a'.repeat(40),
    stamp: { bundleSha256: ZERO64, tokens: {} },
    apkSha256: ZERO64,
    device: { model: 'fixture', fingerprint: 'fixture/planted', width: 1, height: 1, density: 160, refreshRate: 120, locale: 'he-IL', forceDark: false },
    render: { gl: { renderer: 'fixture GPU', gles: 'OpenGL ES 3.2 fixture', reason: null }, display: { colorMode: 'ColorMode::SRGB (7)', wideColor: false, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: null } },
    skiaVersion: harnessFacts().skia,
    startedAt: '2026-11-15T00:00:00Z',
    finishedAt: '2026-11-15T00:01:00Z',
    rows,
    determinism: [],
    proofs: [],
    checks: [],
    results: [],
    records: [],
  };
}

/** The value at a dotted path, and a copy of the row without it. */
export function without(r: Record<string, unknown>, dotted: string): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
  const keys = dotted.split('.');
  let at: Record<string, unknown> = copy;
  for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
  delete at[keys[keys.length - 1]];
  return copy;
}

/** A copy of the row with one dotted path set. */
export function withValue(r: Record<string, unknown>, dotted: string, value: unknown): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
  const keys = dotted.split('.');
  let at: Record<string, unknown> = copy;
  for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
  at[keys[keys.length - 1]] = value;
  return copy;
}
