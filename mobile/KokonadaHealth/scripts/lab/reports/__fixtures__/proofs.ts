// Planted plans and manifests for the cost and motion reports (B8-8e): the shape capture.mjs writes (`plan`, `outcome`,
// `rows`, `determinism`, `proofs`) with the proof kinds B8-5b adds. Synthetic numbers only: no device, no person.
//
// The contract read here, until B8-5b lands its schema:
//   · a planned proof is the plan shot's `proof`: { kind, seconds } for zero-frames, draws-frames and framestats;
//     { kind: 'rate', seconds, band: { min, max } } (frames per second) for rate;
//   · a manifest proof is { shot, kind, seconds, frames, passed } (rate: frames over seconds is the rate; framestats adds
//     its own numbers, informational); a RESULT line is the manifest proof { shot, kind: 'result', result: <the line's
//     JSON> } of a cost.* shot;
//   · determinism is { shot, equal, hashes } for each shot with repeat > 1 (QA-078).

export type Json = Record<string, unknown>;

export function planShot(id: string, scene: string, extra: Json = {}): Json {
  return {
    id, repeat: 1, scene, args: { clock: 'realtime' },
    device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false }, probes: ['stage'], ...extra,
  };
}

export function plan(id: string, shots: Json[]): Json {
  return { id, app: { package: 'com.kokonadahealth.lab', activity: 'com.kokonadahealth.lab.DesignLabActivity' }, readyTimeoutMs: 30000, settleMs: 300, shots };
}

export function runManifest(planId: string, proofs: Json[], determinism: Json[] = [], outcome: 'passed' | 'failed' = 'passed'): Json {
  return {
    plan: planId, outcome, failure: outcome === 'passed' ? null : 'planted failure', restoreFailures: [],
    commit: 'a'.repeat(40), stamp: {}, apkSha256: '0'.repeat(64), device: { model: 'fixture' },
    startedAt: '2026-11-15T00:00:00Z', finishedAt: '2026-11-15T00:01:00Z', rows: [], determinism, proofs,
  };
}

const p = (p50: number, p95: number, max: number) => ({ p50, p95, max });

/** A cost RESULT line's JSON, with its numbers in µs. */
export function costResult(scene: string, gpuP50: number, over: Json = {}): Json {
  return {
    run: 'r1', seq: 0, kind: 'cost', scene, frames: 600, displayHz: 120,
    stepUs: p(210, 340, 900), renderUs: p(1500, 2100, 4000), gpuProxyUs: p(gpuP50, gpuP50 + 200, gpuP50 + 900),
    clock: 'performance.now', ...over,
  };
}

/** The cost run: dark three at full (field, storm, heavy, empty) and at low (field, storm). */
export const COST_SHOTS: ReadonlyArray<{ id: string; scene: string; gpu: number }> = [
  { id: 'cost-full', scene: 'cost.abyss.dark.three.full', gpu: 800 },
  { id: 'cost-full-storm', scene: 'cost.abyss.dark.three.full.storm', gpu: 950 },
  { id: 'cost-full-heavy', scene: 'cost.abyss.dark.three.full.heavy', gpu: 3000 },
  { id: 'cost-full-empty', scene: 'cost.abyss.dark.three.full.empty', gpu: 100 },
  { id: 'cost-low', scene: 'cost.abyss.dark.three.low', gpu: 500 },
  { id: 'cost-low-storm', scene: 'cost.abyss.dark.three.low.storm', gpu: 600 },
];

export function costRun(edit: (id: string, result: Json) => Json | null = (_, r) => r): { plan: Json; manifest: Json } {
  const shots = COST_SHOTS.map((s) => planShot(s.id, s.scene, { proof: { kind: 'result', seconds: 10 } }));
  const proofs = COST_SHOTS.flatMap((s) => {
    const r = edit(s.id, costResult(s.scene, s.gpu));
    return r === null ? [] : [{ shot: s.id, kind: 'result', result: r }];
  });
  return { plan: plan('v1-cost', shots), manifest: runManifest('v1-cost', proofs) };
}

/** The motion run: the still proofs, their positive control, the rates of UI-171, framestats, and two determinism pairs. */
export function motionRun(): { plan: Json; manifest: Json } {
  const shots = [
    planShot('dark-rest-still', 'field.abyss.dark.rest.still', { repeat: 2, proof: { kind: 'zero-frames', seconds: 10 } }),
    planShot('dark-rest-reduced', 'field.abyss.dark.rest.full', { device: { fontScale: 1, night: 'yes', animatorScale: 0, powerSave: false }, proof: { kind: 'zero-frames', seconds: 10 } }),
    planShot('dark-rest-full', 'field.abyss.dark.rest.full', { repeat: 2, proof: { kind: 'draws-frames', seconds: 10 } }),
    planShot('rate-low', 'field.abyss.dark.three.low', { proof: { kind: 'rate', seconds: 10, band: { min: 55, max: 62 } } }),
    planShot('rate-full', 'field.abyss.dark.three.full', { proof: { kind: 'rate', seconds: 10, band: { min: 110, max: 125 } } }),
    planShot('stats-full', 'field.abyss.dark.three.full', { proof: { kind: 'framestats', seconds: 10 } }),
  ];
  const proofs = [
    { shot: 'dark-rest-still', kind: 'zero-frames', seconds: 10, frames: 0, passed: true },
    { shot: 'dark-rest-reduced', kind: 'zero-frames', seconds: 10, frames: 0, passed: true },
    { shot: 'dark-rest-full', kind: 'draws-frames', seconds: 10, frames: 1187, passed: true },
    { shot: 'rate-low', kind: 'rate', seconds: 10, frames: 598, passed: true },
    { shot: 'rate-full', kind: 'rate', seconds: 10, frames: 1190, passed: true },
    { shot: 'stats-full', kind: 'framestats', seconds: 10, frames: 1190, jankPercent: 1.5, p90Ms: 9, p99Ms: 14, passed: true },
  ];
  const determinism = [
    { shot: 'dark-rest-still', equal: true, hashes: ['1'.repeat(64), '1'.repeat(64)] },
    { shot: 'dark-rest-full', equal: true, hashes: ['2'.repeat(64), '2'.repeat(64)] },
  ];
  return { plan: plan('v1-motion', shots), manifest: runManifest('v1-motion', proofs, determinism) };
}
