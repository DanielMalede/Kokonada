// The run readers of the cost and motion reports (B8-8e): the capture plan that ran, its manifest's proofs and
// determinism records, and a cost RESULT line. Each reader refuses what it cannot use, naming the field (an
// EvidenceInputError, as lib/evidence.mts does): a missing or malformed field is never read as a default.
//
// The contract read here, until B8-5b lands its schema (one place to align):
//   · a planned proof is the plan shot's `proof`: { kind, seconds }, and for kind `rate` also `band` { min, max } in
//     frames per second;
//   · a manifest proof is { shot, kind, ... }: zero-frames, draws-frames and rate carry `seconds` and `frames` (a rate is
//     frames over seconds); framestats carries its own numbers, informational; a cost shot's RESULT line is the proof
//     { shot, kind: 'result', result: <the line's JSON> };
//   · a determinism record is { shot, equal, hashes } for each shot launched more than once (QA-078).
// A cost RESULT is judged, not refused: its problems are the report's failures (the instrument), never input errors.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { EvidenceInputError } from './evidence.mts';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** --plan, --manifest and --out, or the usage. */
export function runArgs(argv: readonly string[], script: string): { plan: string; manifest: string; out: string } {
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const plan = at('--plan');
  const manifest = at('--manifest');
  const out = at('--out');
  if (!plan || !manifest || !out) throw new EvidenceInputError(`usage: node scripts/lab/reports/${script}.mts --plan <capture plan>.json --manifest <run>/manifest.json --out <report>.txt`);
  return { plan: path.resolve(plan), manifest: path.resolve(manifest), out: path.resolve(out) };
}

function readJson(file: string, what: string): { value: unknown; sha256: string } {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    throw new EvidenceInputError(`cannot read the ${what} ${file}: ${(e as Error).message}`);
  }
  try {
    return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } catch (e) {
    throw new EvidenceInputError(`the ${what} ${file} is not JSON: ${(e as Error).message}`);
  }
}

const refuse = (report: string, where: string, field: string, why: string): never => {
  throw new EvidenceInputError(`${report}: ${where}: the field "${field}" ${why}`);
};

export interface PlannedProof {
  readonly kind: string;
  readonly seconds: number;
  /** A rate proof's band, frames per second, both ends included. */
  readonly band: { readonly min: number; readonly max: number } | null;
}
export interface PlanShot {
  readonly id: string;
  readonly scene: string;
  readonly repeat: number;
  readonly proof: PlannedProof | null;
}
export interface Plan {
  readonly file: string;
  readonly sha256: string;
  readonly id: string;
  readonly shots: readonly PlanShot[];
}

function readPlanShot(s: unknown, i: number, report: string): PlanShot {
  const where = `the plan's shots[${i}]`;
  if (!isObject(s)) throw new EvidenceInputError(`${report}: ${where} is not an object`);
  const id = s.id;
  if (typeof id !== 'string' || id === '') refuse(report, where, 'id', 'is missing');
  const at = `the plan's shot ${id}`;
  if (typeof s.scene !== 'string' || s.scene === '') refuse(report, at, 'scene', 'is missing');
  if (!Number.isInteger(s.repeat) || (s.repeat as number) < 1) refuse(report, at, 'repeat', 'must be an integer of 1 or more');
  let proof: PlannedProof | null = null;
  if (s.proof !== undefined) {
    const p = s.proof;
    if (!isObject(p)) refuse(report, at, 'proof', 'is not an object');
    const q = p as Record<string, unknown>;
    if (typeof q.kind !== 'string' || q.kind === '') refuse(report, at, 'proof.kind', 'is missing');
    if (!finite(q.seconds) || !(q.seconds > 0)) refuse(report, at, 'proof.seconds', 'must be a finite number above 0');
    let band: PlannedProof['band'] = null;
    if (q.kind === 'rate') {
      const b = q.band;
      if (!isObject(b)) refuse(report, at, 'proof.band', 'is missing: a rate proof needs the band its frames per second must lie in');
      const bb = b as Record<string, unknown>;
      if (!finite(bb.min) || !finite(bb.max) || bb.min > bb.max) refuse(report, at, 'proof.band', `must be { min, max }, finite, min ≤ max, got ${JSON.stringify(b)}`);
      band = { min: bb.min as number, max: bb.max as number };
    }
    proof = { kind: q.kind as string, seconds: q.seconds as number, band };
  }
  return { id: id as string, scene: s.scene as string, repeat: s.repeat as number, proof };
}

export interface RunManifest {
  readonly file: string;
  readonly sha256: string;
  readonly plan: string;
  readonly outcome: unknown;
  readonly failure: unknown;
  readonly commit: unknown;
  readonly proofs: readonly unknown[];
  readonly determinism: readonly unknown[] | null;
}

/** The plan and the manifest of its run: the manifest must name the plan, and carry a proofs list (and determinism, when asked). */
export function loadRun(planFile: string, manifestFile: string, report: string, needDeterminism: boolean): { plan: Plan; manifest: RunManifest } {
  const p = readJson(planFile, 'capture plan');
  if (!isObject(p.value)) throw new EvidenceInputError(`${report}: the capture plan ${planFile} is not an object`);
  const pv = p.value;
  if (typeof pv.id !== 'string' || pv.id === '') refuse(report, `the plan ${planFile}`, 'id', 'is missing');
  if (!Array.isArray(pv.shots)) refuse(report, `the plan ${planFile}`, 'shots', 'is missing or not a list');
  const plan: Plan = { file: planFile, sha256: p.sha256, id: pv.id as string, shots: (pv.shots as unknown[]).map((s, i) => readPlanShot(s, i, report)) };

  const m = readJson(manifestFile, 'manifest');
  if (!isObject(m.value)) throw new EvidenceInputError(`${report}: the manifest ${manifestFile} is not an object`);
  const mv = m.value;
  const where = `the manifest ${manifestFile}`;
  if (mv.plan !== plan.id) refuse(report, where, 'plan', `is ${JSON.stringify(mv.plan)}, not the plan's id ${plan.id}`);
  if (!Array.isArray(mv.proofs)) refuse(report, where, 'proofs', 'is missing or not a list');
  if (needDeterminism && !Array.isArray(mv.determinism)) refuse(report, where, 'determinism', 'is missing or not a list');
  return {
    plan,
    manifest: {
      file: manifestFile, sha256: m.sha256, plan: mv.plan as string, outcome: mv.outcome ?? null, failure: mv.failure ?? null, commit: mv.commit ?? null,
      proofs: mv.proofs as unknown[], determinism: Array.isArray(mv.determinism) ? mv.determinism : null,
    },
  };
}

export interface Proof {
  readonly shot: string;
  readonly kind: string;
  readonly raw: Record<string, unknown>;
}

/** A manifest proof's shot and kind. */
export function readProof(entry: unknown, i: number, report: string): Proof {
  const where = `the manifest's proofs[${i}]`;
  if (!isObject(entry)) throw new EvidenceInputError(`${report}: ${where} is not an object`);
  if (typeof entry.shot !== 'string' || entry.shot === '') refuse(report, where, 'shot', 'is missing');
  if (typeof entry.kind !== 'string' || entry.kind === '') refuse(report, `${where} (${entry.shot})`, 'kind', 'is missing');
  return { shot: entry.shot as string, kind: entry.kind as string, raw: entry };
}

/** A zero-frames, draws-frames or rate proof's seconds and frames, as measured. */
export function readFrames(proof: Proof, report: string): { seconds: number; frames: number } {
  const where = `the manifest's ${proof.kind} proof of ${proof.shot}`;
  const { seconds, frames } = proof.raw;
  if (!finite(seconds) || !(seconds > 0)) refuse(report, where, 'seconds', `must be a finite number above 0, got ${JSON.stringify(seconds)}`);
  if (!Number.isInteger(frames) || (frames as number) < 0) refuse(report, where, 'frames', `must be a whole number of 0 or more, got ${JSON.stringify(frames)}`);
  return { seconds: seconds as number, frames: frames as number };
}

/** A determinism record's shot and hashes (the hashes decide, never the record's own `equal`). */
export function readDeterminism(entry: unknown, i: number, report: string): { shot: string; hashes: string[] } {
  const where = `the manifest's determinism[${i}]`;
  if (!isObject(entry)) throw new EvidenceInputError(`${report}: ${where} is not an object`);
  if (typeof entry.shot !== 'string' || entry.shot === '') refuse(report, where, 'shot', 'is missing');
  const h = entry.hashes;
  if (!Array.isArray(h) || h.length < 2 || !h.every((x) => typeof x === 'string' && x !== '')) refuse(report, `${where} (${entry.shot})`, 'hashes', 'must list the hash of every launch, at least two');
  return { shot: entry.shot as string, hashes: h as string[] };
}

// ---------------------------------------------------------------------------------------- cost

export type Variant = 'field' | 'storm' | 'heavy' | 'empty';
const VARIANTS = new Set(['storm', 'heavy', 'empty']);
const TIERS = new Set(['full', 'low', 'still']);
const FACES = new Set(['dark', 'light']);

/** cost.<direction>.<face>.<scene>.<tier>[.storm|.heavy|.empty]; the scene may hold dots (one.joy). Null if it is not one. */
export function parseCostScene(id: string): { direction: string; face: string; scene: string; tier: string; variant: Variant } | null {
  const parts = id.split('.');
  if (parts[0] !== 'cost' || parts.length < 5) return null;
  let variant: Variant = 'field';
  if (VARIANTS.has(parts[parts.length - 1])) variant = parts.pop() as Variant;
  const tier = parts.pop() as string;
  const [, direction, face, ...scene] = parts;
  if (!TIERS.has(tier) || !FACES.has(face) || !direction || scene.length === 0 || scene.some((s) => s === '')) return null;
  return { direction, face, scene: scene.join('.'), tier, variant };
}

export interface Quantiles {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}
export interface CostResult {
  readonly frames: number;
  readonly displayHz: number;
  readonly stepUs: Quantiles;
  readonly renderUs: Quantiles;
  readonly gpuProxyUs: Quantiles;
}

/** A cost RESULT line, or the problem with it, naming the field: the line's contract (B8-3) and the shot's own scene. */
export function judgeCostResult(raw: unknown, scene: string): { result: CostResult } | { problem: string } {
  if (!isObject(raw)) return { problem: 'the RESULT is not an object' };
  const bad = (field: string, why: string) => ({ problem: `the RESULT field "${field}" ${why}` });
  if (raw.kind !== 'cost') return bad('kind', `is ${JSON.stringify(raw.kind)}, not "cost"`);
  if (raw.scene !== scene) return bad('scene', `is ${JSON.stringify(raw.scene)}, not the shot's ${scene}`);
  if (raw.clock !== 'performance.now') return bad('clock', `is ${JSON.stringify(raw.clock)}, not "performance.now": an absent UI-runtime clock is an error, never a Date fallback`);
  for (const f of ['frames', 'displayHz']) {
    if (raw[f] === undefined) return bad(f, 'is missing');
    if (!finite(raw[f]) || (raw[f] as number) < 0) return bad(f, `is not a finite number: ${JSON.stringify(raw[f])}`);
  }
  if (!((raw.displayHz as number) > 0)) return bad('displayHz', 'is 0');
  const q: Record<string, Quantiles> = {};
  for (const f of ['stepUs', 'renderUs', 'gpuProxyUs']) {
    const v = raw[f];
    if (v === undefined) return bad(f, 'is missing');
    if (!isObject(v)) return bad(f, 'is not an object');
    for (const k of ['p50', 'p95', 'max']) {
      if (v[k] === undefined) return bad(`${f}.${k}`, 'is missing');
      if (!finite(v[k]) || (v[k] as number) < 0) return bad(`${f}.${k}`, `is not a finite number: ${JSON.stringify(v[k])}`);
    }
    q[f] = { p50: v.p50 as number, p95: v.p95 as number, max: v.max as number };
  }
  return { result: { frames: raw.frames as number, displayHz: raw.displayHz as number, stepUs: q.stepUs, renderUs: q.renderUs, gpuProxyUs: q.gpuProxyUs } };
}

/** A number as the reports print it: at most three decimals. */
export const fmt = (x: number): string => String(Math.round(x * 1000) / 1000);
