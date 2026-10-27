'use strict';

// OPS-303 / OPS-304 · docs/runbooks/android-release-signing.md — the custody of the upload key.
//
// The release key lives only under the Windows account kokonada-signer, and sign-release.ps1 checks
// its own session, its four tools' hashes and its input's path, but never the folders' owners or
// permissions. Those are set once, by hand, from the runbook, so the runbook is the only control
// over them. On #264 at d8a8edc it said none of it: folders created from the owner's own window
// are owned by his account (which can always rewrite their permissions, elevated or not) and
// inherit C:\'s defaults, so code in his session could replace bin\jdk's jvm.dll (only java.exe is
// pinned) or rename bin\ away, and the next run would load it into the JVM that holds the password
// (security-auditor SEC-264-10, resilience-auditor RA-32, both S1). The same review found the
// build-tools without a source (RA-33), a signed APK the owner cannot read (RA-34), no keytool
// command (RA-35, SEC-264-11), a copy command that re-encodes the script (RA-36, SEC-264-11), no
// acceptance step (RA-37), no heap residual (SEC-264-11) and the old key's exposure dropped
// (SEC-264-8, RA-38).
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

const PROVISIONING = between(RUNBOOK, '### Provisioning, once, by the owner', '\n## 3.');
const SIGNER_SESSION = between(RUNBOOK, "**Step 2, in the signer's own Windows session.**", 'What the script does, in order');
const ROOT = 'C:\\KokonadaSigner';
const FOLDERS = ['in', 'work', 'out', 'bin', 'vault'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('the runbook provisions C:\\KokonadaSigner so the owner\'s account owns and writes nothing it should not (SEC-264-10, RA-32)', () => {
  it('has a provisioning section that runs elevated', () => {
    expect(PROVISIONING.length).toBeGreaterThan(0);
    expect(PROVISIONING).toMatch(/Run as administrator/);
  });

  it('removes inherited permissions on the root and on every folder', () => {
    for (const dir of [ROOT, ...FOLDERS.map((f) => `${ROOT}\\${f}`)]) {
      expect(PROVISIONING).toMatch(new RegExp(`icacls ${esc(dir)} /inheritance:r`));
    }
  });

  it('sets Administrators as the owner of the tree, and kokonada-signer of vault\\ and work\\', () => {
    expect(PROVISIONING).toMatch(new RegExp(`icacls ${esc(ROOT)} /setowner \\*S-1-5-32-544 /T`));
    for (const f of ['work', 'vault']) {
      expect(PROVISIONING).toMatch(new RegExp(`icacls ${esc(`${ROOT}\\${f}`)} /setowner kokonada-signer`));
    }
  });

  it('gives an explicit permission table row for the root and each folder', () => {
    for (const f of ['C:\\KokonadaSigner', ...FOLDERS.map((x) => `${x}\\`)]) {
      expect(PROVISIONING).toMatch(new RegExp(`^\\s*\\| \`${esc(f)}\` \\|`, 'm'));
    }
  });

  it('lets kokonada-signer write out\\ and the owner\'s account read it, so the delivered APK can be copied (RA-34)', () => {
    const outRow = PROVISIONING.split('\n').find((l) => l.trim().startsWith('| `out\\`'));
    expect(outRow).toBeDefined();
    expect(outRow).toMatch(/kokonada-signer[^|]*Modify/);
    expect(outRow).toMatch(/owner's account[^|]*Read/);
    expect(PROVISIONING).toMatch(new RegExp(`icacls ${esc(`${ROOT}\\out`)} /grant:r [^\\n]*'<owner>:\\(OI\\)\\(CI\\)RX'`));
  });

  it('records a Get-Acl listing with its owner and protection, against an expected listing and a pass criterion', () => {
    expect(PROVISIONING).toMatch(/Get-Acl[^\n]*\| Format-List Path,Owner,AreAccessRulesProtected,AccessToString/);
    expect(PROVISIONING).toMatch(/AreAccessRulesProtected : True/);
    expect(PROVISIONING).toMatch(/Owner\s+: BUILTIN\\Administrators/);
    expect(PROVISIONING).toMatch(/\*\*Pass criterion\.\*\*/);
    expect(PROVISIONING).toMatch(/Everyone/);
    expect(PROVISIONING).toMatch(/Authenticated Users/);
  });

  it('keeps the edited copy\'s hash in the password manager', () => {
    expect(PROVISIONING).toMatch(/edited copy[^.]*password manager/);
  });
});

describe('the signer session re-checks the custody before every run (SEC-264-10, RA-32, RA-34)', () => {
  it('runs the Get-Acl pass criterion and the script hash check before the signing command', () => {
    const run = SIGNER_SESSION.indexOf('powershell.exe -NoProfile');
    expect(run).toBeGreaterThan(0);
    const acl = SIGNER_SESSION.indexOf('Get-Acl');
    const hash = SIGNER_SESSION.indexOf('Get-FileHash C:\\KokonadaSigner\\bin\\sign-release.ps1');
    expect(acl).toBeGreaterThan(-1);
    expect(acl).toBeLessThan(run);
    expect(hash).toBeGreaterThan(-1);
    expect(hash).toBeLessThan(run);
    expect(SIGNER_SESSION.slice(0, run)).toMatch(/pass criterion/i);
  });

  it('resets the delivered APK\'s permissions before signing out', () => {
    const reset = SIGNER_SESSION.indexOf('icacls C:\\KokonadaSigner\\out\\<name>.apk /reset');
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(SIGNER_SESSION.indexOf('**Sign out**'));
  });
});

describe('the tools come from their publishers, checked before they are unpacked, in the elevated window (RA-33)', () => {
  it('downloads build-tools from dl.google.com and checks it against Google\'s SDK repository manifest', () => {
    expect(PROVISIONING).toMatch(/https:\/\/dl\.google\.com\/android\/repository\/build-tools_r\d+[\w.-]*_windows\.zip/);
    expect(PROVISIONING).toMatch(/https:\/\/dl\.google\.com\/android\/repository\/repository2-\d+\.xml/);
    expect(PROVISIONING).toMatch(/SHA-1 `[0-9a-f]{40}`/);
    expect(PROVISIONING).toMatch(/whole folder/);
  });

  it('hashes and unpacks both archives in a folder only administrators can write', () => {
    expect(PROVISIONING).toMatch(/C:\\KokonadaSigner\\bin\\stage/);
    expect(PROVISIONING).toMatch(/Get-FileHash C:\\KokonadaSigner\\bin\\stage\\OpenJDK17U-jdk_x64_windows_hotspot_17\.0\.20\.1_1\.zip/);
    expect(PROVISIONING).toMatch(/Expand-Archive -LiteralPath C:\\KokonadaSigner\\bin\\stage\\/);
  });
});

describe('the key is generated by one exact command, with no password on it (RA-35, SEC-264-11)', () => {
  const line = PROVISIONING.split('\n').find((l) => /keytool\.exe -genkeypair/.test(l)) || '';

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

describe('the runbook limits what a leaked upload key costs, and says what to do when one leaks (R-B7, R-B8)', () => {
  it('has Google generate and keep the app signing key, and registers Play\'s certificate at launch', () => {
    expect(RUNBOOK).toMatch(/Google-generated app signing key/);
    expect(RUNBOOK).toMatch(/never upload your own/i);
    expect(RUNBOOK).toMatch(/[Aa]t launch[^.]*Play's app[- ]signing certificate/);
  });

  it('has an incident response that resets the upload key', () => {
    const incident = between(RUNBOOK, '**If the upload key or its password leaks.**', '\n\n');
    expect(incident).toMatch(/upload key reset/);
    expect(incident).toMatch(/uninstall/i);
  });
});

describe('every run starts from a quiet machine, as hygiene and not as a control (R-B5)', () => {
  it('closes the sessions and the IDE, stops Gradle and Metro and checks the sentinel is not due, before the run command', () => {
    const run = SIGNER_SESSION.indexOf('powershell.exe -NoProfile');
    const before = SIGNER_SESSION.slice(0, run);
    for (const step of ['gradlew --stop', 'Metro', 'sentinel', 'IDE']) expect(before).toContain(step);
    expect(before).toMatch(/hygiene, not a control/);
  });
});

describe('the script is copied byte for byte and checked against the pin on github.com (RA-36, SEC-264-11)', () => {
  it('writes git\'s bytes through cmd, never through PowerShell 5.1\'s re-encoding redirect', () => {
    expect(PROVISIONING).toMatch(
      /cmd \/c "git (-C \S+ )?show origin\/main:mobile\/KokonadaHealth\/scripts\/release\/sign-release\.ps1 > C:\\KokonadaSigner\\bin\\sign-release\.ps1"/,
    );
  });

  it('reads the pin from the runbook on github.com, not from a checkout', () => {
    expect(PROVISIONING).toMatch(/https:\/\/github\.com\/DanielMalede\/Kokonada\/blob\/main\/docs\/runbooks\/android-release-signing\.md/);
  });
});

describe('provisioning ends with an acceptance step that captures MB-139 (RA-37)', () => {
  it('lists the runas refusal, the two badging refusals and the 16 KB pass, recorded on OPS-304', () => {
    const acceptance = between(PROVISIONING, '**Acceptance.**', '\n## ');
    expect(acceptance.length).toBeGreaterThan(0);
    expect(acceptance).toMatch(/runas/);
    expect(acceptance).toMatch(/`:118`/);
    expect(acceptance).toMatch(/`:266`/);
    expect(acceptance).toMatch(/`:265`/);
    expect(acceptance).toMatch(/`:296-297`/);
    expect(acceptance).toMatch(/`MB-139`/);
    expect(acceptance).toMatch(/`OPS-304`/);
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
