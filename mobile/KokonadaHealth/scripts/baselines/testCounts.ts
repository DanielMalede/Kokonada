/// <reference types="node" />
// QA-042 (Stage 0 Q2): the shape of scripts/baselines/test-counts.json, the jest baseline QA-041 reads.
// The counts come from `jest --ci --json` (numTotalTestSuites, numTotalTests) on a clean main at `sha`.
// A package that could not be measured carries its reason instead of numbers, never a guess.

import * as fs from 'fs';
import * as path from 'path';

export const TEST_COUNTS_PATH = path.join(__dirname, 'test-counts.json');

export type PackageCounts = { numTotalTestSuites: number; numTotalTests: number } | { notMeasured: string };

export interface TestCounts {
  sha: string;
  measuredAt: string;
  node: string;
  jest: string;
  /** The exact command per measured package, run from that package's directory. */
  command: Partial<Record<'mobile' | 'backend', string>>;
  mobile: PackageCounts;
  backend: PackageCounts;
  /** Where the counts were cross-checked (a CI run on the same SHA), if anywhere. */
  crossCheck?: string;
}

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function validateTestCounts(value: unknown): TestCounts {
  const c = value as TestCounts;
  if (!c || typeof c !== 'object') throw new Error('test counts: not an object');
  if (typeof c.sha !== 'string' || !/^[0-9a-f]{40}$/.test(c.sha)) throw new Error(`test counts: sha must be 40 lower-case hex characters, got ${String(c.sha)}`);
  if (!text(c.measuredAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(c.measuredAt)) throw new Error('test counts: measuredAt must be an ISO UTC time');
  if (!text(c.node) || !/^v\d+\.\d+\.\d+$/.test(c.node)) throw new Error('test counts: node must be a version like v24.19.0');
  if (!text(c.jest) || !/^\d+\.\d+\.\d+$/.test(c.jest)) throw new Error('test counts: jest must be a version');
  if (!c.command || typeof c.command !== 'object') throw new Error('test counts: command must name the command per package');
  for (const pkg of ['mobile', 'backend'] as const) {
    const p = c[pkg] as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') throw new Error(`test counts: ${pkg} is missing (record its counts or why it was not measured)`);
    if ('notMeasured' in p) {
      if (!text(p.notMeasured)) throw new Error(`test counts: ${pkg}.notMeasured must give the reason`);
      continue;
    }
    if (!positiveInt(p.numTotalTestSuites)) throw new Error(`test counts: ${pkg}.numTotalTestSuites must be a positive integer`);
    if (!positiveInt(p.numTotalTests)) throw new Error(`test counts: ${pkg}.numTotalTests must be a positive integer`);
    if (p.numTotalTests < p.numTotalTestSuites) throw new Error(`test counts: ${pkg} has fewer tests than suites`);
    if (!text(c.command[pkg])) throw new Error(`test counts: command.${pkg} is missing`);
  }
  return c;
}

export const readTestCounts = (file: string = TEST_COUNTS_PATH): TestCounts =>
  validateTestCounts(JSON.parse(fs.readFileSync(file, 'utf8')));
