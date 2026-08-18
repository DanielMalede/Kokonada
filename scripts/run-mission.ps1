# run-mission.ps1 — Wave 4 Runtime Intelligence autonomous loop (usage-aware)
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\run-mission.ps1
#
# MODEL POLICY (Daniel's ruling):
#   - phase "review" (the plan-review pass)  -> $PlanModel  (Fable, max reasoning)
#   - execution                              -> $ExecModel  (Opus, max reasoning)
#   - est. session-window usage >= 70%       -> $SaverModel (Sonnet) until the ~5h window resets
#   - est. session-window usage >= 95%       -> WAIT until the window resets (no session launched)
#   - weekly usage >= soft% -> Sonnet ; >= hard% -> WAIT (rechecks every 30 min)
#   Usage is ESTIMATED locally from Claude Code's own logs via `ccusage` (Anthropic does not expose
#   exact quota via API). Units are ccusage totalTokens (includes cache reads), so the estimate is a
#   PROXY, not the real quota. Therefore: gating stays OFF ("uncalibrated") until either you pass
#   -SessionTokenBudget / -WeeklyTokenBudget explicitly (recommended - compare logs\wave4\usage.log
#   token counts against /usage in the app, then divide), or >=2 COMPLETED 5h windows of local
#   history exist to calibrate from. The active window is never used to calibrate itself. Every wait
#   FAILS OPEN after -MaxConsecutiveWaits, and real limit errors are always handled (20 min retry).
#
# Stop at any time: create an empty file  docs\plans\WAVE4_HALT , or Ctrl+C in this window.
#
# WHILE A SESSION RUNS: the log file (logs\wave4\session-*.log) stays at 0 bytes for the
# WHOLE session - claude's output is buffered and only flushes when the process exits. Every
# ~3 min this window prints '[wave4] session N alive - ...' - as long as that keeps appearing,
# it is working normally. Do NOT close the window or Ctrl+C because the log looks empty; that
# kills real work and burns real tokens for nothing, since nothing is saved until the session
# ends on its own (max SessionTimeoutMin minutes, auto-killed and retried after that).

param(
    [int]$MaxIterations = 40,
    [int]$SessionTimeoutMin = 100,
    [int]$SleepBetweenSec = 60,

    # --- model policy ---
    [string]$PlanModel  = 'fable',    # review pass; if your CLI rejects the alias, set e.g. 'claude-fable-5'
    [string]$ExecModel  = 'opus',
    [string]$SaverModel = 'sonnet',
    [int]$SessionSwitchPct = 70,      # >= this % of session budget -> SaverModel
    [int]$SessionWaitPct   = 95,      # >= this % -> wait for window reset instead of launching
    [long]$SessionTokenBudget = 0,    # 0 = auto (max totalTokens over recent 5h blocks)
    [long]$WeeklyTokenBudget  = 0,    # 0 = monitor-only (no weekly gating, still logged)
    [int]$WeeklySoftPct = 75,         # >= this % of weekly budget -> SaverModel
    [int]$WeeklyHardPct = 90,         # >= this % -> pause (recheck every 30 min)
    [int]$MaxThinkingTokens = 31999,  # exported as MAX_THINKING_TOKENS for max reasoning; 0 = don't set
    [int]$MaxConsecutiveWaits = 2     # after this many no-change waits, FAIL OPEN (never deadlock a 4-day run)
)

$ErrorActionPreference = 'Continue'

# --- locate repo root (this script lives in <repo>\scripts) ---------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# --- single-instance guard -------------------------------------------------------------------
# 2026-08-19 incident: three copies of this script were accidentally launched at once and all
# three ran claude -p against the SAME working tree/branch/STATE file simultaneously (HITL H2).
# One session caught it mid-run and halted safely, but it could have raced two commits or two
# concurrent edits to WAVE4_STATE.md. A named mutex makes a second launch impossible instead of
# relying on a human never double-launching the loop.
$MissionMutex = New-Object System.Threading.Mutex($false, 'Global\KokonadaWave4Loop')
$gotMutex = $false
try {
    $gotMutex = $MissionMutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    # the previous holder died without releasing (crash / Task Manager kill) - ownership passes
    # to us safely; this is the self-healing case, not a collision.
    $gotMutex = $true
}
if (-not $gotMutex) {
    Write-Host '[wave4] another run-mission.ps1 is already running on this machine - exiting.'
    Write-Host '[wave4] if you believe that is wrong, check Task Manager for a stray claude/node process before retrying.'
    exit 1
}

$HaltFile = Join-Path $RepoRoot 'docs\plans\WAVE4_HALT'
$StateFile = Join-Path $RepoRoot 'docs\plans\WAVE4_STATE.md'
$LogDir   = Join-Path $RepoRoot 'logs\wave4'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$UsageLog = Join-Path $LogDir 'usage.log'

if ($MaxThinkingTokens -gt 0) { $env:MAX_THINKING_TOKENS = "$MaxThinkingTokens" }

# --- the session prompt (must match docs/plans/WAVE4_KICKOFF.md) ----------------------------
$Prompt = @'
ultrathink. This is a Wave-4 Runtime Intelligence session for the Kokonada repo.
Read docs/plans/WAVE4_INTELLIGENCE_MISSION.md fully, then docs/plans/WAVE4_STATE.md.
Follow the per-session protocol in the mission (section 2) exactly:
- If STATE phase is "review", run the W4-000 plan-mode review pass (read-only validation of the mission
  against the full repo), update the mission + STATE with deltas, set phase to "execute", commit, and exit.
- Otherwise execute exactly ONE next unblocked task from the queue under strict TDD, update STATE,
  commit with short single-line messages (no attribution of any kind), cut a PR if the cluster is complete, and exit.
- Model economy: env var WAVE4_MODEL_TIER tells you how you were launched (plan|exec|saver). On "saver",
  prefer an S/M task or continuing an in_progress task over STARTING a new L design task, if one is unblocked.
- Never merge PRs. Never touch cloud portals - write HITL tutorials into STATE instead and continue.
- If docs/plans/WAVE4_HALT exists, stop immediately.
End your final message with: WAVE4_SESSION_RESULT: <taskId> <done|in_progress|failed> <one-line summary>
(If the whole queue including W4-015 is done, end instead with: WAVE4_SESSION_RESULT: DONE-ALL complete)
'@

$PromptFile = Join-Path $LogDir 'session-prompt.txt'
Set-Content -Path $PromptFile -Value $Prompt -Encoding UTF8

# --- helpers --------------------------------------------------------------------------------

function Invoke-Ccusage([string]$SubArgs, [string]$OutFile) {
    # runs: npx -y ccusage@latest <SubArgs> --json --offline   (offline = skip pricing fetch; token counts unaffected)
    $cmd = "npx -y ccusage@latest $SubArgs --json --offline > `"$OutFile`" 2>nul"
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', $cmd -WindowStyle Hidden -PassThru
    if (-not $p.WaitForExit(120000)) { try { $p.Kill() } catch {}; return $null }
    if (-not (Test-Path $OutFile)) { return $null }
    try { return (Get-Content -Raw $OutFile | ConvertFrom-Json) } catch { return $null }
}

function Get-UsageSnapshot {
    $snap = [pscustomobject]@{
        SessionTokens = $null; SessionBudget = $null; SessionPct = $null; BlockEnd = $null
        WeeklyTokens = $null; WeeklyPct = $null
    }
    # session window (5h blocks, ccusage default)
    $bj = Invoke-Ccusage 'blocks --recent' (Join-Path $LogDir 'ccusage-blocks.json')
    if ($bj -and $bj.blocks) {
        $active = $bj.blocks | Where-Object { $_.isActive -eq $true } | Select-Object -First 1
        if ($active) {
            $snap.SessionTokens = [long]$active.totalTokens
            try { $snap.BlockEnd = ([DateTimeOffset]::Parse($active.endTime)).UtcDateTime } catch {}
        } else { $snap.SessionTokens = 0 }
        $budget = $SessionTokenBudget
        if ($budget -le 0) {
            # AUTO-CALIBRATION - only from COMPLETED windows, NEVER the active one: including the
            # active block makes the estimate self-referential (budget == current usage == 100%),
            # which is exactly the false WAIT-BLOCK seen on a fresh machine. Needs >=2 completed
            # windows of real history; below that stay UNCALIBRATED (monitor-only, no gating).
            $done = @($bj.blocks | Where-Object { $_.isGap -ne $true -and $_.isActive -ne $true -and [long]$_.totalTokens -ge 1000000 })
            if ($done.Count -ge 2) { $budget = [long](($done | Measure-Object -Property totalTokens -Maximum).Maximum) }
        }
        if ($budget -gt 0) {
            $snap.SessionBudget = $budget
            $snap.SessionPct = [math]::Round(100.0 * $snap.SessionTokens / $budget, 1)
        }
    }
    # rolling 7-day estimate
    $since = (Get-Date).AddDays(-6).ToString('yyyyMMdd')
    $dj = Invoke-Ccusage "daily --since $since" (Join-Path $LogDir 'ccusage-daily.json')
    if ($dj -and $dj.daily) {
        $sum = 0L
        foreach ($d in $dj.daily) {
            if ($d.PSObject.Properties['totalTokens']) { $sum += [long]$d.totalTokens }
            else { $sum += [long]$d.inputTokens + [long]$d.outputTokens + [long]$d.cacheCreationTokens + [long]$d.cacheReadTokens }
        }
        $snap.WeeklyTokens = $sum
        if ($WeeklyTokenBudget -gt 0) { $snap.WeeklyPct = [math]::Round(100.0 * $sum / $WeeklyTokenBudget, 1) }
    }
    return $snap
}

function Get-Phase {
    if (Test-Path $StateFile) {
        $m = Select-String -Path $StateFile -Pattern 'phase:\s*(\w+)' | Select-Object -First 1
        if ($m) { return $m.Matches[0].Groups[1].Value }
    }
    return 'execute'
}

function Log-Usage([string]$line) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $UsageLog -Value "$ts  $line"
    Write-Host "[wave4] $line"
}

# --- main loop ------------------------------------------------------------------------------

$consecutiveFailures = 0
$planModelBroken = $false
$sessionsLaunched = 0
$consecutiveWaits = 0
$forceSaver = $false

while ($sessionsLaunched -lt $MaxIterations) {

    # 1. halt check
    if (Test-Path $HaltFile) { Write-Host "[wave4] HALT file present - stopping. ($HaltFile)"; break }

    # 2. usage snapshot -> model decision
    $u = Get-UsageSnapshot
    $phase = Get-Phase
    $sessPctTxt = 'uncalibrated'
    if ($u.SessionPct -ne $null) { $sessPctTxt = "$($u.SessionPct)%" }
    if ($u.SessionTokens -ne $null) { $sessPctTxt = "$sessPctTxt [$([math]::Round($u.SessionTokens/1e6,1))M tok]" }
    $weekTxt = 'n/a'
    if ($u.WeeklyTokens -ne $null) {
        $weekTxt = "$([math]::Round($u.WeeklyTokens/1e6,1))M tok"
        if ($u.WeeklyPct -ne $null) { $weekTxt = "$weekTxt ($($u.WeeklyPct)%)" }
    }

    # --- wait gates. FAIL-OPEN by design: these run on a LOCAL ESTIMATE (ccusage token
    # counts), not on the real quota, so a miscalibrated estimate must never deadlock a
    # 4-day run. After $MaxConsecutiveWaits no-change waits we proceed anyway on the saver
    # model; a genuine limit is still caught by the limit-error handler below (20 min retry).
    $waitReason = $null
    $waitSec = 900
    if ($u.WeeklyPct -ne $null -and $u.WeeklyPct -ge $WeeklyHardPct) {
        $waitReason = "weekly est $weekTxt >= $WeeklyHardPct%"; $waitSec = 1800
    } elseif ($u.SessionPct -ne $null -and $u.SessionPct -ge $SessionWaitPct) {
        if ($u.BlockEnd) {
            $delta = ($u.BlockEnd - (Get-Date).ToUniversalTime()).TotalSeconds + 120
            if ($delta -gt 0) { $waitSec = [int][math]::Min($delta, 3600) }
        }
        $waitReason = "session est $sessPctTxt >= $SessionWaitPct%"
    }
    if ($waitReason) {
        $consecutiveWaits++
        if ($consecutiveWaits -le $MaxConsecutiveWaits) {
            Log-Usage "WAIT: $waitReason - sleeping $([int]($waitSec/60)) min (wait $consecutiveWaits/$MaxConsecutiveWaits)"
            Start-Sleep -Seconds $waitSec
            continue
        }
        Log-Usage "FAIL-OPEN: $waitReason persisted across $consecutiveWaits waits - estimate is likely miscalibrated; proceeding on $SaverModel"
        $forceSaver = $true
    } else {
        $consecutiveWaits = 0
        $forceSaver = $false
    }

    # model selection
    $tier = 'exec'; $model = $ExecModel
    if ($phase -eq 'review' -and -not $planModelBroken) { $tier = 'plan'; $model = $PlanModel }
    $saverReason = $null
    if ($u.SessionPct -ne $null -and $u.SessionPct -ge $SessionSwitchPct) { $saverReason = "session $sessPctTxt >= $SessionSwitchPct%" }
    if ($u.WeeklyPct -ne $null -and $u.WeeklyPct -ge $WeeklySoftPct) { $saverReason = "weekly $($u.WeeklyPct)% >= $WeeklySoftPct%" }
    if ($forceSaver) { $saverReason = 'fail-open guard' }
    if ($saverReason -and $tier -ne 'plan') { $tier = 'saver'; $model = $SaverModel }   # the review pass stays on the plan model
    $env:WAVE4_MODEL_TIER = $tier

    # 3. freshen remote view (mission handles divergence policy inside the session)
    try { git fetch origin 2>&1 | Out-Null } catch { Write-Host '[wave4] git fetch failed (offline?) - continuing' }

    # 4. run one session
    $sessionsLaunched++
    $i = $sessionsLaunched
    $stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
    $LogFile = Join-Path $LogDir ("session-{0:d3}-{1}.log" -f $i, $stamp)
    $ErrFile = "$LogFile.err"
    Log-Usage "session $i/$MaxIterations  model=$model tier=$tier phase=$phase  session-window=$sessPctTxt  weekly=$weekTxt"

    $cmdLine = "claude -p --model $model --dangerously-skip-permissions < `"$PromptFile`" > `"$LogFile`" 2> `"$ErrFile`""
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', $cmdLine `
              -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru

    # Poll with a heartbeat instead of one blocking WaitForExit. IMPORTANT: the log file
    # legitimately stays at 0 bytes for the ENTIRE session - claude's stdout is fully buffered
    # once redirected to a file, so nothing flushes until the process exits. An empty log is
    # NOT a hang. Only the timeout below (or Ctrl+C on this window) should ever stop a session -
    # killing it early on a hunch wastes real tokens AND discards all progress, since nothing is
    # committed until the session ends on its own.
    $sessionStart = Get-Date
    $deadline = $sessionStart.AddMinutes($SessionTimeoutMin)
    $lastBeat = $sessionStart
    while (-not $proc.HasExited -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 15
        if (((Get-Date) - $lastBeat).TotalSeconds -ge 180) {
            $lastBeat = Get-Date
            $elapsedMin = [int]((Get-Date) - $sessionStart).TotalMinutes
            $sz = 0
            if (Test-Path $LogFile) { $sz = (Get-Item $LogFile).Length }
            Write-Host "[wave4] session $i alive - ${elapsedMin}m/${SessionTimeoutMin}m elapsed, log=$sz bytes (0 is normal mid-session - do NOT close this window)"
        }
    }
    if ($proc.HasExited) {
        $finished = $true
        $exitCode = $proc.ExitCode
    } else {
        $finished = $false
        Write-Host "[wave4] session $i exceeded $SessionTimeoutMin min - killing"
        try { $proc.Kill() } catch {}
        $exitCode = 124
    }

    # 5. classify the outcome
    $marker = $null
    if (Test-Path $LogFile) {
        $marker = Select-String -Path $LogFile -Pattern 'WAVE4_SESSION_RESULT:' -SimpleMatch | Select-Object -Last 1
    }

    if (($exitCode -eq 0) -and $marker) {
        $consecutiveFailures = 0
        Log-Usage "$($marker.Line.Trim())"
        if ($marker.Line -match 'WAVE4_SESSION_RESULT:\s*DONE-ALL') { Write-Host '[wave4] queue reported complete - stopping.'; break }
    } else {
        # limit / overload errors are NOT failures - wait and retry
        $errText = ''
        foreach ($f in @($LogFile, $ErrFile)) { if (Test-Path $f) { $errText += (Get-Content -Raw $f) } }
        if ($errText -match '(?i)usage limit|rate.?limit|limit reached|quota|overloaded|429') {
            Log-Usage "session $i hit a usage/rate limit - waiting 20 min (not counted as failure)"
            $sessionsLaunched--   # this attempt doesn't consume the iteration budget
            Start-Sleep -Seconds 1200
            continue
        }
        # a model-flag rejection on the plan model -> fall back to the exec model for the review pass
        if ($tier -eq 'plan' -and $errText -match '(?i)model') {
            $planModelBroken = $true
            Log-Usage "plan model '$PlanModel' rejected - review pass will retry on '$ExecModel'"
        }
        $consecutiveFailures++
        Log-Usage "session $i FAILED (exit=$exitCode, marker=$([bool]$marker)) - consecutive failures: $consecutiveFailures"
        if ($consecutiveFailures -ge 3) {
            Set-Content -Path $HaltFile -Value "auto-halt: 3 consecutive failed sessions (last: session $i, exit $exitCode). See $LogDir."
            Write-Host '[wave4] 3 consecutive failures - HALT file written, stopping.'
            break
        }
    }

    # 6. breathe
    Start-Sleep -Seconds $SleepBetweenSec
}

Write-Host '[wave4] loop finished. State: docs\plans\WAVE4_STATE.md ; usage: logs\wave4\usage.log ; report (when closeout ran): docs\plans\WAVE4_REPORT.md'
try { $MissionMutex.ReleaseMutex() } catch {}
