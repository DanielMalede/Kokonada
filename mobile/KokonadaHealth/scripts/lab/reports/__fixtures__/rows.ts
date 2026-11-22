// Planted manifest rows for the report tests (B8-8c, B8-8a, B8-8b), built by the harness's own builders (UI-240): each
// row is lib/manifest.mjs buildRow over planted sources, and each manifest is its buildManifest, so a fixture has the
// harness's fields in the harness's order by construction. The sources are made with the harness's own functions: the
// app region from the screen and its system bars (lib/png.mjs appRegion), the probes kept or excluded
// (lib/protocol.mjs classifyProbes), the render facts an expect tier implies (capture.mjs renderFacts, from the token
// file), the Skia version (lib/manifest.mjs readSkiaVersion, from the lockfile) and the lab stamp (lib/stamp.mjs
// makeStamp). Every row is checked by the harness's validateRow before it is returned: this builder cannot make a row
// the harness would refuse to write. Synthetic values only: no device, no person. Imported by the jest tests and by
// makeFixtures.mts.
//
// The end-to-end test (reportsHarness.test.ts) is the other half of the proof: the rows the harness itself writes on its
// fake phone, fed unmodified to every report, and the fixtures' fields held to them.

import fs from 'node:fs';
import path from 'node:path';

import { renderFacts } from '../../capture.mjs';
import { androidDensity, buildManifest, buildRow, readSkiaVersion, validateRow } from '../../lib/manifest.mjs';
import { appRegion } from '../../lib/png.mjs';
import { classifyProbes } from '../../lib/protocol.mjs';
import { makeStamp } from '../../lib/stamp.mjs';

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
  /** READY's other probes in screen px (the witness's region probe, say), classified by the harness as it classifies the stage. */
  readonly probes?: Readonly<Record<string, Rect>>;
  /** `wm density`, dpi: the cross-check of READY's pixel ratio (Android's float density from it). */
  readonly density: number;
  /** READY's pixel ratio (PixelRatio.get()), the px per dp: Android's float density for `density` by default, as on a phone. */
  readonly pixelRatio?: number;
  readonly fontScale?: number;
  /** The clock READY reports: fixed at t 11000 by default; realtime has no t. */
  readonly clock?: { readonly mode: 'fixed' | 'stepped' | 'realtime'; readonly t: number | null };
  readonly shaderStatus: string | null;
  readonly shaderReason?: string | null;
  /** The tier READY observed (motion.tier): the expect's tier by default, as for a scene whose id names it. */
  readonly observedTier?: string | null;
  /** The GPU line the harness read (lib/device.mjs parseGles): the planted phone's by default, the one GPU UI-272's ring model was validated on. */
  readonly gl?: { readonly renderer: string | null; readonly gles: string | null; readonly reason: string | null };
}

const ZERO64 = '0'.repeat(64);
const COMMIT = 'a'.repeat(40);
/** What checkBuild verified, as the harness hands it to buildRow and buildManifest. */
const build = (skiaVersion: string) => ({
  head: COMMIT,
  stamp: makeStamp({ commit: COMMIT, porcelain: '', bundleSha256: ZERO64, tokens: {}, entry: 'index.lab.js', createdAt: '2026-11-15T00:00:00.000Z' }),
  apkSha256: ZERO64,
  hermes: true,
  skiaVersion,
});
/** lib/device.mjs readDeviceFacts of the planted phone (its size and density are each row's). */
const FACTS = { model: 'fixture', fingerprint: 'fixture/planted', width: 1, height: 1, density: 160, refreshRate: 120, forceDark: false, locale: 'he-IL' };
/**
 * lib/device.mjs readRenderFacts of the planted phone. Its GL renderer is the one UI-272's fallback ring model was validated
 * on (the S22+'s Adreno 730), so the reports model a planted fallback row's ring; a test plants another to see it refused.
 */
const RENDER = {
  gl: { renderer: 'Qualcomm, Adreno (TM) 730', gles: 'OpenGL ES 3.2 fixture', reason: null },
  display: { colorMode: 'ColorMode::SRGB (7)', wideColor: false, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: null },
};

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

/** A complete row, built by the harness's buildRow and checked by its validateRow. */
export function row(input: RowInput): Record<string, unknown> {
  const { tiers, skia } = harnessFacts();
  const fontScale = input.fontScale ?? 1;
  const clock = input.clock ?? { mode: 'fixed', t: 11000 };
  const night = input.expect.face !== 'light';
  const still = input.expect.tier === 'still';
  const screen = { width: input.screen.width, height: input.screen.height };
  const region = appRegion(screen, input.bars ?? []) as Rect;
  const stage = input.stage ?? { x: 0, y: 0, ...screen };
  const r = buildRow({
    shot: { id: input.shot, scene: input.scene, device: { fontScale }, expect: input.expect },
    repeat: input.repeat ?? 1,
    file: input.file,
    sha256: input.sha256,
    appRegionHash: ZERO64,
    build: build(skia),
    app: { package: 'com.kokonadahealth.lab' },
    facts: { ...FACTS, width: screen.width, height: screen.height, density: input.density },
    frame: { ...screen, colorSpace: 'sRGB' },
    observed: { fontScale, night: night ? 'yes' : 'no', animatorScales: { window: 1, transition: still ? 0 : 1, animator: still ? 0 : 1 } },
    ready: {
      clock: clock.mode, t: clock.t, seq: 0, powerSave: false, isRTL: true, fontScale,
      tier: input.observedTier === undefined ? input.expect.tier : input.observedTier,
      shaderStatus: input.shaderStatus, shaderReason: input.shaderReason ?? null,
      probes: { stage: { px: { ...stage } } },
      pixelRatio: input.pixelRatio ?? androidDensity(input.density),
    },
    region: { ...region },
    probes: classifyProbes({ stage: { px: { ...stage } }, ...Object.fromEntries(Object.entries(input.probes ?? {}).map(([id, px]) => [id, { px: { ...px } }])) }, screen, region),
    timestamps: { launched: new Date('2026-11-15T00:00:00Z'), ready: new Date('2026-11-15T00:00:01Z'), captured: new Date('2026-11-15T00:00:02Z') },
    renderFacts: renderFacts(input.expect.tier, tiers),
    render: input.gl === undefined ? RENDER : { ...RENDER, gl: { ...input.gl } },
  }) as Record<string, unknown>;
  const errors = validateRow(r) as string[];
  if (errors.length > 0) throw new Error(`the fixture row ${input.shot} is not one the harness writes: ${errors.join('; ')}`);
  return r;
}

/** A manifest around rows, built by the harness's buildManifest (its top level pinned by reportsHarness.test.ts). */
export function manifest(rows: readonly Record<string, unknown>[], outcome: 'passed' | 'failed' = 'passed', plan = 'fixture'): Record<string, unknown> {
  return buildManifest({
    planId: plan,
    failure: outcome === 'passed' ? null : new Error('planted failure'),
    restoreFailures: [],
    build: build(harnessFacts().skia),
    facts: { ...FACTS, width: 1, height: 1, density: 160 },
    render: RENDER,
    startedAt: '2026-11-15T00:00:00Z',
    finishedAt: '2026-11-15T00:01:00Z',
    rows: [...rows],
    determinism: [],
    out: { proofs: [], checks: [], results: [], records: [], moving: [], settleFailures: [] },
  }) as Record<string, unknown>;
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
