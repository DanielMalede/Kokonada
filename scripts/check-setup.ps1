# check-setup.ps1 — verify a fresh machine has everything the Wave-4 run (and this repo) needs.
# READ-ONLY: performs no installs and changes nothing. Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1

$ErrorActionPreference = 'SilentlyContinue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$results = New-Object System.Collections.ArrayList
function Report([string]$status, [string]$name, [string]$detail, [string]$fix) {
    [void]$results.Add([pscustomobject]@{ Status = $status; Name = $name; Detail = $detail; Fix = $fix })
    $color = 'Green'; if ($status -eq 'FIX') { $color = 'Red' } elseif ($status -eq 'WARN') { $color = 'Yellow' }
    Write-Host ("[{0}] {1} - {2}" -f $status, $name, $detail) -ForegroundColor $color
}

Write-Host "=== Wave-4 setup check ($RepoRoot) ===`n"

# 1. Node.js + npm
$node = Get-Command node
if ($node) { Report 'OK' 'Node.js' (node --version) '' }
else { Report 'FIX' 'Node.js' 'not found' 'Install Node.js LTS from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS)' }
$npm = Get-Command npm
if ($npm) { Report 'OK' 'npm' ('v' + (npm --version)) '' }
else { Report 'FIX' 'npm' 'not found (comes with Node.js)' 'Install Node.js' }

# 2. Git + identity + remote auth
$git = Get-Command git
if ($git) {
    Report 'OK' 'Git' ((git --version) -join ' ') ''
    $gname = git config user.name
    $gmail = git config user.email
    if ($gname -and $gmail) { Report 'OK' 'Git identity' "$gname <$gmail>" '' }
    else { Report 'FIX' 'Git identity' 'user.name / user.email not set (commits will fail)' 'git config --global user.name "Daniel" ; git config --global user.email "your@email"' }
    git fetch origin --dry-run 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Report 'OK' 'Git remote auth' 'fetch from origin works' '' }
    else { Report 'FIX' 'Git remote auth' 'cannot reach/auth origin (first push will fail)' 'Run: git fetch origin  - and complete the browser sign-in that Git Credential Manager opens' }
} else {
    Report 'FIX' 'Git' 'not found' 'winget install Git.Git  (then reopen the terminal)'
}

# 3. GitHub CLI
$gh = Get-Command gh
if ($gh) {
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Report 'OK' 'GitHub CLI' 'installed and logged in' '' }
    else { Report 'FIX' 'GitHub CLI' 'installed but NOT logged in (no PRs will be cut)' 'gh auth login  (GitHub.com -> HTTPS -> browser)' }
} else {
    Report 'FIX' 'GitHub CLI' 'not found (run continues, but no PRs will be cut)' 'winget install --id GitHub.cli  (then REOPEN the terminal, then: gh auth login)'
}

# 4. Claude Code CLI
$claude = Get-Command claude
if ($claude) { Report 'OK' 'Claude Code' ((claude --version) -join ' ') 'Also open one interactive "claude" session to confirm login + dismiss any Fable-credits prompt' }
else { Report 'FIX' 'Claude Code' 'not found' 'npm install -g @anthropic-ai/claude-code  (then run "claude" once and log in)' }

# 5. npx via cmd (the loop and ccusage depend on this path)
cmd /d /c "npx.cmd --version" > $null 2>&1
if ($LASTEXITCODE -eq 0) { Report 'OK' 'npx (cmd path)' 'works - usage monitoring will function' '' }
else { Report 'FIX' 'npx (cmd path)' 'npx.cmd failed' 'Reinstall Node.js LTS' }

# 6. Execution policy
$pol = Get-ExecutionPolicy -Scope CurrentUser
if ($pol -eq 'Restricted' -or $pol -eq 'Undefined') {
    $eff = Get-ExecutionPolicy
    if ($eff -eq 'Restricted') { Report 'WARN' 'Execution policy' "effective policy is $eff (npm .ps1 shims blocked in plain PowerShell)" 'Set-ExecutionPolicy -Scope CurrentUser RemoteSigned' }
    else { Report 'OK' 'Execution policy' "effective: $eff" '' }
} else { Report 'OK' 'Execution policy' "CurrentUser: $pol" '' }

# 7. Backend dependencies
if (Test-Path (Join-Path $RepoRoot 'backend\node_modules')) { Report 'OK' 'backend/node_modules' 'present' '' }
else { Report 'FIX' 'backend/node_modules' 'missing (fresh clone) - tests cannot run' 'cd backend ; npm install --include=dev' }

# 8. Local env files (gitignored - LOST in a re-clone unless restored from backup)
if (Test-Path (Join-Path $RepoRoot 'backend\.env')) { Report 'OK' 'backend/.env' 'present' '' }
else { Report 'WARN' 'backend/.env' 'missing (gitignored; a re-clone never has it). Tests mostly run without it; local dev server will not.' 'Recreate from backend\.env.example (or restore from backup) when you need the local server' }

# 9. Android release keystore (gitignored - UNRECOVERABLE if lost; SHA-1 registered with Google/Spotify)
$keystores = Get-ChildItem -Path (Join-Path $RepoRoot 'mobile') -Recurse -Include *.keystore, *.jks -File
if ($keystores) { Report 'OK' 'Release keystore' ($keystores[0].FullName.Substring($RepoRoot.Length + 1)) '' }
else { Report 'WARN' 'Release keystore' 'no .keystore/.jks found under mobile\ - if you did not back it up before formatting, release signing is lost (not needed for the Wave-4 run itself)' 'Restore the keystore from your backup when you get back to store/release work' }

# 10. Sleep settings (the 4-day run dies if the machine sleeps)
$acSleep = $null
try {
    $out = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null
    $line = ($out | Select-String 'Current AC Power Setting Index' | Select-Object -First 1).ToString()
    if ($line -match '0x([0-9a-fA-F]+)') { $acSleep = [convert]::ToInt32($Matches[1], 16) }
} catch {}
if ($acSleep -eq 0) { Report 'OK' 'Sleep (plugged in)' 'never sleeps' '' }
elseif ($acSleep -ne $null) { Report 'FIX' 'Sleep (plugged in)' ("sleeps after {0} min - the run will freeze" -f [int]($acSleep / 60)) 'powercfg /change standby-timeout-ac 0' }
else { Report 'WARN' 'Sleep (plugged in)' 'could not read setting' 'Check manually: Settings > System > Power > never sleep when plugged in' }

# 11. Wave-4 mission files present
$missing = @()
foreach ($f in 'docs\plans\WAVE4_INTELLIGENCE_MISSION.md', 'docs\plans\WAVE4_STATE.md', 'docs\plans\WAVE4_KICKOFF.md', 'scripts\run-mission.ps1') {
    if (-not (Test-Path (Join-Path $RepoRoot $f))) { $missing += $f }
}
if ($missing.Count -eq 0) { Report 'OK' 'Wave-4 mission files' 'all 4 present' '' }
else { Report 'FIX' 'Wave-4 mission files' ("missing: {0}" -f ($missing -join ', ')) 'Re-sync the mission package before launching' }

# --- summary -------------------------------------------------------------------------------
$fixes = @($results | Where-Object { $_.Status -eq 'FIX' })
$warns = @($results | Where-Object { $_.Status -eq 'WARN' })
Write-Host "`n=== Summary: $($fixes.Count) to fix, $($warns.Count) warnings ==="
if ($fixes.Count -gt 0) {
    Write-Host "`nRun these, then re-run this check:" -ForegroundColor Red
    foreach ($f in $fixes) { if ($f.Fix) { Write-Host ("  {0,-18} ->  {1}" -f $f.Name, $f.Fix) } }
}
if ($warns.Count -gt 0) {
    Write-Host "`nWorth knowing:" -ForegroundColor Yellow
    foreach ($w in $warns) { if ($w.Fix) { Write-Host ("  {0,-18} ->  {1}" -f $w.Name, $w.Fix) } }
}
if ($fixes.Count -eq 0) {
    Write-Host "`nAll clear. Final manual items: (1) run 'claude' once interactively to confirm login;" -ForegroundColor Green
    Write-Host "(2) cd backend ; npm test  - confirm the suite is green before launching the mission." -ForegroundColor Green
}
