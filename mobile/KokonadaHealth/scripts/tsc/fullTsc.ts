/// <reference types="node" />
// QA-043, full-project half (Stage 0 Q2). The whole tsconfig project, type-checked in-process (D8 rule
// 1), reduced to a multiset of (file, TS code) -> count with nothing filtered, and compared EXACTLY with
// the recorded baseline: a new error fails, and a fixed one fails too until the baseline is shrunk.
// Line numbers are left out on purpose, so an edit that only moves an error does not trip the ratchet.

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { createTsProgram, relToApp, type Overlay } from '../../src/testing/guards/tsProgram';

export const BASELINE_PATH = path.join(__dirname, 'tsc-baseline.json');

/** `file|TScode` (or `<global>|TScode`) -> count. */
export type Multiset = Record<string, number>;

export interface Baseline {
  /** The commit whose tree was measured. */
  sha: string;
  /** The TypeScript version that measured it; a different compiler means a re-record (ARCH-030). */
  typescript: string;
  total: number;
  diagnostics: Multiset;
}

const KEY = /^(<global>|[^|]+\.(?:ts|tsx|js|jsx|d\.ts|json))\|TS\d+$/;

export function validateBaseline(b: Baseline): Baseline {
  if (!/^[0-9a-f]{40}$/.test(b.sha)) throw new Error(`tsc baseline: sha must be 40 hex characters, got ${b.sha}`);
  if (typeof b.typescript !== 'string' || !/^\d+\.\d+\.\d+/.test(b.typescript)) throw new Error('tsc baseline: typescript must be a version');
  for (const [key, count] of Object.entries(b.diagnostics ?? {})) {
    if (!KEY.test(key)) throw new Error(`tsc baseline: key "${key}" is not file|TScode`);
    if (!Number.isInteger(count) || count < 1) throw new Error(`tsc baseline: count of ${key} must be a positive integer, got ${count}`);
  }
  const sum = Object.values(b.diagnostics).reduce((a, c) => a + c, 0);
  if (b.total !== sum) throw new Error(`tsc baseline: total ${b.total} differs from the sum of the counts ${sum}`);
  return b;
}

export const readBaseline = (file: string = BASELINE_PATH): Baseline =>
  validateBaseline(JSON.parse(fs.readFileSync(file, 'utf8')) as Baseline);

/** Every diagnostic counted once, under its file (relative to the app) and code; keys sorted. */
export function diagnosticMultiset(diagnostics: readonly ts.Diagnostic[]): Multiset {
  const counts: Multiset = {};
  for (const d of diagnostics) {
    const key = `${d.file ? relToApp(d.file.fileName) : '<global>'}|TS${d.code}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export interface FullMeasure {
  rootCount: number;
  diagnostics: readonly ts.Diagnostic[];
  multiset: Multiset;
}

/** The whole tsconfig project's pre-emit diagnostics, unfiltered. */
export function measureFullProject(parsed: ts.ParsedCommandLine, overlay: Overlay = {}): FullMeasure {
  const { program } = createTsProgram(parsed.fileNames, parsed, overlay);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return { rootCount: parsed.fileNames.length, diagnostics, multiset: diagnosticMultiset(diagnostics) };
}

/** Every difference from the baseline, plus how to re-record; empty when the multisets are equal. */
export function ratchetFailures(measured: Multiset, baseline: Baseline): string[] {
  const out: string[] = [];
  if (baseline.typescript !== ts.version) out.push(`the baseline was measured with TypeScript ${baseline.typescript}, this is ${ts.version}`);
  const keys = [...new Set([...Object.keys(measured), ...Object.keys(baseline.diagnostics)])].sort();
  for (const key of keys) {
    const was = baseline.diagnostics[key] ?? 0;
    const now = measured[key] ?? 0;
    if (now > was) out.push(`new: ${key} (${was} -> ${now})`);
    else if (now < was) out.push(`fixed: ${key} (${was} -> ${now})`);
  }
  if (out.length > 0) {
    const total = Object.values(measured).reduce((a, c) => a + c, 0);
    out.push([
      'The full-project tsc ratchet differs from scripts/tsc/tsc-baseline.json. A new error is fixed, never',
      'baselined. A fix shrinks the baseline: re-record it by replacing the file with the JSON below (set sha to',
      'the commit you measured) and name the fix in the PR. A TypeScript or RN types bump re-records it with its',
      'justification (ARCH-030).',
      JSON.stringify({ sha: '<the measured commit>', typescript: ts.version, total, diagnostics: measured }, null, 2),
    ].join('\n'));
  }
  return out;
}
