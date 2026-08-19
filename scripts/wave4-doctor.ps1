# wave4-doctor.ps1 — read-only diagnostic for the Wave-4 run.
# Answers: is more than one session running (H5)?  which node processes are stale (H3)?
# It CHANGES NOTHING. It prints a suggested cleanup command you can copy if you agree with it.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\wave4-doctor.ps1

$ErrorActionPreference = 'Continue'
$now = Get-Date

function Age([datetime]$t) {
    $m = [int]((New-TimeSpan -Start $t -End $now).TotalMinutes)
    if ($m -lt 90) { return "$m min" }
    return "{0:n1} h" -f ($m / 60)
}

Write-Host ''
Write-Host '=== H5: how many Claude sessions are running? ===' -ForegroundColor Cyan
# BUG FIXED 2026-08-19: this used to filter Win32_Process on Name='node.exe' only.
# On this machine the CLI is a native binary (C:\Users\danie\.local\bin\claude.exe),
# not a node.exe wrapper - so every real headless/interactive session was invisible
# to the WMI query itself, before the CommandLine check ever ran. That produced a
# false "none running" while run-mission.ps1 (PID 13256) was live the whole time.
# Fix: match on process name 'claude.exe' OR 'node.exe' (covers both the native CLI
# and any node-launched invocation), and explicitly exclude Chromium/Electron child
# processes (--type=renderer/gpu-process/utility/zygote) so the desktop app's own
# helper processes never masquerade as extra CLI sessions (that caused the H5 false
# alarm investigated separately).
$claude = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='claude.exe'" |
    Where-Object {
        $_.CommandLine -match 'claude' -and
        $_.CommandLine -notmatch 'wave4-doctor' -and
        $_.CommandLine -notmatch '--type='
    })
if ($claude.Count -eq 0) {
    Write-Host '  none running - the loop is between sessions, waiting, or stopped.'
} else {
    foreach ($p in $claude) {
        $start = $p.CreationDate
        $headless = if ($p.CommandLine -match '\s-p\b|--print') { 'headless (from the loop)' } else { 'INTERACTIVE (started by hand)' }
        Write-Host ("  PID {0,-7} started {1,-20} age {2,-8} {3}" -f $p.ProcessId, $start.ToString('HH:mm:ss'), (Age $start), $headless)
    }
    if ($claude.Count -eq 1) {
        Write-Host '  -> exactly one session. This is the healthy state.' -ForegroundColor Green
    } else {
        Write-Host ("  -> {0} sessions at once. THIS IS THE H2/H5 CONDITION." -f $claude.Count) -ForegroundColor Yellow
        Write-Host '     Only one may write this working tree. Decide which to keep and close the others.'
    }
}

Write-Host ''
Write-Host '=== H3: stale test processes ===' -ForegroundColor Cyan
# A real jest run finishes in ~80 s. Anything matching jest/worker.test still alive after 30 min is stranded.
$allNode = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
$stale = @($allNode | Where-Object {
    $_.CommandLine -match 'jest|worker\.test' -and
    (New-TimeSpan -Start $_.CreationDate -End $now).TotalMinutes -gt 30
})
Write-Host ("  node.exe processes total: {0}" -f $allNode.Count)
if ($stale.Count -eq 0) {
    Write-Host '  no stale test processes found - nothing to clean up.' -ForegroundColor Green
} else {
    foreach ($p in $stale) {
        Write-Host ("  PID {0,-7} started {1,-20} age {2}" -f $p.ProcessId, $p.CreationDate.ToString('MM-dd HH:mm'), (Age $p.CreationDate))
    }
    Write-Host ''
    Write-Host ("  -> {0} stranded test process(es). Safe to kill - they are finished jest workers holding" -f $stale.Count) -ForegroundColor Yellow
    Write-Host '     open handles. The command below kills ONLY these PIDs, never the live session:'
    Write-Host ''
    Write-Host ("     Stop-Process -Id {0} -Force" -f ($stale.ProcessId -join ',')) -ForegroundColor White
}

Write-Host ''
Write-Host '=== NEVER do this ===' -ForegroundColor Red
Write-Host '  Stop-Process -Name node -Force     <-- kills the running Wave-4 session too, losing its work.'
Write-Host '  Always kill by PID, from the list above.'
Write-Host ''
