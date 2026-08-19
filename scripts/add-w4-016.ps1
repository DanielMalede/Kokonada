# add-w4-016.ps1 — inserts the W4-016 row into WAVE4_STATE.md's task table.
# Safe to run while the loop is live: it is a single targeted insertion, it verifies before and
# after, and it refuses to act twice. Run it from the repo root.

$ErrorActionPreference = 'Stop'
$state = 'docs\plans\WAVE4_STATE.md'

if (-not (Test-Path $state)) { Write-Host "[w4-016] cannot find $state - run this from the repo root."; exit 1 }

$content = Get-Content -Raw $state

if ($content -match '\|\s*W4-016\s*\|') {
    Write-Host '[w4-016] a W4-016 row already exists - nothing to do.'
    exit 0
}

# Anchor: insert directly BEFORE the W4-015 closeout row, which must stay last in the table.
$anchor = ($content -split "`n" | Where-Object { $_ -match '^\|\s*W4-015\s*\|' } | Select-Object -First 1)
if (-not $anchor) { Write-Host '[w4-016] could not find the W4-015 row - aborting without changes.'; exit 1 }

$row = '| W4-016 | LLM candidate-generation band from the real state source | MUST | M | 004 | pending | — | **Added by Daniel 2026-08-19, outside the original queue.** Full spec: `docs/plans/WAVE4_TASK_W4-016.md` (read it before starting). `geminiEngine.js:235` (`_buildBiometricPrompt`) calls `bandFromHeartRate` directly and `geminiEngine.js:326` passes only `{heartRate}` to `applyBiometricBands`, so both fall through `biometricBand`''s preference chain to the hardcoded 90/120 ladder — the LLM that GENERATES the candidate pool never sees personal baselines or taxonomy state. Fix = populate the context (`stateLabel`, `hrRatio`), not rewrite `biometricBand`. Kill-switch `WAVE4_LLM_BAND_FROM_STATE_DISABLED`. Prompt must still carry the band string ONLY — no vitals, no labels (§0.2.2). |'

$updated = $content.Replace($anchor, $row + "`n" + $anchor)

if ($updated -eq $content) { Write-Host '[w4-016] insertion produced no change - aborting.'; exit 1 }

Set-Content -Path $state -Value $updated -NoNewline -Encoding UTF8

$check = Get-Content -Raw $state
if ($check -match '\|\s*W4-016\s*\|' -and $check -match '\|\s*W4-015\s*\|') {
    Write-Host '[w4-016] row inserted and verified. W4-015 still present and still last.'
} else {
    Write-Host '[w4-016] VERIFICATION FAILED - inspect docs\plans\WAVE4_STATE.md before committing.'
    exit 1
}
