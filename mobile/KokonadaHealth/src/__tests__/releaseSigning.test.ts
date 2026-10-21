/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

// OPS-303 · the owner's rulings of 2026-10-20 (F1 B, F3 A, F7). Release signing leaves the reach of
// every session on this machine. android/app/build.gradle signs no release build and keeps no debug
// fallback, so assembleRelease yields app-release-unsigned.apk, which no device installs: a build that
// skipped the signer fails closed. The owner signs that file, QA builds included, with
// scripts/release/sign-release.ps1, started through runas as the Windows account kokonada-signer, the
// one account (with SYSTEM) that can read the vault holding the new upload key and its DPAPI-bound
// password.
//
// Both files are read as text, as appVersion.test.ts reads build.gradle. Every rule also runs on a
// planted violation of the real file (the last describe), so a rule that stops biting fails here too.

const APP = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(APP, 'scripts/release/sign-release.ps1');
const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const gradle = read(path.join(APP, 'android/app/build.gradle'));
const script = fs.existsSync(SCRIPT_PATH) ? read(SCRIPT_PATH) : '';

// ---- build.gradle ---------------------------------------------------------------------------------

/** The index of the quote that closes the string opened at `open` (Groovy '...' and "..." end at the line). */
function closingQuote(src: string, open: number): number {
  for (let j = open + 1; j < src.length; j += 1) {
    if (src[j] === '\\') {
      j += 1;
    } else if (src[j] === src[open] || src[j] === '\n') {
      return j;
    }
  }
  return src.length;
}

/** build.gradle without its comments ('//' to the end of the line, and block comments); strings kept. */
function groovyCode(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '"' || src[i] === "'") {
      const end = closingQuote(src, i);
      out += src.slice(i, end + 1);
      i = end + 1;
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else {
      out += src[i];
      i += 1;
    }
  }
  return out;
}

/** The text inside the first block that `header` opens (the match ends at its '{'), or null. */
function blockBody(code: string, header: RegExp): string | null {
  const m = header.exec(code);
  if (!m) {
    return null;
  }
  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === '"' || code[i] === "'") {
      i = closingQuote(code, i);
    } else if (code[i] === '{') {
      depth += 1;
    } else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return code.slice(start, i);
      }
    }
  }
  return null;
}

/** The names of the blocks directly inside a block body, in order. */
function childBlocks(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '"' || body[i] === "'") {
      i = closingQuote(body, i);
    } else if (body[i] === '{') {
      if (depth === 0) {
        names.push(/(\w+)\s*$/.exec(body.slice(0, i))?.[1] ?? '?');
      }
      depth += 1;
    } else if (body[i] === '}') {
      depth -= 1;
    }
  }
  return names;
}

const codeLines = (body: string | null) =>
  (body ?? '').split('\n').map((line) => line.trim()).filter(Boolean);

// Pinned as they stand: the lab scripts rely on both (labExclusion.test.ts, bundleAndBuild.test.ts).
const DEBUG_SIGNING = [
  "storeFile file(project.findProperty('kokonadaDebugKeystore') ?: 'debug.keystore')",
  "storePassword 'android'",
  "keyAlias 'androiddebugkey'",
  "keyPassword 'android'",
];
const LAB_BUILD_TYPE = [
  'initWith release',
  'applicationIdSuffix ".lab"',
  'signingConfig signingConfigs.debug',
  'matchingFallbacks = ["release"]',
  'manifestPlaceholders = [',
  'usesCleartextTraffic: "false",',
  'redirectSchemeName  : "kokonadalab-unused",',
  'redirectHostName    : "never"',
  ']',
];

const GRADLE_RULES: Array<[string, string]> = [
  ['[gradle-keystore]', 'reads no keystore.properties'],
  ['[gradle-configs]', 'declares the debug signing config only'],
  ['[gradle-release]', 'gives the release build type no signingConfig, and nothing signs with a release config'],
  ['[gradle-fallback]', 'has two signingConfig statements, debug and lab, so release falls back to no key'],
  ['[gradle-debug]', 'keeps debug signing exactly as it was'],
  ['[gradle-lab]', 'keeps the lab build type exactly as it was: initWith release, debug-signed, not debuggable'],
];

function gradleProblems(src: string): string[] {
  const problems: string[] = [];
  const code = groovyCode(src);
  const android = blockBody(code, /^android \{/m) ?? '';
  const signingConfigs = blockBody(android, /^ {4}signingConfigs \{/m) ?? '';
  const buildTypes = blockBody(android, /^ {4}buildTypes \{/m) ?? '';
  const release = blockBody(buildTypes, /^ {8}release \{/m);
  const configs = childBlocks(signingConfigs);
  const statements = (code.match(/\bsigningConfig\b/g) ?? []).length;

  if (/keystore\.properties|keystoreProperties/i.test(code)) {
    problems.push('[gradle-keystore] build.gradle reads keystore.properties');
  }
  if (configs.join(',') !== 'debug') {
    problems.push(`[gradle-configs] signingConfigs declares ${configs.join(', ') || 'nothing'}; only debug belongs there`);
  }
  if (release === null) {
    problems.push('[gradle-release] there is no release build type');
  } else if (/\bsigningConfig\b/.test(release)) {
    problems.push('[gradle-release] the release build type names a signingConfig');
  }
  if (/\bsigningConfigs\.release\b/.test(code)) {
    problems.push('[gradle-release] something signs with signingConfigs.release');
  }
  if (statements !== 2) {
    problems.push(`[gradle-fallback] ${statements} signingConfig statements; only the debug and lab build types sign, with the debug key`);
  }
  if (codeLines(blockBody(signingConfigs, /^ {8}debug \{/m)).join('\n') !== DEBUG_SIGNING.join('\n')) {
    problems.push('[gradle-debug] the debug signing config changed');
  }
  if (codeLines(blockBody(buildTypes, /^ {8}debug \{/m)).join('\n') !== 'signingConfig signingConfigs.debug') {
    problems.push('[gradle-debug] the debug build type changed');
  }
  if (codeLines(blockBody(buildTypes, /^ {8}lab \{/m)).join('\n') !== LAB_BUILD_TYPE.join('\n')) {
    problems.push('[gradle-lab] the lab build type changed (MB-084: release-equivalent, debug-signed, not debuggable)');
  }
  return problems;
}

// ---- sign-release.ps1 -----------------------------------------------------------------------------

/**
 * The script without its comments ('#' to the end of the line, and '<# ... #>'), which count only
 * outside quoted strings, so 'Signer #1' stays code. `bare` also blanks each string's content, for the
 * rules about commands and operators. PowerShell reads a '#' glued to a word as part of the word, and
 * this scanner does not read here-strings, so both are refused rather than misread.
 */
function powershell(src: string): { code: string; bare: string; problems: string[] } {
  let code = '';
  let bare = '';
  const problems: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (src.startsWith('<#', i)) {
      const end = src.indexOf('#>', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '#') {
      if (i > 0 && !/\s/.test(src[i - 1])) {
        problems.push(`[parse] a '#' glued to a word at offset ${i}`);
      }
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        j += c === '"' && src[j] === '`' ? 2 : 1;
      }
      while (j + 1 < src.length && src[j + 1] === c) {
        // '' (and "") inside a string is an escaped quote: the string goes on.
        j += 2;
        while (j < src.length && src[j] !== c) {
          j += c === '"' && src[j] === '`' ? 2 : 1;
        }
      }
      code += src.slice(i, j + 1);
      bare += c + src.slice(i + 1, j).replace(/[^\n]/g, ' ') + c;
      i = j + 1;
    } else {
      code += c;
      bare += c;
      i += 1;
    }
  }
  if (/@['"][ \t]*$/m.test(src)) {
    problems.push('[parse] a here-string');
  }
  return { code, bare, problems };
}

/** The text between the parenthesis at `open` and its match, quotes skipped. */
function parenBody(code: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "'" || code[i] === '"') {
      i = code.indexOf(code[i], i + 1);
      if (i < 0) {
        return null;
      }
    } else if (code[i] === '(') {
      depth += 1;
    } else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        return code.slice(open + 1, i);
      }
    }
  }
  return null;
}

const SCRIPT_RULES: Array<[string, string]> = [
  ['[parse]', 'is readable by this check: no here-string, no glued #, no variable set but by plain assignment'],
  ['[ascii]', 'is plain ASCII: PowerShell 5.1 reads a script that has no BOM in the ANSI code page'],
  ['[header]', 'opens with a comment naming kokonada-signer, runas and its SHA-256 pinned in the runbook'],
  ['[strict]', "opens with Set-StrictMode -Version Latest and $ErrorActionPreference = 'Stop'"],
  ['[params]', 'takes exactly -In and -Out, so no password can be handed in'],
  ['[user]', 'refuses to run unless [Environment]::UserName is kokonada-signer, before it touches anything'],
  ['[password]', 'reads the password only from the DPAPI file C:\\KokonadaSigner\\vault\\ks.pass'],
  ['[literal]', 'holds no pass: form, no -storepass or -keypass flag, no injected Gradle signing, comments included'],
  ['[kspass]', 'hands the password to apksigner only as --ks-pass env:<VAR>, set on that child alone and removed after it (or stdin)'],
  ['[key]', 'signs with C:\\KokonadaSigner\\vault\\kokonada-upload.p12, PKCS12, alias kokonada-upload'],
  ['[in]', 'reads the input only by a plain name resolved inside C:\\KokonadaSigner\\in\\, refusing .. and links'],
  ['[out]', 'writes only inside C:\\KokonadaSigner\\out\\, never over an existing file and never through a link'],
  ['[tools]', 'runs zipalign and apksigner from C:\\KokonadaSigner\\bin\\build-tools\\ and Java from the JBR, never from PATH or a shell'],
  ['[align]', 'runs zipalign -p -f 4 on the input before apksigner sign'],
  ['[sign]', 'signs the aligned file into a working file in the out folder'],
  ['[verify]', 'runs apksigner verify --print-certs and a 16 KB page check on the signed file before delivering it'],
  ['[exit]', "checks every tool's exit code"],
  ['[print]', "prints the signer certificate's SHA-256 (exactly one signer) and the delivered APK's SHA-256"],
  ['[javaenv]', 'removes the variables that inject options into a JVM from every child environment'],
];

function scriptProblems(src: string): string[] {
  if (src === '') {
    return SCRIPT_RULES.map(([tag]) => `${tag} scripts/release/sign-release.ps1 does not exist`);
  }
  const { code, bare, problems } = powershell(src);
  const p = [...problems];
  const at = (re: RegExp) => re.exec(code)?.index ?? -1;
  const count = (re: RegExp) => (code.match(re) ?? []).length; // re carries the g flag
  const assignments = (name: string) => count(new RegExp(`^\\s*\\$${name}\\s*=`, 'gim'));
  const constant = (name: string, value: string) => assignments(name) === 1 && code.includes(`$${name} = ${value}\n`);

  // [parse]
  if (/Set-Variable|New-Variable|Remove-Variable|Clear-Variable|\$\{|\$(?:script|global|local|private|using):/i.test(code)) {
    p.push('[parse] a variable set other than by plain assignment');
  }

  // [ascii]
  if (/[^\t\n\r\x20-\x7E]/.test(src)) {
    p.push('[ascii] a character outside printable ASCII');
  }

  // [header]
  const header = src.startsWith('<#') ? src.slice(0, src.indexOf('#>') + 2) : '';
  for (const must of ['kokonada-signer', 'runas', 'SHA-256', 'docs/runbooks/android-release-signing.md']) {
    if (!header.includes(must)) {
      p.push(`[header] the opening comment does not name ${must}`);
    }
  }

  // [strict]
  const guard = at(/^if \(\[Environment\]::UserName -ne 'kokonada-signer'\) \{\n\s*throw\b/m);
  const strict = at(/^Set-StrictMode -Version Latest$/m);
  const stop = at(/^\$ErrorActionPreference = 'Stop'$/m);
  if (strict < 0 || stop < 0 || (guard >= 0 && (strict > guard || stop > guard))) {
    p.push("[strict] Set-StrictMode -Version Latest and $ErrorActionPreference = 'Stop' do not open the script");
  }

  // [params]
  const paramAt = at(/^param\s*\(/im);
  const params = paramAt < 0 ? null : parenBody(code, code.indexOf('(', paramAt));
  const declared = [...(params ?? '').matchAll(/\$(\w+)/g)]
    .map((m) => m[1].toLowerCase())
    .filter((name) => name !== 'true' && name !== 'false');
  if (declared.join(',') !== 'in,out') {
    p.push(`[params] the parameters are ${declared.join(', ') || 'none'}, not exactly In and Out`);
  }

  // [user]
  const actions = [
    /C:\\KokonadaSigner/i, /Get-Content/i, /ConvertTo-SecureString/i, /ProcessStartInfo/i, /Get-Item/i, /Test-Path/i,
    /Get-FileHash/i, /\[System\.IO\./i, /Remove-Item/i, /New-ToolStart/i, /Wait-Tool/i,
  ].map(at).filter((index) => index >= 0);
  if (guard < 0) {
    p.push("[user] no refusal unless [Environment]::UserName is 'kokonada-signer'");
  } else if (actions.some((index) => index < guard)) {
    p.push('[user] the script touches a file, a secret or a process before the account check');
  }

  // [password]
  if (!constant('PassFile', "'C:\\KokonadaSigner\\vault\\ks.pass'")) {
    p.push('[password] $PassFile is not C:\\KokonadaSigner\\vault\\ks.pass, assigned once');
  }
  const converts = code.split('\n').filter((line) => /ConvertTo-SecureString/i.test(line));
  if (
    converts.length !== 1 ||
    !/\(Get-Content -LiteralPath \$PassFile -Raw\)\.Trim\(\) \| ConvertTo-SecureString$/i.test(converts[0]) ||
    /-(?:AsPlainText|Key|SecureKey|Force)\b/i.test(converts[0])
  ) {
    p.push('[password] the password is not one ConvertTo-SecureString (DPAPI, no key) over the content of $PassFile');
  }
  if (/AsPlainText|Read-Host|Get-Credential|PSCredential|NetworkCredential|\$env:|GetEnvironmentVariable|SetEnvironmentVariable/i.test(code)) {
    p.push('[password] another password source: plain text, a prompt, a credential or the environment');
  }

  // [literal] the whole text, comments included: a comment is copied as readily as code.
  if (/\bpass:/i.test(src)) {
    p.push("[literal] a 'pass:' password form");
  }
  if (/-(?:src|dest)?(?:store|key)pass\b/i.test(src)) {
    p.push('[literal] a -storepass or -keypass flag');
  }
  if (/android\.injected\.signing/i.test(src)) {
    p.push('[literal] injected Gradle signing properties');
  }

  // [kspass]
  const forms = [...code.matchAll(/'--ks-pass',\s*'([^']*)'/g)].map((m) => m[1]);
  if (count(/--ks-pass/g) !== 1 || forms.length !== 1) {
    p.push('[kspass] apksigner does not get exactly one --ks-pass');
  } else if (/^env:\w+$/.test(forms[0])) {
    const name = forms[0].slice('env:'.length);
    const set = at(new RegExp(`\\.EnvironmentVariables\\['${name}'\\] = \\[System\\.Runtime\\.InteropServices\\.Marshal\\]::PtrToStringBSTR\\(`));
    const fin = set < 0 ? -1 : code.indexOf('finally', set);
    const clear = at(new RegExp(`\\.EnvironmentVariables\\.Remove\\('${name}'\\)`));
    const zero = at(/\[System\.Runtime\.InteropServices\.Marshal\]::ZeroFreeBSTR\(/);
    if (set < 0 || fin < 0 || clear < fin || zero < fin || count(new RegExp(name, 'g')) !== 3) {
      p.push(`[kspass] ${name} is not set on the apksigner child alone, then removed and its plain text zeroed in a finally block`);
    }
  } else if (forms[0] === 'stdin') {
    if (!/\.RedirectStandardInput = \$true/.test(code) || !/\.StandardInput\.Close\(\)/.test(code)) {
      p.push('[kspass] --ks-pass stdin, but standard input is not redirected and closed');
    }
  } else {
    p.push(`[kspass] --ks-pass ${forms[0]}: only env:<VAR> or stdin`);
  }
  if (/--key-pass/i.test(code)) {
    p.push('[kspass] a --key-pass: the PKCS12 key opens with the store password');
  }

  // [key]
  if (
    !constant('KeyStore', "'C:\\KokonadaSigner\\vault\\kokonada-upload.p12'") ||
    !constant('KeyAlias', "'kokonada-upload'") ||
    !/'--ks', \$KeyStore, '--ks-type', 'PKCS12',\s*'--ks-key-alias', \$KeyAlias,/.test(code)
  ) {
    p.push('[key] apksigner does not sign with C:\\KokonadaSigner\\vault\\kokonada-upload.p12, PKCS12, alias kokonada-upload');
  }

  // [in]
  if (!constant('InDir', "'C:\\KokonadaSigner\\in\\'")) {
    p.push('[in] $InDir is not C:\\KokonadaSigner\\in\\, assigned once');
  }
  if (!/^Assert-PlainApkName -Name \$In -Parameter 'In'$/m.test(code) || !/\$Name\.Contains\('\.\.'\)/.test(code)) {
    p.push("[in] -In is not refused unless it is a plain .apk name without '..'");
  }
  if (!/\[System\.IO\.Path\]::GetFullPath\(/.test(code) || !/\[System\.StringComparison\]::OrdinalIgnoreCase/.test(code)) {
    p.push('[in] paths are not resolved and compared as full paths');
  }
  if (!/^\$inPath = Resolve-Inside -Dir \$InDir -Name \$In$/m.test(code) || assignments('inPath') !== 1) {
    p.push('[in] the input path is not Resolve-Inside -Dir $InDir -Name $In, assigned once');
  }
  if (!/^\s*Assert-NoLink -Path \$inPath$/m.test(code) || !/\[System\.IO\.FileAttributes\]::ReparsePoint\b/.test(code)) {
    p.push('[in] a link on the input path is not refused');
  }

  // [out]
  if (!constant('OutDir', "'C:\\KokonadaSigner\\out\\'")) {
    p.push('[out] $OutDir is not C:\\KokonadaSigner\\out\\, assigned once');
  }
  const outVars = new Set([...code.matchAll(/^\$(\w+) = Resolve-Inside -Dir \$OutDir -Name /gim)].map((m) => m[1].toLowerCase()));
  for (const name of outVars) {
    if (assignments(name) !== 1) {
      p.push(`[out] $${name} is assigned more than once`);
    }
  }
  if (/Set-Content|Add-Content|Out-File|Tee-Object|New-Item|Copy-Item|Move-Item|Rename-Item|Export-|Start-Transcript|WriteAll|AppendAll|OpenWrite|CreateText|AppendText|FileStream|FileMode|::Create\(|::Copy\(|::Replace\(|::Open\(/i.test(code)) {
    p.push("[out] a write other than the tools' outputs, the final move and the cleanup");
  }
  if (/>/.test(bare)) {
    p.push('[out] a redirection');
  }
  const moves = [...code.matchAll(/\[System\.IO\.File\]::Move\(\$(\w+), \$(\w+)\)/gi)];
  if (count(/::Move\(/gi) !== 1 || moves.length !== 1 || !outVars.has(moves[0][1].toLowerCase()) || moves[0][2].toLowerCase() !== 'outpath' || !outVars.has('outpath')) {
    p.push('[out] the signed file is not moved once, from the out folder to $outPath');
  }
  const removes = [...code.matchAll(/Remove-Item -LiteralPath \$(\w+) -Force/gi)].map((m) => m[1].toLowerCase());
  if (count(/Remove-Item/gi) !== removes.length || removes.some((name) => !outVars.has(name) || name === 'outpath')) {
    p.push('[out] something other than a working file in the out folder is removed');
  }
  if (!/^if \(Test-Path -LiteralPath \$outPath\) \{ throw\b/m.test(code) || !/^Assert-NoLink -Path \$OutDir$/m.test(code)) {
    p.push('[out] an existing output, or a link on the out folder, is not refused');
  }

  // [tools]
  if (
    !constant('Zipalign', "'C:\\KokonadaSigner\\bin\\build-tools\\zipalign.exe'") ||
    !constant('Apksigner', "'C:\\KokonadaSigner\\bin\\build-tools\\lib\\apksigner.jar'")
  ) {
    p.push('[tools] zipalign and apksigner are not C:\\KokonadaSigner\\bin\\build-tools\\zipalign.exe and lib\\apksigner.jar');
  }
  if (!constant('Java', "'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe'")) {
    p.push("[tools] Java is not Android Studio's JBR under C:\\Program Files");
  }
  const started = [...code.matchAll(/New-ToolStart -File \$(\w+)/gi)].map((m) => m[1].toLowerCase());
  if (started.length === 0 || started.some((name) => name !== 'zipalign' && name !== 'java') || count(/New-ToolStart\b/gi) !== started.length + 1) {
    p.push('[tools] a process is started other than $Zipalign or $Java, by full path');
  }
  if (/&|Start-Process|Invoke-Expression|\biex\b|Invoke-Item|Invoke-Command|Import-Module|Add-Type|\bcmd(?:\.exe)?\b|Get-Command|where\.exe|apksigner\.bat|(?<![\w$-])(?:java|zipalign|apksigner)(?:\.exe)?\b/i.test(bare)) {
    p.push('[tools] a tool started by name, through a shell or the call operator, or looked up on PATH');
  }
  if (!/\.UseShellExecute = \$false$/m.test(code)) {
    p.push('[tools] the process start may go through the shell');
  }

  // [align] [sign] [verify]
  const align = /New-ToolStart -File \$Zipalign -Arguments @\('-p', '-f', '4', \$(\w+), \$(\w+)\)/.exec(code);
  const sign = /New-ToolStart -File \$Java -Arguments @\('-jar', \$Apksigner, 'sign',[^)]*'--out', \$(\w+), \$(\w+)\)/.exec(code);
  const verify = /New-ToolStart -File \$Java -Arguments @\('-jar', \$Apksigner, 'verify', '--print-certs', \$(\w+)\)/.exec(code);
  const page = /New-ToolStart -File \$Zipalign -Arguments @\('-c', '-P', '16', '4', \$(\w+)\)/.exec(code);
  const move = /\[System\.IO\.File\]::Move\(/.exec(code);
  if (!align || align[1] !== 'inPath' || !outVars.has(align[2].toLowerCase())) {
    p.push('[align] zipalign -p -f 4 does not align $inPath into a working file in the out folder');
  }
  if (!align || !sign || sign[2] !== align[2] || !outVars.has(sign[1].toLowerCase()) || sign.index < align.index) {
    p.push('[sign] apksigner sign does not sign the aligned file, after zipalign, into a working file in the out folder');
  }
  if (!sign || !verify || !move || verify[1] !== sign[1] || verify.index < sign.index || move.index < verify.index) {
    p.push('[verify] apksigner verify --print-certs does not check the signed file between signing and delivery');
  }
  if (!sign || !page || !move || page[1] !== sign[1] || page.index < sign.index || move.index < page.index) {
    p.push('[verify] zipalign -c -P 16 does not check the signed file before delivery');
  }

  // [exit]
  if (count(/\.ExitCode -ne 0\) \{ throw\b/g) !== count(/Wait-Tool\b/gi) - 1) {
    p.push("[exit] a tool's exit code is not checked");
  }

  // [print]
  if (
    !/'\(\?m\)\^Signer #\\d\+ certificate SHA-256 digest: \(\[0-9a-f\]\{64\}\)\\r\?\$'/.test(code) ||
    !/^\s*if \(\$certs\.Count -ne 1\) \{ throw\b/m.test(code) ||
    !/^\s*\$certSha256 = \$certs\[0\]\.Groups\[1\]\.Value$/m.test(code) ||
    !/^Write-Host "[^"\n]*\$certSha256\b/m.test(code)
  ) {
    p.push("[print] the signer certificate's SHA-256 is not read from apksigner verify (exactly one signer) and printed");
  }
  const hash = /^\s*\$artifactSha256 = \(Get-FileHash -LiteralPath \$outPath -Algorithm SHA256\)\.Hash/m.exec(code);
  if (!hash || !move || hash.index < move.index || !/^Write-Host "[^"\n]*\$artifactSha256\b/m.test(code)) {
    p.push("[print] the delivered APK's SHA-256 is not computed after the move and printed");
  }

  // [javaenv]
  if (
    !["'JAVA_TOOL_OPTIONS'", "'_JAVA_OPTIONS'", "'JDK_JAVA_OPTIONS'"].every((name) => code.includes(name)) ||
    !/\$start\.EnvironmentVariables\.Remove\(\$name\)/.test(code)
  ) {
    p.push("[javaenv] JAVA_TOOL_OPTIONS, _JAVA_OPTIONS and JDK_JAVA_OPTIONS are not removed from the children's environment");
  }

  return p;
}

// ---- the rules on the real files ------------------------------------------------------------------

describe('build.gradle signs no release build (OPS-303)', () => {
  const problems = gradleProblems(gradle);

  it.each(GRADLE_RULES)('%s %s', (tag) => {
    expect(problems.filter((problem) => problem.startsWith(tag))).toEqual([]);
  });

  it('reports nothing outside those rules', () => {
    expect(problems.filter((problem) => !GRADLE_RULES.some(([tag]) => problem.startsWith(tag)))).toEqual([]);
  });
});

describe('scripts/release/sign-release.ps1 is the one signing step (OPS-303)', () => {
  const problems = scriptProblems(script);

  it.each(SCRIPT_RULES)('%s %s', (tag) => {
    expect(problems.filter((problem) => problem.startsWith(tag))).toEqual([]);
  });

  it('reports nothing outside those rules', () => {
    expect(problems.filter((problem) => !SCRIPT_RULES.some(([tag]) => problem.startsWith(tag)))).toEqual([]);
  });
});

// ---- the checks bite ------------------------------------------------------------------------------

describe('the scanners keep code and drop only comments', () => {
  it('Groovy: line and block comments go, a // inside a string stays', () => {
    expect(groovyCode('a // b\nc /* d */ e "f // g"\n')).toBe('a \nc  e "f // g"\n');
  });

  it('Groovy: the block scan skips braces inside strings and finds the nested blocks', () => {
    const code = 'android {\n    buildTypes {\n        x {\n            a "${b}"\n        }\n        y {\n        }\n    }\n}\n';
    expect(childBlocks(blockBody(blockBody(code, /^android \{/m) ?? '', /^ {4}buildTypes \{/m) ?? '')).toEqual(['x', 'y']);
  });

  it("PowerShell: '#' in a string is code, '#' after code is a comment, '<# #>' is a comment", () => {
    const { code, problems } = powershell("<# a 'b' #>\n$a = 'x # y' # note\n$b = \"p #1 `\" q\" # it's\n$c = 'it''s'\n");
    expect(code).toBe("\n$a = 'x # y' \n$b = \"p #1 `\" q\" \n$c = 'it''s'\n");
    expect(problems).toEqual([]);
  });

  it('PowerShell: bare blanks string contents, and a glued # or a here-string is refused', () => {
    expect(powershell("$a = 'x > y' + \"&\"\n").bare).toBe("$a = '     ' + \" \"\n");
    expect(powershell('$a = $b#c\n').problems).toEqual(["[parse] a '#' glued to a word at offset 7"]);
    expect(powershell("$a = @'\nx\n'@\n").problems).toEqual(['[parse] a here-string']);
  });
});

describe('every rule bites on a planted violation', () => {
  const GRADLE_PLANTS: Array<[string, (g: string) => string, string]> = [
    ['keystore.properties read again', (g) => g.replace(/^android \{/m, 'def keystorePropertiesFile = rootProject.file("keystore.properties")\n\nandroid {'), '[gradle-keystore]'],
    ['a release signing config', (g) => g.replace(/^( {4}signingConfigs \{\n)/m, '$1        release {\n            storeFile file("upload.p12")\n        }\n'), '[gradle-configs]'],
    ['release signed with the debug key', (g) => g.replace(/^( {8}release \{\n)/m, '$1            signingConfig signingConfigs.debug\n'), '[gradle-release]'],
    ['the old conditional fallback', (g) => g.replace(/^( {8}release \{\n)/m, '$1            signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug\n'), '[gradle-release]'],
    ['a signingConfig set outside the build types', (g) => `${g}\nandroid.buildTypes.release.signingConfig = android.signingConfigs.debug\n`, '[gradle-fallback]'],
    ['the debug key changed', (g) => g.replace("storePassword 'android'", "storePassword 'changed'"), '[gradle-debug]'],
    ['the lab signed with another config', (g) => g.replace(/(^ {8}lab \{[\s\S]*?)signingConfig signingConfigs\.debug/m, '$1signingConfig signingConfigs.upload'), '[gradle-lab]'],
    ['the lab made debuggable', (g) => g.replace(/^( {8}lab \{\n)/m, '$1            debuggable true\n'), '[gradle-lab]'],
    ['the lab no longer release-equivalent', (g) => g.replace(/^( {12})initWith release$/m, '$1initWith debug'), '[gradle-lab]'],
  ];

  it.each(GRADLE_PLANTS)('build.gradle: %s', (_name, plant, tag) => {
    const planted = plant(gradle);
    expect(planted).not.toBe(gradle);
    expect(gradleProblems(planted).filter((problem) => problem.startsWith(tag))).not.toEqual([]);
  });

  it('build.gradle: a comment that names keystore.properties is not a read', () => {
    const planted = gradle.replace(/^android \{/m, '// keystore.properties is read nowhere (OPS-303)\nandroid {');
    expect(planted).not.toBe(gradle);
    expect(gradleProblems(planted)).toEqual([]);
  });

  const GUARD = /^if \(\[Environment\]::UserName -ne 'kokonada-signer'\) \{\n[^\n]*\n\}\n/m;
  const SCRIPT_PLANTS: Array<[string, (s: string) => string, string]> = [
    ['--ks-pass pass:', (s) => s.replace("'env:KOKONADA_SIGNER_KS_PASS'", "'pass:planted'"), '[literal]'],
    ['a -storepass flag in a comment', (s) => s.replace(/^Set-StrictMode/m, '# keytool -storepass planted\nSet-StrictMode'), '[literal]'],
    ['a prompt for the password', (s) => s.replace('(Get-Content -LiteralPath $PassFile -Raw).Trim() | ConvertTo-SecureString', 'Read-Host -AsSecureString'), '[password]'],
    ['a plain-text password', (s) => s.replace('.Trim() | ConvertTo-SecureString', '.Trim() | ConvertTo-SecureString -AsPlainText -Force'), '[password]'],
    ['a password from the environment', (s) => s.replace(/^(\$Java = .*)$/m, '$1\n$planted = $env:PLANTED'), '[password]'],
    ['the variable set on this process', (s) => s.replace("$sign.EnvironmentVariables['KOKONADA_SIGNER_KS_PASS'] =", '$env:KOKONADA_SIGNER_KS_PASS ='), '[kspass]'],
    ['the variable never removed', (s) => s.replace("$sign.EnvironmentVariables.Remove('KOKONADA_SIGNER_KS_PASS')", ''), '[kspass]'],
    ['a --key-pass', (s) => s.replace("'--ks-pass', 'env:KOKONADA_SIGNER_KS_PASS',", "'--ks-pass', 'env:KOKONADA_SIGNER_KS_PASS', '--key-pass', 'stdin',"), '[kspass]'],
    ['a third parameter', (s) => s.replace('[string] $Out', '[string] $Out,\n    [string] $Password'), '[params]'],
    ['another account', (s) => s.replace("-ne 'kokonada-signer'", "-ne 'someone-else'"), '[user]'],
    ['the account check after the paths', (s) => s.replace(GUARD, '').replace(/^(\$Java = .*)$/m, (line) => `${line}\n${GUARD.exec(s)?.[0] ?? ''}`), '[user]'],
    ['no strict mode', (s) => s.replace('Set-StrictMode -Version Latest', ''), '[strict]'],
    ['a key elsewhere', (s) => s.replace("'C:\\KokonadaSigner\\vault\\kokonada-upload.p12'", "'C:\\Elsewhere\\upload.p12'"), '[key]'],
    ['an input folder elsewhere', (s) => s.replace("$InDir = 'C:\\KokonadaSigner\\in\\'", "$InDir = 'C:\\Elsewhere\\'"), '[in]'],
    ["'..' let through", (s) => s.replace(" -or $Name.Contains('..')", ''), '[in]'],
    ['no link check', (s) => s.replace('[System.IO.FileAttributes]::ReparsePoint', '[System.IO.FileAttributes]::Hidden'), '[in]'],
    ['the raw -In handed to zipalign', (s) => s.replace("'4', $inPath,", "'4', $In,"), '[align]'],
    ['an output folder elsewhere', (s) => s.replace("$OutDir = 'C:\\KokonadaSigner\\out\\'", "$OutDir = 'C:\\Elsewhere\\'"), '[out]'],
    ['a write with Set-Content', (s) => `${s}\nSet-Content -LiteralPath $outPath -Value planted\n`, '[out]'],
    ['a redirection', (s) => `${s}\nWrite-Output $certSha256 > planted.txt\n`, '[out]'],
    ['an existing output overwritten', (s) => s.replace(/^if \(Test-Path -LiteralPath \$outPath\) \{ throw[^\n]*\n/m, ''), '[out]'],
    ['zipalign without -p', (s) => s.replace("@('-p', '-f', '4',", "@('-f', '4',"), '[align]'],
    ['the unaligned input signed', (s) => s.replace("'--out', $signedTmp, $alignedTmp)", "'--out', $signedTmp, $inPath)"), '[sign]'],
    ['no verify --print-certs', (s) => s.replace("'verify', '--print-certs',", "'verify',"), '[verify]'],
    ['no 16 KB page check', (s) => s.replace("@('-c', '-P', '16', '4',", "@('-c', '4',"), '[verify]'],
    ['an unchecked exit code', (s) => s.replace(/^\s*if \(\$signed\.ExitCode -ne 0\) \{ throw[^\n]*\n/m, ''), '[exit]'],
    ['the certificate not printed', (s) => s.replace(/^Write-Host "[^"\n]*\$certSha256[^\n]*\n/m, ''), '[print]'],
    ['the artifact hashed with MD5', (s) => s.replace('-LiteralPath $outPath -Algorithm SHA256', '-LiteralPath $outPath -Algorithm MD5'), '[print]'],
    ['Java from PATH', (s) => s.replace("'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe'", "'java.exe'"), '[tools]'],
    ['zipalign from the SDK', (s) => s.replace("'C:\\KokonadaSigner\\bin\\build-tools\\zipalign.exe'", "'C:\\Android\\Sdk\\build-tools\\36.0.0\\zipalign.exe'"), '[tools]'],
    ['a tool through the call operator', (s) => `${s}\n& $Zipalign -c 4 $outPath\n`, '[tools]'],
    ['a JVM option variable kept', (s) => s.replace("'JAVA_TOOL_OPTIONS', ", ''), '[javaenv]'],
    ['a character outside ASCII', (s) => s.replace(/^(# A plain \.apk file name)/m, '$1 \u2014'), '[ascii]'],
    ['a here-string', (s) => `${s}\n$planted = @'\nplanted\n'@\n`, '[parse]'],
    ['the runbook pin dropped from the header', (s) => s.replace('docs/runbooks/android-release-signing.md', 'the runbook'), '[header]'],
  ];

  it.each(SCRIPT_PLANTS)('sign-release.ps1: %s', (_name, plant, tag) => {
    const planted = plant(script);
    expect(planted).not.toBe(script);
    expect(scriptProblems(planted).filter((problem) => problem.startsWith(tag))).not.toEqual([]);
  });
});
