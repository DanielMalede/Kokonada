// Tests for the merge-guard trigger, a PostToolUse and PostToolUseFailure hook (DEC-143).
// Run from the repository root:  node --test .claude/hooks/merge-guard-trigger.test.mjs
// The backend suite runs this file too (backend/tests/mergeGuardHook.test.js, OPS-146).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, utimesSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classify, coordCommand, COORD_VALUE_FLAGS, makeLookupOpenPr, makeCurrentBranch, makeClaim, run, handle } from './merge-guard-trigger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'merge-guard-trigger.mjs');
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CWD = path.resolve('/proj');

const bash = (command, extra = {}) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command },
  tool_response: { stdout: '', stderr: '' },
  cwd: CWD,
  ...extra,
});
const ps = (command, extra = {}) => ({ ...bash(command, extra), tool_name: 'PowerShell' });
// A PostToolUseFailure payload as the hook runner sends it (captured live on 2026-10-06): no
// tool_response; `error` is "Exit code N" followed by the command's output.
const failed = (command, error, extra = {}) => {
  const { tool_response: _, ...rest } = bash(command, extra);
  return { ...rest, hook_event_name: 'PostToolUseFailure', error, is_interrupt: false };
};
const mcp = (name, toolInput, extra = {}) => ({
  hook_event_name: 'PostToolUse',
  tool_name: name,
  tool_input: toolInput,
  cwd: CWD,
  ...extra,
});

// A stateful fake of the open-PR lookup: a table of branch -> open PR into main, plus a call log.
function fakeLookup(table = {}) {
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
const deps = (over = {}) => ({ lookupOpenPr: fakeLookup(), currentBranch: fakeBranch('x'), projectDir: CWD, ...over });
const context = (out) => {
  const h = JSON.parse(out).hookSpecificOutput;
  assert.equal(typeof h.additionalContext, 'string');
  return h;
};
// The single hit of a command.
function one(input) {
  const hits = classify(input);
  assert.equal(hits.length, 1, `expected one hit, got ${JSON.stringify(hits)}`);
  return hits[0];
}

describe('classify - the kinds, in Bash and in PowerShell', () => {
  for (const [label, wrap] of [['Bash', bash], ['PowerShell', ps]]) {
    test(`${label}: gh pr merge <n> is a merge with its number`, () => {
      assert.deepEqual(one(wrap('gh pr merge 222 --squash --delete-branch')), {
        kind: 'merge', pr: 222, branch: null, dir: '', repo: null,
      });
    });

    test(`${label}: gh pr create is a create; its number comes from the output, later`, () => {
      assert.deepEqual(one(wrap('gh pr create --base main --title "t" --body-file pr.md')), {
        kind: 'create', pr: null, branch: null, dir: '', repo: null,
      });
    });

    test(`${label}: git push -u origin <branch> is a push of that branch`, () => {
      assert.deepEqual(one(wrap('git push -u origin feat/x')), {
        kind: 'push', pr: null, branch: 'feat/x', dir: '', repo: null,
      });
    });

    test(`${label}: gh pr update-branch <n> is a push to that PR (L-5)`, () => {
      assert.deepEqual(one(wrap('gh pr update-branch 222')), {
        kind: 'push', pr: 222, branch: null, dir: '', repo: null,
      });
    });
  }
});

// OPS-156: the coordinator opens the draft PR (start) and pushes to it (ship, rescope) inside its
// own child processes, and /ship then marks the PR ready. None of that is a literal `gh pr create`
// or `git push`, so the trigger names these commands itself.
describe('classify - the coordinator and gh pr ready (OPS-156)', () => {
  const START = '--task OPS-155 --title "Coordinator hardening" --paths scripts/coord/** --branch fix/ops155';
  const RAN_START = "the coordinator's start ran (it opens or resumes a draft PR)";

  for (const [label, wrap] of [['Bash', bash], ['PowerShell', ps]]) {
    test(`${label}: coord.js start is a create of its --branch`, () => {
      assert.deepEqual(one(wrap(`node scripts/coord/coord.js start ${START}`)), {
        kind: 'create', pr: null, branch: 'fix/ops155', dir: '', repo: null, ran: RAN_START,
      });
    });

    test(`${label}: coord.js ship and rescope are pushes of the current branch; ship --pr names its PR`, () => {
      assert.deepEqual(one(wrap('node scripts/coord/coord.js ship')), {
        kind: 'push', pr: null, branch: null, dir: '', repo: null, ran: "the coordinator's ship ran (it pushes the claim to the PR branch)",
      });
      assert.equal(one(wrap('node scripts/coord/coord.js ship --pr 229')).pr, 229);
      assert.equal(one(wrap('node scripts/coord/coord.js ship --pr=#229')).pr, 229);
      assert.deepEqual(one(wrap('node scripts/coord/coord.js rescope --paths a/b/c.js,d/e/f.js')), {
        kind: 'push', pr: null, branch: null, dir: '', repo: null, ran: "the coordinator's rescope ran (it pushes the claim to the PR branch)",
      });
    });

    test(`${label}: gh pr ready is a push to that PR`, () => {
      assert.deepEqual(one(wrap('gh pr ready 229')), {
        kind: 'push', pr: 229, branch: null, dir: '', repo: null, ran: 'a PR was marked ready for review',
      });
      assert.deepEqual(one(wrap('gh pr ready fix/x')), {
        kind: 'push', pr: null, branch: 'fix/x', dir: '', repo: null, ran: 'a PR was marked ready for review',
      });
      assert.equal(one(wrap('gh pr ready')).branch, null);
      assert.equal(one(wrap('gh pr ready https://github.com/DanielMalede/Kokonada/pull/229 -R o/r')).repo, 'o/r');
    });
  }

  test('any spelling of the script path: ./, backslashes, absolute, node.exe, a full node path', () => {
    const cases = [
      [bash, 'node ./scripts/coord/coord.js ship'],
      [bash, 'node "scripts\\coord\\coord.js" ship'],
      [bash, "node 'C:\\Users\\danie\\Videos\\Kokonada\\scripts\\coord\\coord.js' ship"],
      [bash, 'node /c/Users/danie/Videos/Kokonada/scripts/coord/coord.js ship'],
      [bash, 'node ../coord2/scripts/coord/coord.js ship'],
      [bash, 'node scripts/coord/coord ship'],
      [bash, 'node.exe scripts/coord/coord.js ship'],
      [bash, '"C:\\Program Files\\nodejs\\node.exe" scripts/coord/coord.js ship'],
      [bash, 'COORD_LOGIN=DanielMalede node --trace-warnings scripts/coord/coord.js ship'],
      [ps, 'node .\\scripts\\coord\\coord.js ship'],
      [ps, 'node scripts\\coord\\coord.js ship'],
      [ps, 'node C:\\Users\\danie\\Videos\\Kokonada\\scripts\\coord\\coord.js ship'],
      [ps, '& node .\\scripts\\coord\\coord.js ship'],
      [ps, 'NODE scripts/coord/COORD.JS ship'],
    ];
    for (const [wrap, cmd] of cases) assert.equal(classify(wrap(cmd)).length, 1, cmd);
  });

  test('the command is found the way coord.js finds it: after its flags, with = or a separate value', () => {
    assert.equal(one(bash(`node scripts/coord/coord.js --task OPS-155 start --branch=fix/y --title t --paths a/b/c.js`)).branch, 'fix/y');
    assert.equal(one(bash('node scripts/coord/coord.js --title ship start --branch fix/z --task own:z --paths a/b/c.js')).branch, 'fix/z');
    assert.equal(one(bash('node scripts/coord/coord.js --paths start rescope')).kind, 'push');
  });

  test('a cd before it sets the directory, as for git push', () => {
    assert.equal(one(bash('cd .worktree-fix-x && node ../scripts/coord/coord.js ship')).dir, '.worktree-fix-x');
  });

  test('a branch the shell computes is not guessed', () => {
    assert.equal(one(bash('node scripts/coord/coord.js start --branch "$B" --task own:x --title t --paths a/b/c.js')).branch, null);
  });

  const ignored = [
    'node scripts/coord/coord.js check --paths a/b/c.js',
    'node scripts/coord/coord.js check --merge 229',
    'node scripts/coord/coord.js status',
    'node scripts/coord/coord.js release',
    'node scripts/coord/coord.js ci --branch fix/x --author DanielMalede',
    'node scripts/coord/coord.js',
    'node scripts/coord/coord.js --help',
    'node scripts/coord/coord.js help',
    'node scripts/coord/coord.js start -h',
    `node scripts/coord/coord.js start ${START} --dry-run`,
    'node scripts/coord/coord.js ship --dry-run',
    'node scripts/coord/coord.js rescope --paths a/b/c.js --dry-run',
    'node scripts/coord/coord.js ship --help',
    'node other.js start',
    'node scripts/other/coordinator.js ship',
    'node other.js scripts/coord/coord.js ship',
    'node -e "require(\'./scripts/coord/coord.js\')"',
    'nodemon scripts/coord/coord.js ship',
    'echo node scripts/coord/coord.js ship',
    'git commit -m "node scripts/coord/coord.js ship"',
    'gh pr ready 229 --undo',
    'gh pr ready --help',
    'gh pr readyx 229',
  ];
  for (const cmd of ignored) {
    test(`ignores: ${JSON.stringify(cmd)}`, () => {
      assert.deepEqual(classify(bash(cmd)), []);
    });
  }

  test('L7: the value flags are exactly coord.js\'s, and each of its boolean flags reads as a boolean', () => {
    const require = createRequire(import.meta.url);
    const { VALUE_FLAGS, BOOL_FLAGS } = require(path.join(REPO_ROOT, 'scripts', 'coord', 'coord.js'));
    assert.deepEqual([...COORD_VALUE_FLAGS].sort(), [...VALUE_FLAGS].sort());
    assert.ok(BOOL_FLAGS.size > 0);
    for (const f of BOOL_FLAGS) {
      assert.ok(!COORD_VALUE_FLAGS.has(f), f);
      assert.deepEqual(coordCommand(['ship', `--${f}`, 'extra']), { cmd: 'ship', flags: { [f]: true } }, f);
    }
  });

  test('coordCommand reads every argument list exactly as coord.js parseArgs does', () => {
    const require = createRequire(import.meta.url);
    const { parseArgs } = require(path.join(REPO_ROOT, 'scripts', 'coord', 'coord.js'));
    for (const argv of [
      ['start', '--task', 'OPS-155', '--title', 'ship it', '--paths', 'a/b/c.js', '--branch', 'fix/x'],
      ['--task', 'OPS-155', 'start', '--branch=fix/x', '--paths', 'a/b/c.js', '--title', 'x'],
      ['--title', 'rescope', 'ship', '--pr', '7'],
      ['--paths', 'start', 'rescope'],
      ['ship', '--json', '--pr=7'],
      ['start', '--dry-run', '--branch', 'b', '--merge', '9', '--dir', 'd', '--author', 'a', '--mode', 'warn', '--resources', 'res:secrets'],
      ['-h', 'start'],
    ]) {
      const theirs = parseArgs(argv);
      const mine = coordCommand(argv);
      assert.deepEqual({ argv, cmd: mine.cmd, flags: mine.flags }, { argv, cmd: theirs.cmd, flags: theirs.flags });
    }
  });
});

describe('classify - gh pr merge and update-branch arguments', () => {
  test('the number comes from a PR URL', () => {
    assert.equal(one(bash('gh pr merge https://github.com/DanielMalede/Kokonada/pull/219 --squash')).pr, 219);
  });

  test('flag values are not mistaken for the PR argument', () => {
    assert.equal(one(bash('gh pr merge --squash --match-head-commit 508bedc 222')).pr, 222);
    assert.equal(one(bash('gh pr merge --subject "fix 5" -t 6 222 --squash')).pr, 222);
    assert.equal(one(bash('gh pr merge --match-head-commit=508bedc 222')).pr, 222);
    assert.equal(one(bash('gh pr merge -R o/r 222')).pr, 222);
  });

  test('no argument means the current branch PR; a branch argument is kept', () => {
    assert.deepEqual(one(bash('gh pr merge --squash --delete-branch')), {
      kind: 'merge', pr: null, branch: null, dir: '', repo: null,
    });
    assert.equal(one(bash('gh pr merge fix/x --squash')).branch, 'fix/x');
    assert.deepEqual(one(bash('gh pr update-branch feat/u --rebase')), {
      kind: 'push', pr: null, branch: 'feat/u', dir: '', repo: null,
    });
    assert.equal(one(bash('gh pr update-branch')).branch, null);
  });

  test('several merges in one command are all kept (L-1)', () => {
    const hits = classify(bash('gh pr merge 5 --squash && gh pr merge 6 --squash; gh pr merge fix/y'));
    assert.deepEqual(hits.map((h) => [h.kind, h.pr, h.branch]), [['merge', 5, null], ['merge', 6, null], ['merge', null, 'fix/y']]);
  });

  test('-R / --repo names another repository (L-7)', () => {
    assert.equal(one(bash('gh pr merge 5 -R octo/other')).repo, 'octo/other');
    assert.equal(one(bash('gh pr create --fill --repo=octo/other')).repo, 'octo/other');
    assert.equal(one(bash('gh pr update-branch 3 --repo octo/other')).repo, 'octo/other');
  });

  test('redirections do not become arguments', () => {
    assert.equal(one(bash('gh pr merge 222 --squash 2>&1 | tail -5')).pr, 222);
    assert.equal(one(bash('gh pr merge 2>/dev/null')).pr, null);
    assert.equal(one(ps('gh pr merge *>$null')).pr, null);
    assert.equal(one(bash('git push 2>&1 origin b11')).branch, 'b11');
  });
});

describe('classify - git push refspecs and options', () => {
  const branchOf = (cmd) => one(bash(cmd)).branch;

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

  test('a refspec the shell computes is kept as written, for run to refuse (M-1)', () => {
    assert.equal(branchOf('git push origin "$(git branch --show-current)"'), '\u0001');
    assert.equal(branchOf('git push origin $(git branch --show-current)'), '$');
    assert.equal(branchOf('git push origin `git branch --show-current`'), '`git');
    assert.equal(branchOf('git push origin $b'), '$b');
    assert.equal(branchOf('git push origin @'), '@');
    assert.equal(one(ps('git push origin $(git branch --show-current)')).branch, '$');
  });

  test('option values are not read as the remote or the refspec', () => {
    assert.equal(branchOf('git push -o ci.skip origin feat/o'), 'feat/o');
    assert.equal(branchOf('git push --push-option ci.skip origin feat/o'), 'feat/o');
    assert.equal(branchOf('git push --force-with-lease=feat/o:abc origin feat/o'), 'feat/o');
  });

  test('git -C <path> push carries the path; -c values are skipped', () => {
    assert.deepEqual(one(bash('git -C ../other push -u origin b')), {
      kind: 'push', pr: null, branch: 'b', dir: '../other', repo: null,
    });
    assert.equal(one(bash('git -c core.x=1 -C a -C b push')).dir, path.join('a', 'b'));
    assert.equal(one(ps('git -C C:\\Users\\danie\\repo push origin b')).dir, 'C:\\Users\\danie\\repo');
  });
});

describe('classify - earlier cd segments set the directory (M-2)', () => {
  const dirOf = (cmd, wrap = bash) => one(wrap(cmd)).dir;

  test('cd, pushd, Set-Location and sl', () => {
    assert.equal(dirOf('cd sub && git push'), 'sub');
    assert.equal(dirOf('pushd sub && git push'), 'sub');
    assert.equal(dirOf('Set-Location sub; git push', ps), 'sub');
    assert.equal(dirOf('Set-Location -Path sub; git push', ps), 'sub');
    assert.equal(dirOf('sl sub; git push', ps), 'sub');
  });

  test('they add up, with git -C and with absolute paths', () => {
    assert.equal(dirOf('cd a && cd b && git push'), path.join('a', 'b'));
    assert.equal(dirOf('cd sub && git -C x push'), path.join('sub', 'x'));
    assert.equal(dirOf('cd a && cd /abs && git push'), '/abs');
  });

  test('a bash subshell scopes its cd; PowerShell parentheses do not', () => {
    const hits = classify(bash('(cd sub && git push origin b1); git push origin b2'));
    assert.deepEqual(hits.map((h) => [h.branch, h.dir]), [['b1', 'sub'], ['b2', '']]);
    assert.equal(dirOf('(Set-Location sub); git push', ps), 'sub');
  });

  test('a directory it cannot know is null, or kept as written for run to refuse', () => {
    assert.equal(dirOf('cd && git push'), null);
    assert.equal(dirOf('cd - && git push'), null);
    assert.equal(dirOf('cd ~/repo && git push'), null);
    assert.equal(dirOf('pushd a && popd && git push'), null);
    assert.equal(dirOf('cd $d && git push'), '$d');
  });
});

describe('classify - chained commands', () => {
  test('&& chains, ; chains and newlines', () => {
    assert.equal(one(bash('cd backend && npm test && git push -u origin b1')).branch, 'b1');
    assert.equal(one(ps('Set-Location backend; npm test; git push -u origin b2')).branch, 'b2');
    assert.equal(one(bash('npm test\ngit push origin b3\n')).branch, 'b3');
    assert.equal(one(bash('FOO=1 git push origin b5 || echo failed')).branch, 'b5');
  });

  test('L7: env and timeout in front of the command are passed over, with their own options', () => {
    assert.equal(one(bash('env COORD_LOGIN=DanielMalede node scripts/coord/coord.js ship')).ran, "the coordinator's ship ran (it pushes the claim to the PR branch)");
    assert.equal(one(bash('env -u GH_TOKEN gh pr ready 7')).pr, 7);
    assert.equal(one(bash('env -i PATH=/usr/bin git push origin b13')).branch, 'b13');
    assert.equal(one(bash('timeout 120 git push origin b14')).branch, 'b14');
    assert.equal(one(bash('timeout -k 5 60s gh pr merge 5 --squash')).pr, 5);
    assert.equal(one(bash('timeout --signal=KILL 1m node scripts/coord/coord.js rescope --paths a/b/c.js')).kind, 'push');
    assert.equal(one(bash('nohup env FOO=1 timeout 30 git push origin b15')).branch, 'b15');
    assert.deepEqual(classify(bash('env')), []);
    assert.deepEqual(classify(bash('timeout 5 git status')), []);
    // env -C runs the command in a directory this hook does not resolve: unknown, so it fires with the note
    assert.equal(one(bash('env -C ../other git push')).dir, null);
    assert.equal(one(bash('env --chdir=../other git push')).dir, null);
    assert.match(context(run(bash('env -C ../other git push'), deps())).additionalContext, /could not be resolved/);
  });

  test('every relevant segment is a hit, in order', () => {
    assert.deepEqual(classify(bash('git push -u origin b && gh pr create --fill')).map((h) => h.kind), ['push', 'create']);
  });

  test('backslash and backtick line continuations join one command', () => {
    assert.equal(one(bash('git push \\\n  origin b6')).branch, 'b6');
    assert.equal(one(ps('git push `\n  origin b7')).branch, 'b7');
  });

  test('a bash backslash escapes the next character', () => {
    assert.equal(one(bash('git push origin feat/a\\ b')).branch, 'feat/a b');
  });

  test('blocks and keywords: PowerShell braces, bash { ...; } and if/then', () => {
    assert.equal(one(ps('if ($ok) {git push origin b8}')).branch, 'b8');
    assert.equal(one(bash('{ git push origin b9; }')).branch, 'b9');
    assert.equal(one(bash('if git push origin b10; then echo ok; fi')).branch, 'b10');
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
    'gh pr update-branch --help',
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
      assert.deepEqual(classify(bash(cmd)), []);
    });
  }

  test('a heredoc body does not add to the real command on the first line', () => {
    const cmd = "gh pr create --title t --body-file - <<'EOF'\ngh pr merge 99\nEOF";
    assert.equal(one(bash(cmd)).kind, 'create');
  });

  test('a <<- heredoc ends at its tab-indented delimiter', () => {
    const cmd = 'cat <<-EOF > n.txt\n\tgh pr merge 99\n\tEOF\ngit push origin b12';
    assert.equal(one(bash(cmd)).branch, 'b12');
  });

  test('a $(cat <<EOF) body inside double quotes is data, even with an unbalanced quote', () => {
    const cmd = 'gh pr create --title t --body "$(cat <<\'EOF\'\nWhy it "broke\ngh pr merge 99\nEOF\n)"';
    assert.equal(one(bash(cmd)).kind, 'create');
  });

  test('a PowerShell here-string body is data, even with an unbalanced quote', () => {
    const cmd = '$body = @"\nWhat it fixes: the "merge\ngh pr merge 99\n"@\ngit status';
    assert.deepEqual(classify(ps(cmd)), []);
  });

  test('other tools and missing commands', () => {
    assert.deepEqual(classify({ tool_name: 'Read', tool_input: { file_path: 'x' } }), []);
    assert.deepEqual(classify({ tool_name: 'Bash', tool_input: {} }), []);
    assert.deepEqual(classify({ tool_name: 'Bash' }), []);
    assert.deepEqual(classify(mcp('mcp__github__get_pull_request', { pullNumber: 5 })), []);
    assert.deepEqual(classify(null), []);
  });
});

describe('classify - GitHub MCP tools, any server name', () => {
  test('merge_pull_request takes pullNumber and names the repository', () => {
    assert.deepEqual(
      one(mcp('mcp__plugin_github_github__merge_pull_request', { owner: 'DanielMalede', repo: 'Kokonada', pullNumber: 224 })),
      { kind: 'merge', pr: 224, branch: null, dir: null, repo: 'DanielMalede/Kokonada' },
    );
    assert.equal(one(mcp('mcp__github__merge_pull_request', { pull_number: '9' })).pr, 9);
  });

  test('update_pull_request_branch is a push to that PR (L-5)', () => {
    assert.deepEqual(one(mcp('mcp__github__update_pull_request_branch', { pullNumber: 7 })), {
      kind: 'push', pr: 7, branch: null, dir: null, repo: null,
    });
  });

  test('create_pull_request keeps the head branch', () => {
    assert.deepEqual(one(mcp('mcp__gh__create_pull_request', { head: 'feat/m', base: 'main' })), {
      kind: 'create', pr: null, branch: 'feat/m', dir: null, repo: null,
    });
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

  test('makeClaim: the first claim of an id wins, a repeat loses, an unusable directory fails open', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mg-claim-'));
    try {
      const claim = makeClaim(dir);
      assert.deepEqual([claim('PostToolUse-toolu_1'), claim('PostToolUse-toolu_1'), claim('PostToolUseFailure-toolu_1')], [true, false, true]);
      writeFileSync(path.join(dir, 'a-file'), '');
      assert.equal(makeClaim(path.join(dir, 'a-file', 'sub'))('PostToolUse-toolu_2'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('makeClaim prunes claims older than a day', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mg-claim-'));
    try {
      const old = path.join(dir, 'PostToolUse-toolu_old');
      writeFileSync(old, '');
      const twoDaysAgo = (Date.now() - 2 * 86400000) / 1000;
      utimesSync(old, twoDaysAgo, twoDaysAgo);
      makeClaim(dir)('PostToolUse-toolu_new');
      assert.deepEqual(readdirSync(dir), ['PostToolUse-toolu_new']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe('run - after a successful call (PostToolUse)', () => {
  test('merge: post-merge instruction naming the PR, the agent and the sub-agent line (M-5)', () => {
    const h = context(run(bash('gh pr merge 222 --squash'), deps()));
    assert.equal(h.hookEventName, 'PostToolUse');
    assert.match(h.additionalContext, /^merge-guard trigger: /);
    assert.match(h.additionalContext, /Dispatch the merge-guard agent now on PR #222, phase post-merge\./);
    assert.match(h.additionalContext, /VERDICT: GREEN/);
    assert.ok(h.additionalContext.includes(
      'If you cannot dispatch agents (you are a sub-agent), make the first line of your final report: `merge-guard required: PR #222, post-merge`.',
    ));
  });

  test('several merges name every PR (L-1)', () => {
    const h = context(run(bash('gh pr merge 5 --squash && gh pr merge 6 --squash'), deps()));
    assert.match(h.additionalContext, /on PR #5, PR #6, phase post-merge/);
    assert.match(h.additionalContext, /`merge-guard required: PR #5, PR #6, post-merge`/);
  });

  test('a merge without a number tells the session how to find the PR', () => {
    const h = context(run(bash('gh pr merge --squash --delete-branch'), deps()));
    assert.match(h.additionalContext, /gh pr list --state merged/);
    assert.match(h.additionalContext, /`merge-guard required: PR #N, post-merge`/);
  });

  test('create: pre-merge, numbered from the last PR URL gh printed', () => {
    const input = bash('gh pr create --fill', {
      tool_response: { stdout: 'see https://github.com/o/r/pull/12\nhttps://github.com/o/r/pull/230\n' },
    });
    const h = context(run(input, deps()));
    assert.match(h.additionalContext, /on PR #230, phase pre-merge/);
  });

  test('create: a branch-creation link (/pull/new/<branch>) is not a PR number', () => {
    const input = bash('gh pr create --fill', { tool_response: { stdout: 'https://github.com/o/r/pull/new/b\n' } });
    assert.match(context(run(input, deps())).additionalContext, /the PR for the current branch/);
  });

  test('a create outranks a push in the same command, and a merge outranks both', () => {
    const lookup = fakeLookup({ b: 230 });
    const input = bash('git push -u origin b && gh pr create --fill', {
      tool_response: { stdout: 'https://github.com/o/r/pull/231\n' },
    });
    assert.match(context(run(input, deps({ lookupOpenPr: lookup }))).additionalContext, /on PR #231, phase pre-merge/);
    assert.equal(lookup.calls.length, 0);
    const merged = bash('gh pr create --fill && gh pr merge 9 --squash');
    assert.match(context(run(merged, deps())).additionalContext, /on PR #9, phase post-merge/);
  });

  test('MCP create reads "number" before any URL quoted in the body', () => {
    const input = mcp('mcp__plugin_github_github__create_pull_request', { head: 'feat/n', base: 'main' }, {
      tool_response: { number: 227, html_url: 'https://github.com/o/r/pull/227', body: 'follows https://github.com/o/r/pull/193' },
    });
    assert.match(context(run(input, deps())).additionalContext, /on PR #227, phase pre-merge/);
    const escaped = mcp('mcp__github__create_pull_request', { head: 'feat/n' }, {
      tool_response: [{ type: 'text', text: '{\\"number\\":17}' }],
    });
    assert.match(context(run(escaped, deps())).additionalContext, /PR #17/);
    const nothing = mcp('mcp__github__create_pull_request', { head: 'feat/n' }, { tool_response: 'created' });
    assert.match(context(run(nothing, deps())).additionalContext, /the PR for branch feat\/n/);
  });

  test('push to a branch with an open PR into main: pre-merge on that PR, looked up in cwd', () => {
    const lookup = fakeLookup({ 'feat/x': 221 });
    const h = context(run(bash('git push origin feat/x'), deps({ lookupOpenPr: lookup })));
    assert.match(h.additionalContext, /on PR #221, phase pre-merge/);
    assert.deepEqual(lookup.calls, [{ branch: 'feat/x', cwd: CWD }]);
  });

  test('push to a branch with no open PR prints nothing', () => {
    assert.equal(run(bash('git push -u origin feat/none'), deps({ lookupOpenPr: fakeLookup({ other: 1 }) })), '');
  });

  test('push with no refspec resolves the current branch in the cd and -C directory (M-2)', () => {
    const lookup = fakeLookup({ 'feat/cur': 230 });
    const cur = fakeBranch('feat/cur');
    const out = run(bash('cd sub && git -C deeper push'), deps({ lookupOpenPr: lookup, currentBranch: cur }));
    assert.match(context(out).additionalContext, /PR #230/);
    const dir = path.resolve(CWD, 'sub', 'deeper');
    assert.deepEqual(cur.calls, [dir]);
    assert.deepEqual(lookup.calls, [{ branch: 'feat/cur', cwd: dir }]);
  });

  test('a directory it cannot resolve fires with the note and looks nothing up (M-2)', () => {
    for (const cmd of ['cd $d && git push', 'cd && git push origin feat/x', 'pushd a; popd; git push']) {
      const lookup = fakeLookup({ 'feat/x': 1, x: 1 });
      const cur = fakeBranch('x');
      const h = context(run(bash(cmd), deps({ lookupOpenPr: lookup, currentBranch: cur })));
      assert.match(h.additionalContext, /could not be resolved/, cmd);
      assert.deepEqual([lookup.calls.length, cur.calls.length], [0, 0], cmd);
    }
  });

  test('a refspec the shell computes fires with the note and looks nothing up (M-1)', () => {
    for (const cmd of [
      'git push origin "$(git branch --show-current)"',
      'git push origin $(git branch --show-current)',
      'git push origin `git branch --show-current`',
      'git push origin $b',
      'git push origin @',
      'git push origin %BR%',
      'git push origin feat/{a,b}',
    ]) {
      const lookup = fakeLookup({ x: 1 });
      const cur = fakeBranch('x');
      const h = context(run(bash(cmd), deps({ lookupOpenPr: lookup, currentBranch: cur })));
      assert.match(h.additionalContext, /could not be resolved/, cmd);
      assert.deepEqual([lookup.calls.length, cur.calls.length], [0, 0], cmd);
    }
  });

  test('push when the lookup fails still fires, and says the lookup failed', () => {
    const h = context(run(bash('git push origin feat/x'), deps({ lookupOpenPr: brokenLookup() })));
    assert.match(h.additionalContext, /the PR for branch feat\/x/);
    assert.match(h.additionalContext, /lookup failed \(ENOENT\)/);
  });

  test('push when the current branch cannot be resolved still fires', () => {
    const h = context(run(bash('git push'), deps({ currentBranch: fakeBranch(null) })));
    assert.match(h.additionalContext, /could not be resolved/);
  });

  test('gh pr update-branch: with a number, that PR without a lookup; without, the current branch PR (L-5)', () => {
    const lookup = fakeLookup({ 'feat/cur': 88 });
    const h = context(run(bash('gh pr update-branch 222'), deps({ lookupOpenPr: lookup })));
    assert.match(h.additionalContext, /on PR #222, phase pre-merge/);
    assert.equal(lookup.calls.length, 0);
    const h2 = context(run(bash('gh pr update-branch'), deps({ lookupOpenPr: lookup, currentBranch: fakeBranch('feat/cur') })));
    assert.match(h2.additionalContext, /on PR #88, phase pre-merge/);
    const h3 = context(run(mcp('mcp__github__update_pull_request_branch', { pullNumber: 7 }), deps()));
    assert.match(h3.additionalContext, /on PR #7, phase pre-merge/);
    const h4 = context(run(mcp('mcp__github__update_pull_request_branch', {}), deps()));
    assert.match(h4.additionalContext, /could not be resolved/);
  });

  test('another repository is named (L-7)', () => {
    const lookup = fakeLookup({ b: 4 });
    const outside = context(run(bash('git -C ../other push origin b'), deps({ lookupOpenPr: lookup })));
    assert.ok(outside.additionalContext.includes(`ran in ${path.resolve(CWD, '../other')}, outside this project`));
    assert.deepEqual(lookup.calls, [{ branch: 'b', cwd: path.resolve(CWD, '../other') }]);
    const inside = context(run(bash('git -C sub push origin b'), deps({ lookupOpenPr: lookup })));
    assert.doesNotMatch(inside.additionalContext, /outside this project/);
    assert.match(context(run(bash('gh pr merge 5 -R octo/other'), deps())).additionalContext, /repository octo\/other/);
    const viaMcp = mcp('mcp__github__merge_pull_request', { owner: 'DanielMalede', repo: 'Kokonada', pullNumber: 3 });
    assert.match(context(run(viaMcp, deps())).additionalContext, /repository DanielMalede\/Kokonada/);
  });

  test('ignored commands print nothing and never call the lookups', () => {
    const lookup = fakeLookup({ 'feat/x': 1 });
    const cur = fakeBranch('feat/x');
    for (const cmd of ['git status', 'git push --dry-run origin feat/x', 'gh pr view 5']) {
      assert.equal(run(bash(cmd), deps({ lookupOpenPr: lookup, currentBranch: cur })), '');
    }
    assert.deepEqual([lookup.calls.length, cur.calls.length], [0, 0]);
  });

  test('only PostToolUse and PostToolUseFailure fire', () => {
    assert.equal(run({ ...bash('gh pr merge 222 --squash'), hook_event_name: 'PreToolUse' }, deps()), '');
  });

  test('a call already claimed by another run prints nothing and looks nothing up', () => {
    const seen = [];
    const claim = (id) => {
      seen.push(id);
      return seen.length === 1;
    };
    const lookup = fakeLookup({ 'feat/x': 1 });
    const input = bash('git push origin feat/x', { tool_use_id: 'toolu_9' });
    assert.match(run(input, deps({ claim, lookupOpenPr: lookup })), /PR #1/);
    assert.equal(run(input, deps({ claim, lookupOpenPr: lookup })), '');
    assert.deepEqual(seen, ['PostToolUse-toolu_9', 'PostToolUse-toolu_9']);
    assert.equal(lookup.calls.length, 1);
    assert.equal(run(bash('git status', { tool_use_id: 'toolu_10' }), deps({ claim })), '');
    assert.equal(seen.length, 2, 'an irrelevant command claims nothing');
  });
});

describe('run - the coordinator and gh pr ready (OPS-156)', () => {
  const START = 'node scripts/coord/coord.js start --task OPS-155 --title t --paths a/b/c.js --branch fix/ops155';
  const STARTED = 'CLEAR — claimed M01 for OPS-155\n  branch:   fix/ops155\n  worktree: C:/repo/.worktree-fix-ops155\n  draft PR: https://github.com/DanielMalede/Kokonada/pull/229\n';

  test('start: pre-merge on the draft PR it printed, saying the coordinator ran', () => {
    const h = context(run(bash(START, { tool_response: { stdout: STARTED } }), deps()));
    assert.match(h.additionalContext, /^merge-guard trigger: the coordinator's start ran \(it opens or resumes a draft PR\)\./);
    assert.match(h.additionalContext, /Dispatch the merge-guard agent now on PR #229, phase pre-merge\./);
    assert.ok(h.additionalContext.includes('`merge-guard required: PR #229, pre-merge`'));
  });

  test('start that exits 3 (WARN) has still opened its PR: the failure event fires on it', () => {
    const h = context(run(failed(START, `Exit code 3\n  WARN [shared] his branch also edits docs/design-v1/screens.md\n${STARTED}`), deps()));
    assert.equal(h.hookEventName, 'PostToolUseFailure');
    assert.match(h.additionalContext, /on PR #229, phase pre-merge/);
  });

  test('start that stopped before any PR prints nothing', () => {
    assert.equal(run(failed(START, 'Exit code 1\nHALT — nothing was changed: no branch, no worktree, no claim'), deps()), '');
    assert.equal(run(failed(START, 'Exit code 2\ncannot verify: gh pr list failed'), deps()), '');
  });

  test('ship and rescope: the PR of the branch checked out where they ran', () => {
    for (const cmd of ['cd .worktree-fix-x && node ../scripts/coord/coord.js ship', 'cd .worktree-fix-x && node ../scripts/coord/coord.js rescope --paths a/b/c.js']) {
      const lookup = fakeLookup({ 'fix/x': 229 });
      const cur = fakeBranch('fix/x');
      const h = context(run(bash(cmd), deps({ lookupOpenPr: lookup, currentBranch: cur })));
      assert.match(h.additionalContext, /on PR #229, phase pre-merge/, cmd);
      assert.match(h.additionalContext, /the coordinator's (ship|rescope) ran/, cmd);
      assert.deepEqual(cur.calls, [path.resolve(CWD, '.worktree-fix-x')], cmd);
    }
  });

  test('ship --pr N needs no lookup; a ship that failed still fires, since its push may have landed', () => {
    const lookup = fakeLookup({});
    assert.match(context(run(bash('node scripts/coord/coord.js ship --pr 229'), deps({ lookupOpenPr: lookup }))).additionalContext, /on PR #229/);
    assert.equal(lookup.calls.length, 0);
    const h = context(run(failed('node scripts/coord/coord.js ship', 'Exit code 2\ncannot verify: git push of fix/x failed'), deps({ lookupOpenPr: fakeLookup({ x: 230 }) })));
    assert.match(h.additionalContext, /on PR #230, phase pre-merge/);
  });

  test('ship on a branch with no open PR prints nothing', () => {
    assert.equal(run(bash('node scripts/coord/coord.js ship'), deps({ lookupOpenPr: fakeLookup({}) })), '');
  });

  test('gh pr ready N: pre-merge on that PR, without a lookup; with no number, the current branch PR', () => {
    const lookup = fakeLookup({ 'feat/cur': 88 });
    const h = context(run(bash('gh pr ready 229'), deps({ lookupOpenPr: lookup })));
    assert.match(h.additionalContext, /^merge-guard trigger: a PR was marked ready for review\./);
    assert.match(h.additionalContext, /on PR #229, phase pre-merge/);
    assert.equal(lookup.calls.length, 0);
    assert.match(context(run(ps('gh pr ready'), deps({ lookupOpenPr: lookup, currentBranch: fakeBranch('feat/cur') }))).additionalContext, /on PR #88/);
  });

  test('the /ship sequence (edit, then ready) fires once, on the PR', () => {
    const h = context(run(bash('gh pr edit 229 --body-file pr.md && gh pr ready 229'), deps()));
    assert.match(h.additionalContext, /on PR #229, phase pre-merge/);
  });
});

describe('run - after a failed call (PostToolUseFailure, H-1)', () => {
  test('a failed merge fires post-merge: the merge can land on GitHub and the local cleanup fail', () => {
    const input = failed(
      'gh pr merge 5 --squash --delete-branch',
      "Exit code 1\n✓ Squashed and merged pull request #5\nfailed to delete local branch fix/a: 'main' is checked out elsewhere",
    );
    const h = context(run(input, deps()));
    assert.equal(h.hookEventName, 'PostToolUseFailure');
    assert.match(h.additionalContext, /exited with an error/);
    assert.match(h.additionalContext, /on PR #5, phase post-merge/);
  });

  test('a failed push fires as usual: part of it may have reached the remote', () => {
    const lookup = fakeLookup({ 'feat/x': 221 });
    const input = failed('git push origin feat/x', 'Exit code 1\n ! [rejected]        feat/x -> feat/x (fetch first)');
    const h = context(run(input, deps({ lookupOpenPr: lookup })));
    assert.equal(h.hookEventName, 'PostToolUseFailure');
    assert.match(h.additionalContext, /on PR #221, phase pre-merge/);
    assert.deepEqual(lookup.calls, [{ branch: 'feat/x', cwd: CWD }]);
  });

  test('a failed create fires only when its error names the PR', () => {
    const exists = failed(
      'gh pr create --fill',
      'Exit code 1\na pull request for branch "feat/x" into branch "main" already exists:\nhttps://github.com/DanielMalede/Kokonada/pull/222',
    );
    const h = context(run(exists, deps()));
    assert.equal(h.hookEventName, 'PostToolUseFailure');
    assert.match(h.additionalContext, /on PR #222, phase pre-merge/);
    assert.equal(run(failed('gh pr create --fill', 'Exit code 1\nmust be on a branch named differently than "main"'), deps()), '');
    const viaMcp = { ...mcp('mcp__github__create_pull_request', { head: 'feat/x' }), hook_event_name: 'PostToolUseFailure', error: 'Validation Failed' };
    assert.equal(run(viaMcp, deps()), '');
  });

  test('a failed create with no PR in its error falls back to the push before it', () => {
    const lookup = fakeLookup({ 'feat/x': 230 });
    const input = failed('git push -u origin feat/x && gh pr create --fill', 'Exit code 1\nGraphQL: something went wrong');
    assert.match(context(run(input, deps({ lookupOpenPr: lookup }))).additionalContext, /on PR #230, phase pre-merge/);
  });
});

describe('handle - raw stdin text', () => {
  for (const raw of ['', 'not json', '{', 'null', '[]', '42', '"str"', '{"tool_name": 5}']) {
    test(`malformed input ${JSON.stringify(raw)} prints nothing and does not throw`, () => {
      assert.equal(handle(raw, deps()), '');
    });
  }
  test('a well-formed merge passes through', () => {
    assert.match(handle(JSON.stringify(bash('gh pr merge 5')), deps()), /#5/);
  });
});

describe('end to end - the script as the hook runner starts it, stdin piped', () => {
  const exec = (stdin, args = [SCRIPT], cwd = undefined) =>
    spawnSync(process.execPath, args, { input: stdin, cwd, encoding: 'utf8', timeout: 15000 });

  test('gh pr merge 222 prints valid JSON naming 222 and merge-guard', () => {
    const r = exec(JSON.stringify(bash('gh pr merge 222 --squash', { cwd: REPO_ROOT })));
    assert.equal(r.status, 0, r.stderr);
    const h = context(r.stdout);
    assert.equal(h.hookEventName, 'PostToolUse');
    assert.match(h.additionalContext, /PR #222/);
  });

  test('OPS-156: a coordinator start piped in as the runner sends it prints the instruction for its PR', () => {
    const input = bash('node scripts/coord/coord.js start --task OPS-155 --title t --paths a/b/c.js --branch fix/ops155', {
      cwd: REPO_ROOT,
      tool_response: { stdout: '  draft PR: https://github.com/DanielMalede/Kokonada/pull/229\n' },
    });
    const r = exec(JSON.stringify(input));
    assert.equal(r.status, 0, r.stderr);
    assert.match(context(r.stdout).additionalContext, /the coordinator's start ran.*on PR #229, phase pre-merge/);
  });

  test('a PostToolUseFailure payload is echoed with its own event name', () => {
    const r = exec(JSON.stringify(failed('gh pr merge 5', 'Exit code 1\nx', { cwd: REPO_ROOT })));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(context(r.stdout).hookEventName, 'PostToolUseFailure');
  });

  test('the entry guard holds when the script is named by a relative path (L-8)', () => {
    const r = exec(JSON.stringify(bash('gh pr merge 7', { cwd: REPO_ROOT })), ['.claude/hooks/merge-guard-trigger.mjs'], REPO_ROOT);
    assert.equal(r.status, 0, r.stderr);
    assert.match(context(r.stdout).additionalContext, /PR #7/);
  });

  test('two runs started at once for one tool call (two if filters matched): exactly one prints', async () => {
    const payload = JSON.stringify({ ...bash('gh pr merge 5', { cwd: REPO_ROOT }), tool_use_id: `toolu_test_${process.pid}_${Date.now()}` });
    const start = () => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT]);
      let out = '';
      child.stdout.on('data', (d) => {
        out += d;
      });
      child.on('close', (code) => resolve({ code, out }));
      child.stdin.end(payload);
    });
    const results = await Promise.all([start(), start(), start()]);
    assert.deepEqual(results.map((r) => r.code), [0, 0, 0]);
    assert.equal(results.filter((r) => r.out).length, 1);
  });

  test('git status prints nothing; malformed stdin prints nothing and exits 0', () => {
    for (const stdin of [JSON.stringify(bash('git status', { cwd: REPO_ROOT })), 'this is {not json']) {
      const r = exec(stdin);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
    }
  });
});

describe('wiring - the committed settings', () => {
  const settings = JSON.parse(readFileSync(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8'));
  const IF_FILTERS = ['Bash(git *)', 'Bash(gh pr *)', 'Bash(node *)', 'PowerShell(git *)', 'PowerShell(gh pr *)', 'PowerShell(node *)'];
  const MCP_MATCHER = 'mcp__.*__(merge_pull_request|create_pull_request|update_pull_request_branch)';
  const handlers = (event) => (settings.hooks?.[event] ?? []).flatMap((group) => (group.hooks ?? []).map((h) => ({ ...h, matcher: group.matcher })));
  const command = handlers('PostToolUse')[0]?.command;

  for (const event of ['PostToolUse', 'PostToolUseFailure']) {
    test(`${event}: the shell tools reach the script only through the six if filters, the MCP tools by matcher`, () => {
      const hs = handlers(event);
      assert.deepEqual(hs.filter((h) => h.if).map((h) => [h.matcher, h.if]), IF_FILTERS.map((f) => ['Bash|PowerShell', f]));
      assert.deepEqual(hs.filter((h) => !h.if).map((h) => h.matcher), [MCP_MATCHER]);
      for (const h of hs) {
        // One command string everywhere. The runner does NOT run a doubly matched call once (seen
        // live): the script's claim guard keeps it to one instruction.
        assert.equal(h.command, command);
        assert.equal(h.type, 'command');
        assert.ok(h.timeout >= 15, 'the lookup needs up to 10 s');
      }
      assert.match(command, /^node "\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/merge-guard-trigger\.mjs"$/);
      assert.ok(existsSync(SCRIPT));
    });
  }

  test('the MCP matcher takes any server name and only the three tools', () => {
    const re = new RegExp(`^(?:${MCP_MATCHER})$`);
    for (const name of [
      'mcp__plugin_github_github__merge_pull_request',
      'mcp__github__create_pull_request',
      'mcp__gh_enterprise__update_pull_request_branch',
    ]) {
      assert.ok(re.test(name), name);
    }
    assert.ok(!re.test('mcp__github__get_pull_request'));
    assert.ok(!re.test('Bash'));
  });

  // H-4 (a): the literal command string from settings.json, run the way the hook runner runs it
  // on Windows (Git Bash) and on Linux and macOS (bash), with CLAUDE_PROJECT_DIR set.
  const BASH = process.platform === 'win32'
    ? [process.env.CLAUDE_CODE_GIT_BASH_PATH, 'C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => p && existsSync(p))
    : 'bash';
  const hasBash = Boolean(BASH) && spawnSync(BASH, ['-c', 'exit 0']).status === 0;
  test('the literal settings command, run by bash -c, prints the instruction', {
    skip: hasBash ? false : 'no bash found (Git Bash on Windows): the hook command cannot run here either',
  }, () => {
    for (const input of [bash('gh pr merge 222 --squash', { cwd: REPO_ROOT }), failed('gh pr merge 6', 'Exit code 1\nx', { cwd: REPO_ROOT })]) {
      const r = spawnSync(BASH, ['-c', command], {
        input: JSON.stringify(input),
        env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT },
        encoding: 'utf8',
        timeout: 15000,
      });
      assert.equal(r.status, 0, r.stderr);
      const h = context(r.stdout);
      assert.equal(h.hookEventName, input.hook_event_name);
      assert.match(h.additionalContext, /^merge-guard trigger: /);
    }
  });

  test('every Bash deny rule has a PowerShell twin, every git rule a git -C twin, no duplicates', () => {
    const deny = settings.permissions.deny;
    assert.equal(new Set(deny).size, deny.length);
    const bashRules = deny.filter((r) => r.startsWith('Bash(')).map((r) => r.slice(5, -1));
    for (const r of bashRules) assert.ok(deny.includes(`PowerShell(${r})`), `no PowerShell twin for Bash(${r})`);
    for (const r of bashRules.filter((x) => x.startsWith('git ') && !x.startsWith('git -C '))) {
      // `git -C * clean*` would also refuse `git -C <dir> commit -m "clean up"`; a destructive clean needs an option.
      const twin = r === 'git clean*' ? 'git -C * clean -*' : r.replace(/^git /, 'git -C * ');
      assert.ok(bashRules.includes(twin), `no git -C twin for Bash(${r})`);
    }
  });

  // A model of the permission glob: * matches any run of characters and the whole command must match.
  const globMatch = (glob, cmd) => {
    const parts = glob.split('*');
    if (parts.length === 1) return glob === cmd;
    if (!cmd.startsWith(parts[0])) return false;
    let pos = parts[0].length;
    for (const mid of parts.slice(1, -1)) {
      const at = cmd.indexOf(mid, pos);
      if (at < 0) return false;
      pos = at + mid.length;
    }
    const last = parts[parts.length - 1];
    return cmd.length - last.length >= pos && cmd.endsWith(last);
  };
  const denied = (cmd) =>
    settings.permissions.deny.some((rule) => {
      const open = rule.indexOf('(');
      return globMatch(rule.slice(open + 1, -1), cmd);
    });

  test('H-5: a direct push to main is denied when arguments follow the bare word main', () => {
    for (const cmd of [
      'git push -u origin main',
      'git push -u origin main --no-verify',
      'git push -u origin main --follow-tags',
      'git push upstream main -q',
      'git push origin -d main -q',
      'git push -u origin main 2>&1',
      'git -C wt push -u origin main --no-verify',
      'git push origin +feat/x',
      'git push origin HEAD:refs/heads/main',
    ]) assert.ok(denied(cmd), `not denied: ${cmd}`);
  });

  test('H-5: everyday commands in this repository are not denied', () => {
    for (const cmd of [
      'git push -u origin feat/x',
      'git push origin HEAD',
      'git push -u origin chore/merge-guard-agent 2>&1',
      'git push origin feat/main-fix',
      'gh pr merge 5 --squash --delete-branch --match-head-commit abc123',
      'git -C wt log --oneline',
      'git -C wt commit -m "fix: tidy"',
    ]) assert.ok(!denied(cmd), `denied: ${cmd}`);
  });

  test('N-1: the instruction asks the session to act on the verdict, not to wait for a GREEN that may never come', () => {
    const h = context(run(bash('gh pr merge 222 --squash'), deps()));
    assert.ok(h.additionalContext.includes('acted on its verdict: on VERDICT: GREEN, continue.'));
    assert.ok(h.additionalContext.includes('follow its SESSION MUST'));
    assert.ok(h.additionalContext.includes('not retried in a loop'));
    assert.ok(!h.additionalContext.includes('until it returns VERDICT: GREEN'));
  });

  test('the agent it dispatches exists', () => {
    const agent = readFileSync(path.join(REPO_ROOT, '.claude', 'agents', 'merge-guard.md'), 'utf8');
    assert.match(agent, /^---\r?\nname: merge-guard\r?\n/);
  });
});
