// merge-guard trigger: a PostToolUse and PostToolUseFailure hook (DEC-143).
//
// After a tool call that merges a PR, creates one, or pushes to a branch with an open PR into main,
// it prints an instruction (hookSpecificOutput.additionalContext) telling the session to dispatch
// the `merge-guard` agent (.claude/agents/merge-guard.md). Every other call prints nothing. It never
// throws and always exits 0; malformed stdin is silent.
//
// .claude/settings.json starts it for Bash and PowerShell only through `if` filters (`git *`,
// `gh pr *`), so Node runs only for those commands, and for the GitHub MCP tools by matcher.
// A command started under another name (`git.exe`, a full path, `bash -c "..."`) passes no filter.
//
// What counts, anywhere in a chain (&&, ||, ;, |, &, newlines, ( ), PowerShell { }):
//   gh pr merge [<n>|<url>|<branch>]           -> merge   post-merge; several merges are all named
//   gh pr create                               -> create  pre-merge; the number comes from the output
//   git [-C <path>] push [<remote> <refspec>]  -> push    pre-merge, if the branch has an open PR
//   gh pr update-branch [<n>|<url>|<branch>]   -> push      into main or that cannot be told
// and the MCP tools *__merge_pull_request, *__create_pull_request, *__update_pull_request_branch.
// Ignored: git push --dry-run/-n, --help, gh pr create --dry-run, gh pr merge --disable-auto.
// After a FAILED call (PostToolUseFailure) a merge and a push fire as usual, since either can change
// GitHub before the error; a create fires only when its error names the PR (it already exists).
// A push resolves its branch from the refspec, else the current branch where the command ran
// (earlier cd / pushd / Set-Location / sl segments and git -C). A branch or directory the shell
// computes ($, backtick, %, {, @) is not guessed: it fires with a note instead.
//
// Documented choice: text inside quotes, heredoc bodies and PowerShell here-strings is data, not a
// command, so `git commit -m "... gh pr merge 5"` does not fire; the cost is that a command a second
// shell runs from a string (`bash -c "gh pr merge 5"`) is not seen either. `$( ... )` is lexed.
//
// Run the tests from the repository root:  node --test .claude/hooks/merge-guard-trigger.test.mjs

import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------
// Lexer: a command string -> segments (one simple command each, as words). OPEN and CLOSE mark a
// `(` ... `)` group, so a bash subshell's cd does not leak out of it.

const OPEN = ['('];
const CLOSE = [')'];
const PLACEHOLDER = '\u0001'; // stands for a "$( ... )" inside a double-quoted word

function readHeredocDelimiter(src, j) {
  let word = '';
  while (j < src.length && !/[\s;|&<>()]/.test(src[j])) {
    const c = src[j];
    if (c === "'" || c === '"') {
      const k = src.indexOf(c, j + 1);
      if (k < 0) return { word: word + src.slice(j + 1), end: src.length };
      word += src.slice(j + 1, k);
      j = k + 1;
    } else if (c === '\\') {
      word += src[j + 1] ?? '';
      j += 2;
    } else {
      word += c;
      j += 1;
    }
  }
  return { word, end: j };
}

// i is the first character of the heredoc body; returns the index after its delimiter line.
function skipHeredoc(src, i, { delim, strip }) {
  while (i < src.length) {
    const e = src.indexOf('\n', i);
    const lineEnd = e < 0 ? src.length : e;
    let line = src.slice(i, lineEnd).replace(/\r$/, '');
    if (strip) line = line.replace(/^\t+/, '');
    i = e < 0 ? src.length : e + 1;
    if (line === delim) return i;
  }
  return src.length;
}

// Lexes src from `start` into `segments`. With stopAtParen it lexes the inside of `$(` and
// returns the index after the matching `)`.
function lexRange(src, start, shell, segments, stopAtParen) {
  const ps = shell === 'powershell';
  const esc = ps ? '`' : '\\';
  const n = src.length;
  const heredocs = [];
  let words = [];
  let cur = null;
  let dropNext = false; // the next word is a redirection target
  let depth = 0;
  let i = start;

  const append = (s) => {
    cur = (cur ?? '') + s;
  };
  const finishWord = () => {
    if (cur === null) return;
    if (dropNext) dropNext = false;
    else words.push(cur);
    cur = null;
  };
  const endSegment = () => {
    finishWord();
    if (words.length) segments.push(words);
    words = [];
    dropNext = false;
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === esc) {
      if (next === '\n') i += 2; // line continuation
      else if (next === '\r' && src[i + 2] === '\n') i += 3;
      else {
        if (i + 1 < n) append(next);
        i += 2;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      finishWord();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endSegment();
      i += 1;
      while (heredocs.length) i = skipHeredoc(src, i, heredocs.shift());
      continue;
    }
    if (ch === '#' && cur === null) {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === "'") {
      const k = src.indexOf("'", i + 1);
      const end = k < 0 ? n : k;
      append(src.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (ps && ch === '@' && (next === '"' || next === "'") && cur === null && /^[ \t]*\r?\n/.test(src.slice(i + 2))) {
      // PowerShell here-string: runs to a line that starts with "@ or '@.
      const m = new RegExp(`\\n${next}@`).exec(src.slice(i + 2));
      append(src.slice(i + 2, m ? i + 2 + m.index : n));
      i = m ? i + 2 + m.index + 3 : n;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      append('');
      while (j < n && src[j] !== '"') {
        const c = src[j];
        if (c === esc) {
          const d = src[j + 1];
          if (ps) {
            append(d ?? '');
            j += 2;
          } else if (d === '$' || d === '`' || d === '"' || d === '\\') {
            append(d);
            j += 2;
          } else if (d === '\n') {
            j += 2;
          } else {
            append(c);
            j += 1;
          }
          continue;
        }
        if (c === '$' && src[j + 1] === '(') {
          segments.push(OPEN);
          j = lexRange(src, j + 2, shell, segments, true);
          segments.push(CLOSE);
          append(PLACEHOLDER);
          continue;
        }
        append(c);
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === '(') {
      endSegment();
      segments.push(OPEN);
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      endSegment();
      i += 1;
      if (depth > 0) {
        depth -= 1;
        segments.push(CLOSE);
      } else if (stopAtParen) return i;
      continue;
    }
    if (ch === ';' || (ps && (ch === '{' || ch === '}'))) {
      endSegment();
      i += 1;
      continue;
    }
    if (ch === '|' || ch === '&') {
      endSegment();
      i += next === '|' || next === '&' ? 2 : 1;
      continue;
    }
    if (ch === '>' || ch === '<') {
      if (cur !== null && /^(?:\d+|\*)$/.test(cur)) cur = null; // the fd of 2> or *>
      else finishWord();
      if (!ps && ch === '<' && next === '<' && src[i + 2] !== '<') {
        let j = i + 2;
        let strip = false;
        if (src[j] === '-') {
          strip = true;
          j += 1;
        }
        while (src[j] === ' ' || src[j] === '\t') j += 1;
        const { word, end } = readHeredocDelimiter(src, j);
        if (word) heredocs.push({ delim: word, strip });
        i = end;
        continue;
      }
      let j = i + 1;
      while (src[j] === '>' || src[j] === '<') j += 1;
      if (src[j] === '&') {
        j += 1;
        while (j < n && /[0-9-]/.test(src[j])) j += 1;
      } else {
        dropNext = true;
      }
      i = j;
      continue;
    }
    append(ch);
    i += 1;
  }
  endSegment();
  return n;
}

// ---------------------------------------------------------------------------------------------
// Classifier: a payload -> hits { kind, pr, branch, dir, repo }, one per relevant command.
// `dir` is where the command ran, relative to the payload's cwd ('' = cwd, null = unknown).

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const LEADING_WORDS = new Set([
  'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', 'command', 'exec', 'nohup', 'builtin', '{', '}',
]);
const CD = new Set(['cd', 'pushd', 'push-location', 'set-location', 'sl']);
const POPD = new Set(['popd', 'pop-location']);
const GH_WITH_VALUE = new Set([
  '-b', '--body', '-F', '--body-file', '-t', '--subject', '--match-head-commit', '-A', '--author-email', '-R', '--repo',
]);
const PUSH_LONG_WITH_VALUE = new Set(['--push-option', '--repo', '--receive-pack', '--exec']);
const MCP_KINDS = new Map([
  ['merge_pull_request', 'merge'],
  ['create_pull_request', 'create'],
  ['update_pull_request_branch', 'push'],
]);
const OPAQUE = new RegExp(`[$\`%{${PLACEHOLDER}]`);

// A value the shell computes at run time, which this hook cannot know.
const opaque = (s) => s === '@' || OPAQUE.test(s);

const join = (base, rel) => (base === null ? null : base === '' || path.isAbsolute(rel) ? rel : path.join(base, rel));

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function prFromArg(arg) {
  const m = /^#?(\d+)$/.exec(arg) || /\/pull\/(\d+)(?:\/|$|[?#])/.exec(arg);
  return m ? Number(m[1]) : null;
}

function firstPositional(args) {
  for (let j = 0; j < args.length; j += 1) {
    const a = args[j];
    if (a === '--') return args[j + 1] ?? null;
    if (!a.startsWith('-') || a.length === 1) return a;
    if (!a.includes('=') && GH_WITH_VALUE.has(a)) j += 1;
  }
  return null;
}

function flagValue(args, short, long) {
  for (let j = 0; j < args.length; j += 1) {
    if (args[j] === short || args[j] === long) return args[j + 1] ?? null;
    if (args[j].startsWith(`${long}=`)) return args[j].slice(long.length + 1);
  }
  return null;
}

// gh pr <sub> <args>
function analyzeGh(sub, args, dir) {
  if (args.includes('--help') || args.includes('-h')) return null;
  const repo = flagValue(args, '-R', '--repo');
  if (sub === 'create') return args.includes('--dry-run') ? null : { kind: 'create', pr: null, branch: null, dir, repo };
  if ((sub !== 'merge' && sub !== 'update-branch') || args.includes('--disable-auto')) return null;
  const arg = firstPositional(args);
  const pr = arg === null ? null : prFromArg(arg);
  return { kind: sub === 'merge' ? 'merge' : 'push', pr, branch: pr === null ? arg : null, dir, repo };
}

function branchFromRefspec(spec) {
  if (!spec) return null;
  let s = spec.replace(/^\+/, '');
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1);
  s = s.replace(/^refs\/heads\//, '');
  return s && s !== 'HEAD' ? s : null;
}

// git <args>
function analyzeGit(args, cd) {
  let dir = cd;
  let j = 0;
  while (j < args.length && args[j].startsWith('-')) {
    if (args[j] === '-C') dir = join(dir, args[j + 1] ?? '');
    j += args[j] === '-C' || args[j] === '-c' ? 2 : 1;
  }
  if (args[j] !== 'push') return null;
  const rest = args.slice(j + 1);
  const positional = [];
  for (let k = 0; k < rest.length; k += 1) {
    const a = rest[k];
    if (a === '--dry-run' || a === '--help' || a === '-h') return null;
    if (a === '--') {
      positional.push(...rest.slice(k + 1));
      break;
    }
    if (a.startsWith('--')) {
      if (!a.includes('=') && PUSH_LONG_WITH_VALUE.has(a)) k += 1;
    } else if (a.startsWith('-') && a.length > 1) {
      if (/^-[A-Za-z0-9]+$/.test(a)) {
        if (a.includes('n')) return null; // -n is --dry-run, also inside a cluster such as -nu
        if (a.endsWith('o')) k += 1; // -o <push-option>
      }
    } else {
      positional.push(a);
    }
  }
  return { kind: 'push', pr: null, branch: branchFromRefspec(positional[1]), dir, repo: null };
}

function analyzeShell(command, shell) {
  const segments = [];
  lexRange(command, 0, shell, segments, false);
  const hits = [];
  const scopes = [];
  let cd = '';
  for (const words of segments) {
    if (words === OPEN || words === CLOSE) {
      if (shell === 'bash' && words === OPEN) scopes.push(cd);
      else if (shell === 'bash' && scopes.length) cd = scopes.pop();
      continue;
    }
    let k = 0;
    while (k < words.length && (ENV_ASSIGNMENT.test(words[k]) || LEADING_WORDS.has(words[k]))) k += 1;
    const name = (words[k] ?? '').toLowerCase();
    const args = words.slice(k + 1);
    if (CD.has(name)) {
      const to = args.filter((a) => !a.startsWith('-')).pop();
      cd = to === undefined || to.startsWith('~') ? null : join(cd, to);
    } else if (POPD.has(name)) {
      cd = null;
    } else {
      const hit = name === 'gh' && args[0] === 'pr' ? analyzeGh(args[1], args.slice(2), cd) : name === 'git' ? analyzeGit(args, cd) : null;
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

export function classify(input) {
  if (!input || typeof input !== 'object') return [];
  const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (tool.startsWith('mcp__')) {
    const kind = MCP_KINDS.get(tool.slice(tool.lastIndexOf('__') + 2));
    if (!kind) return [];
    const pr = kind === 'create' ? null : positiveInt(ti.pullNumber ?? ti.pull_number);
    const branch = kind === 'create' && typeof ti.head === 'string' && ti.head ? ti.head : null;
    const repo = typeof ti.owner === 'string' && typeof ti.repo === 'string' ? `${ti.owner}/${ti.repo}` : null;
    return [{ kind, pr, branch, dir: null, repo }];
  }
  if ((tool !== 'Bash' && tool !== 'PowerShell') || typeof ti.command !== 'string') return [];
  return analyzeShell(ti.command, tool === 'PowerShell' ? 'powershell' : 'bash');
}

// ---------------------------------------------------------------------------------------------
// Side-effecting lookups, injectable for tests.

const execText = (exec, file, args, cwd, timeout) =>
  String(exec(file, args, { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })).trim();

export const makeLookupOpenPr = (exec = execFileSync) => (branch, cwd) => {
  const args = ['pr', 'list', '--head', branch, '--base', 'main', '--state', 'open', '--json', 'number', '--jq', '.[0].number'];
  const out = execText(exec, 'gh', args, cwd, 10000);
  if (out === '' || out === 'null') return null;
  if (!/^\d+$/.test(out)) throw new Error(`unexpected gh output: ${out.slice(0, 80)}`);
  return Number(out);
};

export const makeCurrentBranch = (exec = execFileSync) => (cwd) => {
  const out = execText(exec, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 5000);
  return out && out !== 'HEAD' ? out : null;
};

// The hook runner starts this script once per matching `if` filter, even with the same command
// string (seen live on CLI 2.1.283), so `git push && gh pr merge 5` starts it twice for one tool call. Each run
// claims "<event>-<tool_use_id>" with an exclusive create; only the first prints. If the directory
// is unusable it fails open: a duplicate instruction is harmless, a lost one is not.
export const makeClaim = (dir = path.join(os.tmpdir(), 'merge-guard-trigger')) => (id) => {
  try {
    mkdirSync(dir, { recursive: true });
    closeSync(openSync(path.join(dir, id.replace(/[^\w.-]/g, '_')), 'wx'));
  } catch (e) {
    return e.code !== 'EEXIST';
  }
  try {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (Date.now() - statSync(p).mtimeMs > 86400000) rmSync(p, { force: true });
    }
  } catch {
    // pruning is housekeeping only
  }
  return true;
};

const defaultDeps = () => ({ lookupOpenPr: makeLookupOpenPr(), currentBranch: makeCurrentBranch(), claim: makeClaim() });

// ---------------------------------------------------------------------------------------------
// The decision and the instruction.

const UNRESOLVED = 'the pushed branch could not be resolved, so this fires to fail toward checking';
const PHASE = { merge: 'pre-merge', create: 'pre-merge', push: 'pre-merge' };
const RAN = { merge: 'a PR merge ran', create: 'a PR create ran', push: 'a push to a PR branch ran' };

function stringify(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '') ?? '';
  } catch {
    return '';
  }
}

// The PR number in a call's output (or error): the last PR URL, or a JSON "number" key (escaped or
// not). An MCP response is JSON whose body may quote other PRs, so there the key comes first.
function prInText(text, keyFirst) {
  let url = null;
  for (const m of text.matchAll(/\/pull\/(\d+)(?![\d\w])/g)) url = Number(m[1]);
  const key = /\\*"number\\*"\s*:\s*(\d+)/.exec(text);
  const num = key ? Number(key[1]) : null;
  return keyFirst ? num ?? url : url ?? num;
}

function errorText(e) {
  const s = e && (e.code || e.message) ? String(e.code || e.message) : String(e);
  return s.split('\n')[0].slice(0, 120);
}

// A push hit -> the same hit with its PR (or a note saying why it fires anyway), or null when the
// pushed branch has no open PR into main.
function resolvePush(hit, cwd, deps) {
  if (hit.pr !== null) return hit;
  const dir = hit.dir === null || opaque(hit.dir) ? null : path.resolve(cwd, hit.dir);
  let branch = hit.branch;
  if (branch === null && dir !== null) {
    try {
      branch = deps.currentBranch(dir) || null;
    } catch {
      branch = null;
    }
  }
  if (dir === null || branch === null || opaque(branch)) return { ...hit, branch: null, note: UNRESOLVED };
  try {
    const pr = deps.lookupOpenPr(branch, dir);
    return pr === null || pr === undefined ? null : { ...hit, branch, pr };
  } catch (e) {
    const note = `the open-PR lookup failed (${errorText(e)}), so this fires to fail toward checking; establish whether ${branch} has an open PR into main`;
    return { ...hit, branch, note };
  }
}

function target(kind, h) {
  if (h.pr !== null) return `PR #${h.pr}`;
  if (kind === 'merge') {
    return h.branch
      ? `the PR of branch ${h.branch} that was just merged`
      : 'the PR that was just merged (the command named no number: find it with `gh pr list --state merged --limit 3 --json number,headRefName,mergedAt`)';
  }
  return h.branch
    ? `the PR for branch ${h.branch} (find it with \`gh pr list --head ${h.branch} --json number,baseRefName\`)`
    : 'the PR for the current branch (find it with `gh pr view --json number,baseRefName` where the command ran)';
}

function message(kind, failed, targets, notes) {
  const phase = PHASE[kind];
  const named = targets.every((t) => /^PR #\d+$/.test(t)) ? targets.join(', ') : 'PR #N';
  return [
    `merge-guard trigger: ${RAN[kind]}${failed ? ' and exited with an error, which does not mean nothing changed on GitHub' : ''}.`,
    `Dispatch the merge-guard agent now on ${targets.join(', ')}, phase ${phase}.`,
    'Do not start the next merge or the next task until it has returned and you have acted on its verdict: on VERDICT: GREEN, continue.',
    'On VERDICT: RED, follow its SESSION MUST: record each finding as a TASKS.md row, fix it before the next task (DEC-143), and re-run merge-guard on the fixed state. A RED it says cannot be fixed from here (environment only, a merge window, equal patch-ids with CI on the merge commit green) is recorded or waited out as it says, not retried in a loop.',
    `If you cannot dispatch agents (you are a sub-agent), make the first line of your final report: \`merge-guard required: ${named}, ${phase}\`.`,
    ...notes.map((note) => `Note: ${note}.`),
  ].join(' ');
}

// The hook's whole decision for one parsed payload: '' (print nothing) or the JSON to print.
// deps: { lookupOpenPr, currentBranch, claim?, projectDir? } (projectDir defaults to $CLAUDE_PROJECT_DIR).
export function run(input, deps = defaultDeps()) {
  if (!input || typeof input !== 'object') return '';
  const event = input.hook_event_name ?? 'PostToolUse';
  if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return '';
  const failed = event === 'PostToolUseFailure';
  const hits = classify(input);
  if (!hits.length) return '';
  if (deps.claim && typeof input.tool_use_id === 'string' && !deps.claim(`${event}-${input.tool_use_id}`)) return '';
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();

  let kind = 'merge';
  let chosen = hits.filter((h) => h.kind === 'merge');
  if (!chosen.length) {
    const create = hits.find((h) => h.kind === 'create');
    const response = input.tool_response;
    const text = failed ? stringify(input.error) : typeof response?.stdout === 'string' ? response.stdout : stringify(response);
    const pr = create ? prInText(text, input.tool_name.startsWith('mcp__')) : null;
    if (create && (pr !== null || !failed)) {
      kind = 'create';
      chosen = [{ ...create, pr }];
    } else {
      kind = 'push';
      chosen = hits.filter((h) => h.kind === 'push').map((h) => resolvePush(h, cwd, deps)).filter(Boolean);
    }
  }
  if (!chosen.length) return '';

  const root = deps.projectDir || process.env.CLAUDE_PROJECT_DIR || cwd;
  const notes = new Set();
  for (const h of chosen) {
    if (h.note) notes.add(h.note);
    if (h.repo) notes.add(`the command names repository ${h.repo}; run merge-guard against that repository`);
    if (h.dir && !opaque(h.dir)) {
      const where = path.resolve(cwd, h.dir);
      const rel = path.relative(root, where);
      if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) notes.add(`the command ran in ${where}, outside this project`);
    }
  }
  const targets = [...new Set(chosen.map((h) => target(kind, h)))];
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: message(kind, failed, targets, [...notes]) } });
}

// Raw stdin text -> what to print. Malformed input prints nothing.
export function handle(raw, deps = defaultDeps()) {
  try {
    return run(JSON.parse(raw), deps);
  } catch {
    return '';
  }
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  const out = handle(raw);
  if (out) process.stdout.write(out);
}

// Entry guard: Node loads the main module from realpath(argv[1]), so the two are equal only when
// this file is the script Node was started with, not when a test imports it.
function isEntry() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntry()) {
  main()
    .catch(() => {})
    .finally(() => {
      process.exitCode = 0;
    });
}
