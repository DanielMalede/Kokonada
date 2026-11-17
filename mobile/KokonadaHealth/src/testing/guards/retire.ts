/// <reference types="node" />
// QA-118 and the RETIRE rule (Stage 0 Q1). A v1 test that locks old pixels, timings or reversed
// behaviour is deleted only with a RETIRE entry citing a DECIDED DEC (DEC-091, refined by DEC-142);
// editing its expected value to a v2 value is forbidden. A pin is a window of consecutive statements
// inside a test named by file and full name, recorded as the SHA-256 of its text (CRLF read as LF):
// a hash, because the pinned text carries colour literals the design-system lint bans outside
// src/design. A pin whose test is present must hash the same, so a re-point is always red; a pin whose
// test is gone needs a RETIRE entry; a RETIRE entry for a pin still in place is red.

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { indexTests, normalizeEol } from './contracts';
import { APP_ROOT } from './productionImports';

export const REPO_ROOT = path.resolve(APP_ROOT, '../..');
export const DECISIONS_DIR = path.join(REPO_ROOT, 'docs/design-v2/decisions');

/** Structurally the entry in src/__contracts__/retire.ts (that file imports nothing). */
export interface RetireEntry { kind: 'file' | 'pin'; target: string; dec: string; reason: string }

/** Structurally the pin in src/__contracts__/pins.ts. `file` is relative to the repository root. */
export interface Pin { id: string; file: string; fullTitle: string; statements: number; sha256: string; description: string; ref: string }

export type DecStatus = (dec: string) => string | null;

const DEC_ID = /^DEC-\d{3,}$/;
/** The RETIRE rule (DEC-091) and its refinement (DEC-142) say who signs; they are never the signature (#291 audit RA-2). */
export const RULE_DECS: ReadonlySet<string> = new Set(['DEC-091', 'DEC-142']);

/** The `status:` of a decision record's front matter, or null when there is none. */
export function parseDecStatus(text: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(normalizeEol(text));
  if (!m) return null;
  const s = /^status:\s*(\S+)\s*$/m.exec(m[1]);
  return s ? s[1] : null;
}

/** The status of docs/design-v2/decisions/<dec>.md, or null when the id is malformed or the file is missing. */
export function readDecStatus(dec: string, dir: string = DECISIONS_DIR): string | null {
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

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The text of every window of `n` consecutive statements in any statement list inside `fn`. */
export function statementWindows(fn: ts.Node, source: string, n: number): string[] {
  const out: string[] = [];
  const lists: ts.NodeArray<ts.Statement>[] = [];
  const visit = (x: ts.Node): void => {
    if (ts.isBlock(x) || ts.isCaseClause(x) || ts.isDefaultClause(x) || ts.isModuleBlock(x)) lists.push(x.statements);
    ts.forEachChild(x, visit);
  };
  visit(fn);
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body) && n === 1) out.push(source.slice(fn.body.getStart(), fn.body.getEnd()));
  for (const list of lists) {
    for (let i = 0; i + n <= list.length; i += 1) out.push(source.slice(list[i].getStart(), list[i + n - 1].getEnd()));
  }
  return out;
}

export type PinState = 'held' | 'changed' | 'skipped' | 'absent';

/** Where a pin stands in a source: its test is gone, skipped, present with the pinned text, or present without it. */
export function pinState(pin: Pin, source: string): PinState {
  const text = normalizeEol(source);
  const tests = indexTests(text, pin.file).filter((t) => !t.dynamic && t.fullName === pin.fullTitle);
  if (tests.length === 0) return 'absent';
  const live = tests.filter((t) => !t.skipped);
  if (live.length === 0) return 'skipped';
  const held = live.some((t) => t.call.arguments.slice(1)
    .some((fn) => statementWindows(fn, text, pin.statements).some((w) => sha256(w) === pin.sha256)));
  return held ? 'held' : 'changed';
}

/** QA-118: one failure line per pin or pin RETIRE entry that breaks the rule; [] when none does. */
export function checkPins(
  pins: readonly Pin[],
  read: (repoRelativeFile: string) => string | null,
  retire: readonly RetireEntry[],
  decStatus: DecStatus,
): string[] {
  const entries = retire.filter((e) => e.kind === 'pin');
  const failures = checkRetireEntries(entries, decStatus);
  const ids = new Set<string>();
  const unique: Pin[] = [];
  for (const p of pins) {
    if (ids.has(p.id)) failures.push(`pin ${p.id}: listed twice`);
    else { ids.add(p.id); unique.push(p); }
  }
  for (const e of entries) if (!ids.has(e.target)) failures.push(`RETIRE pin ${e.target}: no such pin`);
  for (const p of unique) {
    const source = read(p.file);
    const state: PinState = source === null ? 'absent' : pinState(p, source);
    const retired = entries.some((e) => e.target === p.id);
    const title = JSON.stringify(p.fullTitle);
    if (state === 'absent') {
      if (!retired) failures.push(`pin ${p.id}: ${title} is gone from ${p.file} with no RETIRE entry`);
    } else if (retired) {
      failures.push(`pin ${p.id}: a RETIRE entry names it, but ${title} is still in ${p.file}`);
    } else if (state === 'skipped') {
      failures.push(`pin ${p.id}: ${title} in ${p.file} is skipped (retire it with a RETIRE entry instead)`);
    } else if (state === 'changed') {
      failures.push(`pin ${p.id}: the pinned assertion in ${p.file} ${title} changed (a v1 pin is retired with a RETIRE entry, never re-pointed)`);
    }
  }
  return failures;
}
