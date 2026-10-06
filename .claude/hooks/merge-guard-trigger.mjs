// merge-guard trigger: a PostToolUse hook (DEC-143).
//
// After a tool call that creates a PR, pushes to a branch with an open PR into main, or merges a
// PR, it prints an instruction (hookSpecificOutput.additionalContext) telling the session to
// dispatch the `merge-guard` agent (.claude/agents/merge-guard.md) before the next merge or task.
// Every other call prints nothing. It never throws and always exits 0; malformed stdin is silent.
//
// What counts, for the Bash and PowerShell tools (tool_input.command), anywhere in a chain
// (&&, ||, ;, |, &, newlines, ( ), PowerShell { }):
//   gh pr merge [<n>|<url>|<branch>] ...   -> merge   (post-merge)
//   gh pr create ...                       -> create  (pre-merge; number from the URL gh prints)
//   git [-C <path>] push ...               -> push    (pre-merge; only if the branch has an open
//                                                      PR into main, or the lookup fails)
// and the GitHub MCP tools *__merge_pull_request (pullNumber) and *__create_pull_request.
// Ignored: git push --dry-run/-n, --help, gh pr create --dry-run, gh pr merge --disable-auto.
//
// Documented choice: text inside quotes, heredoc bodies and PowerShell here-strings is data, not
// a command. `echo "gh pr merge 5"` does not fire. The cost of that choice: a command hidden
// inside a string that a second shell runs (`bash -c "gh pr merge 5"`) is not seen either.
// `$( ... )` inside double quotes is lexed as the command it is.
//
// Run the tests from the repository root:  node --test .claude/hooks/merge-guard-trigger.test.mjs

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------
// Lexer: a command string -> segments (one simple command each) -> words.

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
      const close = new RegExp(`\\n${next}@`);
      const m = close.exec(src.slice(i + 2));
      const end = m ? i + 2 + m.index + 3 : n;
      append(src.slice(i + 2, m ? i + 2 + m.index : n));
      i = end;
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
          j = lexRange(src, j + 2, shell, segments, true);
          append('\u0001');
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
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      endSegment();
      i += 1;
      if (depth > 0) depth -= 1;
      else if (stopAtParen) return i;
      continue;
    }
    if (ch === ';' || (ps && (ch === '{' || ch === '}'))) {
      endSegment();
      i += 1;
      continue;
    }
    if (ch === '|') {
      endSegment();
      i += next === '|' || next === '&' ? 2 : 1;
      continue;
    }
    if (ch === '&') {
      endSegment();
      i += next === '&' ? 2 : 1;
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

function lex(command, shell) {
  const segments = [];
  lexRange(command, 0, shell, segments, false);
  return segments;
}

// ---------------------------------------------------------------------------------------------
// Classifier.

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const LEADING_WORDS = new Set([
  'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', 'command', 'exec', 'nohup', 'builtin', '{', '}',
]);
const GIT_GLOBAL_WITH_VALUE = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix']);
const PUSH_LONG_WITH_VALUE = new Set(['--push-option', '--repo', '--receive-pack', '--exec']);
const MERGE_WITH_VALUE = new Set([
  '-b', '--body', '-F', '--body-file', '-t', '--subject', '--match-head-commit', '-A', '--author-email', '-R', '--repo',
]);
const CREATE_WITH_VALUE = new Set([
  '-a', '--assignee', '-B', '--base', '-b', '--body', '-F', '--body-file', '-H', '--head', '-l', '--label',
  '-m', '--milestone', '-p', '--project', '-r', '--reviewer', '-T', '--template', '-t', '--title', '-R', '--repo',
  '--recover',
]);
const RANK = { push: 1, create: 2, merge: 3 };

function exeName(word) {
  if (typeof word !== 'string') return '';
  return word.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

function prFromArg(arg) {
  const m = /^#?(\d+)$/.exec(arg) || /\/pull\/(\d+)(?:\/|$|[?#])/.exec(arg);
  return m ? Number(m[1]) : null;
}

function analyzeGhMerge(args) {
  let positional = null;
  for (let j = 0; j < args.length; j += 1) {
    const a = args[j];
    if (a === '--help' || a === '-h' || a === '--disable-auto') return null;
    if (a === '--') {
      positional = positional ?? args[j + 1] ?? null;
      break;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (!a.includes('=') && MERGE_WITH_VALUE.has(a)) j += 1;
      continue;
    }
    if (positional === null) positional = a;
  }
  if (positional === null) return { kind: 'merge', pr: null, branch: null, dir: null };
  const pr = prFromArg(positional);
  return { kind: 'merge', pr, branch: pr === null ? positional : null, dir: null };
}

function analyzeGhCreate(args) {
  let branch = null;
  for (let j = 0; j < args.length; j += 1) {
    const a = args[j];
    if (a === '--help' || a === '-h' || a === '--dry-run') return null;
    if (a === '-H' || a === '--head') branch = args[j + 1] ?? null;
    else if (a.startsWith('--head=')) branch = a.slice('--head='.length);
    if (a.startsWith('-') && !a.includes('=') && CREATE_WITH_VALUE.has(a)) j += 1;
  }
  if (branch && branch.includes(':')) branch = branch.slice(branch.indexOf(':') + 1); // owner:branch
  return { kind: 'create', pr: null, branch: branch || null, dir: null };
}

function branchFromRefspec(spec) {
  if (!spec) return null;
  let s = spec.replace(/^\+/, '');
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1);
  s = s.replace(/^refs\/heads\//, '');
  return s && s !== 'HEAD' ? s : null;
}

function analyzeGit(args) {
  let j = 0;
  let dir = null;
  while (j < args.length && args[j].startsWith('-')) {
    const a = args[j];
    if (a === '-C') {
      const v = args[j + 1];
      if (v === undefined) return null;
      dir = dir === null || path.isAbsolute(v) ? v : path.join(dir, v);
      j += 2;
    } else if (GIT_GLOBAL_WITH_VALUE.has(a)) {
      j += 2;
    } else {
      j += 1;
    }
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
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (/^-[A-Za-z0-9]+$/.test(a)) {
        if (a.includes('n')) return null; // -n is --dry-run, also inside a cluster such as -nu
        if (a.endsWith('o')) k += 1; // -o <push-option>
      }
      continue;
    }
    positional.push(a);
  }
  return { kind: 'push', pr: null, branch: branchFromRefspec(positional[1]), dir };
}

function analyzeSegment(words) {
  let k = 0;
  while (k < words.length && (ENV_ASSIGNMENT.test(words[k]) || LEADING_WORDS.has(words[k]))) k += 1;
  const exe = exeName(words[k]);
  const args = words.slice(k + 1);
  if (exe === 'gh' && args[0] === 'pr') {
    if (args[1] === 'merge') return analyzeGhMerge(args.slice(2));
    if (args[1] === 'create') return analyzeGhCreate(args.slice(2));
    return null;
  }
  if (exe === 'git') return analyzeGit(args);
  return null;
}

function lastPrUrl(text) {
  let last = null;
  for (const m of String(text).matchAll(/\/pull\/(\d+)(?![\d\w])/g)) last = Number(m[1]);
  return last;
}

function numberKey(text) {
  const m = /\\*"number\\*"\s*:\s*(\d+)/.exec(String(text));
  return m ? Number(m[1]) : null;
}

// The PR number in free text: the last PR URL, else a JSON "number" key (escaped or not).
export function extractPrNumber(text) {
  if (typeof text !== 'string' || !text) return null;
  return lastPrUrl(text) ?? numberKey(text);
}

function stringify(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '') ?? '';
  } catch {
    return '';
  }
}

function shellOutput(response) {
  if (response && typeof response === 'object' && typeof response.stdout === 'string') return response.stdout;
  return stringify(response);
}

function mcpPr(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// input: the PostToolUse hook payload. Returns { kind, pr, branch, dir } or null.
// `dir` is the `git -C` path of a push (relative to input.cwd), else null.
export function classify(input) {
  if (!input || typeof input !== 'object') return null;
  const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  if (tool.startsWith('mcp__')) {
    if (tool.endsWith('__merge_pull_request')) {
      return { kind: 'merge', pr: mcpPr(toolInput.pullNumber ?? toolInput.pull_number), branch: null, dir: null };
    }
    if (tool.endsWith('__create_pull_request')) {
      const text = stringify(input.tool_response);
      const head = typeof toolInput.head === 'string' && toolInput.head ? toolInput.head : null;
      return { kind: 'create', pr: numberKey(text) ?? lastPrUrl(text), branch: head, dir: null };
    }
    return null;
  }

  if (tool !== 'Bash' && tool !== 'PowerShell') return null;
  const command = toolInput.command;
  if (typeof command !== 'string' || !command) return null;

  let best = null;
  for (const words of lex(command, tool === 'PowerShell' ? 'powershell' : 'bash')) {
    const c = analyzeSegment(words);
    if (c && (!best || RANK[c.kind] > RANK[best.kind])) best = c;
  }
  if (best && best.kind === 'create') best = { ...best, pr: extractPrNumber(shellOutput(input.tool_response)) };
  return best;
}

// ---------------------------------------------------------------------------------------------
// Side-effecting lookups, injectable for tests.

export function makeLookupOpenPr(exec = execFileSync) {
  return (branch, cwd) => {
    const out = String(
      exec('gh', ['pr', 'list', '--head', branch, '--base', 'main', '--state', 'open', '--json', 'number', '--jq', '.[0].number'], {
        cwd,
        timeout: 10000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    ).trim();
    if (out === '' || out === 'null') return null;
    if (!/^\d+$/.test(out)) throw new Error(`unexpected gh output: ${out.slice(0, 80)}`);
    return Number(out);
  };
}

export function makeCurrentBranch(exec = execFileSync) {
  return (cwd) => {
    const out = String(
      exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        timeout: 5000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    ).trim();
    return out && out !== 'HEAD' ? out : null;
  };
}

function defaultDeps() {
  return { lookupOpenPr: makeLookupOpenPr(), currentBranch: makeCurrentBranch() };
}

// ---------------------------------------------------------------------------------------------
// The instruction.

function message(kind, pr, branch, note) {
  const phase = kind === 'merge' ? 'post-merge' : 'pre-merge';
  const ran = {
    merge: '`gh pr merge` ran',
    create: '`gh pr create` ran',
    push: branch && pr !== null ? `\`git push\` updated ${branch}, which has an open PR into main` : '`git push` ran',
  }[kind];
  let target;
  if (pr !== null) target = `PR #${pr}`;
  else if (kind === 'merge') {
    target = branch
      ? `the PR of branch ${branch} that was just merged`
      : 'the PR that was just merged (the command named no number: find it with `gh pr list --state merged --limit 3 --json number,headRefName,mergedAt`)';
  } else if (branch) {
    target = `the PR for branch ${branch} (find it with \`gh pr list --head ${branch} --json number,baseRefName\`)`;
  } else {
    target = 'the PR for the current branch (find it with `gh pr view --json number,baseRefName`)';
  }
  return [
    `merge-guard trigger: ${ran}.`,
    `Dispatch the merge-guard agent now on ${target}, phase ${phase}.`,
    'Do not start the next merge or the next task until it returns VERDICT: GREEN.',
    'On VERDICT: RED, follow its instructions: record each finding as a TASKS.md row, fix it before the next task (DEC-143), and re-run merge-guard on the fixed state.',
    note ? `Note: ${note}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function errorText(e) {
  const s = e && (e.code || e.message) ? String(e.code || e.message) : String(e);
  return s.split('\n')[0].slice(0, 120);
}

// The hook's whole decision for one parsed payload: '' (print nothing) or the JSON to print.
export function run(input, deps = defaultDeps()) {
  if (!input || typeof input !== 'object') return '';
  if (input.hook_event_name && input.hook_event_name !== 'PostToolUse') return '';
  const c = classify(input);
  if (!c) return '';

  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  let { pr, branch } = c;
  let note = '';
  if (c.kind === 'push') {
    const dir = c.dir ? path.resolve(cwd, c.dir) : cwd;
    if (!branch) {
      try {
        branch = deps.currentBranch(dir) || null;
      } catch {
        branch = null;
      }
    }
    if (!branch) {
      note = 'the pushed branch could not be resolved, so this fires to fail toward checking';
    } else {
      try {
        pr = deps.lookupOpenPr(branch, dir);
        if (pr === null || pr === undefined) return '';
      } catch (e) {
        pr = null;
        note = `the open-PR lookup failed (${errorText(e)}), so this fires to fail toward checking; establish whether ${branch} has an open PR into main`;
      }
    }
  }
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message(c.kind, pr, branch, note) },
  });
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
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
  } catch {
    raw = '';
  }
  const out = handle(raw);
  if (out) process.stdout.write(out);
}

const isEntry =
  import.meta.main ??
  (typeof process.argv[1] === 'string' &&
    path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase());

if (isEntry) {
  main()
    .catch(() => {})
    .finally(() => {
      process.exitCode = 0;
    });
}
