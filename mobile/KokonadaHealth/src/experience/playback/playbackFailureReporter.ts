import { apiPost } from '../../net/apiClient';

// Reports a discovery track's on-device playback failure so the backend can null its stale cached
// resolved URI (T3 self-heal, event-driven). FIRE-AND-FORGET: never awaited, never throws, never blocks
// playback (apiPost already resolves to a typed result, never rejects). Per-session dedupe so a retried or
// re-seen dead track is not reported (or rate-limited) twice — one report per key per app session is enough
// (the backend nulls it once; further reports would be redundant).
export type ReportPlaybackFailure = (recordingKey: string | null | undefined) => void;

export function createPlaybackFailureReporter(deps: { post: typeof apiPost }): ReportPlaybackFailure {
  const reported = new Set<string>();
  return (recordingKey) => {
    if (typeof recordingKey !== 'string' || !recordingKey) return; // familiar track / no key → nothing to heal
    if (reported.has(recordingKey)) return;                        // already reported this session
    reported.add(recordingKey);
    // .catch keeps fire-and-forget honest: apiPost never rejects, but if post ever did, the
    // rejection is swallowed here rather than surfacing as an unhandled rejection.
    void deps.post('/api/discovery/playback-failed', { recordingKey }).catch(() => {});
  };
}

// Production singleton bound to the app's authenticated apiPost.
export const reportPlaybackFailure: ReportPlaybackFailure = createPlaybackFailureReporter({ post: apiPost });
