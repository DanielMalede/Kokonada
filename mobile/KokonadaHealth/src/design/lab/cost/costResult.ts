// The fieldCost bench's RESULT line (B8-3; the architect's B8 plan, "Contracts fixed now"):
//   KOKONADA_LAB RESULT {"run","seq","kind":"cost","scene","frames","displayHz","stepUs":{p50,p95,max},"renderUs":{…},
//                        "gpuProxyUs":{…},"clock":"performance.now"}
// with no tap coordinates (T1), under 4000 bytes, every number finite. formatCostResult writes exactly these keys in this
// order from the fields it was given, and refuses any other key, so nothing a scene adds can ride onto the line.
//
// How it reaches the harness: a scene cannot reach LabRoot's emit, so the cost scene hands its body to CostReportContext,
// which LabRoot provides (it adds run and seq, formats through formatCostResult and emits, or fails the run with an ERROR).
// Without a provider the bench runs and nothing is sent.
//
// Informational only: DEC-082 (the cost budget) is open, so nothing here judges a number against a threshold.

import { createContext } from 'react';
import { formatLine } from '../protocol';

/** Whole microseconds, nearest rank (histogram.ts). */
export interface Quantiles {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/** What the bench measured, without the run and the seq, which the lab adds. */
export interface CostResultBody {
  readonly kind: 'cost';
  readonly scene: string;
  /** Recorded step frames. */
  readonly frames: number;
  /** The frame callback's rate over the recorded frames, per second. */
  readonly displayHz: number;
  readonly stepUs: Quantiles;
  readonly renderUs: Quantiles;
  readonly gpuProxyUs: Quantiles;
  readonly clock: 'performance.now';
}

export interface CostResult extends CostResultBody {
  readonly run: string;
  readonly seq: number;
}

export const RESULT_KEYS = ['run', 'seq', 'kind', 'scene', 'frames', 'displayHz', 'stepUs', 'renderUs', 'gpuProxyUs', 'clock'] as const;
const QUANTILE_KEYS = ['p50', 'p95', 'max'] as const;
const COST_SCENE = /^cost\.abyss\.(dark|light)\./;

function quantiles(name: string, value: unknown): Quantiles {
  if (value === null || typeof value !== 'object') throw new Error(`RESULT: ${name} must be {p50, p95, max}`);
  const v = value as Record<string, unknown>;
  for (const k of Object.keys(v)) if (!(QUANTILE_KEYS as readonly string[]).includes(k)) throw new Error(`RESULT: ${name}.${k} is not p50, p95 or max`);
  for (const k of QUANTILE_KEYS) {
    const n = v[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`RESULT: ${name}.${k} must be a finite number`);
    if (!Number.isInteger(n) || n < 0) throw new Error(`RESULT: ${name}.${k} must be a whole number of microseconds, at least 0`);
  }
  const q = { p50: v.p50 as number, p95: v.p95 as number, max: v.max as number };
  if (!(q.p50 <= q.p95 && q.p95 <= q.max)) throw new Error(`RESULT: ${name} must have p50 <= p95 <= max`);
  return q;
}

/** The RESULT line for a run's measurement. Throws on anything the contract does not allow (formatLine: finite, ≤ 4000 bytes). */
export function formatCostResult(r: CostResult): string {
  const given = r as unknown as Record<string, unknown>;
  for (const k of Object.keys(given)) if (!(RESULT_KEYS as readonly string[]).includes(k)) throw new Error(`RESULT: "${k}" is not a RESULT key`);
  for (const k of RESULT_KEYS) if (!(k in given)) throw new Error(`RESULT: ${k} is missing`);
  if (typeof r.run !== 'string') throw new Error('RESULT: run must be a string');
  if (!Number.isInteger(r.seq) || r.seq < 0) throw new Error('RESULT: seq must be a whole number, at least 0');
  if (r.kind !== 'cost') throw new Error('RESULT: kind must be "cost"');
  if (typeof r.scene !== 'string' || !COST_SCENE.test(r.scene)) throw new Error(`RESULT: scene "${String(r.scene)}" is not a cost scene`);
  if (!Number.isInteger(r.frames) || r.frames < 1) throw new Error('RESULT: frames must be a whole number, at least 1');
  if (typeof r.displayHz !== 'number' || !Number.isFinite(r.displayHz)) throw new Error('RESULT: displayHz must be a finite number');
  if (!(r.displayHz > 0)) throw new Error('RESULT: displayHz must be above 0');
  if (r.clock !== 'performance.now') throw new Error('RESULT: clock must be "performance.now"');
  const payload = {
    run: r.run, seq: r.seq, kind: r.kind, scene: r.scene, frames: r.frames, displayHz: r.displayHz,
    stepUs: quantiles('stepUs', r.stepUs), renderUs: quantiles('renderUs', r.renderUs), gpuProxyUs: quantiles('gpuProxyUs', r.gpuProxyUs),
    clock: r.clock,
  };
  return formatLine('RESULT', payload);
}

/** The lab's side of a bench: the body when it is done, or the reason it cannot be. LabRoot provides it. */
export interface CostReport {
  result(body: CostResultBody): void;
  error(message: string): void;
}

export const CostReportContext = createContext<CostReport | null>(null);
