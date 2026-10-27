'use strict';

// OPS-303 / OPS-304 · docs/runbooks/android-release-signing.md — the custody of the upload key.
//
// The release key lives only under the Windows account kokonada-signer, and sign-release.ps1 checks
// its own session, its four tools' hashes and its input's path, but never the folders' owners or
// permissions. Those are set once, by hand, from the runbook, so the runbook's commands are the only
// control over them. This test pins those COMMANDS — the fenced lines of the provisioning section
// and of the signer session, and their order — not the prose around them: a prose sentence that
// says the right thing next to a command that does the wrong thing must fail here (RA-41,
// SEC-264-14 on #264 at 13fc700).
//
// What each block guards, by finding:
// - SEC-264-10, RA-32 (d8a8edc): folders owned by the owner's account and inheriting C:\'s defaults.
// - SEC-264-13, RA-32 residual (13fc700): children created before the root was protected, so a
//   watcher could plant bin\jdk\ and have the real JDK nested under it.
// - RA-39 (13fc700): the elevated window ran the profile, user modules, cmd AutoRun and git.
// - RA-42 (13fc700): files the elevated window creates may belong to the owner's account.
// - SEC-264-15 (13fc700): a hard-coded build-tools folder name.
// - SEC-264-12 (13fc700): the signer's Windows password typed into the owner's session (runas).
// - RA-43 (66058cb): the root made by New-Item inherited C:\'s Authenticated Users Modify until it
//   was closed, so a watcher could swap it for a junction; now one CreateDirectory call carries its
//   final security descriptor, and step 7 sweeps the tree for reparse points.
// - RA-44 (66058cb): a second /grant:r on a folder, Set-Acl, takeown, cacls, /restore or a cmd
//   mkdir could change a folder without failing this test.
// - RA-45 (66058cb) and the owner's ruling of 2026-10-27: the daily account's elevated window could
//   load user modules (PSReadLine) and resolve bare program names through a user PATH. Provisioning
//   now runs from a separate administrator, kokonada-admin, created with no password typed in the
//   daily account's window; every Windows program runs by its full System32 path.
//
// A pure read of one markdown file: no fs writes, no child process, no network.

const fs = require('fs');
const path = require('path');

const RUNBOOK = fs.readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'runbooks', 'android-release-signing.md'),
  'utf8',
);

// The text between a heading (or a bold step title) and the next marker after it.
function between(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return '';
  const to = text.indexOf(end, from + start.length);
  return to < 0 ? text.slice(from) : text.slice(from, to);
}

// Every line inside a ``` fence of `text`, trimmed, in document order.
function fencedLines(text) {
  const out = [];
  let inside = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inside = !inside;
      continue;
    }
    if (inside && line.length > 0) out.push(line);
  }
  return out;
}

const PROVISIONING = between(RUNBOOK, '### Provisioning, once, by the owner', '\n## 3.');
const SIGNER_SESSION = between(RUNBOOK, "**Step 2, in the signer's own Windows session.**", 'What the script does, in order');
// The commands only: the expected Get-Acl listing of step 7 is a fence too, but it holds no command.
const CMDS = fencedLines(PROVISIONING).filter((l) => !/^(Path|Owner|AreAccessRulesProtected|AccessToString)\s+:|^(BUILTIN|NT AUTHORITY|<PC>)\\/.test(l));
const RUN_CMDS = fencedLines(SIGNER_SESSION);
const ROOT = 'C:\\KokonadaSigner';
const FOLDERS = ['in', 'work', 'out', 'bin', 'vault'];
const dirOf = (f) => (f ? `${ROOT}\\${f}` : ROOT);

const idx = (pred) => CMDS.findIndex(pred);
const lastIdx = (pred) => {
  for (let i = CMDS.length - 1; i >= 0; i -= 1) if (pred(CMDS[i])) return i;
  return -1;
};
const isCmd = (l, prefix) => l === prefix || l.startsWith(`${prefix} `);
const SYS32 = 'C:\\Windows\\System32\\';
const ICACLS = `${SYS32}icacls.exe`;
const NET = `${SYS32}net.exe`;
const CMD = `${SYS32}cmd.exe`;
// The quoted arguments of an `icacls <dir> /grant:r` line, sorted.
const grantsOf = (l) => (l.match(/'[^']*'/g) || []).map((q) => q.slice(1, -1)).sort();
const grantLines = (dir) => CMDS.filter((l) => isCmd(l, `${ICACLS} ${dir} /grant:r`));
// A line that creates something below the root: New-Item, a cmd or PowerShell mkdir/md, or CreateDirectory.
const createsChild = (l) =>
  l.includes(`${ROOT}\\`) && (/^New-Item\b/.test(l) || /(^|[\s"';{(])(mkdir|md|ni)\s/i.test(l) || /CreateDirectory\(/.test(l));
// The commands typed in the owner's normal (unelevated) window of provisioning step 4.
const OWNER_WINDOW = new Set([
  'git -C <checkout> fetch origin',
  `${CMD} /d /c "git -C <checkout> show origin/main:mobile/KokonadaHealth/scripts/release/sign-release.ps1 > %TEMP%\\sign-release.ps1"`,
]);
// Every command string the owner types in provisioning and in the signer session: the fenced lines and the
// inline code spans of the prose (a removal command such as `cmd.exe /d /c rmdir` is given in prose).
const codeSpans = (text) => (text.match(/`[^`\n]+`/g) || []).map((s) => s.slice(1, -1));
const TYPED = [...CMDS, ...RUN_CMDS, ...codeSpans(PROVISIONING), ...codeSpans(SIGNER_SESSION)];

const BT_ZIP = `${ROOT}\\bin\\stage\\build-tools_r37_windows.zip`;
const JDK_ZIP = `${ROOT}\\bin\\stage\\OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip`;
const BT_SHA1 = 'e9c97e26b5b5678002e9d3fed632c841ae62d99f';
const BT_SHA256 = '68075aa319ed8a01cf1a565ed1e61a3c1a801dd49191c35851248dc293c33b1a';
const JDK_SHA256 = 'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0';
const PSMODULEPATH = '$env:PSModulePath = "$PSHOME\\Modules"';
const NOPROFILE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile';
const PSREADLINE = '(Get-Module PSReadLine).Path';
const LBPU = '(Get-ItemProperty HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa).LimitBlankPasswordUse';

describe('the provisioning commands give each folder exactly its owner and its permissions (SEC-264-10, RA-32, RA-41)', () => {
  it('has a provisioning section with commands', () => {
    expect(PROVISIONING.length).toBeGreaterThan(0);
    expect(CMDS.length).toBeGreaterThan(20);
  });

  // Each folder has exactly one /grant:r, so no earlier grant can leave an ACE behind (RA-44). The
  // expected sets are the table of step 2.
  const EXPECTED = {
    '': ['*S-1-5-18:F', '*S-1-5-32-544:F', '<owner>:RX', 'kokonada-signer:RX'],
    in: ['*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '<owner>:(OI)(CI)M', 'kokonada-signer:(OI)(CI)RX'],
    work: ['*S-1-5-18:(OI)(CI)F', 'kokonada-signer:(OI)(CI)M'],
    out: ['*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '<owner>:(OI)(CI)RX', 'kokonada-signer:(OI)(CI)M'],
    bin: ['*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '<owner>:(OI)(CI)RX', 'kokonada-signer:(OI)(CI)RX'],
    vault: ['*S-1-5-18:(OI)(CI)F', 'kokonada-signer:(OI)(CI)M'],
  };
  for (const [f, expected] of Object.entries(EXPECTED)) {
    it(`grants ${f || 'the root'} exactly ${expected.join(', ')}, in one /grant:r`, () => {
      const lines = grantLines(dirOf(f));
      expect(lines).toHaveLength(1);
      expect(grantsOf(lines[0])).toEqual([...expected].sort());
    });
  }

  it('never grants a principal outside the table, and never Modify or Full to the owner\'s account outside in\\', () => {
    const grants = CMDS.filter((c) => /icacls(\.exe)? \S+ \/grant/i.test(c));
    expect(grants).toHaveLength(Object.keys(EXPECTED).length);
    for (const l of grants) {
      for (const g of grantsOf(l)) {
        expect(g).toMatch(/^(\*S-1-5-32-544|\*S-1-5-18|<owner>|kokonada-signer):/);
        if (g.startsWith('<owner>:') && !l.startsWith(`${ICACLS} ${dirOf('in')} `)) expect(g).toMatch(/:(\(OI\)\(CI\))?RX$/);
      }
    }
    expect(CMDS.join('\n')).not.toMatch(/\/grant(?!:r)/);
  });

  it('changes permissions and owners only through icacls /grant:r, /setowner, /inheritance:r and /reset, never Set-Acl, takeown, cacls, /restore, /deny or a mkdir (RA-44)', () => {
    for (const l of [...CMDS, ...RUN_CMDS]) {
      const tokens = l.split(/[\s;|&(){}"']+/).filter(Boolean).map((t) => t.split('\\').pop().replace(/\.exe$/i, '').toLowerCase());
      for (const bad of ['set-acl', 'takeown', 'cacls', 'mkdir', 'md', 'ni']) expect(tokens).not.toContain(bad);
      expect(l).not.toMatch(/\/(restore|deny|substitute)\b/i);
      for (const m of l.matchAll(/icacls(\.exe)? \S+ (\/\S+)/gi)) expect(m[2]).toMatch(/^\/(grant:r|setowner|inheritance:r|reset)$/);
    }
  });

  it('sets Administrators as the owner of the tree and kokonada-signer of work\\ and vault\\, nothing else', () => {
    const owners = CMDS.filter((l) => / \/setowner /.test(l));
    for (const l of owners) expect(l).toMatch(/\/setowner (\*S-1-5-32-544|kokonada-signer)( |$)/);
    expect(owners).toContain(`${ICACLS} ${ROOT} /setowner *S-1-5-32-544 /T /C`);
    expect(owners).toContain(`${ICACLS} ${dirOf('work')} /setowner kokonada-signer`);
    expect(owners).toContain(`${ICACLS} ${dirOf('vault')} /setowner kokonada-signer`);
    expect(owners.filter((l) => /kokonada-signer/.test(l))).toHaveLength(2);
  });

  it('removes inheritance on every folder after its grant, and makes the root\'s grants this-folder-only last', () => {
    const rootFinal = lastIdx((l) => isCmd(l, `${ICACLS} ${ROOT} /grant:r`));
    for (const f of FOLDERS) {
      const inh = idx((l) => l === `${ICACLS} ${dirOf(f)} /inheritance:r`);
      const grant = lastIdx((l) => isCmd(l, `${ICACLS} ${dirOf(f)} /grant:r`));
      expect(inh).toBeGreaterThan(grant);
      expect(inh).toBeLessThan(rootFinal);
    }
  });
});

describe('the root is made with its final security descriptor in one call, refusing an existing path, and checked before any child (RA-43, SEC-264-13)', () => {
  const firstChild = () => idx(createsChild);
  const SD = [
    '$sd = New-Object System.Security.AccessControl.DirectorySecurity',
    "$sd.SetOwner([System.Security.Principal.SecurityIdentifier]'S-1-5-32-544')",
    '$sd.SetAccessRuleProtection($true, $false)',
  ];
  const rule = (sid) =>
    `$sd.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.SecurityIdentifier]'${sid}', 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))`;
  const CREATE = `if (Test-Path ${ROOT}) { 'STOP: ${ROOT} exists' } else { [void][System.IO.Directory]::CreateDirectory('${ROOT}', $sd) }`;
  const ATTR = `(Get-Item ${ROOT} -Force).Attributes`;
  const OWNER = `(Get-Acl ${ROOT}).Owner`;

  it('never makes the root with New-Item, mkdir or md, and makes it in exactly one CreateDirectory', () => {
    for (const l of CMDS) {
      expect(l).not.toMatch(/^New-Item\b.*C:\\KokonadaSigner\s*$/);
      expect(l).not.toMatch(/(^|\s)(mkdir|md|ni)\s+C:\\KokonadaSigner\s*$/i);
    }
    expect(CMDS.filter((l) => l.includes(`CreateDirectory('${ROOT}'`))).toEqual([CREATE]);
  });

  it('builds the descriptor (owner Administrators, protected, Full (OI)(CI) for Administrators and SYSTEM only) before the create line, which starts with the Test-Path refusal', () => {
    const create = idx((l) => l === CREATE);
    expect(create).toBeGreaterThan(-1);
    expect(CREATE.startsWith(`if (Test-Path ${ROOT}) { 'STOP`)).toBe(true);
    let prev = -1;
    for (const l of SD) {
      const at = idx((c) => c === l);
      expect(at).toBeGreaterThan(prev);
      prev = at;
    }
    expect(prev).toBeLessThan(create);
    const rules = CMDS.filter((l) => l.startsWith('$sd.AddAccessRule('));
    expect(rules.sort()).toEqual([rule('S-1-5-18'), rule('S-1-5-32-544')].sort());
    for (const r of rules) expect(idx((c) => c === r)).toBeLessThan(create);
    expect(create).toBeLessThan(firstChild());
  });

  it('checks the root\'s attributes, owner and emptiness after the create line and before any child, and states what each must print', () => {
    const create = idx((l) => l === CREATE);
    for (const c of [ATTR, OWNER, `Get-ChildItem ${ROOT} -Recurse -Force`]) {
      const at = idx((l) => l === c);
      expect(at).toBeGreaterThan(create);
      expect(at).toBeLessThan(firstChild());
    }
    const step2 = between(PROVISIONING, '2. **The folders', '3. **');
    expect(step2).toMatch(/`\(Get-Item C:\\KokonadaSigner -Force\)\.Attributes` must print `Directory`/);
    expect(step2).toMatch(/`\(Get-Acl C:\\KokonadaSigner\)\.Owner` must print `BUILTIN\\Administrators`/);
    expect(step2).toMatch(/must print nothing/);
  });

  it('runs no icacls on the root before the children exist: its permissions come from the descriptor alone', () => {
    const first = firstChild();
    expect(first).toBeGreaterThan(-1);
    for (const l of CMDS.slice(0, first)) expect(l).not.toMatch(new RegExp(`icacls(\\.exe)? ${ROOT.replace(/\\/g, '\\\\')}( |$)`, 'i'));
    expect(CMDS).not.toContain(`${ICACLS} ${ROOT} /inheritance:r`);
  });

  it('removes a tree it did not make with cmd.exe\'s rmdir, which does not follow links', () => {
    expect(PROVISIONING).toContain(`\`${CMD} /d /c rmdir /s /q ${ROOT}\``);
  });
});

describe('provisioning runs from a separate administrator account, kokonada-admin, created with no password typed in the daily account\'s window (the owner\'s ruling of 2026-10-27, RA-45)', () => {
  const STEP0 = between(PROVISIONING, '0. **The provisioning administrator.**', '**The elevated window.**');
  const STEP0_CMDS = fencedLines(STEP0);
  const CREATE_ADMIN = `if (${LBPU} -eq 1) { ${NET} user kokonada-admin /add } else { 'STOP: blank passwords are not limited to console sign-in' }`;

  it('has a step 0 before step 1', () => {
    expect(STEP0.length).toBeGreaterThan(0);
    expect(PROVISIONING.indexOf('0. **The provisioning administrator.**')).toBeLessThan(PROVISIONING.indexOf('1. **The account.**'));
  });

  it('types exactly four lines in the daily account\'s elevated window: PSModulePath, the LimitBlankPasswordUse check, the guarded create and the Administrators membership', () => {
    expect(STEP0_CMDS).toEqual([PSMODULEPATH, LBPU, CREATE_ADMIN, `${NET} localgroup Administrators kokonada-admin /add`]);
    expect(STEP0).toContain(NOPROFILE);
    expect(STEP0).toMatch(/Ctrl\+Shift\+Enter/);
  });

  it('checks LimitBlankPasswordUse prints 1 before the account exists, and marks it not verified on this machine', () => {
    expect(STEP0).toMatch(/must print `1`/);
    expect(STEP0).toMatch(/console/);
    expect(STEP0).toMatch(/NOT VERIFIED on this machine/);
  });

  it('types no password in that window, and sets it at the sign-in screen through Ctrl+Alt+Del', () => {
    expect(STEP0).toMatch(/type no password/i);
    expect(STEP0).toMatch(/\*\*Switch user\*\*/);
    expect(STEP0).toMatch(/Windows sign-in screen/);
    expect(STEP0).toMatch(/Ctrl\+Alt\+Del[^.]*\*\*Change a password\*\*/);
    expect(STEP0).toMatch(/password manager the owner's Windows account cannot read/);
  });

  it('never puts a password, or a password prompt, on any net.exe user line', () => {
    const users = [...CMDS, ...codeSpans(PROVISIONING)].filter((l) => /net(\.exe)? user /i.test(l));
    expect(users.length).toBeGreaterThan(1);
    for (const l of users) {
      for (const m of l.matchAll(/net(\.exe)? user (\S+)(.*?)(?=\s*\}|$)/gi)) {
        expect(m[2]).toMatch(/^kokonada-(admin|signer)$/);
        expect(m[3].trim()).toBe('/add');
      }
    }
  });

  it('runs steps 1 to 6 in kokonada-admin\'s own session, never by elevating the daily account or typing its password into his session', () => {
    expect(PROVISIONING).toMatch(/Steps 1 to 6 run in `kokonada-admin`'s own session/);
    expect(PROVISIONING).toMatch(/never typed into a User Account Control prompt, a `runas`/);
  });
});

describe('every elevated window runs no code from a profile, user modules, cmd AutoRun, a user PATH or a checkout (RA-39, RA-45)', () => {
  it('is opened as powershell.exe -NoProfile by its full path, elevated from the Run dialog', () => {
    expect(PROVISIONING).toContain(NOPROFILE);
    expect(PROVISIONING).toMatch(/Ctrl\+Shift\+Enter/);
  });

  it('fixes PSModulePath before any other command, and in kokonada-admin\'s window then prints where PSReadLine came from', () => {
    expect(CMDS[0]).toBe(PSMODULEPATH);
    const admin = between(PROVISIONING, '**The elevated window.**', '1. **The account.**');
    expect(fencedLines(admin)).toEqual([PSMODULEPATH, PSREADLINE]);
    expect(admin).toContain('C:\\Program Files\\WindowsPowerShell\\Modules\\');
    expect(admin).toMatch(/\$PSHOME|C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\/);
  });

  it('runs every cmd with /d', () => {
    expect(RUNBOOK).not.toMatch(/cmd \/c\b/);
    expect(RUNBOOK).not.toMatch(/cmd(\.exe)? \/(?!d)/i);
  });

  it('runs icacls, net, cmd and curl only by their full System32 path, in every command of provisioning and of the signer session (RA-45)', () => {
    expect(TYPED.length).toBeGreaterThan(40);
    for (const l of TYPED) {
      for (const m of l.matchAll(/(^|[\s;{(|&"])(icacls|net|cmd|curl)(\.exe)?(?=\s)/gi)) {
        throw new Error(`bare ${m[2]} in: ${l}`);
      }
      for (const m of l.matchAll(/(\S*)\b(icacls|net|cmd|curl)\.exe\b/gi)) {
        if (m[1] !== '') expect(m[1]).toBe(SYS32);
        else throw new Error(`bare ${m[2]}.exe in: ${l}`);
      }
    }
  });

  it('runs git only in the owner\'s normal window, into %TEMP%, and copies into bin\\ from the elevated window', () => {
    const git = CMDS.filter((l) => /\bgit\b/.test(l));
    expect(git.length).toBeGreaterThan(0);
    for (const l of git) {
      expect(l).not.toMatch(/C:\\KokonadaSigner/);
      expect(OWNER_WINDOW.has(l)).toBe(true);
    }
    expect(CMDS).toContain(
      `${CMD} /d /c "git -C <checkout> show origin/main:mobile/KokonadaHealth/scripts/release/sign-release.ps1 > %TEMP%\\sign-release.ps1"`,
    );
    const copy = idx((l) => l === `${CMD} /d /c copy /b <temp>\\sign-release.ps1 ${ROOT}\\bin\\sign-release.ps1`);
    const hash = idx((l) => l === `Get-FileHash ${ROOT}\\bin\\sign-release.ps1 -Algorithm SHA256`);
    expect(copy).toBeGreaterThan(-1);
    expect(hash).toBeGreaterThan(copy);
    expect(between(PROVISIONING, '4. **The script.**', '5. **')).toMatch(/normal window/);
  });
});

describe('files the elevated window creates belong to Administrators (RA-42)', () => {
  it('proves the default owner with a probe before the first download', () => {
    const probe = idx((l) => l === `(Get-Acl ${ROOT}\\bin\\probe).Owner`);
    const curl = idx((l) => /curl\.exe/.test(l));
    expect(probe).toBeGreaterThan(idx((l) => l === `New-Item -ItemType File -Path ${ROOT}\\bin\\probe`));
    expect(probe).toBeGreaterThan(-1);
    expect(probe).toBeLessThan(curl);
    expect(idx((l) => l === `Remove-Item ${ROOT}\\bin\\probe`)).toBeGreaterThan(probe);
    expect(PROVISIONING).toMatch(/must print `BUILTIN\\Administrators`/);
  });

  it('re-owns bin\\ after the pins are written into the script', () => {
    const write = idx((l) => l === '[System.IO.File]::WriteAllText($f, $t)');
    expect(write).toBeGreaterThan(-1);
    expect(lastIdx((l) => l === `${ICACLS} ${ROOT}\\bin /setowner *S-1-5-32-544 /T /C`)).toBeGreaterThan(write);
  });
});

describe('the four pins are written from Get-FileHash without an editor, keeping the script\'s LF bytes (security-auditor S3 at 66058cb)', () => {
  const STEP5 = between(PROVISIONING, '5. **The four tool pins.**', '6. **');
  const S5 = fencedLines(STEP5);
  const PINS = [
    ['ZipalignSha256', `${ROOT}\\bin\\build-tools\\zipalign.exe`],
    ['Aapt2Sha256', `${ROOT}\\bin\\build-tools\\aapt2.exe`],
    ['ApksignerSha256', `${ROOT}\\bin\\build-tools\\lib\\apksigner.jar`],
    ['JavaSha256', `${ROOT}\\bin\\jdk\\bin\\java.exe`],
  ];

  it('reads, replaces each placeholder line once from its tool\'s hash, and writes with [System.IO.File], in that order', () => {
    expect(S5[0]).toBe(`$f = '${ROOT}\\bin\\sign-release.ps1'`);
    expect(S5[1]).toBe('$t = [System.IO.File]::ReadAllText($f)');
    PINS.forEach(([name, tool], i) => {
      expect(S5[2 + i]).toBe(
        `$t = $t.Replace('$${name} = ''<pin after provisioning>''', '$${name} = ''' + (Get-FileHash ${tool} -Algorithm SHA256).Hash.ToLowerInvariant() + '''')`,
      );
    });
    expect(S5[6]).toBe('[System.IO.File]::WriteAllText($f, $t)');
  });

  it('checks four filled pins and no carriage return, and uses no editor or Set-Content', () => {
    expect(S5).toContain("Select-String -LiteralPath $f -CaseSensitive -Pattern '^\\$(Zipalign|Aapt2|Apksigner|Java)Sha256 = ''[0-9a-f]{64}''$'");
    expect(S5).toContain('[System.IO.File]::ReadAllText($f).Contains("`r")');
    expect(STEP5).toMatch(/exactly four lines/);
    expect(STEP5).toMatch(/must print `False`/);
    for (const l of CMDS) expect(l).not.toMatch(/notepad|Set-Content|Out-File/i);
    expect(STEP5).toMatch(/Notepad/);
  });
});

describe('the tools are checked against exact hashes before they are unpacked, and moved only into empty places (RA-33, SEC-264-14, SEC-264-13, SEC-264-15)', () => {
  it('downloads build-tools from dl.google.com and names Google\'s SDK repository manifest', () => {
    expect(CMDS).toContain(`C:\\Windows\\System32\\curl.exe -fL -o ${BT_ZIP} https://dl.google.com/android/repository/build-tools_r37_windows.zip`);
    expect(PROVISIONING).toMatch(/https:\/\/dl\.google\.com\/android\/repository\/repository2-\d+\.xml/);
    expect(PROVISIONING).toMatch(/whole folder/);
  });

  it('unpacks build-tools only inside a guard on its exact SHA-1 and SHA-256', () => {
    const lines = CMDS.filter((l) => l.includes('Expand-Archive') && l.includes(BT_ZIP));
    expect(lines).toHaveLength(1);
    const l = lines[0];
    const at = l.indexOf('Expand-Archive');
    expect(l.startsWith('if (')).toBe(true);
    expect(l.indexOf(`(Get-FileHash ${BT_ZIP} -Algorithm SHA1).Hash -eq '${BT_SHA1}'`)).toBeGreaterThan(-1);
    expect(l.indexOf(`(Get-FileHash ${BT_ZIP} -Algorithm SHA1).Hash -eq '${BT_SHA1}'`)).toBeLessThan(at);
    expect(l.indexOf(`(Get-FileHash ${BT_ZIP} -Algorithm SHA256).Hash -eq '${BT_SHA256}'`)).toBeGreaterThan(-1);
    expect(l.indexOf(`(Get-FileHash ${BT_ZIP} -Algorithm SHA256).Hash -eq '${BT_SHA256}'`)).toBeLessThan(at);
    expect(l).toMatch(/ -and /);
  });

  it('unpacks the JDK only inside a guard on its exact SHA-256', () => {
    const lines = CMDS.filter((l) => l.includes('Expand-Archive') && l.includes(JDK_ZIP));
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.startsWith('if (')).toBe(true);
    const guard = l.indexOf(`(Get-FileHash ${JDK_ZIP} -Algorithm SHA256).Hash -eq '${JDK_SHA256}'`);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(l.indexOf('Expand-Archive'));
  });

  it('has no Expand-Archive outside those two guards, and none before the downloads', () => {
    const all = CMDS.filter((l) => l.includes('Expand-Archive'));
    expect(all).toHaveLength(2);
    expect(idx((l) => l.includes('Expand-Archive'))).toBeGreaterThan(lastIdx((l) => /curl\.exe/.test(l)));
  });

  it('moves each tree into bin\\ only when its stage holds one folder and the target does not exist', () => {
    for (const [stage, target] of [['bt', 'build-tools'], ['jdk', 'jdk']]) {
      const moves = CMDS.filter((l) => /Move-Item/.test(l) && l.includes(`${ROOT}\\bin\\${target}`) && !l.includes(`${ROOT}\\bin\\${target}\\`));
      expect(moves).toHaveLength(1);
      const l = moves[0];
      expect(l).toContain(`@(Get-ChildItem ${ROOT}\\bin\\stage\\${stage} -Directory)`);
      const guard = l.indexOf(`-not (Test-Path ${ROOT}\\bin\\${target})`);
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(l.indexOf('Move-Item'));
      expect(l).toMatch(/\.Count -eq 1/);
      expect(l).toMatch(/\} else \{ 'STOP/);
    }
    expect(CMDS.filter((l) => /Move-Item/.test(l))).toHaveLength(2);
    expect(RUNBOOK).not.toMatch(/android-37\.0/);
  });

  it('resets bin\\\'s owners and the two trees\' permissions after the move', () => {
    const lastMove = lastIdx((l) => /Move-Item/.test(l));
    for (const c of [`${ICACLS} ${ROOT}\\bin /setowner *S-1-5-32-544 /T /C`, `${ICACLS} ${ROOT}\\bin\\build-tools /reset /T /C`, `${ICACLS} ${ROOT}\\bin\\jdk /reset /T /C`]) {
      expect(lastIdx((l) => l === c)).toBeGreaterThan(lastMove);
    }
  });
});

describe('step 7 lists every entry under the root and checks it against the expected set (SEC-264-13, RA-32 residual)', () => {
  const STEP7 = between(PROVISIONING, '7. **The permission check.**', '8. **');
  const PASS = between(STEP7, '**Pass criterion.**', '8. **');

  it('runs the six Get-Acl, the bin\\ owner sweep, the two name listings and the recursive content listing with owners', () => {
    expect(CMDS).toContain(
      `Get-Acl -Path ${ROOT}, ${dirOf('in')}, ${dirOf('work')}, ${dirOf('out')}, ${dirOf('bin')}, ${dirOf('vault')} | Format-List Path,Owner,AreAccessRulesProtected,AccessToString`,
    );
    expect(CMDS).toContain(
      `Get-ChildItem ${ROOT}\\bin -Recurse -Force | Get-Acl | Where-Object { $_.Owner -ne 'BUILTIN\\Administrators' -or $_.AreAccessRulesProtected -or @($_.Access | Where-Object { -not $_.IsInherited }).Count -gt 0 } | Format-List Path,Owner`,
    );
    expect(CMDS).toContain(`(Get-ChildItem ${ROOT} -Force).Name`);
    expect(CMDS).toContain(`(Get-ChildItem ${ROOT}\\bin -Force).Name`);
    expect(CMDS).toContain(
      `Get-ChildItem ${dirOf('in')}, ${dirOf('work')}, ${dirOf('out')}, ${dirOf('vault')} -Recurse -Force | Get-Acl | Format-List Path,Owner,AreAccessRulesProtected,AccessToString`,
    );
  });

  it('runs in kokonada-signer\'s own -NoProfile window, which can read all six, and prints where PSReadLine came from', () => {
    expect(STEP7).toContain(NOPROFILE);
    const s7 = fencedLines(STEP7);
    expect(s7[0]).toBe(PSMODULEPATH);
    expect(s7[1]).toBe(PSREADLINE);
  });

  it('checks that the root is a plain directory and that no reparse point sits anywhere under it, before the permission listings (RA-43)', () => {
    const s7 = fencedLines(STEP7);
    const attr = s7.indexOf(`(Get-Item ${ROOT} -Force).Attributes`);
    const sweep = s7.indexOf(`Get-ChildItem ${ROOT} -Recurse -Force -Attributes ReparsePoint`);
    const acl = s7.findIndex((l) => l.startsWith(`Get-Acl -Path ${ROOT},`));
    expect(attr).toBeGreaterThan(-1);
    expect(sweep).toBeGreaterThan(-1);
    expect(acl).toBeGreaterThan(attr);
    expect(acl).toBeGreaterThan(sweep);
    expect(PASS).toMatch(/`\(Get-Item C:\\KokonadaSigner -Force\)\.Attributes` prints `Directory`/);
    expect(PASS).toMatch(/reparse point/);
    expect(PASS).toMatch(/`ReparsePoint` sweep prints nothing/);
    expect(PASS).toMatch(/`\(Get-Module PSReadLine\)\.Path` prints nothing or a path that starts with `C:\\Program Files\\WindowsPowerShell\\Modules\\`/);
  });

  it('names the forbidden principals inside the pass criterion', () => {
    for (const p of ['Everyone', 'BUILTIN\\Users', 'Authenticated Users', 'CREATOR OWNER']) expect(PASS).toContain(p);
  });

  it('states the exact top-level sets and the expected contents of work\\ and vault\\ at each moment', () => {
    expect(PASS).toMatch(/exactly `bin`, `in`, `out`, `vault` and `work`/);
    expect(PASS).toMatch(/exactly `build-tools`, `jdk` and `sign-release\.ps1`/);
    expect(PASS).toMatch(/`work\\` holds nothing/);
    expect(PASS).toMatch(/before step 8[^.]*`vault\\` holds nothing/);
    expect(PASS).toMatch(/exactly `kokonada-upload\.p12` and `ks\.pass`/);
    expect(PASS).toMatch(/`<PC>\\kokonada-signer`/);
    expect(PASS).toMatch(/AreAccessRulesProtected` is `False`/);
  });
});

describe('the signer\'s Windows password never enters the owner\'s session (SEC-264-12)', () => {
  const STEP1 = between(PROVISIONING, '1. **The account.**', '2. **');

  it('step 1 creates the account with no password and sets it only at the sign-in screen through Ctrl+Alt+Del, kept where the owner\'s account cannot read it, never through the clipboard', () => {
    expect(fencedLines(STEP1)).toContain(`${NET} user kokonada-signer /add`);
    expect(STEP1).toMatch(/Windows sign-in screen/);
    expect(STEP1).toMatch(/Ctrl\+Alt\+Del[^.]*\*\*Change a password\*\*/);
    expect(STEP1).not.toMatch(/net(\.exe)? user kokonada-signer \*/);
    expect(STEP1).toMatch(/password manager the owner's Windows account cannot read/);
    expect(STEP1).toMatch(/separate device/);
    expect(STEP1).toMatch(/never through the clipboard/i);
    expect(STEP1).toMatch(/never typed into a `runas` prompt or any console window/);
  });

  it('runs no runas anywhere in provisioning, and leaves the :118 refusal capture open on MB-139', () => {
    expect(PROVISIONING).not.toMatch(/runas \/user/);
    const acceptance = between(PROVISIONING, '**Acceptance.**', '\n## ');
    expect(acceptance).not.toMatch(/runas/);
    expect(acceptance).toMatch(/`:118`[^.]*not captured/);
    expect(acceptance).toMatch(/`MB-139`/);
  });

  it('has no exception to "never runas"', () => {
    expect(RUNBOOK).not.toMatch(/one exception/i);
    expect(RUNBOOK).not.toMatch(/step 9 \(a\)/);
  });

  it('keeps the key password in the same kind of manager, typed and never pasted', () => {
    const key = between(PROVISIONING, '8. **The key and its password.**', '9. **');
    expect(key).toMatch(/cannot read/);
    expect(key).toMatch(/never through the clipboard/i);
  });
});

describe('the signer session re-checks the custody before every run, from a -NoProfile window (SEC-264-10, RA-32, RA-34, SEC-264 lead)', () => {
  it('opens the window as powershell.exe -NoProfile, fixes PSModulePath and prints where PSReadLine came from before any check', () => {
    expect(RUN_CMDS[0]).toBe(PSMODULEPATH);
    expect(RUN_CMDS[1]).toBe(PSREADLINE);
    expect(SIGNER_SESSION.indexOf(NOPROFILE)).toBeLessThan(SIGNER_SESSION.indexOf(PSMODULEPATH));
  });

  it('runs the script hash and the step 7 checks before the signing command', () => {
    const run = RUN_CMDS.findIndex((l) => l.includes('-File C:\\KokonadaSigner\\bin\\sign-release.ps1'));
    const hash = RUN_CMDS.indexOf(`Get-FileHash ${ROOT}\\bin\\sign-release.ps1 -Algorithm SHA256`);
    expect(run).toBeGreaterThan(0);
    expect(hash).toBeGreaterThan(0);
    expect(hash).toBeLessThan(run);
    const runText = SIGNER_SESSION.indexOf('-File C:\\KokonadaSigner\\bin\\sign-release.ps1');
    expect(SIGNER_SESSION.slice(0, runText)).toMatch(/provisioning step 7[^.]*pass criterion/);
  });

  it('resets the delivered APK\'s permissions before signing out', () => {
    const reset = SIGNER_SESSION.indexOf(`${ICACLS} C:\\KokonadaSigner\\out\\<name>.apk /reset`);
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(SIGNER_SESSION.indexOf('**Sign out**'));
  });
});

describe('the key is generated by one exact command, with no password on it (RA-35, SEC-264-11)', () => {
  const line = CMDS.find((l) => /keytool\.exe -genkeypair/.test(l)) || '';

  it('is PKCS12, RSA of at least 3072 bits, valid for at least 25 years', () => {
    expect(line).toMatch(/-storetype PKCS12/);
    expect(line).toMatch(/-keystore C:\\KokonadaSigner\\vault\\kokonada-upload\.p12/);
    expect(line).toMatch(/-alias kokonada-upload/);
    expect(line).toMatch(/-keyalg RSA/);
    expect(Number((line.match(/-keysize (\d+)/) || [])[1])).toBeGreaterThanOrEqual(3072);
    expect(Number((line.match(/-validity (\d+)/) || [])[1])).toBeGreaterThanOrEqual(9125);
  });

  it('takes the password at the prompt only, one password for store and key', () => {
    expect(line).not.toMatch(/-storepass|-keypass/);
    expect(PROVISIONING).toMatch(/one password/);
  });

  it('asks for a random password of at least 24 characters kept in the password manager', () => {
    const length = Number((PROVISIONING.match(/random one of at least (\d+) characters/) || [])[1]);
    expect(length).toBeGreaterThanOrEqual(24);
    expect(PROVISIONING).toMatch(/at least \d+ characters that the password manager generates and keeps/);
  });
});

describe('the runbook limits what a leaked upload key costs, and says what to do when one leaks (R-B7, R-B8, CA-264-10)', () => {
  it('has Google generate and keep the app signing key, and registers every Google-held certificate at launch', () => {
    expect(RUNBOOK).toMatch(/Google-generated app signing key/);
    expect(RUNBOOK).toMatch(/never upload your own/i);
    expect(RUNBOOK).toMatch(/[Aa]t launch[^.]*fingerprints of the Google-held app signing keys/);
    expect(RUNBOOK).toMatch(/three keys/);
  });

  it('has an incident response that resets the upload key', () => {
    const incident = between(RUNBOOK, '**If the upload key or its password leaks.**', '\n\n');
    expect(incident).toMatch(/upload key reset/);
    expect(incident).toMatch(/uninstall/i);
  });
});

describe('every run starts from a quiet machine, as hygiene and not as a control (R-B5)', () => {
  it('closes the sessions and the IDE, stops Gradle and Metro and checks the sentinel is not due, before the run command', () => {
    const run = SIGNER_SESSION.indexOf('-File C:\\KokonadaSigner\\bin\\sign-release.ps1');
    const before = SIGNER_SESSION.slice(0, run);
    for (const step of ['gradlew --stop', 'Metro', 'sentinel', 'IDE']) expect(before).toContain(step);
    expect(before).toMatch(/hygiene, not a control/);
  });
});

describe('the script is checked against the pin on github.com (RA-36, SEC-264-11)', () => {
  it('reads the pin from the runbook on github.com, on a second device, not from a checkout or this machine\'s browser', () => {
    expect(PROVISIONING).toMatch(/https:\/\/github\.com\/DanielMalede\/Kokonada\/blob\/main\/docs\/runbooks\/android-release-signing\.md/);
    expect(PROVISIONING).toContain('e5e738923aa03af15473261ca7c7abe859ef17031aed248cb9c466cd0e9d2606');
    expect(between(PROVISIONING, '4. **The script.**', '5. **')).toMatch(/on a second device, the phone/);
  });

  it('keeps the edited copy\'s hash in the password manager', () => {
    expect(PROVISIONING).toMatch(/edited copy[^.]*password manager/);
  });
});

describe('provisioning ends with an acceptance step that captures MB-139 (RA-37)', () => {
  it('lists the session pass, the two badging refusals and the 16 KB pass, recorded on OPS-304', () => {
    const acceptance = between(PROVISIONING, '**Acceptance.**', '\n## ');
    expect(acceptance.length).toBeGreaterThan(0);
    for (const ref of ['`:117`', '`:266`', '`:265`', '`:296-297`', '`MB-139`', '`OPS-304`']) expect(acceptance).toContain(ref);
  });
});

describe('the runbook states what it cannot prevent (SEC-264-8, SEC-264-11, RA-38)', () => {
  it('names the password\'s heap residual from the script header', () => {
    expect(RUNBOOK).toMatch(/garbage collector/);
    expect(RUNBOOK).toMatch(/`:56-58`/);
  });

  it('treats the old key and its passwords as exposed in every place they sit, and makes the rotation mandatory', () => {
    const notProvisioned = between(RUNBOOK, '**Not provisioned yet.**', '\n## 1.');
    for (const where of ['main checkout', 'h1-evidence', 'hx3-evidence', '`npm test *`', '`npm run *`', '`npx jest *`']) {
      expect(notProvisioned).toContain(where);
    }
    expect(notProvisioned).toMatch(/exposed to every session/);
    expect(notProvisioned).toMatch(/`F7`[^.]*mandatory/);
  });
});

describe('the licence and validity statements are the publishers\' own (ADV-264-A1, A4, A5)', () => {
  it('excludes Oracle JDK 17 for its OTN licence, names the SDK licence, and states Play\'s validity floor', () => {
    expect(PROVISIONING).toMatch(/Oracle JDK 17 \(updates after 17\.0\.12 are under the OTN licence, not NFTC\)/);
    expect(PROVISIONING).toMatch(/Android SDK License Agreement/);
    expect(PROVISIONING).toMatch(/22 October 2033/);
  });
});
