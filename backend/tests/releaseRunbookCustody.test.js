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
// The quoted arguments of an `icacls <dir> /grant:r` line, sorted.
const grantsOf = (l) => (l.match(/'[^']*'/g) || []).map((q) => q.slice(1, -1)).sort();
const grantLines = (dir) => CMDS.filter((l) => isCmd(l, `icacls ${dir} /grant:r`));

const BT_ZIP = `${ROOT}\\bin\\stage\\build-tools_r37_windows.zip`;
const JDK_ZIP = `${ROOT}\\bin\\stage\\OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip`;
const BT_SHA1 = 'e9c97e26b5b5678002e9d3fed632c841ae62d99f';
const BT_SHA256 = '68075aa319ed8a01cf1a565ed1e61a3c1a801dd49191c35851248dc293c33b1a';
const JDK_SHA256 = 'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0';
const PSMODULEPATH = '$env:PSModulePath = "$PSHOME\\Modules"';
const NOPROFILE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile';

describe('the provisioning commands give each folder exactly its owner and its permissions (SEC-264-10, RA-32, RA-41)', () => {
  it('has a provisioning section with commands', () => {
    expect(PROVISIONING.length).toBeGreaterThan(0);
    expect(CMDS.length).toBeGreaterThan(20);
  });

  // The last /grant:r of a folder is the one that stands. The expected sets are the table of step 2.
  const EXPECTED = {
    '': ['*S-1-5-18:F', '*S-1-5-32-544:F', '<owner>:RX', 'kokonada-signer:RX'],
    in: ['*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '<owner>:(OI)(CI)M', 'kokonada-signer:(OI)(CI)RX'],
    work: ['*S-1-5-18:(OI)(CI)F', 'kokonada-signer:(OI)(CI)M'],
    out: ['*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '<owner>:(OI)(CI)RX', 'kokonada-signer:(OI)(CI)M'],
    bin: ['*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '<owner>:(OI)(CI)RX', 'kokonada-signer:(OI)(CI)RX'],
    vault: ['*S-1-5-18:(OI)(CI)F', 'kokonada-signer:(OI)(CI)M'],
  };
  for (const [f, expected] of Object.entries(EXPECTED)) {
    it(`grants ${f || 'the root'} exactly ${expected.join(', ')}`, () => {
      const lines = grantLines(dirOf(f));
      expect(lines.length).toBeGreaterThan(0);
      expect(grantsOf(lines[lines.length - 1])).toEqual([...expected].sort());
    });
  }

  it('never grants a principal outside the table, and never Modify or Full to the owner\'s account outside in\\', () => {
    for (const l of CMDS.filter((c) => /^icacls \S+ \/grant/.test(c))) {
      for (const g of grantsOf(l)) {
        expect(g).toMatch(/^(\*S-1-5-32-544|\*S-1-5-18|<owner>|kokonada-signer):/);
        if (g.startsWith('<owner>:') && !l.startsWith(`icacls ${dirOf('in')} `)) expect(g).toMatch(/:(\(OI\)\(CI\))?RX$/);
      }
    }
    expect(CMDS.join('\n')).not.toMatch(/\/grant(?!:r)/);
  });

  it('sets Administrators as the owner of the tree and kokonada-signer of work\\ and vault\\, nothing else', () => {
    const owners = CMDS.filter((l) => / \/setowner /.test(l));
    for (const l of owners) expect(l).toMatch(/\/setowner (\*S-1-5-32-544|kokonada-signer)( |$)/);
    expect(owners).toContain(`icacls ${ROOT} /setowner *S-1-5-32-544 /T /C`);
    expect(owners).toContain(`icacls ${dirOf('work')} /setowner kokonada-signer`);
    expect(owners).toContain(`icacls ${dirOf('vault')} /setowner kokonada-signer`);
    expect(owners.filter((l) => /kokonada-signer/.test(l))).toHaveLength(2);
  });

  it('removes inheritance on every folder after its grant, and makes the root\'s grants this-folder-only last', () => {
    const rootFinal = lastIdx((l) => isCmd(l, `icacls ${ROOT} /grant:r`));
    for (const f of FOLDERS) {
      const inh = idx((l) => l === `icacls ${dirOf(f)} /inheritance:r`);
      const grant = lastIdx((l) => isCmd(l, `icacls ${dirOf(f)} /grant:r`));
      expect(inh).toBeGreaterThan(grant);
      expect(inh).toBeLessThan(rootFinal);
    }
  });
});

describe('the root is protected and found empty before any child is created (SEC-264-13, RA-32 residual)', () => {
  const firstChild = () => idx((l) => /^New-Item\b/.test(l) && l.includes(`${ROOT}\\`));
  it('creates the root alone first', () => {
    expect(CMDS).toContain(`New-Item -ItemType Directory -Path ${ROOT}`);
    expect(idx((l) => l === `New-Item -ItemType Directory -Path ${ROOT}`)).toBeLessThan(firstChild());
  });

  it('owns, grants (OI)(CI) to Administrators and SYSTEM only, and removes inheritance on the root, in that order, before any child', () => {
    const own = idx((l) => l === `icacls ${ROOT} /setowner *S-1-5-32-544`);
    const grant = idx((l) => isCmd(l, `icacls ${ROOT} /grant:r`));
    const inh = idx((l) => l === `icacls ${ROOT} /inheritance:r`);
    expect(own).toBeGreaterThan(-1);
    expect(grantsOf(CMDS[grant])).toEqual(['*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F']);
    expect(own).toBeLessThan(grant);
    expect(grant).toBeLessThan(inh);
    expect(inh).toBeLessThan(firstChild());
  });

  it('checks the root is empty after it is protected and before any child', () => {
    const empty = idx((l) => l === `Get-ChildItem ${ROOT} -Recurse -Force`);
    expect(empty).toBeGreaterThan(idx((l) => l === `icacls ${ROOT} /inheritance:r`));
    expect(empty).toBeLessThan(firstChild());
    expect(PROVISIONING).toMatch(/must print nothing/);
  });

  it('removes a tree it did not make with cmd\'s rmdir, which does not follow links', () => {
    expect(PROVISIONING).toMatch(/cmd \/d \/c rmdir \/s \/q C:\\KokonadaSigner/);
  });
});

describe('the elevated window runs no code from the owner\'s profile, modules, cmd AutoRun or checkout (RA-39)', () => {
  it('is opened as powershell.exe -NoProfile by its full path, elevated from the Run dialog', () => {
    expect(PROVISIONING).toContain(NOPROFILE);
    expect(PROVISIONING).toMatch(/Ctrl\+Shift\+Enter/);
  });

  it('fixes PSModulePath before any other command', () => {
    expect(CMDS[0]).toBe(PSMODULEPATH);
  });

  it('runs every cmd with /d', () => {
    expect(RUNBOOK).not.toMatch(/cmd \/c\b/);
    expect(RUNBOOK).not.toMatch(/cmd(\.exe)? \/(?!d)/i);
  });

  it('runs git only in the owner\'s normal window, into %TEMP%, and copies into bin\\ from the elevated window', () => {
    const git = CMDS.filter((l) => /\bgit\b/.test(l));
    expect(git.length).toBeGreaterThan(0);
    for (const l of git) expect(l).not.toMatch(/C:\\KokonadaSigner/);
    expect(CMDS).toContain(
      'cmd /d /c "git -C <checkout> show origin/main:mobile/KokonadaHealth/scripts/release/sign-release.ps1 > %TEMP%\\sign-release.ps1"',
    );
    const copy = idx((l) => l === `cmd /d /c copy /b <temp>\\sign-release.ps1 ${ROOT}\\bin\\sign-release.ps1`);
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
    const notepad = idx((l) => l.startsWith('C:\\Windows\\System32\\notepad.exe '));
    expect(notepad).toBeGreaterThan(-1);
    expect(lastIdx((l) => l === `icacls ${ROOT}\\bin /setowner *S-1-5-32-544 /T /C`)).toBeGreaterThan(notepad);
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
    for (const c of [`icacls ${ROOT}\\bin /setowner *S-1-5-32-544 /T /C`, `icacls ${ROOT}\\bin\\build-tools /reset /T /C`, `icacls ${ROOT}\\bin\\jdk /reset /T /C`]) {
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

  it('runs in kokonada-signer\'s own -NoProfile window, which can read all six', () => {
    expect(STEP7).toContain(NOPROFILE);
    expect(STEP7).toContain(PSMODULEPATH);
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

  it('step 1 types it only at the sign-in screen and the elevated net user prompt, kept where the owner\'s account cannot read it, never through the clipboard', () => {
    expect(STEP1).toMatch(/Windows sign-in screen/);
    expect(STEP1).toMatch(/`net user kokonada-signer \*`/);
    expect(STEP1).toMatch(/password manager the owner's Windows account cannot read/);
    expect(STEP1).toMatch(/separate device/);
    expect(STEP1).toMatch(/never through the clipboard/i);
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
  it('opens the window as powershell.exe -NoProfile and fixes PSModulePath before any check', () => {
    expect(RUN_CMDS[0]).toBe(PSMODULEPATH);
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
    const reset = SIGNER_SESSION.indexOf('icacls C:\\KokonadaSigner\\out\\<name>.apk /reset');
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
  it('reads the pin from the runbook on github.com, not from a checkout', () => {
    expect(PROVISIONING).toMatch(/https:\/\/github\.com\/DanielMalede\/Kokonada\/blob\/main\/docs\/runbooks\/android-release-signing\.md/);
    expect(PROVISIONING).toContain('e5e738923aa03af15473261ca7c7abe859ef17031aed248cb9c466cd0e9d2606');
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
