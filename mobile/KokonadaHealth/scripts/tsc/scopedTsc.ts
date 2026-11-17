/// <reference types="node" />
// QA-043, scoped half (Stage 0 Q2). The Stage 0 trees are type-checked in-process with the project's
// own options (D8 rule 1), and the result is never filtered: the only scoping is on the INPUTS (D8 rule
// 4). A root whose import closure enters a boundary is left out of the program through EXCLUDED_ROOTS,
// a pinned exact list; the check fails when an admitted root crosses a boundary, when an exclusion no
// longer crosses what it says, and when the admitted program itself enters a boundary.

import * as path from 'path';
import ts from 'typescript';
import { APP_ROOT } from '../../src/testing/guards/productionImports';
import { canonical, createTsProgram, formatDiagnostics, relToApp, type Overlay } from '../../src/testing/guards/tsProgram';

/** The Stage 0 trees on main. src/design/v2 and src/pages join after the V1 merge (OPS-420). */
export const STAGE0_ROOT_DIRS = ['src/testing', 'scripts/tsc'];

export interface Boundary {
  /** A directory prefix (ending in /) or one exact file, relative to the app root. */
  id: string;
  reason: string;
}

export const BOUNDARIES: readonly Boundary[] = [
  { id: 'src/health/', reason: 'OPS-022: the health lane carries a production tsc error (blePermissions.ts:57, TS7053); D8 rule 4 keeps the scoped closure out of it until OPS-022 (OPS-421) clears it' },
  { id: 'src/design/v2/', reason: "held by #234's live claim (the V1 PR); OPS-420 admits it after V1 merges" },
  { id: 'src/experience/profile/profileServices.ts', reason: 'OPS-022 production error (profileServices.ts:53, TS2554); fixed under OPS-421' },
];

/**
 * The roots left out, each with exactly the boundaries its closure crosses (measured, then pinned).
 * The check fails when this list and the measured crossings disagree in either direction.
 */
export const EXCLUDED_ROOTS: Readonly<Record<string, readonly string[]>> = {
  'src/testing/__tests__/api.test.tsx': ['src/health/'], // net/apiClient.ts -> health/config.ts
  'src/testing/__tests__/focus.test.tsx': ['src/design/v2/'], // design/v2/clock/fieldClock.ts
  'src/testing/__tests__/motion.test.tsx': ['src/design/v2/'], // design/v2/clock/fieldClock.ts
  'src/testing/__tests__/permissions.test.ts': ['src/health/'], // health/healthConnect.ts, blePermissions.ts
  'src/testing/__tests__/spotify.test.ts': ['src/health/'], // experience/player/spotifyRemoteAdapter.ts -> health/config.ts
};

// Paths are compared in canonical form (case-folded where the file system ignores case) and shown
// relative to the app root in their own case.
const APP_CANON = `${canonical(APP_ROOT)}/`;
const isProjectFile = (canon: string) => !/\/node_modules\//.test(canon) && canon.startsWith(APP_CANON);
const BOUNDARY_CANON = BOUNDARIES.map((b) => ({ id: b.id, prefix: b.id.endsWith('/'), canon: canonical(path.join(APP_ROOT, b.id)) + (b.id.endsWith('/') ? '/' : '') }));
const crossed = (canon: string) => BOUNDARY_CANON.filter((b) => (b.prefix ? canon.startsWith(b.canon) : canon === b.canon)).map((b) => b.id);

/** Every file the tsconfig lists under the Stage 0 trees, relative to the app root, sorted. */
export function candidateRoots(parsed: ts.ParsedCommandLine): string[] {
  return parsed.fileNames.map(relToApp)
    .filter((r) => STAGE0_ROOT_DIRS.some((d) => r.startsWith(`${d}/`)))
    .sort();
}

/** The project files reachable from `root` over the resolved edges (node_modules left out), canonical. */
function closureOf(root: string, edges: Map<string, Set<string>>): Set<string> {
  const start = canonical(root);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    for (const next of edges.get(queue.pop()!) ?? []) {
      if (!seen.has(next) && isProjectFile(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

export interface ScopedResult {
  candidates: string[];
  admitted: string[];
  excluded: Readonly<Record<string, readonly string[]>>;
  /** root -> the boundaries its closure actually crosses (only roots that cross one). */
  crossings: Record<string, string[]>;
  /** The scoped program's project files, relative and sorted. */
  closure: string[];
  /** Every pre-emit diagnostic of the scoped program, unfiltered. */
  diagnostics: readonly ts.Diagnostic[];
  /** The scoped program's files inside a boundary, with the boundaries each is inside. */
  boundaryFiles: Array<{ file: string; boundaries: string[] }>;
  /** Project files of the scoped program that no admitted root reaches over the recorded edges. */
  unreached: string[];
}

export interface ScopedOptions {
  parsed: ts.ParsedCommandLine;
  overlay?: Overlay;
  roots?: string[];
  excluded?: Readonly<Record<string, readonly string[]>>;
}

export function runScopedTsc({ parsed, overlay = {}, roots, excluded = EXCLUDED_ROOTS }: ScopedOptions): ScopedResult {
  const candidates = roots ?? candidateRoots(parsed);
  if (candidates.length === 0) throw new Error('scoped tsc: no roots under the Stage 0 trees');
  const abs = (rel: string) => path.join(APP_ROOT, rel);

  // Every candidate, excluded ones too, so each root's real crossings are measured.
  const analysis = createTsProgram(candidates.map(abs), parsed, overlay);
  const crossings: Record<string, string[]> = {};
  const closures = new Map<string, Set<string>>();
  for (const root of candidates) {
    const closure = closureOf(abs(root), analysis.edges);
    closures.set(root, closure);
    const hits = [...new Set([...closure].flatMap(crossed))];
    if (hits.length > 0) crossings[root] = BOUNDARIES.map((b) => b.id).filter((id) => hits.includes(id));
  }

  const admitted = candidates.filter((r) => !(r in excluded));
  const reach = new Set(admitted.flatMap((r) => [...closures.get(r)!]));
  // Only the overlay entries the admitted roots reach: an excluded root's planted text is read above.
  const scopedOverlay = Object.fromEntries(Object.entries(overlay).filter(([p]) => reach.has(canonical(p))));
  const scoped = admitted.length > 0 ? createTsProgram(admitted.map(abs), parsed, scopedOverlay) : undefined;
  const files = scoped ? scoped.program.getSourceFiles().filter((f) => isProjectFile(canonical(f.fileName))) : [];
  return {
    candidates,
    admitted,
    excluded,
    crossings,
    closure: files.map((f) => relToApp(f.fileName)).sort(),
    boundaryFiles: files.filter((f) => crossed(canonical(f.fileName)).length > 0)
      .map((f) => ({ file: relToApp(f.fileName), boundaries: crossed(canonical(f.fileName)) })),
    diagnostics: scoped ? ts.getPreEmitDiagnostics(scoped.program) : [],
    unreached: files.filter((f) => !reach.has(canonical(f.fileName))).map((f) => relToApp(f.fileName)).sort(),
  };
}

/** Every reason the scoped check fails; empty when it passes. */
export function scopedFailures(r: ScopedResult): string[] {
  const out: string[] = [];
  if (r.admitted.length === 0) out.push('no admitted roots: the scoped program checks nothing');
  for (const root of r.admitted) {
    if (r.crossings[root]) out.push(`admitted root ${root} crosses ${r.crossings[root].join(', ')}: fix the import or pin it in EXCLUDED_ROOTS with its reason`);
  }
  for (const [root, pinned] of Object.entries(r.excluded)) {
    if (!r.candidates.includes(root)) { out.push(`exclusion of ${root} is stale: no such root`); continue; }
    const actual = r.crossings[root] ?? [];
    if (JSON.stringify([...pinned].sort()) !== JSON.stringify([...actual].sort())) {
      out.push(`exclusion of ${root} is stale: pinned ${JSON.stringify(pinned)}, crosses ${JSON.stringify(actual)}`);
    }
  }
  for (const id of BOUNDARIES.map((b) => b.id)) {
    const inside = r.boundaryFiles.filter((f) => f.boundaries.includes(id)).map((f) => f.file);
    if (inside.length > 0) out.push(`the scoped program enters ${id}: ${inside.join(', ')}`);
  }
  if (r.unreached.length > 0) out.push(`the recorded import edges miss files the program loaded: ${r.unreached.join(', ')}`);
  if (r.diagnostics.length > 0) out.push(`scoped tsc reports ${r.diagnostics.length} diagnostics:\n${formatDiagnostics(r.diagnostics)}`);
  return out;
}
