// When a discovery track fails to play, the app reports its recordingKey so the backend
// can null the stale cached resolved URI (T3 self-heal). These tests pin the reporter's
// contract: fire-and-forget (never throws, returns undefined synchronously), per-session
// dedupe (one report per key), and a hard guard against non-string / empty keys (familiar
// tracks have no recordingKey — nothing to heal).

import { createPlaybackFailureReporter } from '../playbackFailureReporter';

function build() {
  const post = jest.fn().mockResolvedValue({ ok: true, data: {} });
  const report = createPlaybackFailureReporter({ post });
  return { report, post };
}

describe('playbackFailureReporter — dedupe + fire-and-forget', () => {
  it('posts a valid recordingKey exactly once to the self-heal endpoint', () => {
    const { report, post } = build();
    report('youtube:abc');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/discovery/playback-failed', { recordingKey: 'youtube:abc' });
  });

  it('dedupes the SAME key within a session (reports once even when seen twice)', () => {
    const { report, post } = build();
    report('youtube:abc');
    report('youtube:abc');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reports two DISTINCT keys once each', () => {
    const { report, post } = build();
    report('youtube:abc');
    report('youtube:def');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, '/api/discovery/playback-failed', { recordingKey: 'youtube:abc' });
    expect(post).toHaveBeenNthCalledWith(2, '/api/discovery/playback-failed', { recordingKey: 'youtube:def' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['a non-string number', 123 as unknown as string],
  ])('does NOT post for %s (no key → nothing to heal)', (_label, key) => {
    const { report, post } = build();
    report(key as string | null | undefined);
    expect(post).not.toHaveBeenCalled();
  });

  it('is fire-and-forget: returns undefined synchronously and never throws even if post rejects', () => {
    const post = jest.fn().mockReturnValue(Promise.reject(new Error('x')));
    const report = createPlaybackFailureReporter({ post });
    let result: unknown;
    expect(() => { result = report('youtube:a'); }).not.toThrow();
    expect(result).toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
