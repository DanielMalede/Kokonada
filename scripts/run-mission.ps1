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
#   exact quota via API). Units are ccusage totalTokens (includes cache reads). Budgets auto-calibrate
#   from your recent history, or set -SessionTokenBudget / -WeeklyTokenBudget explicitly after
#   comparing with /usage in the app.
#
# Stop at any time: create an empty file  docs\plans\WAVE4_HALT , or Ctrl+C in this window.

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
    [int]$MaxThinkingTokens = 31999   # exported as MAX_THINKING_TOKENS for max reasoning; 0 = don't set
)

$ErrorActionPreference = 'Continue'

# --- locate repo root (this script lives in <repo>\scripts) ---------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

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
            $max = ($bj.blocks | Where-Object { $_.isGap -ne $true } | Measure-Object -Property totalTokens -Maximum).Maximum
            if ($max -ge 1000000) { $budget = [long]$max }   # auto-calibrate only once history is meaningful
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

while ($sessionsLaunched -lt $MaxIterations) {

    # 1. halt check
    if (Test-Path $HaltFile) { Write-Host "[wave4] HALT file present - stopping. ($HaltFile)"; break }

    # 2. usage snapshot -> model decision
    $u = Get-UsageSnapshot
    $phase = Get-Phase
    $sessPctTxt = 'n/a'; if ($u.SessionPct -ne $null) { $sessPctTxt = "$($u.SessionPct)%" }
    $weekTxt = 'n/a'
    if ($u.WeeklyTokens -ne $null) {
        $weekTxt = "$([math]::Round($u.WeeklyTokens/1e6,1))M tok"
        if ($u.WeeklyPct -ne $null) { $weekTxt = "$weekTxt ($($u.WeeklyPct)%)" }
    }

    # weekly hard gate
    if ($u.WeeklyPct -ne $null -and $u.WeeklyPct -ge $WeeklyHardPct) {
        Log-Usage "WAIT-WEEKLY: weekly est $weekTxt >= $WeeklyHardPct% - sleeping 30 min"
        Start-Sleep -Seconds 1800
        continue
    }
    # session-window wait gate
    if ($u.SessionPct -ne $null -and $u.SessionPct -ge $SessionWaitPct) {
        $sleepSec = 900
        if ($u.BlockEnd) {
            $delta = ($u.BlockEnd - (Get-Date).ToUniversalTime()).TotalSeconds + 120
            if ($delta -gt 0) { $sleepSec = [int][math]::Min($delta, 3600) }
        }
        Log-Usage "WAIT-BLOCK: session est $sessPctTxt >= $SessionWaitPct% - sleeping $([int]($sleepSec/60)) min until window reset"
        Start-Sleep -Seconds $sleepSec
        continue
    }

    # model selection
    $tier = 'exec'; $model = $ExecModel
    if ($phase -eq 'review' -and -not $planModelBroken) { $tier = 'plan'; $model = $PlanModel }
    $saverReason = $null
    if ($u.SessionPct -ne $null -and $u.SessionPct -ge $SessionSwitchPct) { $saverReason = "session $sessPctTxt >= $SessionSwitchPct%" }
    if ($u.WeeklyPct -ne $null -and $u.WeeklyPct -ge $WeeklySoftPct) { $saverReason = "weekly $($u.WeeklyPct)% >= $WeeklySoftPct%" }
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

    $finished = $proc.WaitForExit($SessionTimeoutMin * 60 * 1000)
    if (-not $finished) {
        Write-Host "[wave4] session $i exceeded $SessionTimeoutMin min - killing"
        try { $proc.Kill() } catch {}
        $exitCode = 124
    } else { $exitCode = $proc.ExitCode }

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
