// Planted manifest rows for the report tests (B8-8c, B8-8a, B8-8b): the shape a capture row has once B8-5a extends the
// manifest (scripts/lab/lib/manifest.mjs): every field the schema has today, plus `expect` {direction, face, hero, tier},
// `args` (the plan's launch args), renderScale, sampling, the stage rect in screen px, pxPerDp, shaderStatus and
// shaderReason. Synthetic values only: no device, no person. Imported by the jest tests and by makeFixtures.mts.

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
  readonly expect: { readonly direction: string; readonly face: string; readonly hero: string | null; readonly tier: string | null };
  readonly file: string;
  readonly sha256: string;
  /** The app region in screen px: the PNG is this crop. */
  readonly region: Rect;
  /** The stage probe in screen px. */
  readonly stage: Rect;
  readonly pxPerDp: number;
  readonly fontScale?: number;
  readonly t?: number;
  readonly renderScale?: number | null;
  readonly shaderStatus: string;
  readonly shaderReason?: string | null;
}

const ZERO64 = '0'.repeat(64);

/** A complete row. A fallback row has no tier, so its renderScale and sampling are null. */
export function row(input: RowInput): Record<string, unknown> {
  const t = input.t ?? 11000;
  const fontScale = input.fontScale ?? 1;
  const night = input.expect.face === 'dark';
  const still = input.expect.tier === 'still';
  return {
    shot: input.shot,
    repeat: input.repeat ?? 1,
    file: input.file,
    sha256: input.sha256,
    appRegionHash: ZERO64,
    commit: { sha: 'a'.repeat(40), porcelainEmpty: true },
    stamp: { bundleSha256: ZERO64, tokens: {} },
    device: { model: 'fixture', fingerprint: 'fixture/planted', width: input.region.x + input.region.width, height: input.region.y + input.region.height, density: Math.round(input.pxPerDp * 160), refreshRate: 60 },
    app: { package: 'com.kokonadahealth.lab', apkSha256: ZERO64, buildType: 'lab', hermes: true, dev: false },
    scene: input.scene,
    direction: null,
    face: null,
    expect: { ...input.expect },
    args: { clock: 'fixed', t: String(t), frames: '10' },
    fontScale: { requested: fontScale, observed: fontScale, app: fontScale },
    motion: { reduceMotionObserved: still, powerSaveObserved: false, tier: input.expect.tier },
    locale: 'he-IL',
    isRTL: true,
    clock: { mode: 'fixed', t, seq: 0 },
    renderScale: input.renderScale === undefined ? null : input.renderScale,
    sampling: input.expect.tier === null ? null : { filter: 'linear', mipmap: 'none' },
    stage: { ...input.stage },
    pxPerDp: input.pxPerDp,
    shaderStatus: input.shaderStatus,
    shaderReason: input.shaderReason ?? null,
    uimode: night ? 'night' : 'day',
    animatorScales: { window: 1, transition: still ? 0 : 1, animator: still ? 0 : 1 },
    forceDark: false,
    colorSpace: 'sRGB',
    region: { ...input.region },
    probes: { inside: { stage: { ...input.stage } }, excluded: [] },
    timestamps: { launched: '2026-11-15T00:00:00Z', ready: '2026-11-15T00:00:01Z', captured: '2026-11-15T00:00:02Z' },
  };
}

/** A manifest around rows, as capture.mjs writes it. */
export function manifest(rows: readonly Record<string, unknown>[], outcome: 'passed' | 'failed' = 'passed'): Record<string, unknown> {
  return {
    plan: 'fixture',
    outcome,
    failure: outcome === 'passed' ? null : 'planted failure',
    restoreFailures: [],
    commit: 'a'.repeat(40),
    stamp: { bundleSha256: ZERO64, tokens: {} },
    apkSha256: ZERO64,
    device: { model: 'fixture' },
    startedAt: '2026-11-15T00:00:00Z',
    finishedAt: '2026-11-15T00:01:00Z',
    rows,
    determinism: [],
    proofs: [],
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
