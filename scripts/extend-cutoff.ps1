param(
    # New hard cutoff, in the same format STATE uses: yyyy-MM-ddTHH:mm (local time).
    # Default pushes the wall to 2026-08-31 22:56 local (~9 extra days of slack).
    [string]$NewCutoff = '2026-08-31T22:56'
)

$ErrorActionPreference = 'Stop'
$state = 'docs\plans\WAVE4_STATE.md'

if (-not (Test-Path $state)) {
    Write-Host "[cutoff] cannot find $state - run this from the repo root."
    exit 1
}

# Validate the value before touching the file, so a typo can never write a broken header.
$parsed = [datetime]::MinValue
if (-not [datetime]::TryParseExact($NewCutoff, 'yyyy-MM-ddTHH:mm', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$parsed)) {
    Write-Host "[cutoff] '$NewCutoff' is not in the required yyyy-MM-ddTHH:mm format - aborting."
    exit 1
}
if ($parsed -lt (Get-Date)) {
    Write-Host "[cutoff] '$NewCutoff' is in the past - aborting rather than halting the run instantly."
    exit 1
}

$content = Get-Content -Raw $state

# Match the whole header line by its key, so this is safe to re-run and independent of the old value.
$pattern = '(?m)^- day4CutoffAt: .*$'
$match = [regex]::Match($content, $pattern)
if (-not $match.Success) {
    Write-Host '[cutoff] could not find the day4CutoffAt line in the Run header - aborting without changes.'
    exit 1
}

$oldLine = $match.Value
$newLine = "- day4CutoffAt: $NewCutoff local (EXTENDED by Daniel - the original runStartedAt + 96h wall did not account for the deliberate pauses he takes to free up token capacity, which burn wall-clock without producing work. Extend again with scripts\extend-cutoff.ps1 if more time is wanted. The cutoff is kept rather than removed because it is what guarantees W4-015 closeout still runs and Daniel gets the packaged deliverable; after this timestamp, only W4-015 may run.)"

if ($oldLine -eq $newLine) {
    Write-Host '[cutoff] the cutoff line already says exactly this - nothing to do.'
    exit 0
}

$updated = $content.Replace($oldLine, $newLine)
if ($updated -eq $content) {
    Write-Host '[cutoff] replacement produced no change - aborting.'
    exit 1
}

Set-Content -Path $state -Value $updated -NoNewline -Encoding UTF8

# Verify from disk rather than trusting the in-memory string.
$check = [regex]::Match((Get-Content -Raw $state), $pattern)
if ($check.Success -and $check.Value -eq $newLine) {
    Write-Host '[cutoff] updated and verified.'
    Write-Host "[cutoff]   was: $oldLine"
    Write-Host "[cutoff]   now: day4CutoffAt = $NewCutoff local"
} else {
    Write-Host '[cutoff] WARNING: write completed but verification failed - check the Run header by hand.'
    exit 1
}
