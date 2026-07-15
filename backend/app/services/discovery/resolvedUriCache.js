'use strict';

// Which serve-time-translated tracks to cache back to the discovery catalog: ONLY discovery
// candidates whose recordingKey is a NATIVE `youtube:` key, resolved to a spotify: URI. Familiar
// library tracks and already-spotify passthroughs (no translatedFrom flag) are excluded. Pure, no I/O.
//
// The `youtube:` allowlist is load-bearing (ADR-0010 §1): a canonical `mbid:` GLOBAL corpus row must
// NEVER get a market-specific spotify: playback id cached onto it — that resolution is per-user and
// ephemeral, and a shared row would leak one user's market to another. translateToSpotify hardcodes
// translatedFrom:'youtube' for any non-spotify source, so we gate on the native key prefix, not that flag.
function resolvedDiscoveryUris(tracks = []) {
  const seen = new Set();
  const out = [];
  for (const t of (tracks || [])) {
    if (!t || !t.isDiscovery || t.translatedFrom !== 'youtube') continue;
    if (typeof t.recordingKey !== 'string' || !t.recordingKey.startsWith('youtube:')) continue;
    if (typeof t.uri !== 'string' || !t.uri.startsWith('spotify:')) continue;
    if (seen.has(t.recordingKey)) continue;      // dedupe within a batch
    seen.add(t.recordingKey);
    out.push({ recordingKey: t.recordingKey, uri: t.uri });
  }
  return out;
}

module.exports = { resolvedDiscoveryUris };
