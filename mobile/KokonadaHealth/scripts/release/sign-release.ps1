<#
sign-release.ps1 - signs one Kokonada Android APK with the upload key (OPS-303).

Gradle signs no release build: assembleRelease yields app-release-unsigned.apk, which no device
installs, and this script is the one signing step, for store uploads and QA builds alike. It runs
only as the Windows account kokonada-signer, which alone (with SYSTEM) can read
C:\KokonadaSigner\vault. Start the reviewed copy in C:\KokonadaSigner\bin from the owner's own
account through runas, and close the window once you have read the result:

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
  3. zipalign -p -f 4, then apksigner sign. The password reaches apksigner as
     --ks-pass env:KOKONADA_SIGNER_KS_PASS, set in that one child process's environment and removed,
     with its plain text zeroed, as soon as the child exits. It is never a parameter, never typed
     here and never on a command line.
  4. apksigner verify --print-certs (exactly one signer), and zipalign -c -P 16, so native libraries
     keep the 16 KB page alignment Google Play requires.
  5. Moves the signed APK to C:\KokonadaSigner\out\<-Out>, then prints the input's SHA-256, the
     signer certificate's SHA-256 (compare it with the upload certificate in Play Console) and the
     signed APK's SHA-256.

It writes its files only in C:\KokonadaSigner\out\, where its two working files are removed at the
end (the JVM keeps only its transient run data in this account's own %TEMP%). zipalign.exe and lib\apksigner.jar come from C:\KokonadaSigner\bin\build-tools\ (build-tools
35 or newer) and Java from Android Studio's JBR under C:\Program Files; nothing is looked up on
PATH, and every child process runs without the variables that inject options into a JVM.
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
$Java = 'C:\Program Files\Android\Android Studio\jbr\bin\java.exe'

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
foreach ($file in @($Zipalign, $Apksigner, $Java, $KeyStore, $PassFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing: $file" }
}
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

    $aligned = Wait-Tool (New-ToolStart -File $Zipalign -Arguments @('-p', '-f', '4', $inPath, $alignedTmp))
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
    if ($page.ExitCode -ne 0) { throw "The signed APK's native libraries are not 16 KB aligned (exit $($page.ExitCode)); use build-tools 35 or newer." }

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
