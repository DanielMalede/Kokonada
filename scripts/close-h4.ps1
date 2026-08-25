$ErrorActionPreference = 'Stop'
$state = 'docs\plans\WAVE4_STATE.md'
if (-not (Test-Path $state)) { Write-Host "[h4-close] cannot find $state - run this from the repo root."; exit 1 }
$content = Get-Content -Raw $state

$marker = 'RESOLVED 2026-08-20 (Daniel, via Atlas UI + an out-of-band session with a real MongoDB MCP connection)'
if ($content -match [regex]::Escape($marker)) {
    Write-Host '[h4-close] H4 resolution already present - nothing to do.'
    exit 0
}

$anchor = '**H4 stays OPEN until Daniel runs it and the read-back shows both indexes.**'
if ($content -notmatch [regex]::Escape($anchor)) {
    Write-Host '[h4-close] could not find the expected H4 anchor sentence - aborting without changes.'
    Write-Host '[h4-close] the H4 entry may have been edited since this script was written; close it by hand instead.'
    exit 1
}

$resolution = @'


  **RESOLVED 2026-08-20 (Daniel, via Atlas UI + an out-of-band session with a real MongoDB MCP connection).** Target confirmed as production first, not assumed: `cluster0.aowqhlx.mongodb.net` has exactly one application database (`test` - `admin`/`config`/`local` are MongoDB-internal), Daniel is the sole user account writing to it right now, and no other database exists to confuse it with - so `test` genuinely is production at this stage, not a dev artifact. The out-of-band session built the query index `userId_1_metric_1_recordedAt_-1` cleanly through the MongoDB MCP server and verified it real and server-side via `$indexStats`. **The TTL index needed a second pass and a human eye to catch it:** the MCP server's `create-index` tool schema only formally documents `type` + `keys` for a classic index, no `expireAfterSeconds` field - the session passed it anyway, but could not mechanically prove server-side whether it landed, and said so rather than claiming success on an unverified point. Daniel checked the Atlas UI's Indexes tab directly: the first attempt (`recordedAt_1_ttl`) showed as plain `REGULAR` with no `TTL` badge, confirming the option had been silently dropped exactly as feared - a TTL index built without it that would have expired nothing, forever, silently. Fix: dropped that index (empty, 0 uses, safe) and rebuilt it through Atlas's own index-creation UI, which has explicit native TTL support. Confirmed in the UI: `recordedAt_1_1`, `TTL` badge, `expireAfterSeconds: 7776000` (90 days), status `READY`. Both indexes are now real, server-side and correct: `userId_1_metric_1_recordedAt_-1` (compound query index, `READY`) and `recordedAt_1_1` (TTL, `expireAfterSeconds: 7776000`, `READY`). **H4 CLOSED.**
'@

$updated = $content.Replace($anchor, $anchor + $resolution)
if ($updated -eq $content) { Write-Host '[h4-close] insertion produced no change - aborting.'; exit 1 }

Set-Content -Path $state -Value $updated -NoNewline -Encoding UTF8

if ((Get-Content -Raw $state) -match [regex]::Escape($marker)) {
    Write-Host '[h4-close] H4 resolution inserted and verified.'
} else {
    Write-Host '[h4-close] WARNING: write completed but verification did not find the marker - check the file by hand.'
    exit 1
}
