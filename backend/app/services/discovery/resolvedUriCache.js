'use strict';

// Which serve-time-translated tracks to cache back to the discovery catalog: ONLY discovery
// candidates resolved FROM youtube to a spotify: URI, keyed by their native recordingKey. Familiar
// library tracks and already-spotify passthroughs (no translatedFrom flag) are excluded. Pure, no I/O.
function resolvedDiscoveryUris(tracks = []) {
  const seen = new Set();
  const out = [];
  for (const t of (tracks || [])) {
    if (!t || !t.isDiscovery || t.translatedFrom !== 'youtube') continue;
    if (typeof t.recordingKey !== 'string' || !t.recordingKey) continue;
    if (typeof t.uri !== 'string' || !t.uri.startsWith('spotify:')) continue;
    if (seen.has(t.recordingKey)) continue;      // dedupe within a batch
    seen.add(t.recordingKey);
    out.push({ recordingKey: t.recordingKey, uri: t.uri });
  }
  return out;
}

module.exports = { resolvedDiscoveryUris };
