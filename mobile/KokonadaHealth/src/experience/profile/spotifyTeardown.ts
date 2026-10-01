// The local half of Disconnect Spotify (HX-2 M8): once the server has erased the Spotify data, the
// device stops using Spotify too. Each step is injected so the ORDER is unit-tested, and each is
// best-effort — a remote that is already gone must not leave a queue or a Now Playing card behind.

export interface SpotifyTeardownDeps {
  disposePlayer: () => Promise<void> | void;    // pause audio, then sever the App Remote link
  clearQueue: () => void;                       // the orchestrator's queued tracks and context
  resetNowPlaying: () => void;                  // track, playing state and cover
  markDisconnected: () => void;                 // the status the Profile row reads
}

async function safe(fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); } catch { /* best-effort: one failed step must not block the rest */ }
}

export async function teardownSpotifyPlayback(deps: SpotifyTeardownDeps): Promise<void> {
  // Audio stops first, so nothing keeps playing while the queue is cleared under it.
  await safe(deps.disposePlayer);
  await safe(deps.clearQueue);
  await safe(deps.resetNowPlaying);
  await safe(deps.markDisconnected);
}
