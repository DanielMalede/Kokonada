'use strict';

// OPS-465 and OPS-466 (/review-pr #234 @ 95d87b7: RA-234-1, AR-234-1, CU-234-1 to CU-234-4, CU-234-6, RA-234-2).
// merge-guard (`.claude/agents/merge-guard.md`) judges CI by the check runs of `.github/workflows/ci.yml`'s jobs,
// and when CI was split into shards its text kept the single jobs' shape: 3a's grep printed the matrix templates
// (`… shard ${{ matrix.shard }}/8`), which match no check run; 3e accepted two skips, while a third job, the sweep
// shards, is skipped on every PR the sweeps filter does not match; step 4 held the shards to an unsharded run CI
// does not have. A merge-guard that follows its text to the letter then goes RED on every ordinary PR. This file
// reads both files as they are, so the next job, matrix or gate added to ci.yml fails here until merge-guard names
// it. The mutations it must catch, each marked where it is caught:
//   M1 a job that a job-level `if:` can skip, or its condition, or the detector and filter behind it, left out of
//      3e; M2 a skipped matrix job accepted under one of its two names only; M3 the "inert before #234" sentence
//      back; M4 3a's grep printing a template without the list it expands over; M5 3a not saying to expand a matrix
//      name, or leaving one unexpanded; M6 3a's list or counts not ci.yml's; M7 step 4 adding the shards up to an
//      unsharded run, or not naming the test that proves they partition the suite; M8 a jest job whose summary
//      step 4 does not read; M9 a gate whose result line step 4 does not hold it to; M10 a detector job's comment
//      that does not name the jobs its output gates.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const tick = (s) => `\`${s}\``;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unquote = (s) => (/^'.*'$/.test(s) ? s.slice(1, -1).replace(/''/g, "'") : (/^".*"$/.test(s) ? s.slice(1, -1) : s));
const splitList = (inner) => inner.split(',').map((v) => unquote(v.trim())).filter((v) => v !== '');
const isComment = (line) => /^\s*#/.test(line);
const indentOf = (line) => line.match(/^ */)[0].length;
function between(text, from, to) {
  const a = text.indexOf(from);
  if (a < 0) return '';
  const b = text.indexOf(to, a + from.length);
  return b < 0 ? '' : text.slice(a + from.length, b);
}

// ------------------------------------------------------------------ the check runs a job reports

const MATRIX_REF = /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g;
const refsOf = (name) => [...new Set([...name.matchAll(MATRIX_REF)].map((m) => m[1]))];
// A matrix job's check runs: GitHub puts each value where its expression stood, one run per combination. A template
// whose values were not read stays as it is, so a comparison shows it instead of losing it.
function expandName(name, matrix) {
  let names = [name];
  for (const key of refsOf(name)) {
    if (!matrix[key]) return [name];
    const expr = new RegExp(`\\$\\{\\{\\s*matrix\\.${key}\\s*\\}\\}`, 'g');
    names = names.flatMap((n) => matrix[key].map((v) => n.replace(expr, v)));
  }
  return names;
}
// 3a's procedure on its grep's output: a `name:` line starts a job, a `<key>: [...]` line after it is the list its
// template expands over. Any other line is refused, since 3a would hand it to the reader as if it were one of these.
function expandGrep(lines) {
  const out = [];
  let job = null;
  const flush = () => { if (job) out.push(...expandName(job.name, job.matrix)); };
  for (const line of lines) {
    const name = line.match(/^ {4}name: (.*)$/);
    const list = line.match(/^ +([\w-]+): \[(.*)\]\s*$/);
    if (name) {
      flush();
      job = { name: unquote(name[1].trim()), matrix: {} };
    } else if (list && job) {
      job.matrix[list[1]] = splitList(list[2]);
    } else {
      throw new Error(`3a's grep printed a line that is neither a job's name nor a matrix list: ${line}`);
    }
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ ci.yml, read as lines

// Read as lines, the way the other workflow pins in this directory read it. Each count is checked against a plain
// grep in the first test, so a job this parser cannot see fails there instead of passing every other test.
const CI_LINES = read('.github/workflows/ci.yml').split('\n');

function parseJobs(lines) {
  const jobsAt = lines.indexOf('jobs:');
  if (jobsAt < 0) throw new Error('ci.yml has no `jobs:` line');
  const after = lines.findIndex((l, i) => i > jobsAt && /^[^\s#]/.test(l));
  const end = after < 0 ? lines.length : after;
  const keys = [];
  for (let i = jobsAt + 1; i < end; i += 1) if (/^ {2}[\w-]+:\s*$/.test(lines[i])) keys.push(i);
  return keys.map((at, k) => {
    const to = k + 1 < keys.length ? keys[k + 1] : end;
    const block = lines.slice(at + 1, to).map((text, j) => ({ text, at: at + 1 + j }));
    const own = (key) => block.find(({ text }) => text.startsWith(`    ${key}:`));
    const value = (key) => {
      const hit = own(key);
      return hit ? unquote(hit.text.slice(`    ${key}:`.length).trim()) : undefined;
    };
    const unread = [];
    // strategy.matrix, each key an inline list on its own line.
    const matrix = {};
    const matrixLines = [];
    const matrixAt = block.findIndex(({ text }) => /^ {6}matrix:\s*$/.test(text));
    if (matrixAt >= 0) {
      for (const { text, at: line } of block.slice(matrixAt + 1)) {
        if (!text.trim() || isComment(text)) continue;
        if (indentOf(text) <= 6) break;
        const list = text.match(/^ {8}([\w-]+): \[(.*)\]\s*$/);
        if (list) {
          matrix[list[1]] = splitList(list[2]);
          matrixLines.push(line);
        } else if (indentOf(text) === 8) {
          unread.push(`a matrix entry that is not an inline list: ${text.trim()}`);
        }
      }
    }
    const name = value('name');
    const refs = name === undefined ? [] : refsOf(name);
    refs.filter((r) => !matrix[r]).forEach((r) => unread.push(`no values read for matrix.${r}`));
    // GitHub names a matrix job without an expression in its name `<name> (<values>)`; nothing here models that.
    if (matrixAt >= 0 && refs.length === 0) unread.push('a matrix job whose name holds no matrix expression');
    const ifValue = value('if');
    const needsRaw = value('needs');
    if (needsRaw === '') unread.push('a needs list this parser cannot read');
    let needs = [];
    if (needsRaw) needs = /^\[.*\]$/.test(needsRaw) ? splitList(needsRaw.slice(1, -1)) : [needsRaw];
    const code = block.map(({ text }) => text).filter((text) => !isComment(text));
    const neededEnv = code.map((text) => text.match(/^\s+NEEDED:\s*(.*)$/)).find(Boolean);
    const comment = [];
    for (let i = at - 1; i >= 0 && /^ {2}#/.test(lines[i]); i -= 1) comment.unshift(lines[i].replace(/^ {2}#\s?/, ''));
    return {
      id: lines[at].trim().slice(0, -1),
      name,
      nameAt: own('name') ? own('name').at : -1,
      if: ifValue,
      // The detector jobs a job-level `if:` reads, and the output it reads of each.
      reads: ifValue === undefined ? [] : [...ifValue.matchAll(/needs\.([\w-]+)\.outputs\.([\w-]+)/g)].map((m) => ({ job: m[1], output: m[2] })),
      needs,
      matrixLines,
      refs,
      values: refs.length === 1 ? matrix[refs[0]] || [] : null,
      expanded: name === undefined ? [] : expandName(name, matrix),
      placeholder: name === undefined ? undefined : name.replace(MATRIX_REF, '<i>'),
      runsJest: code.some((text) => /node_modules\/\.bin\/jest\b|\bnpm test\b/.test(text)),
      gate: code.some((text) => text.includes('needed jobs ended:')),
      neededEnv: neededEnv ? unquote(neededEnv[1].trim()) : undefined,
      comment: comment.join(' '),
      unread,
    };
  });
}

const JOBS = parseJobs(CI_LINES);
function job(id) {
  const found = JOBS.find((j) => j.id === id);
  if (!found) throw new Error(`ci.yml has no job ${id}`);
  return found;
}
// A matrix job named once per value: every expanded name, or for consecutive numbers the range `first` to `last`.
const consecutive = (values) => Array.isArray(values) && values.length > 1
  && values.every((v, i) => /^\d+$/.test(v) && (i === 0 || Number(v) === Number(values[i - 1]) + 1));
const namesEveryValue = (text, j) => j.expanded.every((n) => text.includes(tick(n)))
  || (consecutive(j.values) && text.includes(`${tick(j.expanded[0])} to ${tick(j.expanded[j.expanded.length - 1])}`));

// ------------------------------------------------------------------ merge-guard.md, by step

const MG_LINES = read('.claude/agents/merge-guard.md').split('\n');
const PRE = MG_LINES.slice(MG_LINES.findIndex((l) => l.startsWith('PRE-MERGE')), MG_LINES.findIndex((l) => l.startsWith('POST-MERGE')));
function stepOf(lines, startRe, nextRe) {
  const a = lines.findIndex((l) => startRe.test(l));
  if (a < 0) return '';
  const b = lines.findIndex((l, i) => i > a && nextRe.test(l));
  return lines.slice(a, b < 0 ? lines.length : b).join('\n');
}
const STEP3 = stepOf(PRE, /^3\. /, /^\d+\. /);
const partOf = (letter) => stepOf(STEP3.split('\n'), new RegExp(`^ {3}${letter}\\. `), /^ {3}[a-z]\. /);
const A = partOf('a');
const E = partOf('e');
const S4 = stepOf(PRE, /^4\. /, /^\d+\. /);

// What GitHub reported for this workflow's jobs on PR #234 at 95d87b7 (run 45070672712), and the lines 3a's grep
// prints from that commit's ci.yml: the oracle for 3a's expansion rule.
const RECORDED_GREP = [
  '    name: Security — gitleaks secret scan',
  '    name: Backend — lint & test',
  '    name: Mobile — jest shard ${{ matrix.shard }}/8',
  '        shard: [1, 2, 3, 4, 5, 6, 7, 8]',
  '    name: Mobile — design-system lint and Design Lab exclusion',
  '    name: Mobile — jest',
  '    name: Mobile — Android compile check',
  '    name: Detect iOS-affecting changes',
  '    name: Mobile — iOS build',
  "    name: Detect changes to the never-red sweeps' inputs",
  '    name: Mobile — never-red sweeps shard ${{ matrix.shard }}/4',
  '        shard: [1, 2, 3, 4]',
  '    name: Mobile — never-red sweeps at full resolution',
];
const RECORDED_RUNS = [
  'Mobile — Android compile check', 'Mobile — jest shard 6/8', 'Security — gitleaks secret scan',
  "Detect changes to the never-red sweeps' inputs", 'Backend — lint & test',
  'Mobile — design-system lint and Design Lab exclusion', 'Mobile — jest shard 2/8', 'Mobile — jest shard 1/8',
  'Mobile — jest shard 4/8', 'Detect iOS-affecting changes', 'Mobile — jest shard 7/8', 'Mobile — jest shard 3/8',
  'Mobile — jest shard 5/8', 'Mobile — jest shard 8/8', 'Mobile — iOS build', 'Mobile — never-red sweeps shard 2/4',
  'Mobile — never-red sweeps shard 1/4', 'Mobile — never-red sweeps shard 4/4', 'Mobile — never-red sweeps shard 3/4',
  'Mobile — jest', 'Mobile — never-red sweeps at full resolution',
];

describe('the two files as read here', () => {
  test('the parse sees the whole of ci.yml: every job, name, job-level if: and matrix that a plain grep counts', () => {
    const count = (re) => CI_LINES.filter((l) => re.test(l)).length;
    expect(JOBS.length).toBeGreaterThan(5);
    // Every job names its check run: a job without `name:` reports its key, which 3a's grep does not print.
    expect(JOBS.filter((j) => j.name !== undefined)).toHaveLength(JOBS.length);
    expect(JOBS).toHaveLength(count(/^ {4}name: /));
    expect(JOBS.filter((j) => j.if !== undefined)).toHaveLength(count(/^ {4}if: /));
    expect(JOBS.filter((j) => j.matrixLines.length > 0)).toHaveLength(count(/^ {6}matrix:\s*$/));
    expect(JOBS.filter((j) => j.if !== undefined).length).toBeGreaterThan(0);
    expect(JOBS.filter((j) => j.refs.length > 0).length).toBeGreaterThan(0);
    for (const j of JOBS) expect([j.id, j.unread]).toEqual([j.id, []]);
  });

  test('merge-guard.md has the steps this file reads: 3a, 3e and 4', () => {
    [A, E, S4].forEach((part) => expect(part).not.toBe(''));
    expect(A.startsWith('   a. ')).toBe(true);
    expect(E.startsWith('   e. ')).toBe(true);
    expect(S4.startsWith('4. WHAT ACTUALLY RAN')).toBe(true);
  });

  test("3a's expansion rule, applied to the grep of ci.yml at 95d87b7, gives exactly the check runs GitHub reported", () => {
    expect(expandGrep(RECORDED_GREP).sort()).toEqual([...RECORDED_RUNS].sort());
  });
});

describe('3e · the acceptable skips are every skip that a job-level if: in ci.yml can make (OPS-465)', () => {
  test('3e names every job with a job-level if:, a matrix job under its template and under its per-value names', () => {
    const withIf = JOBS.filter((j) => j.if !== undefined);
    const unnamed = withIf.filter((j) => !E.includes(tick(j.name)) || (j.refs.length > 0 && !namesEveryValue(E, j)));
    expect(unnamed.map((j) => j.id)).toEqual([]); // M1, M2
  });

  test('3e quotes the condition of every job-level if:', () => {
    const unquoted = JOBS.filter((j) => j.if !== undefined)
      .filter((j) => !E.includes(tick(`if: ${j.if}`)) && !E.includes(tick(j.if)));
    expect(unquoted.map((j) => `${j.id}: ${j.if}`)).toEqual([]); // M1
  });

  test('3e judges each skip against its detector and the filter behind it', () => {
    const missing = JOBS.flatMap((j) => j.reads.map((r) => ({ id: j.id, detector: job(r.job), output: r.output })))
      .filter(({ detector, output }) => !E.includes(`${tick(detector.name)} = \`success\``) || !E.includes(`the \`${output}:\` filter`));
    expect(missing.map(({ id, detector }) => `${id} ← ${detector.id}`)).toEqual([]); // M1
  });

  test('when the sweeps filter matched, every sweep shard and the gate must succeed; the "inert" sentence is gone', () => {
    const shards = job('mobile-sweeps-shard');
    expect(E).toContain(`If the PR's changed paths match the \`sweeps:\` filter in \`ci.yml\` at H, every ${tick(shards.placeholder)} and the gate must be \`success\`: a skip, a run under the template name or any other conclusion is \`RED (FAILING)\`.`);
    expect(E).not.toMatch(/\binert\b/); // M3
    expect(E).not.toContain('before #234 merges'); // M3
  });
});

describe('3a · the expected check runs are the names GitHub reports, each matrix expanded (OPS-465)', () => {
  test("3a's grep, run over ci.yml, prints every job's name and, after each matrix template, the list it expands over", () => {
    const pattern = (A.match(/grep -E '([^']+)'/) || [])[1];
    expect(pattern).toBeDefined();
    // ERE and JavaScript read it alike: its only escape is \[.
    expect(pattern).not.toMatch(/\\[^[]/);
    const re = new RegExp(pattern);
    const printed = CI_LINES.map((text, at) => ({ text, at })).filter(({ text }) => re.test(text));
    const known = new Set(JOBS.flatMap((j) => [j.nameAt, ...j.matrixLines]));
    expect(printed.filter(({ at }) => !known.has(at)).map(({ text }) => text)).toEqual([]);
    expect(expandGrep(printed.map(({ text }) => text))).toEqual(JOBS.flatMap((j) => j.expanded)); // M4
  });

  test('3a says to expand each matrix name over its values, and leaves no template unexpanded', () => {
    expect(A).toMatch(/\bmatrix\b[^.]*\bexpand\b|\bexpand\b[^.]*\bmatrix\b/i); // M5
    expect(A).not.toContain('${{'); // M5
  });

  test("3a's list of today's check runs is ci.yml's: every job by name, each matrix expanded, and the counts", () => {
    const today = between(A, 'Today, at H, ', '. ');
    expect(today).not.toBe('');
    expect(today).toContain(`${JOBS.length} jobs report ${JOBS.flatMap((j) => j.expanded).length} check runs`); // M6
    const unnamed = JOBS.filter((j) => (j.refs.length > 0 ? !namesEveryValue(today, j) : !today.includes(tick(j.name))));
    expect(unnamed.map((j) => j.id)).toEqual([]); // M6
  });
});

describe('4 · what each jest job and each gate must print (OPS-466)', () => {
  test('step 4 adds the shards up to no unsharded run, and names the test that proves they partition the suite', () => {
    expect(S4).not.toMatch(/add up to/); // M7
    const proof = 'mobile/KokonadaHealth/scripts/jest/__tests__/ciShards.test.ts';
    expect(S4).toContain(tick(proof)); // M7
    // The test it names is real, and asks jest whether every suite lands in one shard.
    expect(read(proof)).toContain('no suite in two shards, no suite in none');
  });

  test('step 4 reads the summary of every job that runs jest, and holds each default-config shard to an all-passed Test Suites: line', () => {
    const jest = JOBS.filter((j) => j.runsJest);
    expect(jest.length).toBeGreaterThan(1);
    const unread = jest.filter((j) => !S4.includes(tick(j.refs.length > 0 ? j.placeholder : j.name)));
    expect(unread.map((j) => j.id)).toEqual([]); // M8
    expect(S4).toContain("grep -E 'Test Suites: |Tests: |needed jobs ended: '");
    const shards = job('mobile-jest-shard');
    expect(shards.expanded).toHaveLength(8);
    expect(S4).toContain(`Each of the eight ${tick(shards.placeholder)} must print a \`Tests:\` line and a \`Test Suites:\` line whose suites are more than zero and all passed (\`Test Suites: <n> passed, <n> total\``);
  });

  test('step 4 holds every gate to the line it prints when each job it needs succeeded, and each sweep shard to a Tests: line when the filter fired', () => {
    const gates = JOBS.filter((j) => j.gate);
    expect(gates.length).toBeGreaterThan(1);
    for (const g of gates) {
      // The count the gate's script holds the results to, so the line below is the one it prints.
      expect([g.id, g.neededEnv]).toEqual([g.id, String(g.needs.length)]);
      const line = `needed jobs ended: ${g.needs.map(() => 'success').join(' ')} (${g.needs.length} expected)`;
      // Each gate held to its own line in one sentence: both gates print the same line, and each is also named in
      // a disclosure, so finding the name and the line apart would pass with either gate's rule gone.
      const holds = new RegExp(`${escapeRe(tick(g.name))}[^.]*\\bmust read ${escapeRe(tick(line))}`);
      expect([g.id, holds.test(S4)]).toEqual([g.id, true]); // M9
    }
    const shards = job('mobile-sweeps-shard');
    expect(shards.expanded).toHaveLength(4);
    expect(S4).toContain(`When the sweeps filter fired (3e), each of the four ${tick(shards.placeholder)} must print a \`Tests:\` line`); // M8
  });
});

describe("ci.yml · a detector job's comment names the jobs its output gates (OPS-465)", () => {
  test('the comment above each detector job names every job whose if: reads its output', () => {
    const detectors = [...new Set(JOBS.flatMap((j) => j.reads.map((r) => r.job)))];
    expect(detectors.length).toBeGreaterThan(1);
    for (const d of detectors) {
      const gated = JOBS.filter((j) => j.reads.some((r) => r.job === d)).map((j) => j.id);
      const { comment } = job(d);
      const unnamed = gated.filter((id) => !new RegExp(`(^|[^\\w-])${id}([^\\w-]|$)`).test(comment));
      expect([d, unnamed]).toEqual([d, []]); // M10
    }
  });
});
