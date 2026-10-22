<#
sign-release.ps1 - signs one Kokonada Android APK with the upload key (OPS-303).

Gradle signs no release build: assembleRelease yields app-release-unsigned.apk, which no device
installs. This script signs that APK for sideloaded QA builds only. Google Play takes an App Bundle,
bundleRelease yields an unsigned one, and the jarsigner step that would sign it as kokonada-signer
does not exist yet (SEC-271-5); nothing is uploaded until it does. The script runs only as the
Windows account kokonada-signer, which alone (with SYSTEM) can read C:\KokonadaSigner\vault. Start
the reviewed copy in C:\KokonadaSigner\bin from the owner's own account through runas, and close
the window once you have read the result:

  runas /user:kokonada-signer "powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File C:\KokonadaSigner\bin\sign-release.ps1 -In app-release-unsigned.apk -Out <name>.apk"

Its SHA-256 is pinned in docs/runbooks/android-release-signing.md. Compare the copy in
C:\KokonadaSigner\bin with that value (Get-FileHash) before every run; a copy that differs is not
this script and must not run.

The key is C:\KokonadaSigner\vault\kokonada-upload.p12 (PKCS12, alias kokonada-upload). Its password
lives only in C:\KokonadaSigner\vault\ks.pass, written once by kokonada-signer with
  Read-Host -AsSecureString | ConvertFrom-SecureString | Set-Content C:\KokonadaSigner\vault\ks.pass
so DPAPI binds it to that account on this machine.

In order, stopping at the first failure:
  1. Refuses to run unless [Environment]::UserName is kokonada-signer.
  2. -In must be a plain .apk file name in C:\KokonadaSigner\in\ and -Out a plain .apk file name not
     yet present in C:\KokonadaSigner\out\. Each is resolved to a full path and compared with its
     folder; a folder, a drive, '..' or a link (a reparse point) on either path is refused. The
     input stays open for reading, so nobody can change it, until zipalign has read it.
  3. Checks zipalign.exe, lib\apksigner.jar and java.exe against the SHA-256 pinned in this script
     (Get-FileHash) and refuses a link on any tool path, on the key and on ks.pass, before any tool
     runs and before ks.pass is read. A pin left at its placeholder refuses every run: the owner
     records the real values, one line each, when he provisions bin\ (the runbook's provisioning
     step). The pin covers the launcher; the folder's permissions (administrators only) cover the
     rest of the JDK and the build-tools.
  4. zipalign -P 16 -f 4, then apksigner sign. The password reaches apksigner as
     --ks-pass env:KOKONADA_SIGNER_KS_PASS, set in that one child process's environment and removed,
     with its plain text zeroed, as soon as the child exits. It is never a parameter, never typed
     here and never on a command line.
  5. apksigner verify --print-certs (exactly one signer), and zipalign -c -P 16: the 16 KB zip
     alignment of the native libraries, one of Google Play's two 16 KB checks. ELF LOAD-segment
     alignment is checked separately, on a real release build, before the first upload.
  6. Moves the signed APK to C:\KokonadaSigner\out\<-Out>, then prints the input's SHA-256, the
     signer certificate's SHA-256 (the value to compare with Play Console's upload certificate once
     a bundle step exists) and the signed APK's SHA-256.

It writes its files only in C:\KokonadaSigner\out\, where its two working files are removed at the
end; the JVM keeps only its transient run data in this account's own %TEMP%. zipalign.exe and
lib\apksigner.jar come from C:\KokonadaSigner\bin\build-tools\ (build-tools 35 or newer) and
java.exe from the dedicated JDK in C:\KokonadaSigner\bin\jdk\, never from the IDE's runtime, which an
IDE the owner's account runs keeps updating; bin\ is writable by administrators only. Nothing is
looked up on PATH, and every child process runs without the variables that inject options into a
JVM.
Windows PowerShell 5.1 compatible; ASCII only.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $In,
    [Parameter(Mandatory = $true)] [string] $Out
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::UserName -ne 'kokonada-signer') {
    throw "sign-release.ps1 runs only as kokonada-signer, started through runas; this is $([Environment]::UserName). Nothing was read."
}

$InDir = 'C:\KokonadaSigner\in\'
$OutDir = 'C:\KokonadaSigner\out\'
$KeyStore = 'C:\KokonadaSigner\vault\kokonada-upload.p12'
$KeyAlias = 'kokonada-upload'
$PassFile = 'C:\KokonadaSigner\vault\ks.pass'
$Zipalign = 'C:\KokonadaSigner\bin\build-tools\zipalign.exe'
$Apksigner = 'C:\KokonadaSigner\bin\build-tools\lib\apksigner.jar'
$Java = 'C:\KokonadaSigner\bin\jdk\bin\java.exe'
# The SHA-256 of each tool, lower-case hex (SEC-271-2). The owner replaces these lines, one each, with the
# values he records when he provisions bin\ (docs/runbooks/android-release-signing.md), and the runbook pins
# this script's SHA-256 after that edit. While any of them is still the placeholder, every run is refused.
$ZipalignSha256 = '<pin after provisioning>'
$ApksignerSha256 = '<pin after provisioning>'
$JavaSha256 = '<pin after provisioning>'

# A plain .apk file name: no folder, drive, stream, '..' or device name.
function Assert-PlainApkName([string] $Name, [string] $Parameter) {
    if ($Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.apk$' -or $Name.Contains('..') -or
        $Name -match '^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])\.') {
        throw "-$Parameter must be a plain .apk file name (letters, digits, '.', '_' and '-'), not '$Name'."
    }
}

# The full path of a file directly inside $Dir, resolved and compared as full paths.
function Resolve-Inside([string] $Dir, [string] $Name) {
    $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Dir, $Name))
    $parent = [System.IO.Path]::GetDirectoryName($full) + '\'
    if (-not [string]::Equals($parent, $Dir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "'$Name' resolves to $full, which is not directly inside $Dir."
    }
    $full
}

# Refuses a link (a reparse point: symbolic link, junction, mount point) on the item or any folder above it.
function Assert-NoLink([string] $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    while ($null -ne $item) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$($item.FullName) is a link (a reparse point); the signer follows no link."
        }
        if ($item -is [System.IO.DirectoryInfo]) { $item = $item.Parent } else { $item = $item.Directory }
    }
}

# A tool is what its pinned SHA-256 says, or nothing runs: the placeholder, a malformed pin, a missing file, a
# link on the path or a hash that differs each refuse. Runs before any tool starts and before ks.pass is read,
# so no unpinned code ever runs in the account that holds the key.
function Assert-ToolHash([string] $Path, [string] $Sha256) {
    if ($Sha256 -eq '<pin after provisioning>') {
        throw "$Path has no SHA-256 pin yet: the owner records it in this script when he provisions bin\ (docs/runbooks/android-release-signing.md), and until then the signer refuses every run. The input, the key and its password were not touched."
    }
    if ($Sha256 -notmatch '^[0-9a-f]{64}$') { throw "The pin for $Path is not a lower-case SHA-256." }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing: $Path" }
    Assert-NoLink -Path $Path
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) { throw "$Path is not the pinned tool: its SHA-256 is $actual, the pin is $Sha256." }
}

# A tool started by its full path, with no shell, in the out folder. Its environment is a copy of this
# one without the variables a JVM takes options from, so nothing can load into the JVM that holds the key.
function New-ToolStart([string] $File, [string[]] $Arguments) {
    foreach ($argument in $Arguments) {
        if ($argument -match '[\s"]') { throw "Internal error: the argument '$argument' would need quoting." }
    }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $File
    $start.Arguments = $Arguments -join ' '
    $start.UseShellExecute = $false
    $start.WorkingDirectory = $OutDir
    foreach ($name in @('JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH')) {
        $start.EnvironmentVariables.Remove($name)
    }
    $start
}

# Runs a prepared tool to its end; returns its exit code and, when redirected, its standard output.
function Wait-Tool([System.Diagnostics.ProcessStartInfo] $Start) {
    $process = [System.Diagnostics.Process]::Start($Start)
    try {
        $output = ''
        if ($Start.RedirectStandardOutput) { $output = $process.StandardOutput.ReadToEnd() }
        $process.WaitForExit()
        [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output }
    } finally {
        $process.Dispose()
    }
}

Assert-PlainApkName -Name $In -Parameter 'In'
Assert-PlainApkName -Name $Out -Parameter 'Out'
Assert-ToolHash -Path $Zipalign -Sha256 $ZipalignSha256
Assert-ToolHash -Path $Apksigner -Sha256 $ApksignerSha256
Assert-ToolHash -Path $Java -Sha256 $JavaSha256
foreach ($file in @($KeyStore, $PassFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing: $file" }
}
Assert-NoLink -Path $KeyStore
Assert-NoLink -Path $PassFile
$inPath = Resolve-Inside -Dir $InDir -Name $In
$outPath = Resolve-Inside -Dir $OutDir -Name $Out
$token = [guid]::NewGuid().ToString('N')
$alignedTmp = Resolve-Inside -Dir $OutDir -Name "$Out.$token.aligned"
$signedTmp = Resolve-Inside -Dir $OutDir -Name "$Out.$token.signed"
if (-not (Test-Path -LiteralPath $inPath -PathType Leaf)) { throw "There is no input file $inPath." }
if (Test-Path -LiteralPath $outPath) { throw "$outPath exists already; the signer never replaces a file." }
Assert-NoLink -Path $OutDir

$lock = $null
try {
    # Others may read the input but not write, rename or delete it while this handle is open, so the
    # hash printed below is the hash of the bytes zipalign reads.
    $lock = [System.IO.File]::OpenRead($inPath)
    Assert-NoLink -Path $inPath
    $inputSha256 = (Get-FileHash -InputStream $lock -Algorithm SHA256).Hash.ToLowerInvariant()

    $aligned = Wait-Tool (New-ToolStart -File $Zipalign -Arguments @('-P', '16', '-f', '4', $inPath, $alignedTmp))
    if ($aligned.ExitCode -ne 0) { throw "zipalign failed (exit $($aligned.ExitCode))." }
    $lock.Dispose()
    $lock = $null

    $sign = New-ToolStart -File $Java -Arguments @('-jar', $Apksigner, 'sign', '--ks', $KeyStore, '--ks-type', 'PKCS12',
        '--ks-key-alias', $KeyAlias, '--ks-pass', 'env:KOKONADA_SIGNER_KS_PASS', '--v4-signing-enabled', 'false',
        '--out', $signedTmp, $alignedTmp)
    $password = (Get-Content -LiteralPath $PassFile -Raw).Trim() | ConvertTo-SecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    try {
        $sign.EnvironmentVariables['KOKONADA_SIGNER_KS_PASS'] = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        $signed = Wait-Tool $sign
    } finally {
        $sign.EnvironmentVariables.Remove('KOKONADA_SIGNER_KS_PASS')
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        $password.Dispose()
    }
    if ($signed.ExitCode -ne 0) { throw "apksigner sign failed (exit $($signed.ExitCode))." }

    $verify = New-ToolStart -File $Java -Arguments @('-jar', $Apksigner, 'verify', '--print-certs', $signedTmp)
    $verify.RedirectStandardOutput = $true
    $verified = Wait-Tool $verify
    Write-Host $verified.Output
    if ($verified.ExitCode -ne 0) { throw "apksigner verify failed (exit $($verified.ExitCode))." }
    $certs = [regex]::Matches($verified.Output, '(?m)^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})\r?$')
    if ($certs.Count -ne 1) { throw "The signed APK carries $($certs.Count) signers; exactly one is expected." }
    $certSha256 = $certs[0].Groups[1].Value

    $page = Wait-Tool (New-ToolStart -File $Zipalign -Arguments @('-c', '-P', '16', '4', $signedTmp))
    if ($page.ExitCode -ne 0) { throw "The signed APK's native libraries are not 16 KB aligned (exit $($page.ExitCode)) although zipalign -P 16 ran; check that build-tools is 35 or newer and that the APK stores its native libraries uncompressed." }

    [System.IO.File]::Move($signedTmp, $outPath)
    $artifactSha256 = (Get-FileHash -LiteralPath $outPath -Algorithm SHA256).Hash.ToLowerInvariant()
} finally {
    if ($null -ne $lock) { $lock.Dispose() }
    if (Test-Path -LiteralPath $alignedTmp) { Remove-Item -LiteralPath $alignedTmp -Force }
    if (Test-Path -LiteralPath $signedTmp) { Remove-Item -LiteralPath $signedTmp -Force }
}

Write-Host "Signed APK:                  $outPath"
Write-Host "Input SHA-256:               $inputSha256 ($In)"
Write-Host "Signer certificate SHA-256:  $certSha256"
Write-Host "Signed APK SHA-256:          $artifactSha256"
