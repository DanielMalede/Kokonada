/// <reference types="node" />
// The RETIRE signature rule (DEC-091, refined by DEC-142): a RETIRE entry is signed only by a DECIDED
// DEC that is not the rule itself. retire.ts re-exports it for the jest guards; QA-041's CLI (OPS-412)
// loads it under plain Node 24 by type stripping, outside jest. So this module imports only Node
// builtins by their node: names, reads no __dirname, never loads typescript, and keeps to erasable
// syntax (no enum, no namespace, no parameter property).

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Structurally the entry in src/__contracts__/retire.ts (that file imports nothing). */
export interface RetireEntry { kind: 'file' | 'pin'; target: string; dec: string; reason: string }

export type DecStatus = (dec: string) => string | null;

/** A decision id: DEC- and three digits or more (#291 audit RA-8). */
export const DEC_ID = /^DEC-\d{3,}$/;
/** The RETIRE rule (DEC-091) and its refinement (DEC-142) say who signs; they are never the signature (#291 audit RA-2). */
export const RULE_DECS: ReadonlySet<string> = new Set(['DEC-091', 'DEC-142']);

/** The `status:` of a decision record's front matter, or null when there is none. CRLF and CR read as LF, as normalizeEol in ./contracts does. */
export function parseDecStatus(text: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n?/g, '\n'));
  if (!m) return null;
  const s = /^status:\s*(\S+)\s*$/m.exec(m[1]);
  return s ? s[1] : null;
}

/** The status of `<dir>/<dec>.md`, or null when the id is malformed or the file is missing. */
export function readDecStatus(dec: string, dir: string): string | null {
  if (!DEC_ID.test(dec)) return null;
  const file = path.join(dir, `${dec}.md`);
  return fs.existsSync(file) ? parseDecStatus(fs.readFileSync(file, 'utf8')) : null;
}

/** One failure line per RETIRE entry that is not a valid signature; [] when all are. */
export function checkRetireEntries(entries: readonly RetireEntry[], decStatus: DecStatus): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const who = `RETIRE ${e.kind} ${e.target}`;
    const key = `${e.kind}\u0000${e.target}`;
    if (seen.has(key)) { failures.push(`${who}: named twice`); continue; }
    seen.add(key);
    if (!DEC_ID.test(e.dec)) { failures.push(`${who}: ${e.dec} is not a DEC-nnn id`); continue; }
    if (RULE_DECS.has(e.dec)) { failures.push(`${who}: ${e.dec} is the RETIRE rule itself, not a signature`); continue; }
    const status = decStatus(e.dec);
    if (status === null) failures.push(`${who}: ${e.dec} does not exist`);
    else if (status !== 'DECIDED') failures.push(`${who}: ${e.dec} is ${status}, not DECIDED`);
    if (e.reason.trim() === '') failures.push(`${who}: no reason`);
  }
  return failures;
}
