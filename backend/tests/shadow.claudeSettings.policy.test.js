'use strict';

// shadow.claudeSettings.policy — the #270 audit's RA-2, RA-3, RA-4, RA-7. RED at 1f88913 on:
//  - denies that hold only if the runtime's `*` matches the empty string (`git checkout -- .`,
//    `git add -f x`, `git commit --no-verify -m x`, `git stash pop|apply`, and
//    `gh pr update-branch --rebase 1`, which `Bash(gh pr update-branch *)` allows): each needs an
//    un-starred form, as DEC-145's rules carry both `git push --force*` and `git *push --force*`,
//    with the `git -C *` and PowerShell twins merge-guard-trigger.test.mjs requires;
//  - `git diff --output=`, `git diff --ext-diff`, `git ls-remote origin --exec=`, `git add --force`.
// Green pins: attribution is the empty string, the whole DEC-145 list, no `*` as a `-c`/`-C` value,
// no wrapper, file reader or uploader among the allows, an Edit twin for every Read deny, and the
// flow strings of CLAUDE.md step 3 (sentinel.md § FILING), /ship, /merge and merge-guard.
// `git branch -D x` expects `ask`, not `deny`: the custodian's CU270-02 on #270 moved the force
// delete to the ask tier so that CLAUDE.md step 5's cleanup (`git branch -d`) stays possible.
// A model only: the runtime's own reading is settled by the `claude -p --setting-sources ""
// --settings` capture named in the audit (RA-1), never by this file. This model and the one in
// `backend/tests/claudeSettings.policy.test.js` differ on one rule (RA-6): there a trailing ` *`
// matches the bare command, here the strict reading needs one character for every `*` and never
// matches the bare command; the capture's `npm test` item settles which the runtime follows, and a
// shared model is a later row. Every deny must hold under the strict reading too.
// The sentinel's five strings and the adb path are derived from `.claude/settings.json`'s allow
// list by path-free patterns instead of being quoted (round 3): `backend/tests/personalDataGuard.
// test.js` counts every absolute user path in a tracked file. The auditor's intent is unchanged:
// the flows CLAUDE.md step 3 names must stay allowed, and never be denied under the strict reading.

const fs = require('fs');
const path = require('path');

const SETTINGS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '.claude', 'settings.json'), 'utf8'));
const { allow = [], ask = [], deny = [] } = SETTINGS.permissions || {};

const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const specs = (list, tool) =>
  list.filter((r) => r.startsWith(`${tool}(`) && r.endsWith(')')).map((r) => r.slice(tool.length + 1, -1));

// lenient: `*` matches any text and a trailing ` *` (the only wildcard) also matches the bare
// command — the policy test's reading. strict: `*` needs one character and the bare command is not
// matched. A deny must hold under strict too, so no deny depends on the disputed semantics.
function toRegex(spec, strict, ci) {
  let work = spec;
  let bare = '';
  if (!strict && work.endsWith(' *') && !work.slice(0, -2).includes('*')) {
    work = work.slice(0, -2);
    bare = '(?: .*)?';
  }
  return new RegExp(`^${work.split('*').map(esc).join(strict ? '.+' : '.*')}${bare}$`, ci ? 'is' : 's');
}
const hits = (list, tool, cmd, strict) =>
  specs(list, tool).some((s) => toRegex(s, strict, tool === 'PowerShell').test(cmd));
function decide(cmd, tool = 'Bash', strict = false) {
  if (hits(deny, tool, cmd, strict)) return 'deny';
  if (hits(ask, tool, cmd, strict)) return 'ask';
  if (hits(allow, tool, cmd, strict)) return 'allow';
  return 'prompt';
}

// The owner's-path commands, derived from the allow list (see the header): the five sentinel
// strings of CLAUDE.md step 3, and the adb binary the five adb rules share.
const allowCommands = specs(allow, 'Bash');
const SENTINEL_COMMANDS = allowCommands.filter((c) => c.startsWith('git -c core.hooksPath=/dev/null') && c.includes('/.claude/worktrees/sentinel '));
const ADB_MARK = '/platform-tools/adb.exe ';
const ADB_PATHS = [...new Set(allowCommands.filter((c) => c.includes(ADB_MARK)).map((c) => c.slice(0, c.indexOf(ADB_MARK) + ADB_MARK.length - 1)))];

describe('shadow: denies that must not depend on `*` matching nothing (RED at 1f88913)', () => {
  const bare = [
    'git checkout -- .',
    'git add -f x',
    'git commit --no-verify -m x',
    'git stash pop',
    'git stash apply',
    'gh pr update-branch --rebase 1',
  ];
  for (const cmd of bare) {
    for (const tool of ['Bash', 'PowerShell']) {
      it(`${tool}: denied under the strict reading: ${cmd}`, () => {
        expect(decide(cmd, tool, true)).toBe('deny');
      });
    }
  }
  for (const tool of ['Bash', 'PowerShell']) {
    it(`${tool}: asks under the strict reading (CU270-02): git branch -D x`, () => {
      expect(decide('git branch -D x', tool, true)).toBe('ask');
    });
  }
  // Green already: text stands between `git ` and the token, so no empty `*` is needed.
  for (const cmd of [
    'git diff --no-index /dev/null x',
    'git fetch --upload-pack=x .',
    'git ls-remote --upload-pack=x .',
    'git -c core.hooksPath=/dev/null push origin main',
  ]) {
    it(`strictly denied already: ${cmd}`, () => {
      expect(decide(cmd, 'Bash', true)).toBe('deny');
    });
  }
});

describe('shadow: allowed commands with an escape hatch (RED at 1f88913)', () => {
  const gaps = [
    'git diff --output=/tmp/x HEAD', // writes any file, .claude/settings.json included
    'git diff --ext-diff', // runs diff.external from .git/config
    'git ls-remote origin --exec=x', // git-ls-remote: --exec is --upload-pack
    'git add --force x', // the long form of -f
    'git add x --force',
  ];
  for (const cmd of gaps) {
    it(`denied: ${cmd}`, () => {
      expect(decide(cmd)).toBe('deny');
    });
  }
});

describe('shadow: structure pins the policy test leaves loose', () => {
  const shell = [...specs(allow, 'Bash'), ...specs(allow, 'PowerShell')];

  it('attribution.commit and attribution.pr are the empty string (CLAUDE.md § Working rules)', () => {
    expect(SETTINGS.attribution.commit).toBe('');
    expect(SETTINGS.attribution.pr).toBe('');
  });

  it('every DEC-145 rule (docs/design-v2/decisions/DEC-145.md:63) is denied for Bash and PowerShell', () => {
    const dec145 = [
      'git push --force*', 'git push -f*', 'git push --force-with-lease*', 'git push origin main*',
      'git push * main', 'git push * HEAD:main*', 'git reset --hard*', 'git clean*',
      'git stash drop*', 'git stash clear*', 'gh pr merge * --admin*',
    ];
    for (const r of dec145) {
      expect(deny).toContain(`Bash(${r})`);
      expect(deny).toContain(`PowerShell(${r})`);
    }
  });

  it('no allow rule makes `*` the value of git -c or -C (core.hooksPath, core.sshCommand, any directory)', () => {
    expect(shell.filter((r) => /^git(?:\s+-[cC]\s+[^*\s]+)*\s+-[cC]\s+\*/.test(r))).toEqual([]);
  });

  it('no allow rule starts with a wrapper, a file reader or an uploader', () => {
    const banned =
      /^(?:env|bash|sh|zsh|cmd|powershell|pwsh|eval|exec|xargs|timeout|nohup|command|sudo|node\s+-+[epr]\w*|perl|python\d*|ruby|php|cat|type|head|tail|less|more|sed|awk|grep|find|xxd|od|base64|strings|tee|cp|copy|mv|move|tar|zip|7z|curl|wget|scp|ssh|nc|ncat|openssl|certutil|bitsadmin|Get-Content|gc|Invoke-WebRequest|iwr|Invoke-RestMethod|irm|Copy-Item|Move-Item|Compress-Archive|Select-String|Out-File|Set-Content)(?:\s|$)/i;
    expect(shell.filter((r) => banned.test(r))).toEqual([]);
  });

  it('every Read deny has an Edit twin, and no Read allow is home-relative', () => {
    for (const r of specs(deny, 'Read')) expect(deny).toContain(`Edit(${r})`);
    expect(specs(allow, 'Read').filter((r) => r.startsWith('~'))).toEqual([]);
  });

  it('the derived flow strings are the sentinel\'s five exact allows and one adb binary', () => {
    expect(SENTINEL_COMMANDS).toHaveLength(5);
    expect(ADB_PATHS).toHaveLength(1);
  });
});

describe('shadow: the flows the policy test does not pin (green at 1f88913; red when a deny edit catches one)', () => {
  const flows = [
    // CLAUDE.md session start step 3 — .claude/agents/sentinel.md § FILING, the five strings, as
    // the allow list carries them:
    ...SENTINEL_COMMANDS,
    // CLAUDE.md steps 1 and 6, /ship, /merge, merge-guard:
    'git fetch --unshallow',
    'git fetch origin',
    'git merge origin/main',
    'git merge --no-edit origin/main',
    'git push origin HEAD',
    'git ls-remote origin',
    'git branch --show-current',
    'git branch --list',
    'gh pr list --state open',
    'gh pr checks 270',
    'gh pr diff 270 --name-only',
    'gh pr update-branch 270',
    'npm ci',
    'npm run lint',
    'npm run lint:design-system',
    'npm --prefix mobile/KokonadaHealth ci',
    ...ADB_PATHS.map((adb) => `${adb} logcat -d`),
  ];
  for (const cmd of flows) {
    it(`allowed, and never denied under the strict reading: ${cmd}`, () => {
      expect(decide(cmd)).toBe('allow');
      expect(decide(cmd, 'Bash', true)).not.toBe('deny');
    });
  }

  for (const cmd of [
    'gh pr comment 270 --body-file x',
    'gh pr edit 270 --body-file x',
    'gh pr create --fill',
    'gh pr close 270',
    'gh pr review 270 --approve',
  ]) {
    it(`asks: never unprompted, never hard-denied: ${cmd}`, () => {
      expect(decide(cmd)).toBe('ask');
    });
  }
});
