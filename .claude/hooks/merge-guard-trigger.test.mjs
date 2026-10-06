// Tests for the merge-guard PostToolUse trigger (DEC-143).
// Run from the repository root:  node --test .claude/hooks/merge-guard-trigger.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classify,
  extractPrNumber,
  makeLookupOpenPr,
  makeCurrentBranch,
  run,
  handle,
} from './merge-guard-trigger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'merge-guard-trigger.mjs');
const REPO_ROOT = path.resolve(HERE, '..', '..');

const bash = (command, extra = {}) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command },
  tool_response: { stdout: '', stderr: '' },
  cwd: 'C:/repo',
  ...extra,
});
const ps = (command, extra = {}) => ({ ...bash(command, extra), tool_name: 'PowerShell' });

// A stateful fake of the open-PR lookup: a table of branch -> open PR into main, plus a call log.
function fakeLookup(table) {
  const calls = [];
  const fn = (branch, cwd) => {
    calls.push({ branch, cwd });
    return Object.prototype.hasOwnProperty.call(table, branch) ? table[branch] : null;
  };
  fn.calls = calls;
  return fn;
}
// The lookup when `gh` is missing: execFileSync throws ENOENT, so the real wrapper throws.
function brokenLookup() {
  const err = new Error('spawnSync gh ENOENT');
  err.code = 'ENOENT';
  return () => {
    throw err;
  };
}
function fakeBranch(name) {
  const calls = [];
  const fn = (cwd) => {
    calls.push(cwd);
    return name;
  };
  fn.calls = calls;
  return fn;
}
const parseOut = (out) => JSON.parse(out).hookSpecificOutput;

describe('classify - the three kinds, in Bash and in PowerShell', () => {
  for (const [label, wrap] of [['Bash', bash], ['PowerShell', ps]]) {
    test(`${label}: gh pr merge <n> is a merge with its number`, () => {
      assert.deepEqual(classify(wrap('gh pr merge 222 --squash --delete-branch')), {
        kind: 'merge', pr: 222, branch: null, dir: null,
      });
    });

    test(`${label}: gh pr create is a create, numbered from the URL gh prints`, () => {
      const input = wrap('gh pr create --base main --title "t" --body-file pr.md', {
        tool_response: { stdout: 'https://github.com/DanielMalede/Kokonada/pull/223\n', stderr: '' },
      });
      assert.deepEqual(classify(input), { kind: 'create', pr: 223, branch: null, dir: null });
    });

    test(`${label}: git push -u origin <branch> is a push of that branch`, () => {
      assert.deepEqual(classify(wrap('git push -u origin feat/x')), {
        kind: 'push', pr: null, branch: 'feat/x', dir: null,
      });
    });
  }
});

describe('classify - gh pr merge arguments', () => {
  test('the number comes from a PR URL', () => {
    assert.equal(classify(bash('gh pr merge https://github.com/DanielMalede/Kokonada/pull/219 --squash')).pr, 219);
  });

  test('flag values are not mistaken for the PR argument', () => {
    assert.equal(classify(bash('gh pr merge --squash --match-head-commit 508bedc 222')).pr, 222);
    assert.equal(classify(bash('gh pr merge --subject "fix 5" -t 6 222 --squash')).pr, 222);
    assert.equal(classify(bash('gh pr merge --match-head-commit=508bedc 222')).pr, 222);
  });

  test('no argument means the current branch PR: pr is null', () => {
    assert.deepEqual(classify(bash('gh pr merge --squash --delete-branch')), {
      kind: 'merge', pr: null, branch: null, dir: null,
    });
  });

  test('a branch argument is kept as the branch', () => {
    assert.deepEqual(classify(bash('gh pr merge fix/x --squash')), {
      kind: 'merge', pr: null, branch: 'fix/x', dir: null,
    });
  });

  test('redirections do not become arguments', () => {
    assert.equal(classify(bash('gh pr merge 222 --squash 2>&1 | tail -5')).pr, 222);
    assert.deepEqual(classify(bash('gh pr merge 2>/dev/null')), { kind: 'merge', pr: null, branch: null, dir: null });
    assert.deepEqual(classify(ps('gh pr merge *>$null')), { kind: 'merge', pr: null, branch: null, dir: null });
    assert.equal(classify(bash('git push 2>&1 origin b11')).branch, 'b11');
  });
});

describe('classify - gh pr create', () => {
  test('--head names the branch', () => {
    const c = classify(bash('gh pr create --head chore/merge-guard-agent --fill'));
    assert.equal(c.kind, 'create');
    assert.equal(c.branch, 'chore/merge-guard-agent');
    assert.equal(c.pr, null);
    assert.equal(classify(bash('gh pr create --head=feat/eq --fill')).branch, 'feat/eq');
  });

  test('an owner:branch head keeps only the branch', () => {
    assert.equal(classify(bash('gh pr create -H DanielMalede:feat/x --fill')).branch, 'feat/x');
  });

  test('the last PR URL in stdout wins over a URL quoted earlier', () => {
    const input = bash('gh pr create --fill', {
      tool_response: { stdout: 'see https://github.com/o/r/pull/12\nhttps://github.com/o/r/pull/230\n' },
    });
    assert.equal(classify(input).pr, 230);
  });

  test('a branch-creation link (/pull/new/<branch>) is not a PR number', () => {
    const input = bash('git push -u origin b && gh pr create --fill', {
      tool_response: { stdout: '', stderr: 'remote: https://github.com/o/r/pull/new/b\n' },
    });
    assert.deepEqual(classify(input), { kind: 'create', pr: null, branch: null, dir: null });
  });
});

describe('classify - git push refspecs and options', () => {
  const branchOf = (cmd) => classify(bash(cmd)).branch;

  test('HEAD:<branch>, <src>:<dst>, +<branch> and refs/heads/<branch>', () => {
    assert.equal(branchOf('git push origin HEAD:feat/y'), 'feat/y');
    assert.equal(branchOf('git push origin local:remote-b'), 'remote-b');
    assert.equal(branchOf('git push origin +feat/z'), 'feat/z');
    assert.equal(branchOf('git push origin refs/heads/feat/q'), 'feat/q');
    assert.equal(branchOf('git push origin HEAD:refs/heads/feat/r'), 'feat/r');
  });

  test('no refspec, or a bare HEAD, leaves the branch to be resolved', () => {
    assert.equal(branchOf('git push'), null);
    assert.equal(branchOf('git push origin'), null);
    assert.equal(branchOf('git push origin HEAD'), null);
    assert.equal(branchOf('git push --set-upstream origin HEAD'), null);
  });

  test('option values are not read as the remote or the refspec', () => {
    assert.equal(branchOf('git push -o ci.skip origin feat/o'), 'feat/o');
    assert.equal(branchOf('git push --push-option ci.skip origin feat/o'), 'feat/o');
    assert.equal(branchOf('git push --force-with-lease=feat/o:abc origin feat/o'), 'feat/o');
  });

  test('git -C <path> push carries the path', () => {
    assert.deepEqual(classify(bash('git -C ../other push -u origin b')), {
      kind: 'push', pr: null, branch: 'b', dir: '../other',
    });
    assert.deepEqual(classify(bash('git -c core.x=1 -C a -C b push')), {
      kind: 'push', pr: null, branch: null, dir: path.join('a', 'b'),
    });
  });

  test('a PowerShell path keeps its backslashes', () => {
    assert.equal(classify(ps('git -C C:\\Users\\danie\\repo push origin b')).dir, 'C:\\Users\\danie\\repo');
  });

  test('git.exe and gh.exe by full path still count', () => {
    assert.equal(classify(ps('& "C:\\Program Files\\Git\\cmd\\git.exe" push origin b')).branch, 'b');
    assert.equal(classify(ps("& 'C:\\Program Files\\GitHub CLI\\gh.exe' pr merge 7")).pr, 7);
  });
});

describe('classify - chained commands', () => {
  test('&& chains, ; chains and newlines', () => {
    assert.equal(classify(bash('cd backend && npm test && git push -u origin b1')).branch, 'b1');
    assert.equal(classify(ps('Set-Location backend; npm test; git push -u origin b2')).branch, 'b2');
    assert.equal(classify(bash('npm test\ngit push origin b3\n')).branch, 'b3');
    assert.equal(classify(bash('(cd x && git push origin b4)')).branch, 'b4');
    assert.equal(classify(bash('FOO=1 git push origin b5 || echo failed')).branch, 'b5');
  });

  test('a later merge outranks an earlier create, and a create outranks a push', () => {
    assert.equal(classify(bash('gh pr create --fill && gh pr merge 9 --squash')).kind, 'merge');
    assert.equal(classify(bash('git push -u origin b && gh pr create --fill')).kind, 'create');
  });

  test('backslash and backtick line continuations join one command', () => {
    assert.equal(classify(bash('git push \\\n  origin b6')).branch, 'b6');
    assert.equal(classify(ps('git push `\n  origin b7')).branch, 'b7');
  });

  test('a bash backslash escapes the next character', () => {
    assert.equal(classify(bash('git push origin feat/a\\ b')).branch, 'feat/a b');
  });

  test('blocks and keywords: PowerShell braces, bash { ...; } and if/then', () => {
    assert.equal(classify(ps('if ($ok) {git push origin b8}')).branch, 'b8');
    assert.equal(classify(bash('{ git push origin b9; }')).branch, 'b9');
    assert.equal(classify(bash('if git push origin b10; then echo ok; fi')).branch, 'b10');
  });
});

describe('classify - what it ignores', () => {
  const ignored = [
    'git status',
    'git status --short && git log --oneline -5',
    'gh pr view 222 --json number',
    'gh pr checks 222',
    'gh pr list --state open',
    'git push --dry-run origin b',
    'git push -n origin b',
    'git push -nu origin b',
    'git push --help',
    'gh pr merge --help',
    'gh pr merge 5 --disable-auto',
    'gh pr create --dry-run --fill',
    'gitx push origin b',
    'git pushx origin b',
    'gh pr merged 5',
    // Documented choice: text inside quotes is data, never a command. So this is ignored:
    'echo "gh pr merge 5"',
    'git commit -m "then git push origin b; gh pr merge 3"',
    "git log --grep='gh pr create'",
    // ... and so is a heredoc body.
    "cat <<'EOF' > note.txt\ngh pr merge 99\ngit push origin z\nEOF",
    'git status # then; gh pr merge 5',
    '# gh pr merge 5 && git push origin b',
  ];
  for (const cmd of ignored) {
    test(`ignores: ${JSON.stringify(cmd)}`, () => {
      assert.equal(classify(bash(cmd)), null);
    });
  }

  test('a heredoc body does not override the real command on the first line', () => {
    const cmd = "gh pr create --title t --body-file - <<'EOF'\ngh pr merge 99\nEOF";
    assert.equal(classify(bash(cmd)).kind, 'create');
  });

  test('a <<- heredoc ends at its tab-indented delimiter', () => {
    const cmd = 'cat <<-EOF > n.txt\n\tgh pr merge 99\n\tEOF\ngit push origin b12';
    assert.equal(classify(bash(cmd)).branch, 'b12');
  });

  test('a $(cat <<EOF) body inside double quotes is data, even with an unbalanced quote', () => {
    const cmd = 'gh pr create --title t --body "$(cat <<\'EOF\'\nWhy it "broke\ngh pr merge 99\nEOF\n)"';
    assert.equal(classify(bash(cmd)).kind, 'create');
  });

  test('a PowerShell here-string body is data, even with an unbalanced quote', () => {
    const cmd = '$body = @"\nWhat it fixes: the "merge\ngh pr merge 99\n"@\ngit status';
    assert.equal(classify(ps(cmd)), null);
  });

  test('other tools and missing commands', () => {
    assert.equal(classify({ tool_name: 'Read', tool_input: { file_path: 'x' } }), null);
    assert.equal(classify({ tool_name: 'Bash', tool_input: {} }), null);
    assert.equal(classify({ tool_name: 'Bash' }), null);
    assert.equal(classify(null), null);
  });
});

describe('classify - GitHub MCP tools', () => {
  test('merge_pull_request takes pullNumber', () => {
    assert.deepEqual(
      classify({
        tool_name: 'mcp__plugin_github_github__merge_pull_request',
        tool_input: { owner: 'DanielMalede', repo: 'Kokonada', pullNumber: 224, merge_method: 'squash' },
      }),
      { kind: 'merge', pr: 224, branch: null, dir: null },
    );
  });

  test('create_pull_request reads the number from a URL in the response', () => {
    const c = classify({
      tool_name: 'mcp__plugin_github_github__create_pull_request',
      tool_input: { owner: 'o', repo: 'r', head: 'feat/m', base: 'main', title: 't' },
      tool_response: [{ type: 'text', text: '{"id":"1","url":"https://github.com/o/r/pull/226"}' }],
    });
    assert.deepEqual(c, { kind: 'create', pr: 226, branch: 'feat/m', dir: null });
  });

  test('create_pull_request reads "number":N when no URL is present', () => {
    const c = classify({
      tool_name: 'mcp__plugin_github_github__create_pull_request',
      tool_input: { head: 'feat/n', base: 'main' },
      tool_response: { content: [{ type: 'text', text: '{"number": 225, "state": "open"}' }] },
    });
    assert.equal(c.pr, 225);
  });

  test('create_pull_request prefers the response number over a PR URL quoted in the body', () => {
    const c = classify({
      tool_name: 'mcp__plugin_github_github__create_pull_request',
      tool_input: { head: 'feat/n', base: 'main' },
      tool_response: {
        number: 227,
        html_url: 'https://github.com/o/r/pull/227',
        body: 'follows https://github.com/o/r/pull/193',
      },
    });
    assert.equal(c.pr, 227);
  });

  test('create_pull_request with nothing to read leaves pr null', () => {
    const c = classify({
      tool_name: 'mcp__plugin_github_github__create_pull_request',
      tool_input: { head: 'feat/n', base: 'main' },
      tool_response: 'created',
    });
    assert.deepEqual(c, { kind: 'create', pr: null, branch: 'feat/n', dir: null });
  });
});

describe('extractPrNumber', () => {
  test('URL, escaped JSON number, nothing', () => {
    assert.equal(extractPrNumber('https://github.com/a/b/pull/42/files'), 42);
    assert.equal(extractPrNumber('{\\"number\\":17}'), 17);
    assert.equal(extractPrNumber('https://github.com/a/b/pull/new/feat'), null);
    assert.equal(extractPrNumber(''), null);
  });
});

describe('the real lookup wrappers, with an injected exec', () => {
  test('makeLookupOpenPr runs the exact gh command with a timeout, in cwd', () => {
    const seen = [];
    const lookup = makeLookupOpenPr((file, args, opts) => {
      seen.push({ file, args, opts });
      return '222\n';
    });
    assert.equal(lookup('feat/x', 'C:/repo'), 222);
    assert.equal(seen[0].file, 'gh');
    assert.deepEqual(seen[0].args, [
      'pr', 'list', '--head', 'feat/x', '--base', 'main', '--state', 'open', '--json', 'number', '--jq', '.[0].number',
    ]);
    assert.equal(seen[0].opts.cwd, 'C:/repo');
    assert.ok(seen[0].opts.timeout > 0 && seen[0].opts.timeout <= 10000);
  });

  test('empty or null output means no open PR; an exec failure propagates', () => {
    assert.equal(makeLookupOpenPr(() => '')('b', '.'), null);
    assert.equal(makeLookupOpenPr(() => 'null\n')('b', '.'), null);
    assert.throws(() => makeLookupOpenPr(() => { throw new Error('gh: not logged in'); })('b', '.'), /not logged in/);
  });

  test('output that is not a PR number is a failure, not "no PR"', () => {
    assert.throws(() => makeLookupOpenPr(() => 'To get started with GitHub CLI, please run: gh auth login\n')('b', '.'));
  });

  test('makeCurrentBranch reads git rev-parse in cwd; detached HEAD is null', () => {
    const seen = [];
    const cur = makeCurrentBranch((file, args, opts) => {
      seen.push({ file, args, opts });
      return 'feat/here\n';
    });
    assert.equal(cur('C:/repo'), 'feat/here');
    assert.equal(seen[0].file, 'git');
    assert.deepEqual(seen[0].args, ['rev-parse', '--abbrev-ref', 'HEAD']);
    assert.equal(seen[0].opts.cwd, 'C:/repo');
    assert.equal(makeCurrentBranch(() => 'HEAD\n')('.'), null);
  });
});

describe('run - what the hook prints', () => {
  test('merge: post-merge instruction naming the PR and the agent', () => {
    const out = run(bash('gh pr merge 222 --squash'), { lookupOpenPr: fakeLookup({}), currentBranch: fakeBranch('x') });
    const h = parseOut(out);
    assert.equal(h.hookEventName, 'PostToolUse');
    assert.match(h.additionalContext, /merge-guard/);
    assert.match(h.additionalContext, /#222/);
    assert.match(h.additionalContext, /post-merge/);
    assert.match(h.additionalContext, /VERDICT: GREEN/);
  });

  test('create: pre-merge instruction', () => {
    const input = bash('gh pr create --fill', { tool_response: { stdout: 'https://github.com/o/r/pull/223\n' } });
    const h = parseOut(run(input, { lookupOpenPr: fakeLookup({}), currentBranch: fakeBranch('x') }));
    assert.match(h.additionalContext, /#223/);
    assert.match(h.additionalContext, /pre-merge/);
  });

  test('push to a branch with an open PR into main: pre-merge on that PR', () => {
    const lookup = fakeLookup({ 'feat/x': 221 });
    const h = parseOut(run(bash('git push origin feat/x'), { lookupOpenPr: lookup, currentBranch: fakeBranch('nope') }));
    assert.match(h.additionalContext, /#221/);
    assert.match(h.additionalContext, /pre-merge/);
    assert.deepEqual(lookup.calls, [{ branch: 'feat/x', cwd: 'C:/repo' }]);
  });

  test('push to a branch with no open PR prints nothing', () => {
    const out = run(bash('git push -u origin feat/none'), { lookupOpenPr: fakeLookup({ other: 1 }), currentBranch: fakeBranch('x') });
    assert.equal(out, '');
  });

  test('push with no refspec resolves the current branch in the -C directory', () => {
    const lookup = fakeLookup({ 'feat/cur': 230 });
    const cur = fakeBranch('feat/cur');
    const out = run(bash('git -C sub push', { cwd: path.resolve('/base') }), { lookupOpenPr: lookup, currentBranch: cur });
    assert.match(parseOut(out).additionalContext, /#230/);
    assert.deepEqual(cur.calls, [path.resolve('/base', 'sub')]);
    assert.deepEqual(lookup.calls, [{ branch: 'feat/cur', cwd: path.resolve('/base', 'sub') }]);
  });

  test('push when the lookup fails still fires, and says the lookup failed', () => {
    const out = run(bash('git push origin feat/x'), { lookupOpenPr: brokenLookup(), currentBranch: fakeBranch('x') });
    const h = parseOut(out);
    assert.match(h.additionalContext, /merge-guard/);
    assert.match(h.additionalContext, /feat\/x/);
    assert.match(h.additionalContext, /lookup failed/i);
  });

  test('push when the branch cannot be resolved still fires', () => {
    const out = run(bash('git push'), { lookupOpenPr: fakeLookup({}), currentBranch: fakeBranch(null) });
    assert.match(parseOut(out).additionalContext, /could not be resolved/i);
  });

  test('a merge without a number tells the session how to find the PR', () => {
    const h = parseOut(run(bash('gh pr merge --squash --delete-branch'), { lookupOpenPr: fakeLookup({}), currentBranch: fakeBranch('x') }));
    assert.match(h.additionalContext, /gh pr list --state merged/);
  });

  test('ignored commands print nothing and never call the lookup', () => {
    const lookup = fakeLookup({ 'feat/x': 1 });
    assert.equal(run(bash('git status'), { lookupOpenPr: lookup, currentBranch: fakeBranch('feat/x') }), '');
    assert.equal(run(bash('git push --dry-run origin feat/x'), { lookupOpenPr: lookup, currentBranch: fakeBranch('feat/x') }), '');
    assert.equal(lookup.calls.length, 0);
  });

  test('only PostToolUse events fire', () => {
    const input = { ...bash('gh pr merge 222 --squash'), hook_event_name: 'PreToolUse' };
    assert.equal(run(input, { lookupOpenPr: fakeLookup({}), currentBranch: fakeBranch('x') }), '');
  });
});

describe('handle - raw stdin text', () => {
  const deps = { lookupOpenPr: fakeLookup({}), currentBranch: fakeBranch('x') };
  for (const raw of ['', 'not json', '{', 'null', '[]', '42', '"str"', '{"tool_name": 5}']) {
    test(`malformed input ${JSON.stringify(raw)} prints nothing and does not throw`, () => {
      assert.equal(handle(raw, deps), '');
    });
  }
  test('a well-formed merge passes through', () => {
    assert.match(handle(JSON.stringify(bash('gh pr merge 5')), deps), /#5/);
  });
});

describe('end to end - the script as the hook runner starts it, stdin piped', () => {
  const exec = (stdin) => spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: 'utf8', timeout: 15000 });

  test('gh pr merge 222 --squash prints valid JSON naming 222 and merge-guard', () => {
    const r = exec(JSON.stringify(bash('gh pr merge 222 --squash', { cwd: REPO_ROOT })));
    assert.equal(r.status, 0, r.stderr);
    const h = parseOut(r.stdout);
    assert.equal(h.hookEventName, 'PostToolUse');
    assert.match(h.additionalContext, /222/);
    assert.match(h.additionalContext, /merge-guard/);
  });

  test('git status prints nothing', () => {
    const r = exec(JSON.stringify(bash('git status', { cwd: REPO_ROOT })));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });

  test('malformed stdin prints nothing and exits 0', () => {
    const r = exec('this is {not json');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });
});

describe('wiring - the committed settings point at this hook', () => {
  const settings = JSON.parse(readFileSync(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8'));
  const entries = (settings.hooks && settings.hooks.PostToolUse) || [];
  const entry = entries.find((e) => (e.hooks || []).some((h) => /merge-guard-trigger\.mjs/.test(h.command || '')));

  test('a PostToolUse entry runs merge-guard-trigger.mjs, and the file exists', () => {
    assert.ok(entry, 'no PostToolUse hook runs merge-guard-trigger.mjs');
    const hook = entry.hooks.find((h) => /merge-guard-trigger\.mjs/.test(h.command));
    assert.equal(hook.type, 'command');
    assert.match(hook.command, /\.claude\/hooks\/merge-guard-trigger\.mjs/);
    assert.ok(hook.timeout >= 15, 'the lookup needs up to 10s');
    assert.ok(existsSync(SCRIPT));
  });

  test('its matcher covers every tool the classifier reads', () => {
    const re = new RegExp(`^(?:${entry.matcher})$`);
    for (const name of [
      'Bash',
      'PowerShell',
      'mcp__plugin_github_github__merge_pull_request',
      'mcp__plugin_github_github__create_pull_request',
    ]) {
      assert.ok(re.test(name), `matcher misses ${name}`);
    }
    assert.ok(!re.test('Read'));
  });

  test('the agent it dispatches exists', () => {
    const agent = readFileSync(path.join(REPO_ROOT, '.claude', 'agents', 'merge-guard.md'), 'utf8');
    assert.match(agent, /^---\nname: merge-guard\n/);
  });
});
