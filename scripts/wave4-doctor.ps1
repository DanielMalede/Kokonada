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
# BUG #1 FIXED 2026-08-19 (false NEGATIVE): this used to filter Win32_Process on
# Name='node.exe' only. The real CLI is a native binary
# (C:\Users\danie\.local\bin\claude.exe), not a node.exe wrapper - so every real
# headless/interactive session was invisible to the WMI query itself, before the
# CommandLine check ever ran. That produced a false "none running" while
# run-mission.ps1 (PID 13256) was live the whole time.
#
# BUG #2 FIXED 2026-08-19 (false POSITIVE, found right after fixing #1): widening
# the Name filter to 'claude.exe' also caught the Claude DESKTOP app's own main
# process (PID 31104 in the report that surfaced this - alive since the app was
# opened, its command line legitimately contains 'claude' and no --type= flag
# since it's the parent, not a renderer child). It got misreported as a second
# INTERACTIVE session competing with the real loop.
#
# Fix for #2: the one thing that reliably tells the real CLI apart from the
# desktop app is WHERE it is installed. The CLI always runs from $cliPath below.
# Match on ExecutablePath first; only fall back to name+commandline heuristics
# (and label the result as unverified) when ExecutablePath can't be read.
$cliPath = 'C:\Users\danie\.local\bin\claude.exe'

$candidates = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='claude.exe'" |
    Where-Object {
        $_.CommandLine -match 'claude' -and
        $_.CommandLine -notmatch 'wave4-doctor' -and
        $_.CommandLine -notmatch '--type='
    })

$claude = @($candidates | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $cliPath) })
$unverified = @($candidates | Where-Object { -not ($_.ExecutablePath -and ($_.ExecutablePath -ieq $cliPath)) })

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
if ($unverified.Count -gt 0) {
    Write-Host ''
    Write-Host ("  ({0} other process(es) matched the name/commandline check but do NOT run from {1} -" -f $unverified.Count, $cliPath) -ForegroundColor DarkGray
    Write-Host '   most likely the Claude desktop app, not a CLI session. Listed for transparency, NOT counted above:' -ForegroundColor DarkGray
    foreach ($p in $unverified) {
        $path = if ($p.ExecutablePath) { $p.ExecutablePath } else { '(path unreadable)' }
        Write-Host ("     PID {0,-7} started {1,-20} age {2,-8} path: {3}" -f $p.ProcessId, $p.CreationDate.ToString('HH:mm:ss'), (Age $p.CreationDate), $path) -ForegroundColor DarkGray
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
