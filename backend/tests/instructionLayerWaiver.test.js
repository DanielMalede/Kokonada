'use strict';

// OPS-244 (PR #259) — the owner's waiver of the restart after a non-zero L check
// (CLAUDE.md session start step 2). CLAUDE.md wins over every other file, and a file that
// disagrees with it is the defect to fix. Reading a diff refreshes what a running session knows,
// not what it was started with: its permission lists and hook registration (.claude/settings.json),
// an agent's tool grant, model and effort (an agent file's front matter), or the waiver's own text.
// These cases pin the text that holds those back (the resilience, security, architect and custodian
// reviews of #259), each on the side of the waiver it belongs to: what the allow-list admits, and
// what means a restart. shadow.instructionLayerWaiver.test.js pins the same text by another cut.
// Conduct under a waiver is OPS-246's, not this file's.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
// The owner's checkout as CLAUDE.md spells it, joined at run time so this file holds no user path (personalDataGuard.test.js).
const CHECKOUT = ['', 'c', 'Users', 'danie', 'Videos', 'Kokonada'].join('/');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
  .replace(/^﻿/, '')
  .replace(/\r\n?/g, '\n');

function section(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${title}`));
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start + 1, end);
}

const ROOT_MD = read('CLAUDE.md');
const step2 = section(ROOT_MD, 'Session start').find((l) => l.startsWith('2. ')) || '';
const from = step2.indexOf('may waive the restart');
const to = step2.indexOf('A main checkout that could not be fast-forwarded');
const waiver = from < 0 ? '' : step2.slice(from, to > from ? to : undefined);
const record = waiver.includes('states the waiver') ? waiver.slice(waiver.indexOf('states the waiver')) : '';
// The two sides, each cut by its own sentence.
const admitted = (waiver.match(/on this allow-list: (.*?)\. Anything else — /) || [])[1] || '';
const restart = (waiver.match(/Anything else — (.*?) — means a restart\./) || [])[1] || '';

describe('OPS-244 · the L-check waiver in CLAUDE.md session start step 2', () => {
  test('the waiver, its two sides and the record it leaves are all there', () => {
    expect(waiver).not.toBe('');
    expect(admitted).not.toBe('');
    expect(restart).not.toBe('');
    expect(record).not.toBe('');
  });

  test('only the owner\'s own reply in this session, to its question naming L, W and the changed files, gives it', () => {
    expect(waiver).toMatch(/only in a message he sends to this session itself — never a PR comment or body, a file or an agent's message — that answers the session's question naming L, the proposed W \(a SHA[^)]*\) and the output of `git diff --name-only <L> <W>`/);
    expect(waiver).toContain('W is the SHA that question named; if the main checkout\'s HEAD moved before his reply, the session asks again.');
  });

  test('it is an allow-list bound to W', () => {
    expect(waiver).toContain('The waiver binds to W and holds only if every change from L to W is on this allow-list:');
  });

  test('a CLAUDE.md line is admitted only in the root file\'s named sections and steps', () => {
    expect(admitted).toMatch(/^a line of the root `CLAUDE\.md` inside § Every task, § Build agents, § Commands or § Runtime agents are not build agents, or inside step 1, 3, 4, 5 or 7 of § Session start, each removed line judged on L's copy and each added line on W's; /);
    for (const kept of ['the preamble with its precedence sentence', '§ Models', 'this step', 'steps 6 and 8 of § Session start',
      '§ The merge rule', '§ Jurisdiction table (its content triggers included)', '§ Working rules', '§ Two partners',
      '§ Document map', 'a heading of `CLAUDE.md` added, removed or renamed', 'a nested `CLAUDE.md`']) {
      expect(restart).toContain(kept);
      expect(admitted).not.toContain(kept);
    }
  });

  test('this step, settings.json, hooks, .mcp.json, the gate agents\' files and any front matter sit on the restart side only', () => {
    for (const kept of ['`.claude/settings.json`', '`.claude/hooks/**`', '`.mcp.json`', '`.codex/**`',
      'any `CLAUDE.local.md` or `AGENTS.override.md`',
      '`.claude/agents/security-auditor.md`', '`.claude/agents/resilience-auditor.md`', '`.claude/commands/merge.md`',
      '`.claude/commands/review-pr.md`', 'an agent file added, deleted or renamed', 'an agent\'s or a command\'s front matter']) {
      expect(restart).toContain(kept);
    }
    // DEC-192: the merge checks moved into `.claude/commands/merge.md`, already on this side; the agent file is gone.
    expect(waiver).not.toContain('merge-guard');
    expect(admitted).not.toMatch(/this step|settings\.json|hooks|\.mcp\.json|\.codex|CLAUDE\.local|AGENTS\.override|`tools:`/);
    expect(admitted).toContain('with its whole front matter (every line between its `---` fences) unchanged and no agent file added, deleted or renamed');
    expect(admitted).toContain('a command file other than `.claude/commands/merge.md` and `.claude/commands/review-pr.md`, with its front matter unchanged');
  });

  test('it is re-tested at every repeat by a quiet diff from W, and a lapse is final', () => {
    expect(waiver).toContain('At every repeat of the check (before each `/review-pr`, each PR of a `/merge` batch and each step 6 sweep) the waiver holds only while `git -C ' + CHECKOUT + ' diff --quiet <W> HEAD -- <this step\'s pathspec>` exits 0; any other exit, or a command that cannot run, ends it for good, so it lapses at the first change after W, including one the session merged itself.');
    expect(waiver).toContain('A lapsed waiver means a restart, and a fresh waiver needs a fresh question.');
  });

  test('an unknown L, an uncomputable diff or a stuck checkout means a restart', () => {
    expect(waiver).toContain('An unknown L, a diff that cannot be computed, or a main checkout that could not be fast-forwarded means a restart, never a waiver.');
  });

  test('the session follows W\'s CLAUDE.md, and its agents run as their own registered type, never through wider tools', () => {
    expect(waiver).toContain('While the waiver holds, the session itself is bound by W\'s lines of the root `CLAUDE.md`, and it dispatches each agent by its own registered type, never through a type with wider tools');
  });

  test('its record names L, W, HEAD and both file lists, on every PR it reviews, sweeps or merges', () => {
    expect(record).toContain('on every PR it reviews, sweeps or merges, in a comment of its own, not inside the approvals record');
    expect(record).toContain('`L-check waiver: session <id> · L <sha> · W <sha> · HEAD <sha> — "<his words>"`');
    expect(record).toContain('`git diff --name-only <L> <W>`');
    expect(record).toContain('`git diff --name-only <W> <HEAD>` (empty while the waiver holds)');
  });
});

describe('OPS-244 · each text that restates the L-check stop names the waiver', () => {
  const STOP = /until (?:it|the session) (?:restarts|is restarted)|must restart/;
  test.each([
    ['CLAUDE.md § The merge rule', () => section(ROOT_MD, 'The merge rule').join('\n')],
    ['.claude/commands/review-pr.md', () => read('.claude/commands/review-pr.md')],
    ['.claude/commands/merge.md', () => read('.claude/commands/merge.md')],
  ])('%s', (_name, text) => {
    const parts = text().split(/(?<=[.;])\s+/);
    const stops = parts
      .map((part, i) => ({ part, i }))
      .filter(({ part }) => STOP.test(part));
    expect(stops.length).toBeGreaterThan(0);
    for (const { part, i } of stops) {
      expect(`${part} ${parts[i + 1] || ''}`).toMatch(/waive/);
    }
  });
});

describe('OPS-244 · § Two partners lets a waived session\'s statement onto his PR', () => {
  test('the L-check waiver statement is one of the writes allowed on his PR', () => {
    expect(section(ROOT_MD, 'Two partners').join('\n')).toContain('the only writes on his PR are the approvals record, the `PRE-MERGE CHECK` and `POST-MERGE CHECK` records and a waived session\'s `L-check waiver:` statement (session start step 2) that `/review-pr` and the session start\'s post-merge sweep post.');
  });
});

// DEC-192 (#307, OPS-475) - the owner's rulings of 2026-11-23: the session runs the pre- and post-merge checks
// itself, from `.claude/commands/merge.md` § Checks, and the merge-guard agent and the hook that dispatched it are
// gone. These cases pin what replaced them: nothing names the agent any more; the procedure it carried keeps every
// rule, with OPS-389's owner-accepted neutral (#306's clause and pins, moved here with the procedure), step 8d's
// filter that gh's jq parses from Git Bash (OPS-374), step 7's whole commit list (OPS-464) and #234's shard-aware
// steps 3a, 3e and 4; and the records the session posts. #234's `shadow.mergeGuardSkips.test.js` pins 3a, 3e and 4
// against its sharded ci.yml once it merges.
const MERGE_MD = read('.claude/commands/merge.md');
const MERGE_LINES = MERGE_MD.split('\n');
const checksAt = MERGE_LINES.indexOf('## Checks');
const CHECKS = checksAt < 0 ? [] : MERGE_LINES.slice(checksAt + 1);
const CHECKS_TEXT = CHECKS.join('\n');
const FLOW = checksAt < 0 ? MERGE_MD : MERGE_LINES.slice(0, checksAt).join('\n');
// The lines from the first that starts with `from` up to the first after it that starts with `to` (or to the end).
function blockOf(lines, from, to) {
  const a = lines.findIndex((l) => l.startsWith(from));
  if (a < 0) return [];
  const b = to ? lines.findIndex((l, i) => i > a && l.startsWith(to)) : -1;
  return lines.slice(a, b < 0 ? lines.length : b);
}
const PRE = blockOf(CHECKS, 'PRE-MERGE (', 'POST-MERGE (');
const POST = blockOf(CHECKS, 'POST-MERGE (', 'THE RESULT.');
const STEP3 = blockOf(PRE, '3. CI ON H.', '4. WHAT ACTUALLY RAN');
const sub3 = (k) => STEP3.find((l) => l.startsWith(`   ${k}. `)) || '';
const STEP4 = blockOf(PRE, '4. WHAT ACTUALLY RAN', '5. CONFLICTS.').join('\n');
const STEP7 = blockOf(PRE, '7. DIFF SANITY.', '8. APPROVALS').join('\n');
const STEP8 = blockOf(PRE, '8. APPROVALS', null);
const sub8 = (k) => STEP8.find((l) => l.startsWith(`   ${k}. `)) || '';
const has = (text, ...phrases) => {
  for (const p of phrases) expect([p, text.includes(p)]).toEqual([p, true]);
};
// The instruction files a session or an agent loads.
function instructionFiles() {
  const list = (dir) => fs.readdirSync(path.join(REPO_ROOT, dir), { recursive: true })
    .map((f) => `${dir}/${String(f).replace(/\\/g, '/')}`).filter((f) => f.endsWith('.md'));
  return ['CLAUDE.md', 'AGENTS.md', 'docs/ORCHESTRATOR_FABLE.md', 'docs/plans/DESIGN_V2_PLAN.md',
    ...list('.claude/agents'), ...list('.claude/commands'), ...list('.agents')];
}

describe('DEC-192 · the merge-guard agent is gone, and nothing dispatches or requires it', () => {
  test('the agent, the hook that dispatched it, the hook\'s tests and their runner are deleted', () => {
    for (const gone of ['.claude/agents/merge-guard.md', '.claude/hooks/merge-guard-trigger.mjs',
      '.claude/hooks/merge-guard-trigger.test.mjs', 'backend/tests/mergeGuardHook.test.js']) {
      expect([gone, fs.existsSync(path.join(REPO_ROOT, gone))]).toEqual([gone, false]);
    }
  });

  test('no instruction file names the agent; only the old record marker `MERGE-GUARD` stays, as history', () => {
    const files = instructionFiles();
    expect(files).toContain('.claude/commands/merge.md');
    expect(files).toContain('.claude/agents/developer.md');
    // The agent's name, hyphenated or spaced; #234's test file `shadow.mergeGuardSkips.test.js` is not the agent.
    const naming = files.filter((f) => /merge[- ]guard/i.test(read(f).replace(/MERGE-GUARD/g, '')));
    expect(naming).toEqual([]);
  });

  test('the merge rule needs the session\'s own pre-merge check, recorded as PRE-MERGE CHECK, and a post-merge record', () => {
    const rule = section(ROOT_MD, 'The merge rule').join('\n');
    has(rule,
      'Step 8 of `.claude/commands/merge.md` § Checks is the exact procedure',
      '- the session\'s own pre-merge check (`.claude/commands/merge.md` § Checks) is GREEN at H on the current `origin/main` M, recorded on the PR, with its evidence, as `PRE-MERGE CHECK GREEN @ <H> on <M>`;',
      'its own pre- and post-merge checks (DEC-192) verify, never approve',
      '(`.claude/commands/merge.md` § Checks step 8f)',
      'After every merge, the session runs the post-merge check and posts `POST-MERGE CHECK <verdict> @ <S>`, with its evidence, on the merged PR.');
    // The one-time BOOTSTRAP for #231 dispatched the agent; #231 merged on 2026-10-08 (OPS-178).
    expect(rule).not.toContain('BOOTSTRAP');
  });

  test('session start step 6 sweeps for either post-merge record and runs the session\'s post-merge check', () => {
    const step6 = section(ROOT_MD, 'Session start').find((l) => l.startsWith('6. ')) || '';
    has(step6, '`POST-MERGE CHECK`', '`MERGE-GUARD post-merge`',
      'Run the post-merge check (`.claude/commands/merge.md` § Checks) on any that carries neither');
  });

  test('every task: no hook reminds the session, so it reads CI after each push and checks after each merge itself', () => {
    const step4 = section(ROOT_MD, 'Every task').find((l) => l.startsWith('4. ')) || '';
    has(step4, 'No hook reminds the session: after every push to a PR it reads CI on the new head to the end itself, and after every merge it runs the post-merge check (`.claude/commands/merge.md` § Checks); a red is fixed before the next task (DEC-143, DEC-192).');
  });

  test('/review-pr runs the pre-merge check itself and posts PRE-MERGE CHECK; AGENTS.md reads the same records', () => {
    const reviewPr = read('.claude/commands/review-pr.md');
    has(reviewPr, 'Step 8 of `.claude/commands/merge.md` § Checks is the procedure',
      'post its result, with its evidence, as a separate comment whose first line is `PRE-MERGE CHECK <GREEN | RED (<tags>)> @ <H> on <M>`',
      'owner accepts neutral: <check name> @ <H> — "<his own words>"');
    has(read('AGENTS.md'), '`PRE-MERGE CHECK GREEN @ <H> on <M>`', '`POST-MERGE CHECK <verdict> @ <S>`');
  });
});

describe('DEC-192 · `.claude/commands/merge.md` § Checks carries the whole procedure, run by the session', () => {
  test('the flow runs the checks itself and posts PRE-MERGE CHECK and POST-MERGE CHECK', () => {
    expect(checksAt).toBeGreaterThan(0);
    has(FLOW, 'step 8 of § Checks below is the exact procedure',
      'Run the pre-merge check (§ Checks, PRE-MERGE) on the PR at H yourself; merge only on GREEN, and post it with its evidence as `PRE-MERGE CHECK GREEN @ <H> on <M>`',
      'Then run the post-merge check (§ Checks, POST-MERGE) on the PR yourself; a RED stops the batch.',
      'After each merge, post the post-merge check\'s result with its evidence as `POST-MERGE CHECK <GREEN | RED (<tags>)> @ <S>` on the merged PR.');
  });

  test('PRE-MERGE steps 1-8 and POST-MERGE steps 1-6, in order, then the result, the record and what a RED asks', () => {
    // The first line of the file that starts with PRE-MERGE is the section's, and none before it starts with
    // POST-MERGE: #234's shadow.mergeGuardSkips.test.js cuts the steps out by those two lines.
    expect(MERGE_LINES.findIndex((l) => l.startsWith('PRE-MERGE'))).toBe(checksAt + 1 + CHECKS.findIndex((l) => l.startsWith('PRE-MERGE (')));
    expect(MERGE_LINES.findIndex((l) => l.startsWith('POST-MERGE'))).toBeGreaterThan(MERGE_LINES.findIndex((l) => l.startsWith('PRE-MERGE')));
    const order = (lines, titles) => titles.map((t) => lines.findIndex((l) => l.startsWith(t)));
    const pre = order(PRE, ['1. FACTS.', '2. BASE.', '3. CI ON H.', '4. WHAT ACTUALLY RAN', '5. CONFLICTS.', '6. MERGE WINDOW.', '7. DIFF SANITY.', '8. APPROVALS']);
    expect(pre.every((at, i) => at > 0 && (i === 0 || at > pre[i - 1]))).toBe(true);
    expect('abcdef'.split('').map((k) => sub3(k) !== '')).toEqual([true, true, true, true, true, true]);
    expect('abcdefg'.split('').map((k) => sub8(k) !== '')).toEqual([true, true, true, true, true, true, true]);
    const post = order(POST, ['1. FACTS.', '2. CONTENT EQUALITY.', '3. MAIN CI ON S.', '4. ONLY THE `CI` WORKFLOW COUNTS.', '5. THE WHOLE OF MAIN.', '6. ALWAYS NOT EXERCISED']);
    expect(post.every((at, i) => at > 0 && (i === 0 || at > post[i - 1]))).toBe(true);
    const tail = order(CHECKS, ['POST-MERGE (', 'THE RESULT.', 'THE RECORD.', 'ON RED.']);
    expect(tail.every((at, i) => at >= 0 && (i === 0 || at > tail[i - 1]))).toBe(true);
  });

  test('the records: first lines PRE-MERGE CHECK and POST-MERGE CHECK; the old MERGE-GUARD comments are records too, never approvals', () => {
    has(CHECKS_TEXT, '`PRE-MERGE CHECK <GREEN | RED (<TAG>[, <TAG>...])> @ <H> on <M>`',
      '`POST-MERGE CHECK <GREEN | RED (<TAG>[, <TAG>...])> @ <S>`',
      'The `PRE-MERGE CHECK` and `POST-MERGE CHECK` comments on the PR, like the `MERGE-GUARD` comments posted before DEC-192, are records, never approvals.');
  });

  test('the session runs main\'s copy, only reads while it checks, and runs the steps in Git Bash', () => {
    has(CHECKS_TEXT, 'It runs the copy of this section at M',
      'Never during the steps: `gh pr merge|close|reopen|edit|comment|review|ready|update-branch`',
      'Never check out over anyone\'s tree: read other commits with `git show <sha>:<path>`.',
      'Run the steps in Git Bash (the Bash tool).');
  });
});

describe('DEC-192 · OPS-389 in § Checks step 3f: an external check\'s neutral, accepted by the owner at H (#306\'s clause)', () => {
  const f = sub3('f');
  const LABEL = 'An owner-accepted neutral, beyond 3e\'s skips: ';
  const accepted = f.includes(LABEL) ? f.slice(f.indexOf(LABEL)) : '';

  test('step 3d sends an external check\'s neutral to 3f', () => {
    has(sub3('d'), 'External checks count the same (`GitGuardian Security Checks`): any failure is RED, except an owner-accepted neutral (3f).');
  });

  test('without all four conditions a neutral stays RED (UNVERIFIED), and only a neutral is ever accepted', () => {
    has(f, 'cancelled / stale / action_required / neutral / missing: `RED (UNVERIFIED)`.', LABEL);
    has(accepted, 'a check that ends `neutral` is not RED when all four hold, and only then',
      '(4) the check itself is `completed` + `neutral` with `head_sha` = H', 'any other conclusion keeps its tag above');
  });

  test('(1) only an external check: not a check run of ci.yml at M or at H, not a required status check of main\'s ruleset', () => {
    has(accepted, '(1) it is external: ', 'its name is not a check run of `ci.yml` at M or at H (3a\'s union)',
      'not a required status check of main\'s ruleset',
      '`gh api repos/{owner}/{repo}/rules/branches/main --jq \'.[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context\'`, which must exit 0');
  });

  test('(2) only with its acceptance line in the current record, at all 40 characters of H; a push needs a fresh one', () => {
    has(accepted, '(2) the current approvals record (8d) carries a line of the exact form',
      '`owner accepts neutral: <check name> @ <sha> — "<his words>"`',
      '`<check name>` is the check\'s exact name', '`<sha>` is H, all 40 characters',
      'an acceptance at any other SHA does not carry over, so every push needs a fresh one');
    has(sub8('d'), '`owner accepts neutral: <check name> @ <H> — "<his words>"` line (3f)');
  });

  test('(3) only when the gitleaks scan of the PR\'s commit range succeeded on H', () => {
    has(accepted, '(3) `Security — gitleaks secret scan` is `completed` + `success` with `head_sha` = H (it scans the PR\'s commit range)');
  });

  test('when it applies the check is NOT EXERCISED with the line quoted, not a finding, and the record\'s limit is stated', () => {
    has(accepted, 'list the check under NOT EXERCISED, quoting that line; it is not a finding',
      'The session can check the line\'s author, form and SHA, not that the words are the owner\'s', 'DEC-155');
  });

  test('post-merge, the acceptance never applies to S', () => {
    has(POST.find((l) => l.startsWith('3. MAIN CI ON S.')) || '', '3f\'s owner-accepted neutral does not apply to S: it names a PR\'s H and its record.');
  });
});

describe('DEC-192 · § Checks step 8d\'s filter parses in gh\'s jq from Git Bash (OPS-374), and step 7 reads every commit (OPS-464)', () => {
  test('8d builds the byte-order mark without a backslash, and matches it with whitespace before `Approvals for`', () => {
    has(sub8('d'), 'test("^[[:space:]" + ([65279] | implode) + "]*Approvals for")', '`[65279] | implode`');
    expect(sub8('d')).not.toContain('\\x{FEFF}');
    expect(sub8('d')).not.toContain('\\s');
  });

  test('no --jq filter in § Checks holds a backslash: Git Bash halves a doubled one on its way to gh', () => {
    const filters = [...CHECKS_TEXT.matchAll(/--jq '([^']*)'/g)].map((m) => m[1]);
    expect(filters.length).toBeGreaterThan(5);
    expect(filters.filter((q) => q.includes('\\'))).toEqual([]);
  });

  test('step 7 reads the message of every commit of B..H with git log, never gh\'s capped commit list', () => {
    has(STEP7, 'git log --format=%B "$B..$H"', 'never `gh pr view --json commits`, which returns at most 100 commits (`OPS-464`)');
    expect(CHECKS_TEXT).not.toContain('.commits[]');
  });
});

describe('DEC-192 · § Checks steps 3a, 3e and 4 read the sharded ci.yml (#234\'s wording, OPS-465, OPS-466)', () => {
  test('3a expands a matrix name over its values, and lists the check runs of #234\'s ci.yml', () => {
    has(sub3('a'), 'grep -E \'^    name: |^        [a-z0-9_-]+: \\[\'', 'expand it over the matrix list the grep prints after it',
      'Today, at H, 11 jobs report 21 check runs once both matrices expand');
    expect(sub3('a')).not.toContain('${{');
  });

  test('3e accepts the sweep shards\' skip under both names, and holds them and the gate to success when the filter fired', () => {
    const e = sub3('e');
    has(e, '`Mobile — never-red sweeps shard ${{ matrix.shard }}/4`',
      '`Mobile — never-red sweeps shard 1/4` to `Mobile — never-red sweeps shard 4/4`',
      'If the PR\'s changed paths match the `sweeps:` filter in `ci.yml` at H, every `Mobile — never-red sweeps shard <i>/4` and the gate must be `success`: a skip, a run under the template name or any other conclusion is `RED (FAILING)`.',
      '`backend/tests/shadow.mergeGuardSkips.test.js` fails while this step leaves out a job that a job-level `if:` in `ci.yml` can skip.');
    expect(e).not.toMatch(/\binert\b/);
  });

  test('3e names every job of ci.yml that a job-level if: can skip, with its condition', () => {
    const lines = read('.github/workflows/ci.yml').split('\n');
    const skippable = [];
    let name = null;
    for (const line of lines) {
      if (/^ {2}[\w-]+:\s*$/.test(line)) name = null;
      const n = line.match(/^ {4}name: (.*)$/);
      if (n) name = n[1].trim();
      const cond = line.match(/^ {4}if: (.*)$/);
      if (cond && name) skippable.push({ name, cond: cond[1].trim() });
    }
    expect(skippable.length).toBeGreaterThan(0);
    const e = sub3('e');
    const missing = skippable.filter(({ name: n, cond }) => !e.includes(`\`${n}\``) || !(e.includes(`\`if: ${cond}\``) || e.includes(`\`${cond}\``)));
    expect(missing).toEqual([]);
  });

  test('step 4 holds each jest shard and each gate to its own line, and the single jest job of an unsharded ci.yml to a summary', () => {
    has(STEP4, '`mobile/KokonadaHealth/scripts/jest/__tests__/ciShards.test.ts`',
      'grep -E \'Test Suites: |Tests: |needed jobs ended: \'',
      'Each of the eight `Mobile — jest shard <i>/8` must print a `Tests:` line and a `Test Suites:` line whose suites are more than zero and all passed',
      'The gate `Mobile — jest` runs no tests since OPS-456: its log must read `needed jobs ended: success success (2 expected)`',
      'When the sweeps filter fired (3e), each of the four `Mobile — never-red sweeps shard <i>/4` must print a `Tests:` line',
      'the gate `Mobile — never-red sweeps at full resolution` must read `needed jobs ended: success success (2 expected)`',
      'When `ci.yml` at the run\'s commit has no `mobile-jest-shard` matrix (main before #234), `Mobile — jest` is the single jest job instead: it must print a `Tests:` line and a `Test Suites:` line whose suites are more than zero and all passed, and no gate line.');
    expect(STEP4).not.toMatch(/add up to/);
  });
});

describe('DEC-192 · device work closes on emulator evidence; the owner\'s real phone once, at the end', () => {
  test('CLAUDE.md\'s evidence rule closes device work on an emulator, with one real-phone pass before the owner\'s review', () => {
    const rule = section(ROOT_MD, 'Working rules').find((l) => l.startsWith('- Evidence over assertion:')) || '';
    expect(rule).not.toBe('');
    expect(rule).toMatch(/emulator/);
    expect(rule).toMatch(/real phone/);
    expect(rule).not.toContain('real device evidence');
  });

  test('/device-qa gives the emulator runbook by default, with the manifest it reads, and keeps the phone for the final pass', () => {
    const qa = read('.claude/commands/device-qa.md');
    has(qa, 'EMULATOR', '`adb -s <serial> emu avd name`', '`getprop ro.build.version.sdk`', '`getprop ro.build.fingerprint`',
      '`adb -s <serial> shell dumpsys SurfaceFlinger | grep -m1 \'GLES:\'`', '`getprop debug.hwui.renderer`', 'THE REAL PHONE');
    expect(qa.indexOf('EMULATOR')).toBeLessThan(qa.indexOf('THE REAL PHONE'));
  });

  test.each(['.claude/agents/developer.md', '.claude/agents/designer.md', '.claude/agents/resilience-auditor.md', '.claude/commands/fix-bug.md'])(
    '%s names the emulator as where device evidence closes', (file) => {
      const body = read(file).split('\n---\n').slice(1).join('\n---\n');
      expect(body).toMatch(/emulator/);
    });
});
