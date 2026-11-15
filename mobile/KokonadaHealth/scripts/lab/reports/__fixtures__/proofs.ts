// Planted plans and manifests for the cost and motion reports (B8-8e), in the harness's final schema (B8-5b,
// scripts/lab/capture.mjs): a plan the harness's validatePlan accepts (every shot with its `expect`), and the manifest's
// top level as rows.ts's manifest() writes it (capture.mjs's own fields). The proofs are the entries capture.mjs runProof
// pushes, field for field:
//   · zero-frames, draws-frames: { shot, kind, seconds, frames, passed };
//   · rate: { shot, kind: 'rate', seconds, frames, fps, band: { min, max }, passed } (fps = frames / seconds);
//   · framestats: { shot, kind: 'framestats', seconds, frames, janky, jankPercent, reason, passed: null } (informational);
//   · result: the proof { shot, kind: 'result', seconds, passed: true }, and the RESULT line itself in the manifest's
//     top-level `results` as { shot, repeat, result };
//   · record: the proof { shot, kind: 'record', seconds, passed: true }, and the file in `records`.
// determinism is { shot, equal, hashes } for each shot with repeat > 1 (QA-078); a shot allowed to move (a real-time
// clock with motion on, not at the still tier) is launched once (validatePlan, capture.mjs movingReason). Every plan made here is checked by the
// harness's validatePlan before it is returned. Synthetic numbers only: no device, no person.

import { validatePlan } from '../../capture.mjs';
import { manifest } from './rows.ts';

export type Json = Record<string, unknown>;

/** The catalogue's facts for a field.* or cost.* scene id, by the plan's grammar (capturePlans.test.ts pins the real plans). */
export function expectOf(scene: string): Json {
  const parts = scene.split('.');
  const [group, direction, face] = parts;
  let body = parts.slice(3);
  if (group === 'cost' && ['storm', 'heavy', 'empty'].includes(body[body.length - 1])) body = body.slice(0, -1);
  if ((group !== 'field' && group !== 'cost') || body.length < 2) throw new Error(`no facts for the fixture scene ${scene}`);
  return { direction, face, hero: body.slice(0, -1).join('.'), tier: body[body.length - 1] };
}

export function planShot(id: string, scene: string, extra: Json = {}): Json {
  return {
    id, repeat: 1, scene, args: { clock: 'realtime', frames: '10' },
    device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false }, probes: ['stage'], expect: expectOf(scene), ...extra,
  };
}

export function plan(id: string, shots: Json[]): Json {
  const p = { id, app: { package: 'com.kokonadahealth.lab', activity: 'com.kokonadahealth.lab.DesignLabActivity' }, readyTimeoutMs: 30000, settleMs: 300, session: { stayOn: true }, shots };
  const errors = validatePlan(p) as string[];
  if (errors.length > 0) throw new Error(`the fixture plan ${id} is not one the harness takes: ${errors.join('; ')}`);
  return p;
}

export function runManifest(planId: string, proofs: Json[], determinism: Json[] = [], outcome: 'passed' | 'failed' = 'passed', results: Json[] = []): Json {
  return { ...manifest([], outcome, planId), determinism, proofs, results };
}

const p = (p50: number, p95: number, max: number) => ({ p50, p95, max });

/** A cost RESULT line's JSON, with its numbers in µs (the keys of lib/protocol.mjs checkResult, in its order). */
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

/** The cost run. `edit` changes a shot's RESULT, or drops it (null): then the harness, which refuses a shot whose RESULT never came, would have failed the run, so a dropped RESULT drops its proof too. */
export function costRun(edit: (id: string, result: Json) => Json | null = (_, r) => r): { plan: Json; manifest: Json } {
  const shots = COST_SHOTS.map((s) => planShot(s.id, s.scene, { proof: { kind: 'result', seconds: 60 } }));
  const kept = COST_SHOTS.flatMap((s) => {
    const r = edit(s.id, costResult(s.scene, s.gpu));
    return r === null ? [] : [{ shot: s.id, result: r }];
  });
  const proofs = kept.map((k) => ({ shot: k.shot, kind: 'result', seconds: 60, passed: true }));
  const results = kept.map((k) => ({ shot: k.shot, repeat: 1, result: k.result }));
  return { plan: plan('v1-cost', shots), manifest: runManifest('v1-cost', proofs, [], 'passed', results) };
}

/** The motion run: the still proofs, their positive control, the rates of UI-171, framestats, and two determinism pairs. */
export function motionRun(): { plan: Json; manifest: Json } {
  const shots = [
    planShot('dark-rest-still', 'field.abyss.dark.rest.still', { repeat: 2, proof: { kind: 'zero-frames', seconds: 10 } }),
    planShot('dark-rest-fixed', 'field.abyss.dark.rest.full', { repeat: 2, args: { clock: 'fixed', t: '11000', frames: '10' } }),
    planShot('dark-rest-reduced', 'field.abyss.dark.rest.full', { device: { fontScale: 1, night: 'yes', animatorScale: 0, powerSave: false }, proof: { kind: 'zero-frames', seconds: 10 } }),
    planShot('dark-rest-full', 'field.abyss.dark.rest.full', { proof: { kind: 'draws-frames', seconds: 10 } }),
    planShot('rate-low', 'field.abyss.dark.three.low', { proof: { kind: 'rate', seconds: 10, band: { min: 55, max: 62 } } }),
    planShot('rate-full', 'field.abyss.dark.three.full', { proof: { kind: 'rate', seconds: 10, band: { min: 110, max: 125 } } }),
    planShot('stats-full', 'field.abyss.dark.three.full', { proof: { kind: 'framestats', seconds: 10 } }),
  ];
  const proofs = [
    { shot: 'dark-rest-still', kind: 'zero-frames', seconds: 10, frames: 0, passed: true },
    { shot: 'dark-rest-reduced', kind: 'zero-frames', seconds: 10, frames: 0, passed: true },
    { shot: 'dark-rest-full', kind: 'draws-frames', seconds: 10, frames: 1187, passed: true },
    { shot: 'rate-low', kind: 'rate', seconds: 10, frames: 598, fps: 59.8, band: { min: 55, max: 62 }, passed: true },
    { shot: 'rate-full', kind: 'rate', seconds: 10, frames: 1190, fps: 119, band: { min: 110, max: 125 }, passed: true },
    { shot: 'stats-full', kind: 'framestats', seconds: 10, frames: 1190, janky: 18, jankPercent: 1.5, reason: null, passed: null },
  ];
  const determinism = [
    { shot: 'dark-rest-still', equal: true, hashes: ['1'.repeat(64), '1'.repeat(64)] },
    { shot: 'dark-rest-fixed', equal: true, hashes: ['2'.repeat(64), '2'.repeat(64)] },
  ];
  return { plan: plan('v1-motion', shots), manifest: runManifest('v1-motion', proofs, determinism) };
}
